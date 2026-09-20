package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"
)

var whatsappOutboxWorkerID = "vimob-api-whatsapp-outbox-" + randomHex(8)
var whatsappOutboxFastWorkerWake = make(chan struct{}, maxWhatsAppOutboxWorkerConcurrency)
var whatsappOutboxMediaWorkerWake = make(chan struct{}, 1)
var whatsappOutboxFastWorkerCount atomic.Int64

type whatsappOutboxLane string

const (
	whatsappOutboxLaneAny   whatsappOutboxLane = "any"
	whatsappOutboxLaneFast  whatsappOutboxLane = "fast"
	whatsappOutboxLaneMedia whatsappOutboxLane = "media"

	whatsappOutboxProviderStartedMarker  = "provider_delivery_started"
	whatsappOutboxProviderAcceptedMarker = "provider_accepted_finalization_pending"
	whatsappOutboxProviderUnknownMarker  = "provider_delivery_outcome_unknown"

	whatsappOutboxLeaseStaleAfter        = 5 * time.Minute
	whatsappOutboxLeaseHeartbeatInterval = 30 * time.Second
	whatsappOutboxLeaseHeartbeatTimeout  = 5 * time.Second
	whatsappOutboxSessionDeferDelay      = 30 * time.Second
	whatsappOutboxRecoveryBatch          = 250
	whatsappOutboxRecoveryMaxBatches     = 8

	// Preserve normal per-conversation order while a media send is healthy, but
	// never let a slow upload/provider call hold a newer text indefinitely.
	// After this grace period the fast lane may progress concurrently with the
	// older media operation; provider-visible cross-lane order is then best-effort.
	whatsappOutboxMediaOrderingGrace = 2 * time.Second
)

var (
	errWhatsAppOutboxLeaseLost           = errors.New("whatsapp outbox lease lost")
	errWhatsAppOutboxSessionDisconnected = errors.New("whatsapp outbox session temporarily disconnected")
	errWhatsAppOutboxFinalizationPending = errors.New("whatsapp outbox provider acceptance awaits local finalization")
)

type whatsappOutboxLaneMetrics struct {
	claimed           atomic.Uint64
	sent              atomic.Uint64
	deliveryFailures  atomic.Uint64
	workerErrors      atomic.Uint64
	maxClaimAgeMillis atomic.Uint64
}

type whatsappOutboxLaneMetricsSnapshot struct {
	Claimed           uint64
	Sent              uint64
	DeliveryFailures  uint64
	WorkerErrors      uint64
	MaxClaimAgeMillis uint64
}

var whatsappOutboxFastMetrics whatsappOutboxLaneMetrics
var whatsappOutboxMediaMetrics whatsappOutboxLaneMetrics

const (
	whatsappOutboxQueuedLanePredicateToken = "/* whatsapp_outbox_queued_lane_predicate */"
	whatsappOutboxActiveLanePredicateToken = "/* whatsapp_outbox_active_lane_predicate */"
	whatsappOutboxCrossLaneOrderingToken   = "/* whatsapp_outbox_cross_lane_ordering */"
)

const claimWhatsAppOutboxQueryTemplate = `
	with claim_params as materialized (
			select
				coalesce(nullif(btrim($3), '')::uuid, '00000000-0000-0000-0000-000000000000'::uuid) as after_conversation_id,
				$4::text as requested_lane,
				$5::double precision as media_ordering_grace_millis
		),
		conversation_heads as (
			select distinct on (queued.conversation_id)
				queued.conversation_id,
				queued.id,
				queued.message_type,
				queued.payload,
				queued.next_attempt_at,
				queued.created_at
			from public.whatsapp_outbox queued
			cross join claim_params params
			where queued.status in ('pending', 'retry')
			  and (
				queued.attempts < queued.max_attempts
				or queued.last_error = '` + whatsappOutboxProviderAcceptedMarker + `'
			  )
			  and (
				queued.last_error = '` + whatsappOutboxProviderAcceptedMarker + `'
				or exists (
					select 1
					from public.whatsapp_sessions as delivery_session
					where delivery_session.id = queued.session_id
					  and delivery_session.organization_id = queued.organization_id
					  and lower(btrim(coalesce(delivery_session.provider, ''))) = 'evolution_go'
					  and coalesce(delivery_session.is_active, true)
					  and lower(btrim(coalesce(delivery_session.status, ''))) = 'connected'
				)
			  )
			  and exists (
				select 1
				from public.whatsapp_messages as current_message
				join public.whatsapp_conversations as current_conversation
				  on current_conversation.id = current_message.conversation_id
				 and current_conversation.organization_id = current_message.organization_id
				 and current_conversation.session_id = current_message.session_id
				join public.whatsapp_conversation_lead_bindings as current_binding
				  on current_binding.organization_id = current_conversation.organization_id
				 and current_binding.conversation_id = current_conversation.id
				 and current_binding.session_id = current_conversation.session_id
				 and current_binding.lead_id = current_conversation.lead_id
				 and current_binding.active_to is null
				where current_message.id = queued.message_id
				  and current_message.organization_id = queued.organization_id
				  and current_message.session_id = queued.session_id
				  and current_message.conversation_id = queued.conversation_id
				  and current_message.lead_id = current_conversation.lead_id
			  )
			  and queued.conversation_id > params.after_conversation_id
			  ` + whatsappOutboxQueuedLanePredicateToken + `
			order by
				queued.conversation_id,
				queued.created_at,
				queued.id
		),
		candidate_conversations as materialized (
			select
				wc.id as conversation_id,
				head.id as event_id
			from conversation_heads head
			join public.whatsapp_conversations wc on wc.id = head.conversation_id
			cross join claim_params params
			where head.next_attempt_at <= now()
			  and not exists (
				select 1
				from public.whatsapp_outbox active
				where active.conversation_id = wc.id
				  and active.status = 'processing'
				  ` + whatsappOutboxActiveLanePredicateToken + `
			)
			  ` + whatsappOutboxCrossLaneOrderingToken + `
			order by wc.id
			limit $1
			for no key update of wc skip locked
		),
		locked_heads as materialized (
			select
				queued.id,
				selected.conversation_id
			from candidate_conversations selected
			join public.whatsapp_outbox queued on queued.id = selected.event_id
			cross join claim_params params
			where queued.status in ('pending', 'retry')
			  and (
				queued.attempts < queued.max_attempts
				or queued.last_error = '` + whatsappOutboxProviderAcceptedMarker + `'
			  )
			  and (
				queued.last_error = '` + whatsappOutboxProviderAcceptedMarker + `'
				or exists (
					select 1
					from public.whatsapp_sessions as delivery_session
					where delivery_session.id = queued.session_id
					  and delivery_session.organization_id = queued.organization_id
					  and lower(btrim(coalesce(delivery_session.provider, ''))) = 'evolution_go'
					  and coalesce(delivery_session.is_active, true)
					  and lower(btrim(coalesce(delivery_session.status, ''))) = 'connected'
				)
			  )
			  and exists (
				select 1
				from public.whatsapp_messages as current_message
				join public.whatsapp_conversations as current_conversation
				  on current_conversation.id = current_message.conversation_id
				 and current_conversation.organization_id = current_message.organization_id
				 and current_conversation.session_id = current_message.session_id
				join public.whatsapp_conversation_lead_bindings as current_binding
				  on current_binding.organization_id = current_conversation.organization_id
				 and current_binding.conversation_id = current_conversation.id
				 and current_binding.session_id = current_conversation.session_id
				 and current_binding.lead_id = current_conversation.lead_id
				 and current_binding.active_to is null
				where current_message.id = queued.message_id
				  and current_message.organization_id = queued.organization_id
				  and current_message.session_id = queued.session_id
				  and current_message.conversation_id = queued.conversation_id
				  and current_message.lead_id = current_conversation.lead_id
			  )
			  and queued.next_attempt_at <= now()
			  and not exists (
				select 1
				from public.whatsapp_outbox active
				where active.conversation_id = selected.conversation_id
				  and active.id <> queued.id
				  and active.status = 'processing'
				  ` + whatsappOutboxActiveLanePredicateToken + `
			  )
			order by selected.conversation_id
			for update of queued skip locked
		),
		claimed as (
			update public.whatsapp_outbox queued
			set status = 'processing',
			    locked_at = now(),
			    locked_by = concat($2::text, ':', $6::text, ':', queued.id::text),
			    updated_at = now()
			from locked_heads selected, claim_params params
			where queued.id = selected.id
			  and queued.status in ('pending', 'retry')
			  and (
				queued.attempts < queued.max_attempts
				or queued.last_error = '` + whatsappOutboxProviderAcceptedMarker + `'
			  )
			  and (
				queued.last_error = '` + whatsappOutboxProviderAcceptedMarker + `'
				or exists (
					select 1
					from public.whatsapp_sessions as delivery_session
					where delivery_session.id = queued.session_id
					  and delivery_session.organization_id = queued.organization_id
					  and lower(btrim(coalesce(delivery_session.provider, ''))) = 'evolution_go'
					  and coalesce(delivery_session.is_active, true)
					  and lower(btrim(coalesce(delivery_session.status, ''))) = 'connected'
				)
			  )
			  and exists (
				select 1
				from public.whatsapp_messages as current_message
				join public.whatsapp_conversations as current_conversation
				  on current_conversation.id = current_message.conversation_id
				 and current_conversation.organization_id = current_message.organization_id
				 and current_conversation.session_id = current_message.session_id
				join public.whatsapp_conversation_lead_bindings as current_binding
				  on current_binding.organization_id = current_conversation.organization_id
				 and current_binding.conversation_id = current_conversation.id
				 and current_binding.session_id = current_conversation.session_id
				 and current_binding.lead_id = current_conversation.lead_id
				 and current_binding.active_to is null
				where current_message.id = queued.message_id
				  and current_message.organization_id = queued.organization_id
				  and current_message.session_id = queued.session_id
				  and current_message.conversation_id = queued.conversation_id
				  and current_message.lead_id = current_conversation.lead_id
			  )
			  and queued.next_attempt_at <= now()
			  and not exists (
				select 1
				from public.whatsapp_outbox active
				where active.conversation_id = queued.conversation_id
				  and active.id <> queued.id
				  and active.status = 'processing'
				  ` + whatsappOutboxActiveLanePredicateToken + `
			  )
			returning
				queued.id,
				queued.organization_id,
				queued.session_id,
				queued.conversation_id,
				queued.message_id,
				queued.client_message_id,
				queued.provider_message_id,
				queued.payload,
				queued.attempts,
				queued.max_attempts,
				queued.locked_by,
				queued.last_error,
				queued.created_at
		)
		select
			claimed.id::text,
			claimed.organization_id::text,
			claimed.session_id::text,
			claimed.conversation_id::text,
			claimed.message_id::text,
			claimed.client_message_id,
			coalesce(claimed.provider_message_id, ''),
			claimed.payload::text,
			claimed.attempts,
			claimed.max_attempts,
			coalesce(claimed.locked_by, ''),
			coalesce(claimed.last_error, ''),
			claimed.created_at
		from claimed
		order by claimed.conversation_id
	`

var (
	// PostgreSQL cannot prove a parameterized lane OR implies a partial-index
	// predicate. Expand the two worker statements once at process startup so the
	// hot head scan contains a literal predicate matching its lane index. The
	// predicate-free query remains the compatibility path for lane `any`.
	claimWhatsAppOutboxQuery      = buildWhatsAppOutboxClaimQuery(whatsappOutboxLaneAny)
	claimWhatsAppOutboxFastQuery  = buildWhatsAppOutboxClaimQuery(whatsappOutboxLaneFast)
	claimWhatsAppOutboxMediaQuery = buildWhatsAppOutboxClaimQuery(whatsappOutboxLaneMedia)
)

func buildWhatsAppOutboxClaimQuery(lane whatsappOutboxLane) string {
	queuedLanePredicate := ""
	activeLanePredicate := ""
	crossLaneOrdering := ""

	switch lane {
	case whatsappOutboxLaneFast:
		queuedLanePredicate = `and not (
			lower(coalesce(queued.payload->>'action', '')) in ('send.media', 'send.audio', 'send.sticker')
			or lower(coalesce(queued.message_type, '')) in ('image', 'audio', 'video', 'document', 'sticker')
		)`
		activeLanePredicate = `and not (
			lower(coalesce(active.payload->>'action', '')) in ('send.media', 'send.audio', 'send.sticker')
			or lower(coalesce(active.message_type, '')) in ('image', 'audio', 'video', 'document', 'sticker')
		)`
		crossLaneOrdering = `and (
			head.created_at <= now() - make_interval(secs => params.media_ordering_grace_millis / 1000.0)
			or not exists (
				select 1
				from public.whatsapp_outbox older_media
				where older_media.conversation_id = wc.id
				  and older_media.status in ('pending', 'retry', 'processing')
				  and (older_media.status = 'processing' or older_media.attempts < older_media.max_attempts)
				  and (older_media.created_at, older_media.id) < (head.created_at, head.id)
				  and (
					lower(coalesce(older_media.payload->>'action', '')) in ('send.media', 'send.audio', 'send.sticker')
					or lower(coalesce(older_media.message_type, '')) in ('image', 'audio', 'video', 'document', 'sticker')
				  )
			)
		)`
	case whatsappOutboxLaneMedia:
		queuedLanePredicate = `and (
			lower(coalesce(queued.payload->>'action', '')) in ('send.media', 'send.audio', 'send.sticker')
			or lower(coalesce(queued.message_type, '')) in ('image', 'audio', 'video', 'document', 'sticker')
		)`
		activeLanePredicate = `and (
			lower(coalesce(active.payload->>'action', '')) in ('send.media', 'send.audio', 'send.sticker')
			or lower(coalesce(active.message_type, '')) in ('image', 'audio', 'video', 'document', 'sticker')
		)`
		crossLaneOrdering = `and not exists (
			select 1
			from public.whatsapp_outbox older_fast
			where older_fast.conversation_id = wc.id
			  and older_fast.status in ('pending', 'retry', 'processing')
			  and (older_fast.status = 'processing' or older_fast.attempts < older_fast.max_attempts)
			  and (older_fast.created_at, older_fast.id) < (head.created_at, head.id)
			  and not (
				lower(coalesce(older_fast.payload->>'action', '')) in ('send.media', 'send.audio', 'send.sticker')
				or lower(coalesce(older_fast.message_type, '')) in ('image', 'audio', 'video', 'document', 'sticker')
			  )
		)`
	}

	return strings.NewReplacer(
		whatsappOutboxQueuedLanePredicateToken, queuedLanePredicate,
		whatsappOutboxActiveLanePredicateToken, activeLanePredicate,
		whatsappOutboxCrossLaneOrderingToken, crossLaneOrdering,
	).Replace(claimWhatsAppOutboxQueryTemplate)
}

func whatsappOutboxClaimQueryForLane(lane whatsappOutboxLane) string {
	switch lane {
	case whatsappOutboxLaneFast:
		return claimWhatsAppOutboxFastQuery
	case whatsappOutboxLaneMedia:
		return claimWhatsAppOutboxMediaQuery
	default:
		return claimWhatsAppOutboxQuery
	}
}

func wakeWhatsAppOutboxWorker() {
	// Wake every fast-lane worker. A buffered, non-blocking broadcast preserves
	// request latency while allowing a burst of newly committed text messages to
	// use the configured concurrency immediately.
	wakeWhatsAppOutboxFastWorkers()
	select {
	case whatsappOutboxMediaWorkerWake <- struct{}{}:
	default:
	}
}

func wakeWhatsAppOutboxFastWorkers() {
	workerCount := int(whatsappOutboxFastWorkerCount.Load())
	if workerCount < 1 || workerCount > maxWhatsAppOutboxWorkerConcurrency {
		workerCount = defaultWhatsAppOutboxWorkerConcurrency
	}
	for range workerCount {
		select {
		case whatsappOutboxFastWorkerWake <- struct{}{}:
		default:
			return
		}
	}
}

func whatsappOutboxLaneForPayload(payload map[string]any) whatsappOutboxLane {
	action := strings.ToLower(strings.TrimSpace(stringFromAny(payload["action"])))
	if action == "send.media" || action == "send.audio" || action == "send.sticker" {
		return whatsappOutboxLaneMedia
	}
	return whatsappOutboxLaneFast
}

func whatsappOutboxMetricsForLane(lane whatsappOutboxLane) *whatsappOutboxLaneMetrics {
	if lane == whatsappOutboxLaneMedia {
		return &whatsappOutboxMediaMetrics
	}
	return &whatsappOutboxFastMetrics
}

func recordWhatsAppOutboxClaim(lane whatsappOutboxLane, createdAt time.Time) {
	metrics := whatsappOutboxMetricsForLane(lane)
	metrics.claimed.Add(1)
	if createdAt.IsZero() {
		return
	}
	age := time.Since(createdAt)
	if age < 0 {
		age = 0
	}
	ageMillis := uint64(age / time.Millisecond)
	for current := metrics.maxClaimAgeMillis.Load(); ageMillis > current; current = metrics.maxClaimAgeMillis.Load() {
		if metrics.maxClaimAgeMillis.CompareAndSwap(current, ageMillis) {
			break
		}
	}
}

func recordWhatsAppOutboxSent(lane whatsappOutboxLane) {
	whatsappOutboxMetricsForLane(lane).sent.Add(1)
}

func recordWhatsAppOutboxDeliveryFailure(lane whatsappOutboxLane) {
	whatsappOutboxMetricsForLane(lane).deliveryFailures.Add(1)
}

func recordWhatsAppOutboxWorkerError(lane whatsappOutboxLane) {
	whatsappOutboxMetricsForLane(lane).workerErrors.Add(1)
}

func snapshotWhatsAppOutboxLaneMetrics(lane whatsappOutboxLane) whatsappOutboxLaneMetricsSnapshot {
	metrics := whatsappOutboxMetricsForLane(lane)
	return whatsappOutboxLaneMetricsSnapshot{
		Claimed:           metrics.claimed.Swap(0),
		Sent:              metrics.sent.Swap(0),
		DeliveryFailures:  metrics.deliveryFailures.Swap(0),
		WorkerErrors:      metrics.workerErrors.Swap(0),
		MaxClaimAgeMillis: metrics.maxClaimAgeMillis.Swap(0),
	}
}

func logWhatsAppOutboxMinute(logger *slog.Logger) {
	fast := snapshotWhatsAppOutboxLaneMetrics(whatsappOutboxLaneFast)
	media := snapshotWhatsAppOutboxLaneMetrics(whatsappOutboxLaneMedia)
	logger.Info(
		"whatsapp outbox minute",
		"fast_claimed", fast.Claimed,
		"fast_sent", fast.Sent,
		"fast_delivery_failures", fast.DeliveryFailures,
		"fast_worker_errors", fast.WorkerErrors,
		"fast_max_claim_age_ms", fast.MaxClaimAgeMillis,
		"media_claimed", media.Claimed,
		"media_sent", media.Sent,
		"media_delivery_failures", media.DeliveryFailures,
		"media_worker_errors", media.WorkerErrors,
		"media_max_claim_age_ms", media.MaxClaimAgeMillis,
	)
}

type pendingWhatsAppOutbox struct {
	ID                string
	OrganizationID    string
	SessionID         string
	ConversationID    string
	MessageRowID      string
	ClientMessageID   string
	ProviderMessageID string
	Payload           map[string]any
	Attempts          int
	MaxAttempts       int
	LeaseToken        string
	LastError         string
	CreatedAt         time.Time
}

func (handler Handler) StartOutboxWorker(ctx context.Context, logger *slog.Logger) {
	config := handler.workerConfig.normalized()
	if !config.OutboxWorkerEnabled {
		return
	}
	if logger == nil {
		logger = slog.Default()
	}
	whatsappOutboxFastWorkerCount.Store(int64(config.OutboxWorkerConcurrency))

	// Text and lightweight control operations have their own capacity. Outbound
	// media is intentionally isolated because provider-side fetch/upload can take
	// orders of magnitude longer than a text request. FIFO is strict inside each
	// lane. Across lanes, text waits briefly for older media and then proceeds so
	// an upload/provider stall cannot freeze the conversation indefinitely.
	for range config.OutboxWorkerConcurrency {
		go handler.runWhatsAppOutboxLaneWorker(
			ctx,
			logger,
			whatsappOutboxLaneFast,
			whatsappOutboxFastWorkerWake,
			config.OutboxWorkerInterval,
			config.OutboxWorkerBatch,
		)
	}
	go handler.runWhatsAppOutboxLaneWorker(
		ctx,
		logger,
		whatsappOutboxLaneMedia,
		whatsappOutboxMediaWorkerWake,
		config.OutboxWorkerInterval,
		1,
	)

	go func() {
		recoveryTicker := time.NewTicker(time.Minute)
		cleanupTicker := time.NewTicker(time.Hour)
		defer recoveryTicker.Stop()
		defer cleanupTicker.Stop()
		if err := handler.repo.RecoverStaleWhatsAppOutbox(ctx); err != nil && !errors.Is(err, context.Canceled) {
			logger.Error("whatsapp outbox recovery failed", "error", err)
		}
		for {
			select {
			case <-ctx.Done():
				return
			case <-recoveryTicker.C:
				logWhatsAppOutboxMinute(logger)
				if err := handler.repo.RecoverStaleWhatsAppOutbox(ctx); err != nil && !errors.Is(err, context.Canceled) {
					logger.Error("whatsapp outbox recovery failed", "error", err)
				}
			case <-cleanupTicker.C:
				if _, err := handler.repo.CleanupTerminalWhatsAppOutbox(ctx, 1000); err != nil && !errors.Is(err, context.Canceled) {
					logger.Error("whatsapp outbox cleanup failed", "error", err)
				}
			}
		}
	}()

	// Drain rows already committed before this process started instead of waiting
	// for the first fallback poll.
	wakeWhatsAppOutboxWorker()
}

func (handler Handler) runWhatsAppOutboxLaneWorker(
	ctx context.Context,
	logger *slog.Logger,
	lane whatsappOutboxLane,
	wake <-chan struct{},
	interval time.Duration,
	burst int,
) {
	pollTicker := time.NewTicker(interval)
	defer pollTicker.Stop()
	afterConversationID := ""

	for {
		processed, cursor, err := handler.repo.processWhatsAppOutboxLaneBurst(ctx, lane, burst, afterConversationID)
		afterConversationID = cursor
		if err != nil && !errors.Is(err, context.Canceled) {
			recordWhatsAppOutboxWorkerError(lane)
			logger.Error("whatsapp outbox lane failed", "lane", lane, "error", err)
		}
		if err == nil && processed > 0 {
			// Any successful delivery just changed the head of its conversation.
			// Probe again immediately so a single busy conversation is not throttled
			// by the fallback poll after the fair cursor completes one wrap.
			continue
		}

		select {
		case <-ctx.Done():
			return
		case <-pollTicker.C:
		case <-wake:
		}
	}
}

func (repo Repository) CleanupTerminalWhatsAppOutbox(ctx context.Context, limit int) (int64, error) {
	if limit < 1 || limit > 10000 {
		limit = 1000
	}
	result, err := repo.db.Pool().Exec(ctx, `
		with expired as (
			select id
			from public.whatsapp_outbox
			where (
				status in ('sent', 'delivered', 'read')
				and updated_at < now() - interval '90 days'
			) or (
				status in ('failed', 'dead')
				and updated_at < now() - interval '180 days'
			)
			order by updated_at, id
			limit $1
			for update skip locked
		)
		delete from public.whatsapp_outbox outbox
		using expired
		where outbox.id = expired.id
	`, limit)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected(), nil
}

func (repo Repository) ProcessWhatsAppOutbox(ctx context.Context) error {
	return repo.ProcessWhatsAppOutboxWithBatch(ctx, defaultWhatsAppOutboxWorkerBatch)
}

func (repo Repository) ProcessWhatsAppOutboxWithBatch(ctx context.Context, batch int) error {
	_, _, err := repo.processWhatsAppOutboxLaneBurst(ctx, whatsappOutboxLaneAny, batch, "")
	return err
}

func (repo Repository) processWhatsAppOutboxLaneBurst(
	ctx context.Context,
	lane whatsappOutboxLane,
	burst int,
	afterConversationID string,
) (int, string, error) {
	burst = normalizeWorkerBatch(burst, defaultWhatsAppOutboxWorkerBatch)
	processed := 0
	cursor := afterConversationID
	wrapped := false
	var processErrors []error
	for processed < burst {
		// Claim only the row that this goroutine is about to deliver. Claiming a
		// whole burst up front would leave the remaining rows leased as
		// `processing` while provider calls are still happening sequentially.
		items, err := repo.claimWhatsAppOutboxWithBatchAfterConversation(ctx, 1, cursor, lane)
		if err != nil {
			processErrors = append(processErrors, err)
			break
		}
		if len(items) == 0 {
			if tryWrapWhatsAppOutboxCursor(&cursor, &wrapped) {
				continue
			}
			break
		}
		item := items[0]
		cursor = item.ConversationID
		metricsLane := lane
		if metricsLane == whatsappOutboxLaneAny {
			metricsLane = whatsappOutboxLaneForPayload(item.Payload)
		}
		recordWhatsAppOutboxClaim(metricsLane, item.CreatedAt)
		if err := repo.processClaimedWhatsAppOutbox(ctx, item, metricsLane); err != nil {
			if lane == whatsappOutboxLaneAny {
				recordWhatsAppOutboxWorkerError(metricsLane)
			}
			processErrors = append(processErrors, err)
		}
		processed++
	}
	return processed, cursor, errors.Join(processErrors...)
}

func tryWrapWhatsAppOutboxCursor(cursor *string, wrapped *bool) bool {
	if cursor == nil || wrapped == nil || *wrapped || strings.TrimSpace(*cursor) == "" {
		return false
	}
	*cursor = ""
	*wrapped = true
	return true
}

func (repo Repository) processClaimedWhatsAppOutbox(ctx context.Context, item pendingWhatsAppOutbox, lane whatsappOutboxLane) error {
	leaseOwned, err := repo.renewWhatsAppOutboxLease(ctx, item)
	if err != nil {
		return err
	}
	if !leaseOwned {
		return fmt.Errorf("%w: %s", errWhatsAppOutboxLeaseLost, item.ID)
	}

	// A provider acknowledgement was already persisted by an earlier lease. This
	// claim owns local reconciliation only; it must never invoke the provider a
	// second time.
	if whatsappOutboxAwaitingFinalization(item.LastError) {
		if strings.TrimSpace(item.ProviderMessageID) == "" {
			cause := fmt.Errorf("%w: accepted outbox row has no provider message id", ErrProviderOutcomeUnknown)
			return repo.failWhatsAppOutbox(ctx, item, cause, false, true)
		}
		if err := repo.completeWhatsAppOutbox(ctx, item, item.ProviderMessageID); err != nil {
			return repo.deferWhatsAppOutboxFinalization(ctx, item, err)
		}
		recordWhatsAppOutboxSent(lane)
		return nil
	}

	action := strings.TrimSpace(stringFromAny(item.Payload["action"]))
	body := mapFromAny(item.Payload["body"])
	if action == "" || len(body) == 0 {
		recordWhatsAppOutboxDeliveryFailure(lane)
		return repo.failWhatsAppOutbox(ctx, item, fmt.Errorf("invalid outbox payload"), true, false)
	}
	permanentSessionFailure, sessionErr := repo.validateWhatsAppOutboxSession(ctx, item)
	if sessionErr != nil {
		recordWhatsAppOutboxDeliveryFailure(lane)
		if errors.Is(sessionErr, errWhatsAppOutboxSessionDisconnected) {
			return repo.deferWhatsAppOutboxWithoutAttempt(ctx, item, sessionErr)
		}
		return repo.failWhatsAppOutbox(ctx, item, sessionErr, permanentSessionFailure, false)
	}
	if storagePath := strings.TrimSpace(stringFromAny(body["mediaStoragePath"])); storagePath != "" {
		if !whatsappMediaPathBelongsToOrganization(storagePath, item.OrganizationID) {
			recordWhatsAppOutboxDeliveryFailure(lane)
			return repo.failWhatsAppOutbox(
				ctx,
				item,
				fmt.Errorf("%w: outbound media path escaped organization scope", ErrInvalidInput),
				true,
				false,
			)
		}
		signedURL, signErr := repo.storage.signedURL(ctx, whatsappMediaBucket, storagePath, 15*60)
		if signErr != nil || signedURL == "" {
			if signErr == nil {
				signErr = fmt.Errorf("media signed URL is empty")
			}
			recordWhatsAppOutboxDeliveryFailure(lane)
			return repo.failWhatsAppOutbox(ctx, item, signErr, false, false)
		}
		body["media"] = signedURL
		body["url"] = signedURL
		body["mediaUrl"] = signedURL
		delete(body, "mediaStoragePath")
	}

	item.Attempts, err = repo.startWhatsAppOutboxProviderAttempt(ctx, item)
	if err != nil {
		return err
	}

	var providerResult map[string]any
	providerCallErr, leaseErr := superviseWhatsAppOutboxLease(
		ctx,
		whatsappOutboxLeaseHeartbeatInterval,
		func(heartbeatCtx context.Context) (bool, error) {
			return repo.renewWhatsAppOutboxLease(heartbeatCtx, item)
		},
		func(providerCtx context.Context) error {
			var sendErr error
			providerResult, sendErr = repo.functions.invokeEvolution(providerCtx, action, map[string]any{
				"session_id": item.SessionID,
				"body":       body,
			})
			return sendErr
		},
	)
	if leaseErr != nil {
		// The durable provider-started marker remains on the row. Recovery will
		// quarantine it as outcome-unknown instead of issuing another send.
		return errors.Join(providerCallErr, leaseErr)
	}
	sendErr := providerCallErr
	if sendErr != nil {
		recordWhatsAppOutboxDeliveryFailure(lane)
		return repo.failWhatsAppOutbox(ctx, item, sendErr, false, whatsappOutboxProviderOutcomeUnknown(sendErr))
	}

	providerID := stripNullBytes(providerMessageID(providerResult))
	expectedProviderID := stripNullBytes(strings.TrimSpace(item.ProviderMessageID))
	if expectedProviderID == "" {
		expectedProviderID = deterministicProviderMessageID(item.ClientMessageID)
	}
	if action != "message.react" && providerID != "" && providerID != expectedProviderID {
		// Evolution Go receives the deterministic stanza ID in body.id. If a
		// successful response reports another ID, the provider has already
		// observed the request but our idempotency contract is no longer
		// provable. Stop automatic retries instead of risking a duplicate.
		mismatchErr := fmt.Errorf(
			"%w: provider message id mismatch (expected %s, received %s)",
			ErrProviderOutcomeUnknown,
			expectedProviderID,
			providerID,
		)
		recordWhatsAppOutboxDeliveryFailure(lane)
		return repo.failWhatsAppOutbox(ctx, item, mismatchErr, false, true)
	}
	if action == "message.react" && providerID == strings.TrimSpace(stringFromAny(body["messageId"])) {
		// Some providers acknowledge a reaction by echoing the target message
		// ID. Never overwrite the reaction event with the target's identity.
		providerID = item.ProviderMessageID
	}
	if providerID == "" {
		providerID = expectedProviderID
	}
	providerWebhookAlreadyFinalized := false
	finalizationErr := finalizeAcceptedWhatsAppOutbox(
		func() error {
			alreadyFinalized, err := repo.markWhatsAppOutboxProviderAccepted(ctx, item, providerID)
			if err != nil {
				return err
			}
			providerWebhookAlreadyFinalized = alreadyFinalized
			item.ProviderMessageID = providerID
			item.LastError = whatsappOutboxProviderAcceptedMarker
			return nil
		},
		func() error {
			if providerWebhookAlreadyFinalized {
				// The signed provider webhook committed the outbox and all local
				// projections atomically while this worker was returning from the
				// provider. There is no lease left to finalize and no reason to
				// classify the successful send as outcome-unknown.
				return nil
			}
			return repo.completeWhatsAppOutbox(ctx, item, providerID)
		},
		func(cause error) error {
			return repo.deferWhatsAppOutboxFinalization(ctx, item, cause)
		},
	)
	if errors.Is(finalizationErr, ErrProviderOutcomeUnknown) {
		recordWhatsAppOutboxDeliveryFailure(lane)
		return errors.Join(finalizationErr, repo.failWhatsAppOutbox(ctx, item, finalizationErr, false, true))
	}
	if finalizationErr != nil {
		return finalizationErr
	}
	recordWhatsAppOutboxSent(lane)
	return nil
}

func finalizeAcceptedWhatsAppOutbox(
	markAccepted func() error,
	complete func() error,
	deferFinalization func(error) error,
) error {
	if err := markAccepted(); err != nil {
		return fmt.Errorf("%w: provider accepted but acknowledgement marker failed: %v", ErrProviderOutcomeUnknown, err)
	}
	if err := complete(); err != nil {
		return deferFinalization(err)
	}
	return nil
}

func (repo Repository) validateWhatsAppOutboxSession(ctx context.Context, item pendingWhatsAppOutbox) (bool, error) {
	var organizationID, provider, status string
	var active bool
	err := repo.db.Pool().QueryRow(ctx, `
		select organization_id::text, coalesce(provider, ''), coalesce(status, ''), coalesce(is_active, true)
		from public.whatsapp_sessions
		where id = $1::uuid
		limit 1
	`, item.SessionID).Scan(&organizationID, &provider, &status, &active)
	if errors.Is(err, pgx.ErrNoRows) {
		return true, fmt.Errorf("%w: WhatsApp session no longer exists", ErrSessionNotFound)
	}
	if err != nil {
		return false, err
	}
	if organizationID != item.OrganizationID || provider != "evolution_go" || !active || status == "deleted" {
		return true, fmt.Errorf("%w: WhatsApp session is not eligible for delivery", ErrSessionNotFound)
	}
	if status != "connected" {
		return false, fmt.Errorf("%w: %w", ErrProviderFailed, errWhatsAppOutboxSessionDisconnected)
	}
	return false, nil
}

func whatsappOutboxAwaitingFinalization(lastError string) bool {
	return strings.TrimSpace(lastError) == whatsappOutboxProviderAcceptedMarker
}

func whatsappOutboxProviderOutcomeUnknown(err error) bool {
	return errors.Is(err, ErrProviderOutcomeUnknown) ||
		errors.Is(err, context.Canceled) ||
		errors.Is(err, context.DeadlineExceeded)
}

func superviseWhatsAppOutboxLease(
	ctx context.Context,
	heartbeatInterval time.Duration,
	renew func(context.Context) (bool, error),
	providerCall func(context.Context) error,
) (providerErr error, leaseErr error) {
	if heartbeatInterval <= 0 {
		heartbeatInterval = whatsappOutboxLeaseHeartbeatInterval
	}
	providerCtx, cancelProvider := context.WithCancel(ctx)
	defer cancelProvider()
	leaseResult := make(chan error, 1)
	providerDone := make(chan struct{})
	go func() {
		ticker := time.NewTicker(heartbeatInterval)
		defer ticker.Stop()
		for {
			select {
			case <-providerCtx.Done():
				leaseResult <- nil
				return
			case <-ticker.C:
				heartbeatCtx, cancelHeartbeat := context.WithTimeout(providerCtx, whatsappOutboxLeaseHeartbeatTimeout)
				renewed, err := renew(heartbeatCtx)
				cancelHeartbeat()
				// Provider completion may cancel an in-flight heartbeat. It is not a
				// lease failure; the following accepted-marker update remains fenced
				// and will detect a genuinely reclaimed row.
				select {
				case <-providerDone:
					leaseResult <- nil
					return
				default:
				}
				if err != nil {
					cancelProvider()
					leaseResult <- err
					return
				}
				if !renewed {
					cancelProvider()
					leaseResult <- errWhatsAppOutboxLeaseLost
					return
				}
			}
		}
	}()

	providerErr = providerCall(providerCtx)
	close(providerDone)
	cancelProvider()
	leaseErr = <-leaseResult
	return providerErr, leaseErr
}

func (repo Repository) renewWhatsAppOutboxLease(ctx context.Context, item pendingWhatsAppOutbox) (bool, error) {
	if strings.TrimSpace(item.LeaseToken) == "" {
		return false, errWhatsAppOutboxLeaseLost
	}
	result, err := repo.db.Pool().Exec(ctx, `
		update public.whatsapp_outbox
		set locked_at = now(), updated_at = now()
		where id = $1::uuid
		  and status = 'processing'
		  and locked_by = $2
	`, item.ID, item.LeaseToken)
	if err != nil {
		return false, err
	}
	return result.RowsAffected() == 1, nil
}

func (repo Repository) startWhatsAppOutboxProviderAttempt(ctx context.Context, item pendingWhatsAppOutbox) (int, error) {
	var attempts int
	err := repo.db.Pool().QueryRow(ctx, `
		update public.whatsapp_outbox
		set attempts = attempts + 1,
		    locked_at = now(),
		    last_error = $3,
		    updated_at = now()
		where id = $1::uuid
		  and status = 'processing'
		  and locked_by = $2
		  and attempts < max_attempts
		returning attempts
	`, item.ID, item.LeaseToken, whatsappOutboxProviderStartedMarker).Scan(&attempts)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, errWhatsAppOutboxLeaseLost
	}
	return attempts, err
}

func (repo Repository) markWhatsAppOutboxProviderAccepted(ctx context.Context, item pendingWhatsAppOutbox, providerMessageID string) (bool, error) {
	result, err := repo.db.Pool().Exec(ctx, `
		update public.whatsapp_outbox
		set provider_message_id = $3,
		    locked_at = now(),
		    last_error = $4,
		    updated_at = now()
		where id = $1::uuid
		  and status = 'processing'
		  and locked_by = $2
	`, item.ID, item.LeaseToken, providerMessageID, whatsappOutboxProviderAcceptedMarker)
	if err != nil {
		return false, err
	}
	if result.RowsAffected() == 1 {
		return false, nil
	}

	// A signed outbound webhook can legitimately win the race after the
	// provider accepts the send. Its transaction clears this worker's lease and
	// completes the message/outbox projections. Confirm that exact terminal
	// identity before accepting the lost lease as success.
	var status, persistedProviderMessageID, messageID string
	err = repo.db.Pool().QueryRow(ctx, `
		select coalesce(status, ''), coalesce(provider_message_id, ''), coalesce(message_id::text, '')
		from public.whatsapp_outbox
		where id = $1::uuid
		  and organization_id = $2::uuid
		  and session_id = $3::uuid
		limit 1
	`, item.ID, item.OrganizationID, item.SessionID).Scan(&status, &persistedProviderMessageID, &messageID)
	if err != nil {
		return false, errors.Join(errWhatsAppOutboxLeaseLost, err)
	}
	if whatsappOutboxTerminalMatchesProvider(status, persistedProviderMessageID, providerMessageID, messageID) {
		return true, nil
	}
	return false, errWhatsAppOutboxLeaseLost
}

func whatsappOutboxTerminalMatchesProvider(status string, persistedProviderMessageID string, expectedProviderMessageID string, messageID string) bool {
	status = strings.TrimSpace(status)
	return (status == "sent" || status == "delivered" || status == "read") &&
		strings.TrimSpace(messageID) != "" &&
		strings.TrimSpace(persistedProviderMessageID) != "" &&
		strings.TrimSpace(persistedProviderMessageID) == strings.TrimSpace(expectedProviderMessageID)
}

func (repo Repository) deferWhatsAppOutboxWithoutAttempt(ctx context.Context, item pendingWhatsAppOutbox, cause error) error {
	result, err := repo.db.Pool().Exec(ctx, `
		update public.whatsapp_outbox
		set status = 'retry',
		    next_attempt_at = now() + ($3 * interval '1 second'),
		    locked_at = null,
		    locked_by = null,
		    last_error = left($4, 4000),
		    updated_at = now()
		where id = $1::uuid
		  and status = 'processing'
		  and locked_by = $2
	`, item.ID, item.LeaseToken, int64(whatsappOutboxSessionDeferDelay/time.Second), cause.Error())
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return errWhatsAppOutboxLeaseLost
	}
	return nil
}

func (repo Repository) deferWhatsAppOutboxFinalization(ctx context.Context, item pendingWhatsAppOutbox, cause error) error {
	result, err := repo.db.Pool().Exec(ctx, `
		update public.whatsapp_outbox
		set status = 'retry',
		    next_attempt_at = now() + interval '5 seconds',
		    locked_at = null,
		    locked_by = null,
		    last_error = $3,
		    updated_at = now()
		where id = $1::uuid
		  and status = 'processing'
		  and locked_by = $2
		  and last_error = $3
	`, item.ID, item.LeaseToken, whatsappOutboxProviderAcceptedMarker)
	if err != nil {
		return errors.Join(fmt.Errorf("%w: %v", errWhatsAppOutboxFinalizationPending, cause), err)
	}
	if result.RowsAffected() != 1 {
		return errors.Join(fmt.Errorf("%w: %v", errWhatsAppOutboxFinalizationPending, cause), errWhatsAppOutboxLeaseLost)
	}
	return fmt.Errorf("%w: %v", errWhatsAppOutboxFinalizationPending, cause)
}

func (repo Repository) getOutboundMessageByClientID(ctx context.Context, organizationID string, sessionID string, clientMessageID string) (Message, error) {
	message, err := scanMessage(repo.db.Pool().QueryRow(ctx, `
		select `+messageSelectFields()+`
		from public.whatsapp_messages wm
		where wm.organization_id = $1::uuid
		  and wm.session_id = $2::uuid
		  and wm.client_message_id = $3
		limit 1
	`, organizationID, sessionID, clientMessageID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Message{}, ErrMessageNotFound
	}
	if err != nil {
		return Message{}, err
	}
	messages := []Message{message}
	if err := repo.hydrateMessageMediaURLs(ctx, organizationID, messages); err != nil {
		return Message{}, err
	}
	return messages[0], nil
}

func (repo Repository) claimWhatsAppOutbox(ctx context.Context) ([]pendingWhatsAppOutbox, error) {
	return repo.claimWhatsAppOutboxWithBatch(ctx, defaultWhatsAppOutboxWorkerBatch)
}

func (repo Repository) claimWhatsAppOutboxWithBatch(ctx context.Context, batch int) ([]pendingWhatsAppOutbox, error) {
	return repo.claimWhatsAppOutboxWithBatchAfterConversation(ctx, batch, "", whatsappOutboxLaneAny)
}

func (repo Repository) claimWhatsAppOutboxWithBatchAfterConversation(
	ctx context.Context,
	batch int,
	afterConversationID string,
	lane whatsappOutboxLane,
) ([]pendingWhatsAppOutbox, error) {
	batch = normalizeWorkerBatch(batch, defaultWhatsAppOutboxWorkerBatch)
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	// A missing rollout index must fail quickly instead of turning every fast
	// lane claim into a long scan over the durable outbox.
	if _, err := tx.Exec(ctx, `set local statement_timeout = '5s'`); err != nil {
		return nil, err
	}

	rows, err := tx.Query(
		ctx,
		whatsappOutboxClaimQueryForLane(lane),
		batch,
		whatsappOutboxWorkerID,
		afterConversationID,
		string(lane),
		whatsappOutboxMediaOrderingGrace.Milliseconds(),
		randomHex(16),
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]pendingWhatsAppOutbox, 0, batch)
	for rows.Next() {
		var item pendingWhatsAppOutbox
		var rawPayload string
		if err := rows.Scan(
			&item.ID,
			&item.OrganizationID,
			&item.SessionID,
			&item.ConversationID,
			&item.MessageRowID,
			&item.ClientMessageID,
			&item.ProviderMessageID,
			&rawPayload,
			&item.Attempts,
			&item.MaxAttempts,
			&item.LeaseToken,
			&item.LastError,
			&item.CreatedAt,
		); err != nil {
			return nil, err
		}
		item.Payload = map[string]any{}
		if err := json.Unmarshal([]byte(rawPayload), &item.Payload); err != nil {
			item.Payload = map[string]any{}
		}
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

func (repo Repository) RecoverStaleWhatsAppOutbox(ctx context.Context) error {
	for batchIndex := 0; batchIndex < whatsappOutboxRecoveryMaxBatches; batchIndex++ {
		recovered, err := repo.recoverStaleWhatsAppOutboxBatch(ctx, whatsappOutboxRecoveryBatch)
		if err != nil {
			return err
		}
		if recovered < whatsappOutboxRecoveryBatch {
			return nil
		}
		if err := ctx.Err(); err != nil {
			return err
		}
	}
	return nil
}

func (repo Repository) recoverStaleWhatsAppOutboxBatch(ctx context.Context, batch int) (int, error) {
	batch = normalizeWorkerBatch(batch, whatsappOutboxRecoveryBatch)
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `set local lock_timeout = '2s'; set local statement_timeout = '30s'`); err != nil {
		return 0, err
	}
	staleSeconds := int64(whatsappOutboxLeaseStaleAfter / time.Second)

	// Lock one globally ordered, bounded set. This prevents recovery from
	// holding an unbounded portion of the outbox or acquiring the same batch in
	// a different order than webhook/finalizer transactions.
	rows, err := tx.Query(ctx, `
		with candidates as materialized (
		  select outbox.id,
		         case
		           when outbox.status = 'processing'
		             and outbox.locked_at < now() - ($4 * interval '1 second')
		             and outbox.last_error = $1 then 'finalize'
		           when outbox.status = 'processing'
		             and outbox.locked_at < now() - ($4 * interval '1 second')
		             and outbox.last_error = $2 then 'unknown'
		           when outbox.attempts >= outbox.max_attempts then 'exhausted'
		           else 'retry'
		         end as recovery_action
		  from public.whatsapp_outbox as outbox
		  where (
		      outbox.status = 'processing'
		      and outbox.locked_at < now() - ($4 * interval '1 second')
		      and outbox.last_error in ($1, $2)
		    ) or (
		      outbox.attempts >= outbox.max_attempts
		      and coalesce(outbox.last_error, '') <> $1
		      and (
		        (outbox.status in ('pending', 'retry') and outbox.next_attempt_at <= now())
		        or (outbox.status = 'processing' and outbox.locked_at < now() - ($4 * interval '1 second'))
		      )
		    ) or (
		      outbox.status = 'processing'
		      and outbox.locked_at < now() - ($4 * interval '1 second')
		      and outbox.attempts < outbox.max_attempts
		      and coalesce(outbox.last_error, '') not in ($1, $2)
		    )
		  order by outbox.id
		  limit $5
		  for update skip locked
		), recovered as (
		  update public.whatsapp_outbox as outbox
		  set status = case when candidate.recovery_action in ('finalize', 'retry') then 'retry' else 'dead' end,
		      dead_lettered_at = case
		        when candidate.recovery_action in ('unknown', 'exhausted') then coalesce(outbox.dead_lettered_at, now())
		        else outbox.dead_lettered_at
		      end,
		      locked_at = null,
		      locked_by = null,
		      next_attempt_at = case
		        when candidate.recovery_action in ('finalize', 'retry') then now()
		        else outbox.next_attempt_at
		      end,
		      last_error = case
		        when candidate.recovery_action = 'unknown' then $3
		        when candidate.recovery_action = 'exhausted' then coalesce(outbox.last_error, 'retry_exhausted')
		        else outbox.last_error
		      end,
		      updated_at = now()
		  from candidates as candidate
		  where outbox.id = candidate.id
		  returning outbox.id::text, outbox.status
		)
		select id, status from recovered order by id
	`, whatsappOutboxProviderAcceptedMarker, whatsappOutboxProviderStartedMarker,
		whatsappOutboxProviderUnknownMarker, staleSeconds, batch)
	if err != nil {
		return 0, err
	}
	recoveredCount := 0
	terminalIDs := make([]string, 0, batch)
	for rows.Next() {
		var id, status string
		if err := rows.Scan(&id, &status); err != nil {
			rows.Close()
			return 0, err
		}
		recoveredCount++
		if status == "dead" || status == "failed" {
			terminalIDs = append(terminalIDs, id)
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, err
	}
	rows.Close()
	if len(terminalIDs) > 0 {
		if err := repo.syncTerminalWhatsAppOutboxFailuresBatch(ctx, tx, terminalIDs); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return recoveredCount, nil
}

func (repo Repository) completeWhatsAppOutbox(ctx context.Context, item pendingWhatsAppOutbox, providerMessageID string) error {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Binding switches lock the physical conversation before touching its
	// outbox. Preserve that order during provider finalization as well: the
	// message-context triggers may need the same conversation lock while merging
	// a webhook projection that won the provider-id race.
	var lockedConversationID string
	if err := tx.QueryRow(ctx, `
		select conversation.id::text
		from public.whatsapp_conversations as conversation
		where conversation.id = $1::uuid
		  and conversation.organization_id = $2::uuid
		  and conversation.session_id = $3::uuid
		for no key update of conversation
	`, item.ConversationID, item.OrganizationID, item.SessionID).Scan(&lockedConversationID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return errWhatsAppOutboxLeaseLost
		}
		return err
	}

	var lockedID string
	if err := tx.QueryRow(ctx, `
		select id::text
		from public.whatsapp_outbox
		where id = $1::uuid
		  and status = 'processing'
		  and locked_by = $2
		for update
	`, item.ID, item.LeaseToken).Scan(&lockedID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return errWhatsAppOutboxLeaseLost
		}
		return err
	}

	canonicalMessageID := item.MessageRowID
	var existingID, existingLeadID, pendingLeadID string
	pendingMessageLocked := false
	messageRows, err := tx.Query(ctx, `
		select message.id::text, message.conversation_id::text, coalesce(message.lead_id::text, '')
		from public.whatsapp_messages as message
		where message.organization_id = $1::uuid
		  and message.session_id = $2::uuid
		  and (
		    message.id = $4::uuid
		    or message.provider_message_id = $3
		    or message.message_id = $3
		  )
		order by message.id
		for update of message
	`, item.OrganizationID, item.SessionID, providerMessageID, item.MessageRowID)
	if err != nil {
		return err
	}
	for messageRows.Next() {
		var messageID, conversationID, messageLeadID string
		if err := messageRows.Scan(&messageID, &conversationID, &messageLeadID); err != nil {
			messageRows.Close()
			return err
		}
		if conversationID != item.ConversationID {
			messageRows.Close()
			return fmt.Errorf("%w: WhatsApp message projection conversation mismatch", ErrProviderFailed)
		}
		if messageID == item.MessageRowID {
			pendingMessageLocked = true
			pendingLeadID = messageLeadID
			continue
		}
		if existingID != "" && existingID != messageID {
			messageRows.Close()
			return fmt.Errorf("%w: multiple WhatsApp message projections share provider id", ErrProviderFailed)
		}
		existingID = messageID
		existingLeadID = messageLeadID
	}
	if err := messageRows.Err(); err != nil {
		messageRows.Close()
		return err
	}
	messageRows.Close()
	if !pendingMessageLocked {
		return ErrMessageNotFound
	}
	if pendingLeadID == "" {
		return fmt.Errorf("%w: WhatsApp outbox message has no immutable lead", ErrProviderFailed)
	}
	if existingID != "" && existingLeadID != "" && existingLeadID != pendingLeadID {
		return fmt.Errorf("%w: WhatsApp provider projection lead mismatch", ErrProviderFailed)
	}

	if existingID != "" {
		// Release the partial unique client id before moving it to a webhook row
		// that won the provider-id race.
		if _, err := tx.Exec(ctx, `
			update public.whatsapp_messages
			set client_message_id = null,
			    updated_at = now()
			where id = $1::uuid
		`, item.MessageRowID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			update public.whatsapp_messages existing
			set client_message_id = coalesce(existing.client_message_id, $4),
			    lead_id = coalesce(existing.lead_id, pending.lead_id),
			    sender_user_id = coalesce(existing.sender_user_id, pending.sender_user_id),
			    content = coalesce(existing.content, pending.content),
			    media_url = coalesce(existing.media_url, pending.media_url),
			    media_storage_path = coalesce(existing.media_storage_path, pending.media_storage_path),
			    provider_message_id = $3,
			    message_id = $3,
			    status = case when existing.status in ('delivered', 'read') then existing.status else 'sent' end,
			    sent_at = coalesce(existing.sent_at, now()),
			    updated_at = now()
			from public.whatsapp_messages pending
			where existing.id = $1::uuid
			  and pending.id = $2::uuid
		`, existingID, item.MessageRowID, providerMessageID, item.ClientMessageID); err != nil {
			return err
		}
		canonicalMessageID = existingID
		if _, err := tx.Exec(ctx, `
			update public.whatsapp_outbox
			set message_id = $2::uuid
			where id = $1::uuid
			  and locked_by = $3
		`, item.ID, canonicalMessageID, item.LeaseToken); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `delete from public.whatsapp_messages where id = $1::uuid`, item.MessageRowID); err != nil {
			return err
		}
	} else {
		if _, err := tx.Exec(ctx, `
			update public.whatsapp_messages
			set provider_message_id = $2,
			    message_id = $2,
			    status = case when status in ('delivered', 'read') then status else 'sent' end,
			    sent_at = coalesce(sent_at, now()),
			    updated_at = now()
			where id = $1::uuid
			  and organization_id = $3::uuid
		`, item.MessageRowID, providerMessageID, item.OrganizationID); err != nil {
			return err
		}
	}

	result, err := tx.Exec(ctx, `
		update public.whatsapp_outbox
		set status = 'sent',
		    provider_message_id = $2,
		    sent_at = now(),
		    locked_at = null,
		    locked_by = null,
		    last_error = null,
		    updated_at = now()
		where id = $1::uuid
		  and status = 'processing'
		  and locked_by = $3
	`, item.ID, providerMessageID, item.LeaseToken)
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return errWhatsAppOutboxLeaseLost
	}

	if strings.TrimSpace(stringFromAny(item.Payload["action"])) != "message.react" {
		// CRM contact clocks and the timeline are provider-acknowledgement facts.
		// They are intentionally written here, in the same transaction that turns
		// the durable outbox row into `sent`, never when the browser/automation
		// merely queues the message.
		if _, err := tx.Exec(ctx, `
			update public.leads as lead
			set last_contact_at = greatest(
			      coalesce(lead.last_contact_at, '-infinity'::timestamptz),
			      coalesce(message.sent_at, now())
			    ),
			    first_response_at = coalesce(lead.first_response_at, message.sent_at, now()),
			    first_response_seconds = coalesce(
			      lead.first_response_seconds,
			      greatest(0, extract(epoch from (coalesce(message.sent_at, now()) - lead.created_at))::integer)
			    ),
			    first_response_channel = coalesce(lead.first_response_channel, 'whatsapp'),
			    first_response_is_automation = coalesce(
			      lead.first_response_is_automation,
			      coalesce(message.metadata->>'origin', '') = 'automation'
			    ),
			    first_response_actor_user_id = coalesce(lead.first_response_actor_user_id, message.sender_user_id),
			    updated_at = now()
			from public.whatsapp_messages as message
			where message.id = $1::uuid
			  and message.organization_id = $2::uuid
			  and message.lead_id = lead.id
			  and lead.organization_id = message.organization_id
		`, canonicalMessageID, item.OrganizationID); err != nil {
			return err
		}

		timelineResult, err := tx.Exec(ctx, `
			update public.lead_timeline_events as timeline
			set event_type = 'whatsapp_message_sent',
			    title = 'Mensagem WhatsApp enviada',
			    description = coalesce(nullif(message.content, ''), case message.message_type
			      when 'image' then '[Imagem]' when 'audio' then '[Audio]'
			      when 'video' then '[Video]' when 'document' then '[Documento]'
			      else '[Mensagem]' end),
			    user_id = coalesce(timeline.user_id, message.sender_user_id),
			    actor_user_id = coalesce(timeline.actor_user_id, message.sender_user_id),
			    metadata = coalesce(timeline.metadata, '{}'::jsonb) || jsonb_build_object(
			      'outbox_id', $3,
			      'message_row_id', message.id,
			      'message_id', $4,
			      'client_message_id', $5,
			      'session_id', message.session_id,
			      'conversation_id', message.conversation_id,
			      'message_type', message.message_type,
			      'delivery_status', 'sent'
			    ),
			    event_at = coalesce(message.sent_at, now())
			from public.whatsapp_messages as message
			where message.id = $1::uuid
			  and message.organization_id = $2::uuid
			  and timeline.organization_id = message.organization_id
			  and timeline.lead_id = message.lead_id
			  and timeline.metadata->>'outbox_id' = $3
		`, canonicalMessageID, item.OrganizationID, item.ID, providerMessageID, item.ClientMessageID)
		if err != nil {
			return err
		}
		if timelineResult.RowsAffected() == 0 {
			if _, err := tx.Exec(ctx, `
				insert into public.lead_timeline_events (
				  organization_id, lead_id, event_type, title, description,
				  user_id, actor_user_id, metadata, event_at
				)
				select
				  message.organization_id, message.lead_id,
				  'whatsapp_message_sent',
				  'Mensagem WhatsApp enviada',
				  coalesce(nullif(message.content, ''), case message.message_type
				    when 'image' then '[Imagem]' when 'audio' then '[Audio]'
				    when 'video' then '[Video]' when 'document' then '[Documento]'
				    else '[Mensagem]' end),
				  message.sender_user_id, message.sender_user_id,
				  jsonb_build_object(
				    'outbox_id', $3,
				    'message_row_id', message.id,
				    'message_id', $4,
				    'client_message_id', $5,
				    'session_id', message.session_id,
				    'conversation_id', message.conversation_id,
				    'message_type', message.message_type,
				    'delivery_status', 'sent'
				  ),
				  coalesce(message.sent_at, now())
				from public.whatsapp_messages as message
				where message.id = $1::uuid
				  and message.organization_id = $2::uuid
				  and message.lead_id is not null
			`, canonicalMessageID, item.OrganizationID, item.ID, providerMessageID, item.ClientMessageID); err != nil {
				return err
			}
		}

		if _, err := tx.Exec(ctx, `
			update public.automation_effect_dispatches
			set status = 'succeeded',
			    provider_id = $2,
			    error_message = null,
			    completed_at = now(),
			    response = coalesce(response, '{}'::jsonb) || jsonb_build_object(
			      'status', 'sent',
			      'provider_id', $2,
			      'message_id', $3::uuid,
			      'outbox_id', $1::uuid
			    )
			where response->>'outbox_id' = $1
			  and organization_id = $4::uuid
			  and effect_key = $5
			  and request->>'delivery_contract' = 'canonical_whatsapp_outbox_v1'
			  and status in ('succeeded', 'failed', 'unknown')
		`, item.ID, providerMessageID, canonicalMessageID, item.OrganizationID, item.ClientMessageID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (repo Repository) failWhatsAppOutbox(ctx context.Context, item pendingWhatsAppOutbox, cause error, permanent bool, outcomeUnknown bool) error {
	status := "retry"
	if outcomeUnknown {
		// A timeout or broken response can happen after WhatsApp accepted the
		// stanza. Evolution Go documents the custom message ID but does not
		// guarantee exactly-once delivery, so automatic resend is unsafe.
		status = "dead"
	} else if permanent {
		status = "failed"
	} else if item.Attempts >= item.MaxAttempts {
		status = "dead"
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	result, err := tx.Exec(ctx, `
		update public.whatsapp_outbox
		set status = $2,
		    next_attempt_at = case
		      when $2 = 'retry' then now() + make_interval(secs => least(3600, 5 * (power(2, least(attempts, 9)))::int))
		      else next_attempt_at
		    end,
		    failed_at = case when $2 = 'failed' then now() else failed_at end,
		    dead_lettered_at = case when $2 = 'dead' then now() else dead_lettered_at end,
		    locked_at = null,
		    locked_by = null,
		    last_error = left($3, 4000),
		    updated_at = now()
		where id = $1::uuid
		  and status = 'processing'
		  and locked_by = $4
	`, item.ID, status, cause.Error(), item.LeaseToken)
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return errWhatsAppOutboxLeaseLost
	}
	if status == "dead" || status == "failed" {
		if _, err := tx.Exec(ctx, `
			update public.whatsapp_messages
			set status = 'failed',
			    updated_at = now()
			where id = $1::uuid
			  and organization_id = $2::uuid
		`, item.MessageRowID, item.OrganizationID); err != nil {
			return err
		}
		if err := repo.syncTerminalWhatsAppOutboxFailures(ctx, tx, item.ID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// syncTerminalWhatsAppOutboxFailures projects a terminal durable-delivery
// failure into the CRM and automation observability model. It is intentionally
// idempotent because it runs both after a worker failure and while recovering
// exhausted/abandoned leases.
func (repo Repository) syncTerminalWhatsAppOutboxFailures(ctx context.Context, tx pgx.Tx, outboxID string) error {
	outboxID = strings.TrimSpace(outboxID)
	if outboxID == "" {
		return fmt.Errorf("terminal WhatsApp outbox projection requires an explicit outbox id")
	}
	return repo.syncTerminalWhatsAppOutboxFailuresBatch(ctx, tx, []string{outboxID})
}

func (repo Repository) syncTerminalWhatsAppOutboxFailuresBatch(ctx context.Context, tx pgx.Tx, outboxIDs []string) error {
	outboxIDs = uniqueStrings(outboxIDs...)
	if len(outboxIDs) == 0 {
		return fmt.Errorf("terminal WhatsApp outbox projection requires an explicit non-empty scope")
	}

	// Establish the same deterministic lock hierarchy used everywhere else:
	// outbox rows first, then their message projections, both ordered by UUID.
	outboxRows, err := tx.Query(ctx, `
		select outbox.id::text
		from public.whatsapp_outbox as outbox
		where outbox.id in (
		  select scoped.id_text::uuid
		  from unnest($1::text[]) as scoped(id_text)
		)
		order by outbox.id
		for update
	`, outboxIDs)
	if err != nil {
		return err
	}
	for outboxRows.Next() {
		var ignoredID string
		if err := outboxRows.Scan(&ignoredID); err != nil {
			outboxRows.Close()
			return err
		}
	}
	if err := outboxRows.Err(); err != nil {
		outboxRows.Close()
		return err
	}
	outboxRows.Close()

	messageRows, err := tx.Query(ctx, `
		select message.id::text
		from public.whatsapp_messages as message
		join public.whatsapp_outbox as outbox
		  on outbox.message_id = message.id
		 and outbox.organization_id = message.organization_id
		where outbox.id in (
		  select scoped.id_text::uuid
		  from unnest($1::text[]) as scoped(id_text)
		)
		order by message.id
		for update of message
	`, outboxIDs)
	if err != nil {
		return err
	}
	for messageRows.Next() {
		var ignoredID string
		if err := messageRows.Scan(&ignoredID); err != nil {
			messageRows.Close()
			return err
		}
	}
	if err := messageRows.Err(); err != nil {
		messageRows.Close()
		return err
	}
	messageRows.Close()

	if _, err := tx.Exec(ctx, `
		update public.whatsapp_messages as message
		set status = 'failed',
		    updated_at = now()
		from public.whatsapp_outbox as outbox
		where outbox.message_id = message.id
		  and outbox.organization_id = message.organization_id
		  and outbox.status in ('failed', 'dead')
		  and message.status is distinct from 'failed'
		  and outbox.id in (
		    select scoped.id_text::uuid
		    from unnest($1::text[]) as scoped(id_text)
		  )
	`, outboxIDs); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
		update public.lead_timeline_events as timeline
		set event_type = 'whatsapp_message_failed',
		    title = 'Falha no envio de mensagem WhatsApp',
		    metadata = coalesce(timeline.metadata, '{}'::jsonb) || jsonb_build_object(
		      'delivery_status', outbox.status,
		      'last_error', left(coalesce(outbox.last_error, 'delivery_failed'), 500)
		    )
		from public.whatsapp_outbox as outbox
		where outbox.organization_id = timeline.organization_id
		  and timeline.metadata->>'outbox_id' = outbox.id::text
		  and outbox.status in ('failed', 'dead')
		  and timeline.metadata->>'delivery_status' is distinct from outbox.status
		  and outbox.id in (
		    select scoped.id_text::uuid
		    from unnest($1::text[]) as scoped(id_text)
		  )
	`, outboxIDs); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
		update public.automation_effect_dispatches as dispatch
		set status = case when outbox.status = 'dead' then 'unknown' else 'failed' end,
		    error_message = left(case
		      when outbox.status = 'dead' then 'whatsapp_delivery_not_confirmed: ' || coalesce(outbox.last_error, 'retry_exhausted')
		      else coalesce(outbox.last_error, 'whatsapp_delivery_failed')
		    end, 4000),
		    response = coalesce(dispatch.response, '{}'::jsonb) || jsonb_build_object(
		      'status', case when outbox.status = 'dead' then 'unknown' else 'failed' end,
		      'delivery_status', outbox.status,
		      'outbox_id', outbox.id,
		      'message_id', outbox.message_id,
		      'last_error', left(coalesce(outbox.last_error, 'whatsapp_delivery_failed'), 4000)
		    ),
		    completed_at = coalesce(dispatch.completed_at, now())
		from public.whatsapp_outbox as outbox
		where dispatch.organization_id = outbox.organization_id
		  and dispatch.response->>'outbox_id' = outbox.id::text
		  and dispatch.request->>'delivery_contract' = 'canonical_whatsapp_outbox_v1'
		  and dispatch.effect_key = outbox.client_message_id
		  and dispatch.status = 'succeeded'
		  and outbox.status in ('failed', 'dead')
		  and outbox.id in (
		    select scoped.id_text::uuid
		    from unnest($1::text[]) as scoped(id_text)
		  )
	`, outboxIDs); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
		insert into public.notifications (
		  organization_id, user_id, title, content, body, type, channel,
		  lead_id, target_url, metadata
		)
		select
		  dispatch.organization_id,
		  member.user_id,
		  'Falha em automacao do WhatsApp',
		  case when outbox.status = 'dead'
		    then 'A entrega de uma mensagem automatica nao foi confirmada apos todas as tentativas.'
		    else 'Uma mensagem automatica nao foi entregue.' end,
		  case when outbox.status = 'dead'
		    then 'A entrega de uma mensagem automatica nao foi confirmada apos todas as tentativas.'
		    else 'Uma mensagem automatica nao foi entregue.' end,
		  'automation_whatsapp_delivery_failed',
		  'in_app',
		  execution.lead_id,
		  '/automations',
		  jsonb_build_object(
		    'dedupe_key', 'automation_whatsapp_delivery_failed:' || outbox.id::text || ':' || member.user_id::text,
		    'automation_id', execution.automation_id,
		    'execution_id', dispatch.execution_id,
		    'effect_id', dispatch.id,
		    'outbox_id', outbox.id,
		    'delivery_status', outbox.status,
		    'last_error', left(coalesce(outbox.last_error, 'whatsapp_delivery_failed'), 500)
		  )
		from public.whatsapp_outbox as outbox
		join public.automation_effect_dispatches as dispatch
		  on dispatch.organization_id = outbox.organization_id
		 and dispatch.response->>'outbox_id' = outbox.id::text
		 and dispatch.request->>'delivery_contract' = 'canonical_whatsapp_outbox_v1'
		 and dispatch.effect_key = outbox.client_message_id
		 and dispatch.status in ('failed', 'unknown')
		join public.automation_executions as execution
		  on execution.id = dispatch.execution_id
		 and execution.organization_id = dispatch.organization_id
		join public.organization_members as member
		  on member.organization_id = dispatch.organization_id
		 and member.role in ('owner', 'admin', 'manager')
		 and coalesce(member.is_active, false) = true
		join public.users as recipient
		  on recipient.id = member.user_id
		 and recipient.organization_id = member.organization_id
		 and coalesce(recipient.is_active, false) = true
		where outbox.status in ('failed', 'dead')
		  and outbox.id in (
		    select scoped.id_text::uuid
		    from unnest($1::text[]) as scoped(id_text)
		  )
		on conflict do nothing
	`, outboxIDs); err != nil {
		return err
	}

	return nil
}
