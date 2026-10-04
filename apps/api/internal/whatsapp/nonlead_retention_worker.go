package whatsapp

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const (
	whatsAppNonLeadRetentionDBTimeout      = 25 * time.Second
	whatsAppNonLeadRetentionStorageTimeout = 25 * time.Second
	whatsAppNonLeadRetentionFinishTimeout  = 5 * time.Second
)

var whatsAppNonLeadRetentionWorkerID = "vimob-api-whatsapp-nonlead-ctwa2-" + randomHex(8)

type whatsAppNonLeadRunCounts struct {
	dueSelected    int
	dbPurged       int
	dbBusy         int
	dbFailed       int
	cohortSelected int
	cohortPurged   int
	cohortBusy     int
	cohortFailed   int
	mediaClaims    int
	mediaDeleted   int
	mediaFailed    int
}

type whatsAppNonLeadRetentionHealth struct {
	oldestOverdueSeconds       int64
	oldestCohortOverdueSeconds int64
	oldestMediaDueSeconds      int64
	heldMediaDeletes           int64
	oldestHeldSeconds          int64
	deadMediaDeletes           int64
	unknownMediaDeletes        int64
	stuckStartedDeletes        int64
	oldestStartedSeconds       int64
}

// StartNonLeadRetentionWorker has two bounded stages: first it purges due
// database conversations, then it drains their durable Storage delete outbox.
// It is off by default. Applying the preparatory migrations cannot enable it
// or activate any session's retention policy.
func (handler Handler) StartNonLeadRetentionWorker(ctx context.Context, logger *slog.Logger) {
	config := handler.workerConfig.normalized()
	if !config.NonLeadRetentionWorkerEnabled {
		return
	}
	go handler.runNonLeadRetentionLoop(ctx, logger, config)
}

func (handler Handler) runNonLeadRetentionLoop(ctx context.Context, logger *slog.Logger, config WorkerConfig) {
	var lastHealthWarning time.Time
	var lastSchemaWarning time.Time
	run := func() {
		schemaCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
		schemaReady, schemaErr := handler.repo.nonLeadRetentionSchemaReady(schemaCtx)
		cancel()
		if !schemaReady || schemaErr != nil {
			if logger != nil && ctx.Err() == nil && time.Since(lastSchemaWarning) >= 10*time.Minute {
				logger.Warn("WhatsApp nonlead retention schema is not ready; worker will retry",
					"databaseCode", whatsAppNonLeadDatabaseErrorCode(schemaErr))
				lastSchemaWarning = time.Now()
			}
			return
		}
		// A session-specific CTWA successor cohort requires a live retention
		// worker. Heartbeats alone do not prove two distinct running replicas;
		// deployment readiness must also be checked for each current task.
		heartbeatCtx, heartbeatCancel := context.WithTimeout(ctx, 3*time.Second)
		heartbeatErr := handler.repo.heartbeatCTWACohortRetentionWorker(heartbeatCtx)
		heartbeatCancel()
		if heartbeatErr != nil {
			if logger != nil && ctx.Err() == nil && time.Since(lastSchemaWarning) >= 10*time.Minute {
				logger.Warn("WhatsApp CTWA cohort retention heartbeat failed",
					"databaseCode", whatsAppNonLeadDatabaseErrorCode(heartbeatErr))
				lastSchemaWarning = time.Now()
			}
			return
		}
		counts := whatsAppNonLeadRunCounts{}
		var dbCode string
		var storageCode string
		selected, purged, busy, failed, failureCode, err := handler.repo.purgeDueWhatsAppNonLeadBatch(
			ctx, config.NonLeadRetentionWorkerBatch,
		)
		counts.dueSelected, counts.dbPurged, counts.dbBusy, counts.dbFailed = selected, purged, busy, failed
		dbCode = failureCode
		if err != nil {
			dbCode = whatsAppNonLeadDatabaseErrorCode(err)
		}
		cohortSelected, cohortPurged, cohortBusy, cohortFailed, cohortFailureCode, cohortErr :=
			handler.repo.purgeDueWhatsAppCTWAUnmaterializedCohortBatch(ctx, config.NonLeadRetentionWorkerBatch)
		counts.cohortSelected, counts.cohortPurged = cohortSelected, cohortPurged
		counts.cohortBusy, counts.cohortFailed = cohortBusy, cohortFailed
		if cohortFailureCode != "" {
			dbCode = cohortFailureCode
		}
		if cohortErr != nil {
			dbCode = whatsAppNonLeadDatabaseErrorCode(cohortErr)
		}
		for index := 0; index < config.NonLeadRetentionWorkerBatch && ctx.Err() == nil; index++ {
			itemCtx, cancel := context.WithTimeout(ctx, whatsAppNonLeadRetentionStorageTimeout)
			claimed, deleted, deleteErr := handler.repo.processOneWhatsAppNonLeadMediaDelete(
				itemCtx, whatsAppNonLeadRetentionWorkerID,
			)
			cancel()
			if !claimed {
				if deleteErr != nil {
					storageCode = whatsAppNonLeadDatabaseErrorCode(deleteErr)
					counts.mediaFailed++
				}
				break
			}
			counts.mediaClaims++
			if deleted {
				counts.mediaDeleted++
			}
			if deleteErr != nil {
				counts.mediaFailed++
				storageCode = whatsAppNonLeadDatabaseErrorCode(deleteErr)
			}
		}
		if logger != nil && (counts.dbFailed > 0 || counts.cohortBusy > 0 || counts.cohortFailed > 0 ||
			counts.mediaFailed > 0 || dbCode != "") {
			// Never log a phone, provider ID, object path, message, or SQL detail.
			logger.Warn("WhatsApp nonlead retention run needs review",
				"dueSelected", counts.dueSelected,
				"dbPurged", counts.dbPurged,
				"dbBusy", counts.dbBusy,
				"dbFailed", counts.dbFailed,
				"cohortSelected", counts.cohortSelected,
				"cohortPurged", counts.cohortPurged,
				"cohortBusy", counts.cohortBusy,
				"cohortFailed", counts.cohortFailed,
				"mediaClaims", counts.mediaClaims,
				"mediaDeleted", counts.mediaDeleted,
				"mediaFailed", counts.mediaFailed,
				"databaseCode", dbCode,
				"storageCode", storageCode,
			)
		}
		if ctx.Err() == nil {
			healthCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
			health, healthErr := handler.repo.nonLeadRetentionHealth(healthCtx)
			cancel()
			if logger != nil && healthErr != nil && time.Since(lastHealthWarning) >= 10*time.Minute {
				logger.Warn("WhatsApp nonlead retention health query failed",
					"databaseCode", whatsAppNonLeadDatabaseErrorCode(healthErr))
				lastHealthWarning = time.Now()
			}
			if logger != nil && healthErr == nil &&
				(health.oldestOverdueSeconds > 5*60 || health.oldestCohortOverdueSeconds > 5*60 ||
					health.oldestMediaDueSeconds > 5*60 ||
					health.heldMediaDeletes > 0 || health.deadMediaDeletes > 0 ||
					health.unknownMediaDeletes > 0 || health.stuckStartedDeletes > 0) &&
				time.Since(lastHealthWarning) >= 10*time.Minute {
				logger.Warn("WhatsApp nonlead retention is delayed",
					"oldestOverdueSeconds", health.oldestOverdueSeconds,
					"oldestCohortOverdueSeconds", health.oldestCohortOverdueSeconds,
					"oldestMediaDueSeconds", health.oldestMediaDueSeconds,
					"heldMediaDeletes", health.heldMediaDeletes,
					"oldestHeldSeconds", health.oldestHeldSeconds,
					"deadMediaDeletes", health.deadMediaDeletes,
					"unknownMediaDeletes", health.unknownMediaDeletes,
					"stuckStartedDeletes", health.stuckStartedDeletes,
					"oldestStartedSeconds", health.oldestStartedSeconds,
				)
				lastHealthWarning = time.Now()
			}
		}
	}

	run()
	ticker := time.NewTicker(config.NonLeadRetentionWorkerInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			run()
		}
	}
}

func (repo Repository) nonLeadRetentionSchemaReady(ctx context.Context) (bool, error) {
	var ready bool
	err := repo.db.Pool().QueryRow(ctx, `
		select to_regprocedure('private.try_purge_whatsapp_nonlead_conversation(uuid)') is not null
		  and to_regprocedure('private.defer_whatsapp_nonlead_purge(uuid,text)') is not null
		  and to_regprocedure('private.claim_whatsapp_nonlead_media_delete(text)') is not null
		  and to_regprocedure('private.mark_whatsapp_nonlead_media_delete_started(uuid,uuid)') is not null
		  and to_regprocedure('private.finish_whatsapp_nonlead_media_delete(uuid,uuid,text)') is not null
		  and to_regprocedure('private.whatsapp_nonlead_retention_candidate_active(uuid,uuid,uuid)') is not null
		  and to_regprocedure('private.whatsapp_ctwa_recent_successor_claimable(uuid,uuid,text,text)') is not null
		  and to_regprocedure('private.heartbeat_whatsapp_ctwa_cohort_worker(text)') is not null
		  and to_regprocedure('private.try_purge_whatsapp_ctwa_unmaterialized_cohort(uuid,uuid,text)') is not null
		  and to_regprocedure('private.try_purge_whatsapp_ctwa_unmaterialized_cohort(uuid,uuid,text,uuid,text)') is not null
		  and to_regprocedure('private.defer_whatsapp_ctwa_cohort_purge(uuid,uuid,text,text)') is not null
		  and to_regclass('private.whatsapp_ctwa_recent_successor_cohorts') is not null
		  and to_regclass('private.whatsapp_ctwa_recent_successor_rollouts') is not null
	`).Scan(&ready)
	return ready, err
}

func (repo Repository) heartbeatCTWACohortRetentionWorker(ctx context.Context) error {
	_, err := repo.db.Pool().Exec(ctx, `
		select private.heartbeat_whatsapp_ctwa_cohort_worker($1)
	`, whatsAppNonLeadRetentionWorkerID)
	return err
}

// A newer direct message can remain in the inbox until its own seven-day
// deadline without ever materializing a conversation. The exact cohort is
// removed transactionally, including its raw provider payload and snapshot.
func (repo Repository) purgeDueWhatsAppCTWAUnmaterializedCohortBatch(
	ctx context.Context, batch int,
) (selected, purged, busy, failed int, firstFailureCode string, batchErr error) {
	rows, err := repo.db.Pool().Query(ctx, `
		select cohort.organization_id::text, cohort.session_id::text, cohort.routing_key
		from private.whatsapp_ctwa_recent_successor_cohorts as cohort
		where cohort.settled_at is null
		  and cohort.expires_at <= clock_timestamp()
		  and cohort.purge_next_attempt_at <= clock_timestamp()
		  and not exists (
		    select 1 from private.whatsapp_nonlead_retention_candidate_routes as route
		    left join private.whatsapp_nonlead_retention_candidates as candidate
		      on candidate.organization_id = route.organization_id
		     and candidate.session_id = route.session_id
		     and candidate.conversation_id = route.conversation_id
		    where route.organization_id = cohort.organization_id
		      and route.session_id = cohort.session_id
		      and route.routing_key = cohort.routing_key
		      and route.first_ingress_sequence >= cohort.first_ingress_sequence
		      and candidate.state is distinct from 'converted'
		  )
		order by cohort.purge_next_attempt_at, cohort.expires_at,
		         cohort.session_id, cohort.routing_key
		limit $1
	`, batch)
	if err != nil {
		return 0, 0, 0, 0, "", err
	}
	type cohortKey struct{ organizationID, sessionID, routingKey string }
	cohorts := make([]cohortKey, 0, batch)
	for rows.Next() {
		var key cohortKey
		if err := rows.Scan(&key.organizationID, &key.sessionID, &key.routingKey); err != nil {
			rows.Close()
			return 0, 0, 0, 0, "", err
		}
		cohorts = append(cohorts, key)
	}
	batchErr = rows.Err()
	rows.Close()
	if batchErr != nil {
		return 0, 0, 0, 0, "", batchErr
	}
	for _, key := range cohorts {
		if ctx.Err() != nil {
			break
		}
		selected++
		itemCtx, cancel := context.WithTimeout(ctx, whatsAppNonLeadRetentionDBTimeout)
		var outcome string
		err := repo.db.Pool().QueryRow(itemCtx, `
			select private.try_purge_whatsapp_ctwa_unmaterialized_cohort(
			  $1::uuid, $2::uuid, $3::text
			)
		`, key.organizationID, key.sessionID, key.routingKey).Scan(&outcome)
		cancel()
		if err != nil {
			failed++
			code := whatsAppNonLeadSQLState(err)
			if firstFailureCode == "" {
				firstFailureCode = code
			}
			if deferErr := repo.deferWhatsAppCTWACohortPurge(ctx, key, code); deferErr != nil && batchErr == nil {
				batchErr = deferErr
			}
			continue
		}
		switch outcome {
		case "purged":
			purged++
		case "busy":
			busy++
			if deferErr := repo.deferWhatsAppCTWACohortPurge(ctx, key, "55000"); deferErr != nil && batchErr == nil {
				batchErr = deferErr
			}
		case "not_due", "converted":
			// Concurrent workers may have completed or converted the route.
		default:
			failed++
			if firstFailureCode == "" {
				firstFailureCode = "XX000"
			}
			if deferErr := repo.deferWhatsAppCTWACohortPurge(ctx, key, "XX000"); deferErr != nil && batchErr == nil {
				batchErr = deferErr
			}
		}
	}
	return selected, purged, busy, failed, firstFailureCode, batchErr
}

func (repo Repository) deferWhatsAppCTWACohortPurge(
	ctx context.Context, key struct{ organizationID, sessionID, routingKey string }, code string,
) error {
	retryCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), whatsAppNonLeadRetentionFinishTimeout)
	defer cancel()
	var recorded bool
	return repo.db.Pool().QueryRow(retryCtx, `
		select private.defer_whatsapp_ctwa_cohort_purge(
		  $1::uuid, $2::uuid, $3::text, $4::text
		)
	`, key.organizationID, key.sessionID, key.routingKey, code).Scan(&recorded)
}

func (repo Repository) nonLeadRetentionHealth(ctx context.Context) (whatsAppNonLeadRetentionHealth, error) {
	var health whatsAppNonLeadRetentionHealth
	err := repo.db.Pool().QueryRow(ctx, `
		select
		  coalesce((
		    select greatest(0, extract(epoch from clock_timestamp() - oldest.expires_at))::bigint
		    from private.whatsapp_nonlead_retention_candidates as oldest
		    where oldest.state = 'pending'
		      and oldest.expires_at <= clock_timestamp()
		      and private.whatsapp_nonlead_retention_candidate_active(
		        oldest.organization_id, oldest.session_id, oldest.conversation_id
		      )
		    order by oldest.expires_at, oldest.conversation_id
		    limit 1
		  ), 0),
		  coalesce((
		    select greatest(0, extract(epoch from clock_timestamp() - cohort.expires_at))::bigint
		    from private.whatsapp_ctwa_recent_successor_cohorts as cohort
		    where cohort.settled_at is null
		      and cohort.expires_at <= clock_timestamp()
		    order by cohort.expires_at, cohort.session_id, cohort.routing_key
		    limit 1
		  ), 0),
		  coalesce((
		    select max(greatest(0, extract(epoch from clock_timestamp() - next_attempt_at))::bigint)
		    from private.whatsapp_nonlead_media_delete_outbox
		    where status in ('pending', 'retry') and next_attempt_at <= clock_timestamp()
		  ), 0),
		  (select count(*) from private.whatsapp_nonlead_media_delete_outbox where status = 'held_shared'),
		  coalesce((
		    select max(greatest(0, extract(epoch from clock_timestamp() - created_at))::bigint)
		    from private.whatsapp_nonlead_media_delete_outbox where status = 'held_shared'
		  ), 0),
		  (select count(*) from private.whatsapp_nonlead_media_delete_outbox where status = 'dead'),
		  (select count(*) from private.whatsapp_media_path_operations
		   where operation = 'delete' and outcome_unknown is true),
		  stuck.item_count, stuck.oldest_seconds
		from (
		  select count(*) as item_count,
		         coalesce(max(greatest(0, extract(epoch from clock_timestamp() - delete_started_at))::bigint), 0) as oldest_seconds
		  from private.whatsapp_nonlead_media_delete_outbox
		  where status = 'processing'
		    and delete_started_at <= clock_timestamp() - interval '5 minutes'
		) as stuck
	`).Scan(
		&health.oldestOverdueSeconds, &health.oldestCohortOverdueSeconds,
		&health.oldestMediaDueSeconds,
		&health.heldMediaDeletes, &health.oldestHeldSeconds,
		&health.deadMediaDeletes, &health.unknownMediaDeletes,
		&health.stuckStartedDeletes, &health.oldestStartedSeconds,
	)
	return health, err
}

func (repo Repository) purgeDueWhatsAppNonLeadBatch(
	ctx context.Context, batch int,
) (selected, purged, busy, failed int, firstFailureCode string, batchErr error) {
	rows, err := repo.db.Pool().Query(ctx, `
		select candidate.conversation_id::text
		from private.whatsapp_nonlead_retention_candidates as candidate
		where candidate.state = 'pending'
		  and candidate.expires_at <= clock_timestamp()
		  and candidate.purge_next_attempt_at <= clock_timestamp()
		  and private.whatsapp_nonlead_retention_candidate_active(
		    candidate.organization_id, candidate.session_id, candidate.conversation_id
		  )
		order by candidate.purge_next_attempt_at, candidate.expires_at, candidate.conversation_id
		limit $1
	`, batch)
	if err != nil {
		return 0, 0, 0, 0, "", err
	}
	candidates := make([]string, 0, batch)
	for rows.Next() {
		var conversationID string
		if err := rows.Scan(&conversationID); err != nil {
			rows.Close()
			return 0, 0, 0, 0, "", err
		}
		candidates = append(candidates, conversationID)
	}
	batchErr = rows.Err()
	rows.Close()
	if batchErr != nil {
		return 0, 0, 0, 0, "", batchErr
	}
	for _, conversationID := range candidates {
		if ctx.Err() != nil {
			break
		}
		selected++
		itemCtx, cancel := context.WithTimeout(ctx, whatsAppNonLeadRetentionDBTimeout)
		var outcome string
		err := repo.db.Pool().QueryRow(itemCtx, `
			select private.try_purge_whatsapp_nonlead_conversation($1::uuid)
		`, conversationID).Scan(&outcome)
		cancel()
		if err != nil {
			failed++
			code := whatsAppNonLeadSQLState(err)
			if firstFailureCode == "" {
				firstFailureCode = code
			}
			if deferErr := repo.deferWhatsAppNonLeadPurge(ctx, conversationID, code); deferErr != nil && batchErr == nil {
				batchErr = deferErr
			}
			continue
		}
		switch outcome {
		case "purged":
			purged++
		case "busy":
			busy++
		case "already_absent", "converted", "not_due":
			// The candidate changed after selection; the function rechecked it.
		default:
			failed++
			if firstFailureCode == "" {
				firstFailureCode = "XX000"
			}
			if deferErr := repo.deferWhatsAppNonLeadPurge(ctx, conversationID, "XX000"); deferErr != nil && batchErr == nil {
				batchErr = deferErr
			}
		}
	}
	return selected, purged, busy, failed, firstFailureCode, batchErr
}

func (repo Repository) deferWhatsAppNonLeadPurge(ctx context.Context, conversationID, code string) error {
	retryCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), whatsAppNonLeadRetentionFinishTimeout)
	defer cancel()
	var recorded bool
	return repo.db.Pool().QueryRow(retryCtx, `
		select private.defer_whatsapp_nonlead_purge($1::uuid, $2::text)
	`, conversationID, code).Scan(&recorded)
}

type whatsAppNonLeadMediaDeleteClaim struct {
	id             string
	organizationID string
	bucketID       string
	storagePath    string
	leaseToken     string
}

// processOneWhatsAppNonLeadMediaDelete is the Storage stage. The SQL claim
// checks all surviving references and atomically holds a per-path delete
// reservation before returning. A 20-second HTTP timeout has an unknown
// outcome: the delete reservation must remain until an operator proves safety.
func (repo Repository) processOneWhatsAppNonLeadMediaDelete(ctx context.Context, workerID string) (claimed, deleted bool, err error) {
	var item whatsAppNonLeadMediaDeleteClaim
	err = repo.db.Pool().QueryRow(ctx, `
		select id::text, organization_id::text, bucket_id, storage_path, lease_token::text
		from private.claim_whatsapp_nonlead_media_delete($1::text)
	`, workerID).Scan(
		&item.id, &item.organizationID, &item.bucketID, &item.storagePath, &item.leaseToken,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, false, nil
	}
	if err != nil {
		return false, false, err
	}
	claimed = true
	if item.bucketID != whatsappMediaBucket ||
		!whatsappMediaPathBelongsToOrganization(item.storagePath, item.organizationID) ||
		!whatsAppNonLeadDeletableMediaPath(item.storagePath, item.organizationID) ||
		repo.storage.projectURL == "" || repo.storage.apiKey == "" || ctx.Err() != nil {
		finishErr := repo.finishWhatsAppNonLeadMediaDelete(ctx, item, "not_started")
		if finishErr != nil {
			return true, false, finishErr
		}
		return true, false, fmt.Errorf("WhatsApp nonlead media delete preflight failed")
	}
	var started bool
	err = repo.db.Pool().QueryRow(ctx, `
		select private.mark_whatsapp_nonlead_media_delete_started($1::uuid, $2::uuid)
	`, item.id, item.leaseToken).Scan(&started)
	if err != nil || !started {
		// A failed/ambiguous mark is still before HTTP. The old claim may be
		// recovered by SQL only if delete_started_at remains NULL.
		return true, false, fmt.Errorf("WhatsApp nonlead media delete start proof unavailable")
	}

	deleteErr := repo.storage.removeWhatsAppMediaObject(ctx, item.organizationID, item.storagePath)
	if deleteErr != nil {
		// Even an HTTP timeout/cancellation can finish on the Storage server.
		// Do not retry, release the path, or infer absence from a HEAD request.
		finishErr := repo.finishWhatsAppNonLeadMediaDelete(ctx, item, "unknown")
		if finishErr != nil {
			return true, false, fmt.Errorf("WhatsApp nonlead media delete outcome and finish are unknown")
		}
		return true, false, fmt.Errorf("WhatsApp nonlead media delete outcome is unknown")
	}
	if err := repo.finishWhatsAppNonLeadMediaDelete(ctx, item, "confirmed_deleted"); err != nil {
		// Storage may already be gone; SQL keeps the path reserved until the
		// acknowledgement succeeds. A repeat DELETE must not run blindly.
		return true, false, fmt.Errorf("WhatsApp nonlead media delete confirmation could not be recorded")
	}
	return true, true, nil
}

func (repo Repository) finishWhatsAppNonLeadMediaDelete(
	ctx context.Context, item whatsAppNonLeadMediaDeleteClaim, outcome string,
) error {
	finishCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), whatsAppNonLeadRetentionFinishTimeout)
	defer cancel()
	var finished bool
	err := repo.db.Pool().QueryRow(finishCtx, `
		select private.finish_whatsapp_nonlead_media_delete($1::uuid, $2::uuid, $3::text)
	`, item.id, item.leaseToken, outcome).Scan(&finished)
	if err != nil {
		return err
	}
	if !finished {
		return fmt.Errorf("WhatsApp nonlead media delete lease changed")
	}
	return nil
}

func whatsAppNonLeadDeletableMediaPath(objectPath, organizationID string) bool {
	if len(objectPath) == 0 || len(objectPath) > 1024 ||
		!whatsappMediaPathBelongsToOrganization(objectPath, organizationID) {
		return false
	}
	organizationPrefix := "orgs/" + organizationID + "/"
	if !strings.HasPrefix(objectPath, organizationPrefix) {
		return false
	}
	pathTail := strings.TrimPrefix(objectPath, organizationPrefix)
	if strings.HasPrefix(pathTail, "assets/v2/") {
		return len(pathTail) > len("assets/v2/")
	}
	if !strings.HasPrefix(pathTail, "sessions/") {
		return false
	}
	parts := strings.Split(strings.TrimPrefix(pathTail, "sessions/"), "/")
	if len(parts) != 3 || parts[1] != "incoming" || parts[2] == "" {
		return false
	}
	normalizedSessionID, ok := normalizeUUID(parts[0])
	return ok && normalizedSessionID == parts[0]
}

func whatsAppNonLeadDatabaseErrorCode(err error) string {
	if err == nil {
		return ""
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code
	}
	return "operation_failed"
}

func whatsAppNonLeadSQLState(err error) string {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && len(pgErr.Code) == 5 {
		return pgErr.Code
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return "57014"
	}
	return "XX000"
}
