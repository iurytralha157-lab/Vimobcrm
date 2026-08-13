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
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
)

var whatsappWebhookWorkerID = "vimob-api-evolution-webhook-" + randomHex(8)
var whatsappWebhookWorkerWake = make(chan struct{}, 1)

var evolutionWebhookMessageMarkers = []string{"message"}
var evolutionWebhookStatusMarkers = []string{"receipt", "ack", "status"}

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
		cleanupTicker := time.NewTicker(time.Minute)
		defer pollTicker.Stop()
		defer cleanupTicker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-cleanupTicker.C:
				if _, err := handler.repo.CleanupExpiredWebhookInbox(ctx, 10000); err != nil && !errors.Is(err, context.Canceled) {
					logger.Error("whatsapp webhook inbox cleanup failed", "error", err)
				}
			case <-pollTicker.C:
				if err := handler.repo.processWebhookInboxWithBatchAndConcurrency(ctx, config.WebhookWorkerBatch, config.WebhookWorkerConcurrency); err != nil && !errors.Is(err, context.Canceled) {
					logger.Error("whatsapp webhook inbox worker failed", "error", err)
				}
			case <-whatsappWebhookWorkerWake:
				if err := handler.repo.processWebhookInboxWithBatchAndConcurrency(ctx, config.WebhookWorkerBatch, config.WebhookWorkerConcurrency); err != nil && !errors.Is(err, context.Canceled) {
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
			where expires_at < now()
			  and (
			    status = 'processed'
			    or (
			      status = 'dead'
			      and not (
			        strpos(lower(btrim(event_type)), 'message') > 0
			        and strpos(lower(btrim(event_type)), 'receipt') = 0
			        and strpos(lower(btrim(event_type)), 'ack') = 0
			        and strpos(lower(btrim(event_type)), 'status') = 0
			      )
			    )
			  )
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
	return repo.processWebhookInboxWithBatchAndConcurrency(ctx, batch, defaultWhatsAppWebhookWorkerConcurrency)
}

func (repo Repository) processWebhookInboxWithBatchAndConcurrency(ctx context.Context, batch int, concurrency int) error {
	items, err := repo.claimEvolutionWebhooksWithBatch(ctx, batch)
	if err != nil {
		return err
	}
	return drainEvolutionWebhookBatch(ctx, items, normalizeWebhookWorkerConcurrency(concurrency), repo.processClaimedEvolutionWebhook)
}

func (repo Repository) processClaimedEvolutionWebhook(ctx context.Context, item pendingEvolutionWebhook) error {
	leaseOwned, err := repo.renewEvolutionWebhookLease(ctx, item.ID)
	if err != nil || !leaseOwned {
		return err
	}
	if err := repo.dispatchEvolutionWebhook(ctx, item); err != nil {
		return repo.markEvolutionWebhookFailed(ctx, item, err)
	}
	return repo.markEvolutionWebhookProcessed(ctx, item)
}

type evolutionWebhookSessionBatch struct {
	items []pendingEvolutionWebhook
}

func groupEvolutionWebhookBatchBySession(items []pendingEvolutionWebhook) []evolutionWebhookSessionBatch {
	groups := make([]evolutionWebhookSessionBatch, 0, len(items))
	groupIndex := make(map[string]int, len(items))
	for _, item := range items {
		index, exists := groupIndex[item.SessionID]
		if !exists {
			index = len(groups)
			groupIndex[item.SessionID] = index
			groups = append(groups, evolutionWebhookSessionBatch{})
		}
		groups[index].items = append(groups[index].items, item)
	}
	return groups
}

func drainEvolutionWebhookBatch(
	ctx context.Context,
	items []pendingEvolutionWebhook,
	concurrency int,
	process func(context.Context, pendingEvolutionWebhook) error,
) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if len(items) == 0 {
		return nil
	}
	groups := groupEvolutionWebhookBatchBySession(items)
	concurrency = normalizeWebhookWorkerConcurrency(concurrency)
	if concurrency > len(groups) {
		concurrency = len(groups)
	}

	workCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	jobs := make(chan evolutionWebhookSessionBatch, len(groups))
	for _, group := range groups {
		jobs <- group
	}
	close(jobs)

	var workers sync.WaitGroup
	var firstError error
	var firstErrorOnce sync.Once
	for worker := 0; worker < concurrency; worker++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for {
				select {
				case <-workCtx.Done():
					return
				case group, ok := <-jobs:
					if !ok {
						return
					}
					for _, item := range group.items {
						if err := workCtx.Err(); err != nil {
							return
						}
						if err := process(workCtx, item); err != nil {
							firstErrorOnce.Do(func() {
								firstError = err
								cancel()
							})
							return
						}
					}
				}
			}
		}()
	}
	workers.Wait()
	if firstError != nil {
		return firstError
	}
	return ctx.Err()
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
		with candidates as materialized (
			select wi.id
			from public.whatsapp_webhook_inbox wi
			where wi.status in ('pending', 'retry')
			  and wi.attempts < wi.max_attempts
			  and wi.next_attempt_at <= now()
			order by wi.next_attempt_at, wi.created_at, wi.id
			limit $1
			for update skip locked
		),
		claimed as (
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
				wi.id,
				wi.organization_id,
				wi.session_id,
				wi.provider_instance_id,
				wi.event_type,
				wi.payload,
				wi.attempts,
				wi.max_attempts,
				wi.next_attempt_at,
				wi.created_at
		)
		select
			id::text,
			organization_id::text,
			session_id::text,
			coalesce(claimed.provider_instance_id, ws.instance_id, ws.instance_name, ''),
			claimed.event_type,
			coalesce(ws.advanced_settings->>'webhook_token', ''),
			claimed.payload::text,
			claimed.attempts,
			claimed.max_attempts
		from claimed
		join public.whatsapp_sessions ws on ws.id = claimed.session_id
		order by claimed.next_attempt_at, claimed.created_at, claimed.id
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

func (repo Repository) markEvolutionWebhookProcessed(ctx context.Context, item pendingEvolutionWebhook) error {
	retentionSeconds := int64(evolutionWebhookProcessedRetention(item.EventType) / time.Second)
	_, err := repo.db.Pool().Exec(ctx, `
		update public.whatsapp_webhook_inbox
		set status = 'processed',
		    processed_at = now(),
		    expires_at = now() + ($3 * interval '1 second'),
		    locked_at = null,
		    locked_by = null,
		    last_error = null,
		    updated_at = now()
		where id = $1::uuid
		  and status = 'processing'
		  and locked_by = $2
	`, item.ID, whatsappWebhookWorkerID, retentionSeconds)
	return err
}

func evolutionWebhookProcessedRetention(eventType string) time.Duration {
	if evolutionWebhookContainsMarker(eventType, evolutionWebhookStatusMarkers) {
		return 6 * time.Hour
	}
	if evolutionWebhookContainsMarker(eventType, evolutionWebhookMessageMarkers) {
		return 24 * time.Hour
	}
	return time.Hour
}

func evolutionWebhookContainsMarker(eventType string, markers []string) bool {
	normalized := strings.ToLower(strings.TrimSpace(eventType))
	for _, marker := range markers {
		if strings.Contains(normalized, marker) {
			return true
		}
	}
	return false
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
