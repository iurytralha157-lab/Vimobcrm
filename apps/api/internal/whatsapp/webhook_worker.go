package whatsapp

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"time"

	"github.com/jackc/pgx/v5"
)

var whatsappWebhookWorkerID = "vimob-api-evolution-webhook-" + randomHex(8)
var whatsappWebhookWorkerWake = make(chan struct{}, 1)

func wakeWhatsAppWebhookWorker() {
	select {
	case whatsappWebhookWorkerWake <- struct{}{}:
	default:
	}
}

type pendingEvolutionWebhook struct {
	ID             string
	OrganizationID string
	SessionID      string
	InstanceID     string
	EventType      string
	WebhookToken   string
	Payload        []byte
	Attempts       int
	MaxAttempts    int
}

func (handler Handler) StartWebhookWorker(ctx context.Context, logger *slog.Logger) {
	config := handler.workerConfig.normalized()
	if !config.WebhookWorkerEnabled {
		return
	}
	if logger == nil {
		logger = slog.Default()
	}

	go func() {
		pollTicker := time.NewTicker(config.WebhookWorkerInterval)
		cleanupTicker := time.NewTicker(time.Hour)
		defer pollTicker.Stop()
		defer cleanupTicker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-cleanupTicker.C:
				if _, err := handler.repo.CleanupExpiredWebhookInbox(ctx, 1000); err != nil && !errors.Is(err, context.Canceled) {
					logger.Error("whatsapp webhook inbox cleanup failed", "error", err)
				}
			case <-pollTicker.C:
				if err := handler.repo.ProcessWebhookInboxWithBatch(ctx, config.WebhookWorkerBatch); err != nil && !errors.Is(err, context.Canceled) {
					logger.Error("whatsapp webhook inbox worker failed", "error", err)
				}
			case <-whatsappWebhookWorkerWake:
				if err := handler.repo.ProcessWebhookInboxWithBatch(ctx, config.WebhookWorkerBatch); err != nil && !errors.Is(err, context.Canceled) {
					logger.Error("whatsapp webhook inbox worker failed", "error", err)
				}
			}
		}
	}()
}

func (repo Repository) CleanupExpiredWebhookInbox(ctx context.Context, limit int) (int64, error) {
	if limit < 1 || limit > 10000 {
		limit = 1000
	}
	result, err := repo.db.Pool().Exec(ctx, `
		with expired as (
			select id
			from public.whatsapp_webhook_inbox
			where status in ('processed', 'dead')
			  and expires_at < now()
			order by expires_at, id
			limit $1
			for update skip locked
		)
		delete from public.whatsapp_webhook_inbox inbox
		using expired
		where inbox.id = expired.id
	`, limit)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected(), nil
}

func (repo Repository) ProcessWebhookInbox(ctx context.Context) error {
	return repo.ProcessWebhookInboxWithBatch(ctx, defaultWhatsAppWebhookWorkerBatch)
}

func (repo Repository) ProcessWebhookInboxWithBatch(ctx context.Context, batch int) error {
	items, err := repo.claimEvolutionWebhooksWithBatch(ctx, batch)
	if err != nil {
		return err
	}
	for _, item := range items {
		leaseOwned, renewErr := repo.renewEvolutionWebhookLease(ctx, item.ID)
		if renewErr != nil {
			return renewErr
		}
		if !leaseOwned {
			continue
		}
		err := repo.dispatchEvolutionWebhook(ctx, item)
		if err == nil {
			if markErr := repo.markEvolutionWebhookProcessed(ctx, item.ID); markErr != nil {
				return markErr
			}
			continue
		}
		if markErr := repo.markEvolutionWebhookFailed(ctx, item, err); markErr != nil {
			return markErr
		}
	}
	return nil
}

func (repo Repository) renewEvolutionWebhookLease(ctx context.Context, id string) (bool, error) {
	result, err := repo.db.Pool().Exec(ctx, `
		update public.whatsapp_webhook_inbox
		set locked_at = now(), updated_at = now()
		where id = $1::uuid
		  and status = 'processing'
		  and locked_by = $2
	`, id, whatsappWebhookWorkerID)
	if err != nil {
		return false, err
	}
	return result.RowsAffected() == 1, nil
}

func (repo Repository) claimEvolutionWebhooks(ctx context.Context) ([]pendingEvolutionWebhook, error) {
	return repo.claimEvolutionWebhooksWithBatch(ctx, defaultWhatsAppWebhookWorkerBatch)
}

func (repo Repository) claimEvolutionWebhooksWithBatch(ctx context.Context, batch int) ([]pendingEvolutionWebhook, error) {
	batch = normalizeWorkerBatch(batch, defaultWhatsAppWebhookWorkerBatch)
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if err := resetStaleEvolutionWebhookClaims(ctx, tx); err != nil {
		return nil, err
	}

	rows, err := tx.Query(ctx, `
		with candidates as (
			select wi.id
			from public.whatsapp_webhook_inbox wi
			where wi.status in ('pending', 'retry')
			  and wi.attempts < wi.max_attempts
			  and wi.next_attempt_at <= now()
			order by wi.created_at asc
			limit $1
			for update skip locked
		)
		update public.whatsapp_webhook_inbox wi
		set status = 'processing',
		    attempts = wi.attempts + 1,
		    locked_at = now(),
		    locked_by = $2,
		    updated_at = now()
		from candidates c, public.whatsapp_sessions ws
		where wi.id = c.id
		  and ws.id = wi.session_id
		returning
			wi.id::text,
			wi.organization_id::text,
			wi.session_id::text,
			coalesce(wi.provider_instance_id, ws.instance_id, ws.instance_name, ''),
			wi.event_type,
			coalesce(ws.advanced_settings->>'webhook_token', ''),
			wi.payload::text,
			wi.attempts,
			wi.max_attempts
	`, batch, whatsappWebhookWorkerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]pendingEvolutionWebhook, 0, batch)
	for rows.Next() {
		var item pendingEvolutionWebhook
		var payload string
		if err := rows.Scan(&item.ID, &item.OrganizationID, &item.SessionID, &item.InstanceID, &item.EventType, &item.WebhookToken, &payload, &item.Attempts, &item.MaxAttempts); err != nil {
			return nil, err
		}
		item.Payload = []byte(payload)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return items, nil
}

func (repo Repository) forwardEvolutionWebhook(ctx context.Context, item pendingEvolutionWebhook) error {
	target := repo.functions.validLegacyEvolutionWebhookBaseURL()
	if target == "" || repo.functions.apiKey == "" {
		return fmt.Errorf("edge webhook receiver is not configured")
	}
	endpoint, err := url.Parse(target)
	if err != nil {
		return err
	}
	query := endpoint.Query()
	removeEvolutionWebhookQueryCredentials(query)
	query.Set("session_id", item.SessionID)
	if item.InstanceID != "" {
		query.Set("instance_id", item.InstanceID)
	}
	endpoint.RawQuery = query.Encode()

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), bytes.NewReader(item.Payload))
	if err != nil {
		return err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("apikey", repo.functions.apiKey)
	request.Header.Set("Authorization", "Bearer "+repo.functions.apiKey)
	request.Header.Set("x-webhook-token", item.WebhookToken)

	response, err := repo.functions.httpClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	body, readErr := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if readErr != nil {
		return readErr
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("edge webhook returned %d: %s", response.StatusCode, string(body))
	}
	return nil
}

func (repo Repository) markEvolutionWebhookProcessed(ctx context.Context, id string) error {
	_, err := repo.db.Pool().Exec(ctx, `
		update public.whatsapp_webhook_inbox
		set status = 'processed',
		    processed_at = now(),
		    locked_at = null,
		    locked_by = null,
		    last_error = null,
		    updated_at = now()
		where id = $1::uuid
		  and status = 'processing'
		  and locked_by = $2
	`, id, whatsappWebhookWorkerID)
	return err
}

func (repo Repository) markEvolutionWebhookFailed(ctx context.Context, item pendingEvolutionWebhook, cause error) error {
	status := "retry"
	if item.Attempts >= item.MaxAttempts {
		status = "dead"
	}
	_, err := repo.db.Pool().Exec(ctx, `
		update public.whatsapp_webhook_inbox
		set status = $2,
		    next_attempt_at = case
		      when $2 = 'retry' then now() + make_interval(secs => least(300, (power(2, least(attempts, 8)))::int))
		      else next_attempt_at
		    end,
		    dead_lettered_at = case when $2 = 'dead' then now() else dead_lettered_at end,
		    locked_at = null,
		    locked_by = null,
		    last_error = left($3, 4000),
		    updated_at = now()
		where id = $1::uuid
		  and status = 'processing'
		  and locked_by = $4
	`, item.ID, status, cause.Error(), whatsappWebhookWorkerID)
	return err
}

func resetStaleEvolutionWebhookClaims(ctx context.Context, tx pgx.Tx) error {
	if _, err := tx.Exec(ctx, `
		update public.whatsapp_webhook_inbox
		set status = 'dead',
		    dead_lettered_at = coalesce(dead_lettered_at, now()),
		    locked_at = null,
		    locked_by = null,
		    last_error = coalesce(last_error, 'retry_exhausted'),
		    updated_at = now()
		where attempts >= max_attempts
		  and (
		    (status in ('pending', 'retry') and next_attempt_at <= now())
		    or (status = 'processing' and locked_at < now() - interval '5 minutes')
		  )
	`); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `
		update public.whatsapp_webhook_inbox
		set status = 'retry',
		    locked_at = null,
		    locked_by = null,
		    next_attempt_at = now(),
		    updated_at = now()
		where status = 'processing'
		  and locked_at < now() - interval '5 minutes'
		  and attempts < max_attempts
	`)
	return err
}
