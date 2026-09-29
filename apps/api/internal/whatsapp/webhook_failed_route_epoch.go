package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"

	"github.com/jackc/pgx/v5"
)

const maxFailedRouteEpochsPerMinute = 10

func isDeterministicUnsupportedWebhook(err error) bool {
	return errors.Is(err, errNativeWebhookMessageLikeUnsupported) ||
		errors.Is(err, errNativeWebhookUnsupported)
}

func failedWebhookLastError(cause error) string {
	if errors.Is(cause, errNativeWebhookMessageLikeUnsupported) {
		return errNativeWebhookMessageLikeUnsupported.Error()
	}
	if errors.Is(cause, errNativeWebhookUnsupported) {
		return errNativeWebhookUnsupported.Error()
	}
	if errors.Is(cause, errNativeNotificationReceiptTargetNotFound) {
		return "notification_receipt_target_not_found"
	}
	return cause.Error()
}

type failedRouteEpochResult struct {
	State        string `json:"state"`
	Reason       string `json:"reason"`
	TerminalRows int    `json:"terminal_rows"`
}

// Candidate roots are reconciled even if the route receives no further
// callback. The database helper takes the same route advisory lock as capture
// and proves the current binding, exact chain and absence of projections.
func (repo Repository) reconcileFailedRouteCandidates(ctx context.Context, logger *slog.Logger) error {
	held, noGo := 0, 0
	for range maxFailedRouteEpochsPerMinute {
		tx, err := repo.db.Pool().Begin(ctx)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `set local lock_timeout = '1s'`); err != nil {
			_ = tx.Rollback(ctx)
			return err
		}
		if _, err := tx.Exec(ctx, `set local statement_timeout = '5s'`); err != nil {
			_ = tx.Rollback(ctx)
			return err
		}
		var rootID, organizationID, sessionID, routingKey string
		err = tx.QueryRow(ctx, `
			select candidate.root_inbox_id::text,
			  candidate.organization_id::text,candidate.session_id::text,
			  candidate.routing_key
			from private.whatsapp_failed_route_candidates as candidate
			where (candidate.last_reconcile_attempt_at is null or
			  candidate.last_reconcile_attempt_at <= now() - interval '5 minutes')
			  and not exists (select 1 from private.whatsapp_failed_route_epoch_fences as fence
			    where fence.root_inbox_id = candidate.root_inbox_id)
			  and candidate.root_inbox_id = (
			    select older.root_inbox_id
			    from private.whatsapp_failed_route_candidates as older
			    where older.organization_id = candidate.organization_id
			      and older.session_id = candidate.session_id
			      and older.routing_key = candidate.routing_key
			      and not exists (select 1 from private.whatsapp_failed_route_epoch_fences as fence
			        where fence.root_inbox_id = older.root_inbox_id)
			    order by older.ingress_sequence nulls first,older.recorded_at,older.root_inbox_id
			    limit 1)
			order by candidate.recorded_at,candidate.root_inbox_id
			limit 1 for update of candidate skip locked
		`).Scan(&rootID, &organizationID, &sessionID, &routingKey)
		if errors.Is(err, pgx.ErrNoRows) {
			_ = tx.Rollback(ctx)
			break
		}
		if err != nil {
			_ = tx.Rollback(ctx)
			return err
		}
		var raw string
		err = tx.QueryRow(ctx, `
			select private.try_hold_failed_whatsapp_route_epoch(
			  $1::uuid,$2::uuid,$3,
			  case when $3 like 'phone:%' then substring($3 from 7) else '' end
			)::text
		`, organizationID, sessionID, routingKey).Scan(&raw)
		if err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("hold failed WhatsApp route candidate: %w", err)
		}
		if _, err := tx.Exec(ctx, `
			update private.whatsapp_failed_route_candidates
			set last_reconcile_attempt_at = clock_timestamp()
			where root_inbox_id = $1::uuid
		`, rootID); err != nil {
			_ = tx.Rollback(ctx)
			return err
		}
		if err := tx.Commit(ctx); err != nil {
			return err
		}
		var result failedRouteEpochResult
		if err := json.Unmarshal([]byte(raw), &result); err != nil {
			return err
		}
		switch result.State {
		case "held":
			held++
		case "no_go":
			noGo++
			if logger != nil {
				logger.Error("WhatsApp failed route candidate needs review", "reason", result.Reason)
			}
		}
	}
	if logger != nil && (held > 0 || noGo > 0) {
		logger.Info("WhatsApp failed route candidate reconciliation",
			"held_epochs", held, "candidates_requiring_review", noGo)
	}
	return nil
}

// Quarantine only epochs that passed the database's ten-minute recovery grace.
// Each epoch is a separate transaction with fresh provenance and projection
// checks; a failed epoch remains HELD and does not block other route checks.
func (repo Repository) quarantineDueFailedWhatsAppEpochs(ctx context.Context, logger *slog.Logger) error {
	rows, err := repo.db.Pool().Query(ctx, `
		select root_inbox_id::text
		from private.whatsapp_failed_route_epoch_fences
		where state = 'held' and quarantine_after <= now()
		  and (last_reconcile_attempt_at is null
		    or last_reconcile_attempt_at <= now() - interval '5 minutes')
		order by quarantine_after, root_inbox_id
		limit $1
	`, maxFailedRouteEpochsPerMinute)
	if err != nil {
		return err
	}
	rootIDs := make([]string, 0, maxFailedRouteEpochsPerMinute)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		rootIDs = append(rootIDs, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	quarantined, held, terminalRows := 0, 0, 0
	for _, rootID := range rootIDs {
		var raw string
		if err := repo.db.Pool().QueryRow(ctx, `
			select private.quarantine_due_failed_whatsapp_epoch($1::uuid)::text
		`, rootID).Scan(&raw); err != nil {
			return fmt.Errorf("quarantine failed WhatsApp epoch: %w", err)
		}
		var result failedRouteEpochResult
		if err := json.Unmarshal([]byte(raw), &result); err != nil {
			return fmt.Errorf("decode failed WhatsApp epoch result: %w", err)
		}
		switch result.State {
		case "quarantined":
			quarantined++
			terminalRows += result.TerminalRows
		case "no_go":
			held++
			if logger != nil {
				logger.Error("WhatsApp failed route epoch remains held", "reason", result.Reason)
			}
		}
	}
	if logger != nil && (quarantined > 0 || held > 0) {
		logger.Info("WhatsApp failed route epoch reconciliation",
			"quarantined_epochs", quarantined,
			"terminal_rows_raw_preserved", terminalRows,
			"held_epochs_requiring_review", held)
	}
	return nil
}
