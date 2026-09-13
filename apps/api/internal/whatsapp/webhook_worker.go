package whatsapp

import (
	"bytes"
	"context"
	"encoding/json"
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
	"github.com/vimob-crm/vimob-crm/apps/api/internal/supabasehttp"
)

var whatsappWebhookWorkerID = "vimob-api-evolution-webhook-" + randomHex(8)
var whatsappWebhookLiveWorkerWake = newEvolutionWebhookWorkerSignal()
var whatsappWebhookBacklogWorkerWake = newEvolutionWebhookWorkerSignal()

var evolutionWebhookMessageMarkers = []string{"message"}
var evolutionWebhookStatusMarkers = []string{"receipt", "ack", "status"}

const maxEvolutionWebhookTargetResponseBytes int64 = 64 << 10

const (
	evolutionWebhookLaneLive    = "live"
	evolutionWebhookLaneBacklog = "backlog"
)

const claimEvolutionWebhooksQuery = `
		with candidate_sessions as materialized (
			select
				ws.id as session_id,
				head.id as event_id
			from public.whatsapp_sessions ws
			cross join lateral (
			  select
			    wi.id,
			    wi.next_attempt_at,
			    coalesce(
			      nullif(wi.payload #>> '{__vimob_ingress,routing_key}', ''),
			      '__session__'
			    ) as routing_key
			  from public.whatsapp_webhook_inbox wi
			  where wi.session_id = ws.id
			    and wi.processing_lane = $4
			    and wi.status in ('pending', 'retry')
			    and wi.attempts < wi.max_attempts
			    and ($4 <> 'live' or wi.next_attempt_at <= now())
			    and not exists (
			      select 1
			      from public.whatsapp_webhook_inbox older
			      where older.session_id = wi.session_id
			        and older.processing_lane = wi.processing_lane
			        and older.status in ('pending', 'retry')
			        and older.attempts < older.max_attempts
			        and (older.created_at, older.id) < (wi.created_at, wi.id)
			        and (
			          coalesce(nullif(older.payload #>> '{__vimob_ingress,routing_key}', ''), '__session__') = '__session__'
			          or coalesce(nullif(wi.payload #>> '{__vimob_ingress,routing_key}', ''), '__session__') = '__session__'
			          or coalesce(nullif(older.payload #>> '{__vimob_ingress,routing_key}', ''), '__session__') =
			             coalesce(nullif(wi.payload #>> '{__vimob_ingress,routing_key}', ''), '__session__')
			        )
			    )
			  order by wi.created_at, wi.id
			  limit 1
			) head
			where (nullif(btrim($3), '') is null or ws.id > nullif(btrim($3), '')::uuid)
			  and coalesce(ws.is_active, true) = true
			  and coalesce(ws.status, '') <> 'deleted'
			  and head.next_attempt_at <= now()
			  and not exists (
			    select 1
			    from public.whatsapp_webhook_inbox active
			    where active.session_id = ws.id
			      and active.status = 'processing'
			      and (
			        coalesce(nullif(active.payload #>> '{__vimob_ingress,routing_key}', ''), '__session__') = '__session__'
			        or head.routing_key = '__session__'
			        or coalesce(nullif(active.payload #>> '{__vimob_ingress,routing_key}', ''), '__session__') = head.routing_key
			      )
			  )
			  and (
			    $4 <> 'backlog'
			    or not exists (
			      select 1
			      from public.whatsapp_webhook_inbox live_due
			      where live_due.session_id = ws.id
			        and live_due.processing_lane = 'live'
			        and live_due.status in ('pending', 'retry')
			        and live_due.attempts < live_due.max_attempts
			        and live_due.next_attempt_at <= now()
			    )
			  )
			order by ws.id
			limit $1
			for no key update of ws skip locked
		),
		locked_heads as materialized (
			select
				wi.id,
				selected.session_id
			from candidate_sessions selected
			join public.whatsapp_webhook_inbox wi on wi.id = selected.event_id
			where wi.processing_lane = $4
			  and wi.status in ('pending', 'retry')
			  and wi.attempts < wi.max_attempts
			  and wi.next_attempt_at <= now()
			  and not exists (
			    select 1
			    from public.whatsapp_webhook_inbox active
			    where active.session_id = selected.session_id
			      and active.id <> wi.id
			      and active.status = 'processing'
			      and (
			        coalesce(nullif(active.payload #>> '{__vimob_ingress,routing_key}', ''), '__session__') = '__session__'
			        or coalesce(nullif(wi.payload #>> '{__vimob_ingress,routing_key}', ''), '__session__') = '__session__'
			        or coalesce(nullif(active.payload #>> '{__vimob_ingress,routing_key}', ''), '__session__') =
			           coalesce(nullif(wi.payload #>> '{__vimob_ingress,routing_key}', ''), '__session__')
			      )
			  )
			order by selected.session_id
			for update of wi skip locked
		),
		claimed as (
			update public.whatsapp_webhook_inbox wi
			set status = 'processing',
			    attempts = wi.attempts + 1,
			    locked_at = now(),
			    locked_by = $2,
			    updated_at = now()
			from locked_heads c
			where wi.id = c.id
			  and wi.processing_lane = $4
			  and wi.status in ('pending', 'retry')
			  and wi.attempts < wi.max_attempts
			  and wi.next_attempt_at <= now()
			  and not exists (
			    select 1
			    from public.whatsapp_webhook_inbox active
			    where active.session_id = wi.session_id
			      and active.id <> wi.id
			      and active.status = 'processing'
			      and (
			        coalesce(nullif(active.payload #>> '{__vimob_ingress,routing_key}', ''), '__session__') = '__session__'
			        or coalesce(nullif(wi.payload #>> '{__vimob_ingress,routing_key}', ''), '__session__') = '__session__'
			        or coalesce(nullif(active.payload #>> '{__vimob_ingress,routing_key}', ''), '__session__') =
			           coalesce(nullif(wi.payload #>> '{__vimob_ingress,routing_key}', ''), '__session__')
			      )
			  )
			returning
				wi.id,
				wi.organization_id,
				wi.session_id,
				wi.provider_instance_id,
				wi.event_type,
				wi.payload,
				wi.attempts,
				wi.max_attempts,
				wi.processing_lane,
				wi.next_attempt_at,
				wi.created_at
		)
		select
			claimed.id::text,
			claimed.organization_id::text,
			claimed.session_id::text,
			coalesce(claimed.provider_instance_id, ws.instance_id, ws.instance_name, ''),
			claimed.event_type,
			coalesce(ws.advanced_settings->>'webhook_token', ''),
			claimed.payload::text,
			claimed.attempts,
			claimed.max_attempts,
			claimed.processing_lane,
			claimed.created_at
		from claimed
		join public.whatsapp_sessions ws on ws.id = claimed.session_id
		order by claimed.session_id
	`

func wakeWhatsAppWebhookWorker() {
	whatsappWebhookLiveWorkerWake.Notify()
	whatsappWebhookBacklogWorkerWake.Notify()
}

type evolutionWebhookWorkerSignal struct {
	mu      sync.Mutex
	channel chan struct{}
}

func newEvolutionWebhookWorkerSignal() *evolutionWebhookWorkerSignal {
	return &evolutionWebhookWorkerSignal{channel: make(chan struct{})}
}

func (signal *evolutionWebhookWorkerSignal) Notify() {
	signal.mu.Lock()
	close(signal.channel)
	signal.channel = make(chan struct{})
	signal.mu.Unlock()
}

func (signal *evolutionWebhookWorkerSignal) WaitChannel() <-chan struct{} {
	signal.mu.Lock()
	defer signal.mu.Unlock()
	return signal.channel
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
	ProcessingLane string
	CreatedAt      time.Time
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
		for {
			if err := handler.repo.ensureEvolutionWebhookSchema(ctx); err == nil {
				break
			} else if !errors.Is(err, context.Canceled) {
				logger.Error("whatsapp webhook worker waiting for compatible schema", "error", err)
			}
			timer := time.NewTimer(5 * time.Second)
			select {
			case <-ctx.Done():
				timer.Stop()
				return
			case <-timer.C:
			}
		}
		cleanupTicker := time.NewTicker(time.Minute)
		defer cleanupTicker.Stop()
		liveConcurrency, backlogConcurrency := evolutionWebhookLaneConcurrency(config.WebhookWorkerConcurrency)
		var statsMu sync.Mutex
		windowStats := evolutionWebhookWorkerWindowStats{startedAt: time.Now()}
		startLane := func(lane string, concurrency int, wake *evolutionWebhookWorkerSignal) {
			startSlot := func(slot int) {
				cursor := ""
				processBatch := func() (int, error) {
					startedAt := time.Now()
					// One slot claims one event at a time. It never leases work that
					// cannot begin immediately, and a fast slot refills without waiting
					// for a slower sibling in the same lane.
					batchStats, nextCursor, err := handler.repo.processWebhookInboxLaneBatch(
						ctx,
						lane,
						1,
						1,
						cursor,
					)
					cursor = nextCursor
					statsMu.Lock()
					windowStats.observe(batchStats, time.Since(startedAt), err)
					statsMu.Unlock()
					return batchStats.Claimed(), err
				}
				go runEvolutionWebhookLaneWorker(
					ctx,
					config.WebhookWorkerInterval,
					wake,
					processBatch,
					func(err error) {
						if !errors.Is(err, context.Canceled) {
							logger.Error("whatsapp webhook inbox lane worker failed", "lane", lane, "slot", slot, "error", err)
						}
					},
				)
			}
			for slot := 0; slot < concurrency; slot++ {
				startSlot(slot)
			}
		}

		// Recover abandoned leases once before either lane starts claiming. The
		// live and backlog runners then own separate capacity, so a slow legacy
		// Edge request in the backlog lane cannot occupy every live worker slot.
		if err := handler.repo.RecoverStaleWebhookInbox(ctx); err != nil && !errors.Is(err, context.Canceled) {
			logger.Error("whatsapp webhook inbox recovery failed", "error", err)
		}
		startLane(evolutionWebhookLaneLive, liveConcurrency, whatsappWebhookLiveWorkerWake)
		startLane(evolutionWebhookLaneBacklog, backlogConcurrency, whatsappWebhookBacklogWorkerWake)

		for {
			select {
			case <-ctx.Done():
				return
			case <-cleanupTicker.C:
				statsMu.Lock()
				windowStats.logAndReset(logger, config, liveConcurrency, backlogConcurrency)
				statsMu.Unlock()
				if err := handler.repo.RecoverStaleWebhookInbox(ctx); err != nil && !errors.Is(err, context.Canceled) {
					logger.Error("whatsapp webhook inbox recovery failed", "error", err)
				}
				if _, err := handler.repo.CleanupExpiredWebhookInbox(ctx, 10000); err != nil && !errors.Is(err, context.Canceled) {
					logger.Error("whatsapp webhook inbox cleanup failed", "error", err)
				}
			}
		}
	}()
}

func runEvolutionWebhookLaneWorker(
	ctx context.Context,
	interval time.Duration,
	wake *evolutionWebhookWorkerSignal,
	processBatch func() (int, error),
	onError func(error),
) {
	pollTicker := time.NewTicker(interval)
	defer pollTicker.Stop()
	for {
		// Capture the generation before querying. A provider notification that
		// races with an empty claim closes this exact channel, so no wake-up can
		// be lost between the database read and the wait below.
		wakeChannel := wake.WaitChannel()
		claimed, err := processBatch()
		if err != nil && onError != nil {
			onError(err)
		}
		// A claimed item may fail independently, but its retry is deferred by
		// next_attempt_at. Refill this slot immediately so unrelated sessions do
		// not inherit a polling delay.
		if shouldContinueWebhookDrain(claimed) {
			continue
		}
		select {
		case <-ctx.Done():
			return
		case <-pollTicker.C:
		case <-wakeChannel:
		}
	}
}

func evolutionWebhookLaneConcurrency(total int) (live int, backlog int) {
	total = normalizeWebhookWorkerConcurrency(total)
	if total == 1 {
		// Two independent lanes are the minimum needed to prevent a blocking
		// backlog request from consuming all live capacity. Production defaults
		// to four; this compatibility fallback intentionally raises an explicit
		// one-worker configuration to two effective workers.
		return 1, 1
	}
	backlog = total / 4
	if backlog < 1 {
		backlog = 1
	}
	if total >= 4 && backlog < 2 {
		// With the production default of four workers, a 3/1 split reduced a
		// multi-session historical drain to one request at a time while three
		// live slots were commonly idle. Two reserved backlog slots double real
		// drain throughput without raising the configured database/provider
		// concurrency or allowing two events from one conversation to overlap.
		backlog = 2
	}
	return total - backlog, backlog
}

func shouldContinueWebhookDrain(claimed int) bool {
	return claimed > 0
}

type evolutionWebhookWorkerWindowStats struct {
	startedAt             time.Time
	batches               int
	liveClaimed           int
	backlogClaimed        int
	errors                int
	oldestLiveClaimAge    time.Duration
	oldestBacklogClaimAge time.Duration
	maxBatchDuration      time.Duration
}

func (stats *evolutionWebhookWorkerWindowStats) observe(batch evolutionWebhookBatchStats, duration time.Duration, err error) {
	stats.batches++
	stats.liveClaimed += batch.LiveClaimed
	stats.backlogClaimed += batch.BacklogClaimed
	if err != nil {
		stats.errors++
	}
	if batch.OldestLiveClaimAge > stats.oldestLiveClaimAge {
		stats.oldestLiveClaimAge = batch.OldestLiveClaimAge
	}
	if batch.OldestBacklogClaimAge > stats.oldestBacklogClaimAge {
		stats.oldestBacklogClaimAge = batch.OldestBacklogClaimAge
	}
	if duration > stats.maxBatchDuration {
		stats.maxBatchDuration = duration
	}
}

func (stats *evolutionWebhookWorkerWindowStats) logAndReset(
	logger *slog.Logger,
	config WorkerConfig,
	liveConcurrency int,
	backlogConcurrency int,
) {
	window := time.Since(stats.startedAt)
	logger.Info(
		"whatsapp webhook worker throughput",
		"worker_id", whatsappWebhookWorkerID,
		"window_ms", window.Milliseconds(),
		"batches", stats.batches,
		"live_claimed", stats.liveClaimed,
		"backlog_claimed", stats.backlogClaimed,
		"errors", stats.errors,
		"oldest_live_claim_age_ms", stats.oldestLiveClaimAge.Milliseconds(),
		"oldest_backlog_claim_age_ms", stats.oldestBacklogClaimAge.Milliseconds(),
		"max_batch_duration_ms", stats.maxBatchDuration.Milliseconds(),
		"configured_batch_limit", config.WebhookWorkerBatch,
		"claim_size_per_slot", 1,
		"configured_concurrency", config.WebhookWorkerConcurrency,
		"live_concurrency", liveConcurrency,
		"backlog_concurrency", backlogConcurrency,
	)
	*stats = evolutionWebhookWorkerWindowStats{startedAt: time.Now()}
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
	_, err := repo.processWebhookInboxBatch(ctx, batch, concurrency, evolutionWebhookLaneCursors{})
	return err
}

type evolutionWebhookLaneCursors struct {
	LiveSessionID    string
	BacklogSessionID string
}

type evolutionWebhookBatchStats struct {
	Cursors               evolutionWebhookLaneCursors
	LiveClaimed           int
	BacklogClaimed        int
	OldestLiveClaimAge    time.Duration
	OldestBacklogClaimAge time.Duration
}

func (stats evolutionWebhookBatchStats) Claimed() int {
	return stats.LiveClaimed + stats.BacklogClaimed
}

func (repo Repository) processWebhookInboxBatch(
	ctx context.Context,
	batch int,
	concurrency int,
	cursors evolutionWebhookLaneCursors,
) (evolutionWebhookBatchStats, error) {
	items, nextCursors, err := repo.claimEvolutionWebhooksForWorker(ctx, batch, cursors)
	if err != nil {
		return evolutionWebhookBatchStats{Cursors: cursors}, err
	}
	stats := summarizeEvolutionWebhookBatch(items, nextCursors, time.Now())
	return stats, drainEvolutionWebhookBatch(
		ctx,
		items,
		normalizeWebhookWorkerConcurrency(concurrency),
		repo.processClaimedEvolutionWebhook,
	)
}

func (repo Repository) processWebhookInboxLaneBatch(
	ctx context.Context,
	lane string,
	batch int,
	concurrency int,
	afterSessionID string,
) (evolutionWebhookBatchStats, string, error) {
	items, nextSessionID, err := repo.claimEvolutionWebhooksForLane(ctx, lane, batch, afterSessionID)
	if err != nil {
		return evolutionWebhookBatchStats{}, afterSessionID, err
	}
	cursors := evolutionWebhookLaneCursors{}
	switch lane {
	case evolutionWebhookLaneLive:
		cursors.LiveSessionID = nextSessionID
	case evolutionWebhookLaneBacklog:
		cursors.BacklogSessionID = nextSessionID
	default:
		return evolutionWebhookBatchStats{}, afterSessionID, fmt.Errorf("unsupported WhatsApp webhook processing lane %q", lane)
	}
	stats := summarizeEvolutionWebhookBatch(items, cursors, time.Now())
	err = drainEvolutionWebhookBatch(
		ctx,
		items,
		normalizeWebhookWorkerConcurrency(concurrency),
		repo.processClaimedEvolutionWebhook,
	)
	return stats, nextSessionID, err
}

func summarizeEvolutionWebhookBatch(items []pendingEvolutionWebhook, cursors evolutionWebhookLaneCursors, now time.Time) evolutionWebhookBatchStats {
	stats := evolutionWebhookBatchStats{Cursors: cursors}
	for _, item := range items {
		age := now.Sub(item.CreatedAt)
		if item.CreatedAt.IsZero() || age < 0 {
			age = 0
		}
		switch item.ProcessingLane {
		case evolutionWebhookLaneLive:
			stats.LiveClaimed++
			if age > stats.OldestLiveClaimAge {
				stats.OldestLiveClaimAge = age
			}
		default:
			stats.BacklogClaimed++
			if age > stats.OldestBacklogClaimAge {
				stats.OldestBacklogClaimAge = age
			}
		}
	}
	return stats
}

func (repo Repository) processClaimedEvolutionWebhook(ctx context.Context, item pendingEvolutionWebhook) error {
	leaseOwned, err := repo.renewEvolutionWebhookLease(ctx, item.ID)
	if err != nil {
		return err
	}
	if !leaseOwned {
		return fmt.Errorf("whatsapp webhook lease %s is no longer owned by this worker", item.ID)
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

	jobs := make(chan evolutionWebhookSessionBatch, len(groups))
	for _, group := range groups {
		jobs <- group
	}
	close(jobs)

	var workers sync.WaitGroup
	var errorsMu sync.Mutex
	var workerErrors []error
	for worker := 0; worker < concurrency; worker++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for {
				select {
				case <-ctx.Done():
					return
				case group, ok := <-jobs:
					if !ok {
						return
					}
					for _, item := range group.items {
						if err := ctx.Err(); err != nil {
							return
						}
						if err := process(ctx, item); err != nil {
							errorsMu.Lock()
							workerErrors = append(workerErrors, err)
							errorsMu.Unlock()
							// Do not advance within the failed session, but let the
							// remaining independent sessions release their leases.
							break
						}
					}
				}
			}
		}()
	}
	workers.Wait()
	if err := ctx.Err(); err != nil {
		workerErrors = append(workerErrors, err)
	}
	return errors.Join(workerErrors...)
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
	return repo.claimEvolutionWebhooksWithBatchAfterSession(ctx, batch, "")
}

func (repo Repository) claimEvolutionWebhooksWithBatchAfterSession(ctx context.Context, batch int, afterSessionID string) ([]pendingEvolutionWebhook, error) {
	items, _, err := repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneBacklog, batch, afterSessionID)
	return items, err
}

func (repo Repository) claimEvolutionWebhooksForLane(
	ctx context.Context,
	lane string,
	batch int,
	afterSessionID string,
) ([]pendingEvolutionWebhook, string, error) {
	batch = normalizeWorkerBatch(batch, defaultWhatsAppWebhookWorkerBatch)
	if lane != evolutionWebhookLaneLive && lane != evolutionWebhookLaneBacklog {
		return nil, afterSessionID, fmt.Errorf("unsupported WhatsApp webhook processing lane %q", lane)
	}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, afterSessionID, err
	}
	defer tx.Rollback(ctx)
	// A missing/invalid rollout index must fail this claim quickly instead of
	// turning the large durable inbox into a long-running sequential scan.
	if _, err := tx.Exec(ctx, `set local statement_timeout = '5s'`); err != nil {
		return nil, afterSessionID, err
	}
	items, err := claimEvolutionWebhooksInLane(ctx, tx, batch, afterSessionID, lane)
	if err != nil {
		return nil, afterSessionID, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, afterSessionID, err
	}
	return items, laneLastSessionID(items, afterSessionID), nil
}

func (repo Repository) claimEvolutionWebhooksForWorker(
	ctx context.Context,
	batch int,
	cursors evolutionWebhookLaneCursors,
) ([]pendingEvolutionWebhook, evolutionWebhookLaneCursors, error) {
	batch = normalizeWorkerBatch(batch, defaultWhatsAppWebhookWorkerBatch)
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, cursors, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `set local statement_timeout = '5s'`); err != nil {
		return nil, cursors, err
	}

	liveLimit := reservedLiveWebhookBatch(batch)
	liveItems, err := claimEvolutionWebhooksInLane(ctx, tx, liveLimit, cursors.LiveSessionID, evolutionWebhookLaneLive)
	if err != nil {
		return nil, cursors, err
	}
	remaining := batch - len(liveItems)
	backlogItems, err := claimEvolutionWebhooksInLane(ctx, tx, remaining, cursors.BacklogSessionID, evolutionWebhookLaneBacklog)
	if err != nil {
		return nil, cursors, err
	}
	remaining -= len(backlogItems)
	extraLiveItems, err := claimEvolutionWebhooksInLane(ctx, tx, remaining, laneLastSessionID(liveItems, cursors.LiveSessionID), evolutionWebhookLaneLive)
	if err != nil {
		return nil, cursors, err
	}

	// Keep live work at the front of the in-memory dispatcher even though the
	// backlog reservation is claimed before the final live fill. The database
	// guard serializes each known conversation across lanes (and conservatively
	// serializes the whole session for legacy rows without a routing key); the
	// in-memory grouping below keeps any same-session items in this batch ordered.
	items := make([]pendingEvolutionWebhook, 0, len(liveItems)+len(extraLiveItems)+len(backlogItems))
	items = append(items, liveItems...)
	items = append(items, extraLiveItems...)
	items = append(items, backlogItems...)
	nextCursors := evolutionWebhookLaneCursors{
		LiveSessionID:    laneLastSessionID(extraLiveItems, laneLastSessionID(liveItems, cursors.LiveSessionID)),
		BacklogSessionID: laneLastSessionID(backlogItems, cursors.BacklogSessionID),
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, cursors, err
	}
	return items, nextCursors, nil
}

func reservedLiveWebhookBatch(batch int) int {
	if batch <= 1 {
		return 1
	}
	backlogReserve := batch / 5
	if backlogReserve < 1 {
		backlogReserve = 1
	}
	return batch - backlogReserve
}

func laneLastSessionID(items []pendingEvolutionWebhook, fallback string) string {
	if len(items) == 0 {
		return fallback
	}
	return items[len(items)-1].SessionID
}

func claimEvolutionWebhooksInLane(
	ctx context.Context,
	tx pgx.Tx,
	batch int,
	afterSessionID string,
	lane string,
) ([]pendingEvolutionWebhook, error) {
	items, err := claimEvolutionWebhooksInLaneSegment(ctx, tx, batch, afterSessionID, lane)
	if err != nil || !shouldWrapEvolutionWebhookLaneClaim(afterSessionID, len(items)) {
		return items, err
	}
	// The cursor is monotonic inside one UUID segment. Wrap exactly once only
	// after that segment is empty; never CASE-sort every session and never loop
	// forever when the lane has no runnable head.
	return claimEvolutionWebhooksInLaneSegment(ctx, tx, batch, "", lane)
}

func shouldWrapEvolutionWebhookLaneClaim(afterSessionID string, claimed int) bool {
	return strings.TrimSpace(afterSessionID) != "" && claimed == 0
}

func claimEvolutionWebhooksInLaneSegment(
	ctx context.Context,
	tx pgx.Tx,
	batch int,
	afterSessionID string,
	lane string,
) ([]pendingEvolutionWebhook, error) {
	if batch <= 0 {
		return nil, nil
	}
	if lane != evolutionWebhookLaneLive && lane != evolutionWebhookLaneBacklog {
		return nil, fmt.Errorf("unsupported WhatsApp webhook processing lane %q", lane)
	}
	rows, err := tx.Query(ctx, claimEvolutionWebhooksQuery, batch, whatsappWebhookWorkerID, afterSessionID, lane)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]pendingEvolutionWebhook, 0, batch)
	for rows.Next() {
		var item pendingEvolutionWebhook
		var payload string
		if err := rows.Scan(
			&item.ID,
			&item.OrganizationID,
			&item.SessionID,
			&item.InstanceID,
			&item.EventType,
			&item.WebhookToken,
			&payload,
			&item.Attempts,
			&item.MaxAttempts,
			&item.ProcessingLane,
			&item.CreatedAt,
		); err != nil {
			return nil, err
		}
		item.Payload = []byte(payload)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (repo Repository) RecoverStaleWebhookInbox(ctx context.Context) error {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := resetStaleEvolutionWebhookClaims(ctx, tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
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

	// Routing metadata is an internal durable-inbox concern. Never extend the
	// legacy Edge provider contract with backend-only ordering fields.
	providerPayload := evolutionWebhookProviderPayload(item.Payload)
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), bytes.NewReader(providerPayload))
	if err != nil {
		return err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", "application/json")
	supabasehttp.SetServiceAuth(request, repo.functions.apiKey)
	request.Header.Set("x-webhook-token", item.WebhookToken)

	response, err := repo.functions.httpClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	body, readErr := io.ReadAll(io.LimitReader(response.Body, maxEvolutionWebhookTargetResponseBytes+1))
	if readErr != nil {
		return readErr
	}
	if int64(len(body)) > maxEvolutionWebhookTargetResponseBytes {
		return fmt.Errorf("edge webhook response exceeded the allowed size")
	}
	return validateEvolutionWebhookTargetResponse(response.StatusCode, body)
}

func validateEvolutionWebhookTargetResponse(statusCode int, body []byte) error {
	if statusCode < http.StatusOK || statusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("edge webhook returned status %d", statusCode)
	}

	var envelope map[string]any
	if len(bytes.TrimSpace(body)) == 0 || json.Unmarshal(body, &envelope) != nil || envelope == nil {
		return fmt.Errorf("edge webhook returned an invalid JSON acknowledgement")
	}
	if semanticBoolean(envelope["success"]) == -1 || semanticBoolean(envelope["ok"]) == -1 {
		return fmt.Errorf("edge webhook rejected the delivery")
	}
	if semanticBoolean(envelope["ignored"]) == 1 {
		return fmt.Errorf("edge webhook ignored the delivery")
	}

	if result, ok := envelope["result"].(map[string]any); ok {
		if semanticPositiveCount(result["failed"]) ||
			semanticPositiveCount(result["inProgress"]) ||
			semanticPositiveCount(result["ignored"]) {
			return fmt.Errorf("edge webhook did not finish processing the delivery")
		}
	}

	if semanticBoolean(envelope["success"]) != 1 && semanticBoolean(envelope["ok"]) != 1 {
		return fmt.Errorf("edge webhook acknowledgement is missing a success marker")
	}
	return nil
}

func semanticBoolean(value any) int {
	boolean, ok := value.(bool)
	if !ok {
		return 0
	}
	if boolean {
		return 1
	}
	return -1
}

func semanticPositiveCount(value any) bool {
	switch typed := value.(type) {
	case float64:
		return typed > 0
	case bool:
		return typed
	case string:
		return strings.TrimSpace(typed) != "" && strings.TrimSpace(typed) != "0"
	case []any:
		return len(typed) > 0
	default:
		return false
	}
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
