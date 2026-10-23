package whatsapp

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strconv"
	"time"
)

const whatsappOutboxPreparationLimit = 6

func whatsappOutboxPreparationCount(payload map[string]any) int {
	value, exists := payload["preparation_attempts"]
	if !exists {
		return 0
	}
	if number, ok := value.(float64); ok && (math.IsNaN(number) || math.IsInf(number, 0) || math.Trunc(number) != number) {
		return whatsappOutboxPreparationLimit
	}
	count, err := strconv.Atoi(stringFromAny(value))
	if err != nil || count < 0 || count > whatsappOutboxPreparationLimit {
		// Corrupt internal state must never silently reset a retry budget.
		return whatsappOutboxPreparationLimit
	}
	return count
}

func whatsappOutboxPreparationDelay(count int) time.Duration {
	if count < 1 {
		count = 1
	}
	if count > whatsappOutboxPreparationLimit {
		count = whatsappOutboxPreparationLimit
	}
	return time.Duration(5*(1<<(count-1))) * time.Second
}

func permanentWhatsAppPreparationError(cause error) bool {
	if errors.Is(cause, ErrStorageNotConfigured) {
		return true
	}
	var signingError storageSigningHTTPError
	if errors.As(cause, &signingError) {
		switch signingError.statusCode {
		case 400, 401, 403, 404, 410, 422:
			return true
		}
	}
	return false
}

// Preparation has its own bounded budget. It cannot consume provider attempts
// or write the durable provider-started marker: no send has begun here.
func (repo Repository) failWhatsAppOutboxPreparation(ctx context.Context, item pendingWhatsAppOutbox, cause error) error {
	count := whatsappOutboxPreparationCount(item.Payload) + 1
	if count > whatsappOutboxPreparationLimit {
		count = whatsappOutboxPreparationLimit
	}
	status, code := "retry", "media_preparation_retry"
	if permanentWhatsAppPreparationError(cause) || count >= whatsappOutboxPreparationLimit {
		status, code = "failed", "media_preparation_failed"
	}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `set local lock_timeout='2s'; set local statement_timeout='10s'`); err != nil {
		return err
	}
	tag, err := tx.Exec(ctx, `
		update public.whatsapp_outbox
		set status=$3,
		    payload=jsonb_set(payload, '{preparation_attempts}', to_jsonb($4::integer), true),
		    next_attempt_at=case when $3='retry' then now()+($5::integer*interval '1 second') else next_attempt_at end,
		    failed_at=case when $3='failed' then now() else failed_at end,
		    locked_at=null, locked_by=null, last_error=$6, updated_at=now()
		where id=$1::uuid and locked_by=$2 and status='processing'
		  and coalesce(last_error,'') not in ($7,$8,$9)
	`, item.ID, item.LeaseToken, status, count, int(whatsappOutboxPreparationDelay(count)/time.Second), code,
		whatsappOutboxProviderStartedMarker, whatsappOutboxProviderAcceptedMarker, whatsappOutboxProviderUnknownMarker)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return fmt.Errorf("%w: preparation no longer owns an unstarted send", errWhatsAppOutboxLeaseLost)
	}
	if status == "failed" {
		if err := repo.syncTerminalWhatsAppOutboxFailures(ctx, tx, item.ID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
