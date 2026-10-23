package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const (
	unlinkedRetentionWorkerInterval = time.Minute
	unlinkedRetentionCycleTimeout   = 50 * time.Second
	unlinkedRetentionGCTimeout      = 15 * time.Second
	unlinkedRetentionDeleteTimeout  = 10 * time.Second
	unlinkedRetentionScrubCalls     = 4
	unlinkedRetentionMessageBatch   = 500
	unlinkedRetentionGCJobs         = 25
	unlinkedRetentionGCLease        = "5 minutes"
)

var unlinkedRetentionWorkerID = "vimob-api-whatsapp-unlinked-retention-" + randomHex(8)

type unlinkedRetentionScrubResult struct {
	Status                 string `json:"status"`
	InboxScrubbed          int    `json:"inbox_scrubbed"`
	InboxTerminal          int    `json:"inbox_terminal"`
	InboxNewlyTerminalized int    `json:"inbox_newly_terminalized"`
}

type unlinkedMediaGCJob struct {
	ID             string
	OrganizationID string
	Bucket         string
	ObjectPath     string
}

type unlinkedMediaGCTx interface {
	QueryRow(context.Context, string, ...any) pgx.Row
	Commit(context.Context) error
	Rollback(context.Context) error
}

type unlinkedRetentionWorkerError struct {
	stage string
	err   error
}

func (err unlinkedRetentionWorkerError) Error() string { return err.stage }
func (err unlinkedRetentionWorkerError) Unwrap() error { return err.err }

type unlinkedMediaGCTerminalError struct{ reason string }

func (err unlinkedMediaGCTerminalError) Error() string {
	return "unlinked media GC terminal: " + err.reason
}

func (handler Handler) StartUnlinkedRetentionWorker(ctx context.Context, logger *slog.Logger) {
	if !handler.workerConfig.UnlinkedRetentionWorkerEnabled {
		return
	}
	if logger == nil {
		logger = slog.Default()
	}
	go handler.runUnlinkedRetentionWorker(ctx, logger)
}

func (handler Handler) runUnlinkedRetentionWorker(ctx context.Context, logger *slog.Logger) {
	ticker := time.NewTicker(unlinkedRetentionWorkerInterval)
	defer ticker.Stop()

	for {
		if ctx.Err() != nil {
			return
		}
		cycleCtx, cancel := context.WithTimeout(ctx, unlinkedRetentionCycleTimeout)
		err := handler.repo.runUnlinkedRetentionCycle(cycleCtx, func(result unlinkedRetentionScrubResult) {
			if result.InboxNewlyTerminalized > 0 {
				// Accepted events were still pending, retrying, or held by an
				// expired processing lease when their seven-day epoch ended.
				logger.Warn("whatsapp unlinked retention terminalized unprocessed inbox events",
					"inbox_newly_terminalized", result.InboxNewlyTerminalized)
			}
		})
		cancel()
		if err != nil && ctx.Err() == nil {
			logUnlinkedRetentionWorkerError(logger, err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func logUnlinkedRetentionWorkerError(logger *slog.Logger, err error) {
	var terminal unlinkedMediaGCTerminalError
	if errors.As(err, &terminal) {
		// processUnlinkedMediaGCJobInTx returns this only after COMMIT. Emit one
		// alertable event for the transition, never the Storage body or path.
		logger.Error("whatsapp unlinked media GC terminal", "reason", terminal.reason)
		return
	}
	var stageErr unlinkedRetentionWorkerError
	stage := "internal"
	if errors.As(err, &stageErr) {
		stage = stageErr.stage
	}
	var pgErr *pgconn.PgError
	sqlState := ""
	if errors.As(err, &pgErr) {
		sqlState = pgErr.SQLState()
	}
	// SQL and Storage errors may contain a contact or object path. Log only
	// fixed stage and SQLSTATE; queue.last_error uses fixed reason codes.
	logger.Error("whatsapp unlinked retention worker failed", "stage", stage, "sqlstate", sqlState)
}

func (repo Repository) runUnlinkedRetentionCycle(ctx context.Context, onScrub func(unlinkedRetentionScrubResult)) error {
	for attempt := 0; attempt < unlinkedRetentionScrubCalls; attempt++ {
		result, err := repo.scrubOneExpiredUnlinkedConversation(ctx)
		if err != nil {
			return unlinkedRetentionWorkerError{stage: "scrub", err: err}
		}
		if onScrub != nil {
			onScrub(result)
		}
		switch result.Status {
		case "processed":
		case "media_processing":
			// A concurrent media claim won the row lock. The next bounded call
			// can advance another expired conversation while this job finishes.
		case "idle":
			attempt = unlinkedRetentionScrubCalls
		case "cutover_required":
			return unlinkedRetentionWorkerError{stage: "cutover_required", err: errors.New("unlinked retention cutover is incomplete")}
		default:
			return unlinkedRetentionWorkerError{stage: "scrub_contract", err: errors.New("unknown scrub status")}
		}
	}

	for attempt := 0; attempt < unlinkedRetentionGCJobs; attempt++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		if deadline, hasDeadline := ctx.Deadline(); hasDeadline && time.Until(deadline) < unlinkedRetentionGCTimeout+time.Second {
			return nil
		}
		job, found, err := repo.claimUnlinkedMediaGCJob(ctx)
		if err != nil {
			return unlinkedRetentionWorkerError{stage: "gc_claim", err: err}
		}
		if !found {
			return nil
		}
		if err := repo.processUnlinkedMediaGCJob(ctx, job); err != nil {
			return unlinkedRetentionWorkerError{stage: "gc_process", err: err}
		}
	}
	return nil
}

func (repo Repository) scrubOneExpiredUnlinkedConversation(ctx context.Context) (unlinkedRetentionScrubResult, error) {
	var raw string
	err := repo.db.Pool().QueryRow(ctx, `
		select private.scrub_expired_whatsapp_unlinked_conversations($1)::text
	`, unlinkedRetentionMessageBatch).Scan(&raw)
	if err != nil {
		return unlinkedRetentionScrubResult{}, err
	}
	var result unlinkedRetentionScrubResult
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		return unlinkedRetentionScrubResult{}, err
	}
	return result, nil
}

func (repo Repository) claimUnlinkedMediaGCJob(ctx context.Context) (unlinkedMediaGCJob, bool, error) {
	var job unlinkedMediaGCJob
	err := repo.db.Pool().QueryRow(ctx, `
		select id::text, organization_id::text, bucket_id, object_path
		from private.claim_whatsapp_unlinked_media_gc($1, 1, $2::interval)
	`, unlinkedRetentionWorkerID, unlinkedRetentionGCLease).Scan(
		&job.ID, &job.OrganizationID, &job.Bucket, &job.ObjectPath,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return unlinkedMediaGCJob{}, false, nil
	}
	if err != nil {
		return unlinkedMediaGCJob{}, false, err
	}
	return job, true, nil
}

// The DB transaction is intentionally held through the Storage DELETE. The
// SQL can_delete function locks the GC row; media-path attachment triggers
// take a conflicting lock, so no live reference can appear between the
// recheck and deletion.
func (repo Repository) processUnlinkedMediaGCJob(ctx context.Context, job unlinkedMediaGCJob) error {
	processCtx, cancel := context.WithTimeout(ctx, unlinkedRetentionGCTimeout)
	defer cancel()

	tx, err := repo.db.Pool().Begin(processCtx)
	if err != nil {
		return err
	}
	defer func() {
		rollbackCtx, rollbackCancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer rollbackCancel()
		_ = tx.Rollback(rollbackCtx)
	}()
	deleted, err := processUnlinkedMediaGCJobInTx(processCtx, tx, job, repo.storage.deleteUnlinkedMediaObject)
	if err != nil {
		return err
	}
	if deleted {
		whatsappMediaSignedURLCache.Delete(job.ObjectPath)
	}
	return nil
}

func processUnlinkedMediaGCJobInTx(
	ctx context.Context,
	tx unlinkedMediaGCTx,
	job unlinkedMediaGCJob,
	deleteObject func(context.Context, string, string) error,
) (bool, error) {
	if job.Bucket != whatsappMediaBucket || !validUnlinkedMediaGCPath(job.OrganizationID, job.ObjectPath) {
		if err := completeUnlinkedMediaGCJob(ctx, tx, job.ID, false, "invalid_path"); err != nil {
			return false, err
		}
		if err := tx.Commit(ctx); err != nil {
			return false, err
		}
		return false, unlinkedMediaGCTerminalError{reason: "invalid_path"}
	}

	var canDelete bool
	if err := tx.QueryRow(ctx, `
		select private.whatsapp_unlinked_media_gc_can_delete($1::uuid, $2)
	`, job.ID, unlinkedRetentionWorkerID).Scan(&canDelete); err != nil {
		return false, err
	}
	if !canDelete {
		if err := completeUnlinkedMediaGCJob(ctx, tx, job.ID, false, "live_reference"); err != nil {
			return false, err
		}
		return false, tx.Commit(ctx)
	}

	deleteCtx, cancelDelete := context.WithTimeout(ctx, unlinkedRetentionDeleteTimeout)
	deleteErr := deleteObject(deleteCtx, job.OrganizationID, job.ObjectPath)
	cancelDelete()
	if deleteErr != nil {
		reason := unlinkedMediaGCFailureCode(deleteErr)
		if err := completeUnlinkedMediaGCJob(ctx, tx, job.ID, false, reason); err != nil {
			return false, err
		}
		var terminal bool
		if err := tx.QueryRow(ctx, `
			select status = 'failed'
			from private.whatsapp_unlinked_media_gc
			where id = $1::uuid
		`, job.ID).Scan(&terminal); err != nil {
			return false, err
		}
		if err := tx.Commit(ctx); err != nil {
			return false, err
		}
		if terminal {
			return false, unlinkedMediaGCTerminalError{reason: reason}
		}
		return false, deleteErr
	}
	if err := completeUnlinkedMediaGCJob(ctx, tx, job.ID, true, ""); err != nil {
		return false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	return true, nil
}

func completeUnlinkedMediaGCJob(ctx context.Context, tx unlinkedMediaGCTx, jobID string, deleted bool, reason string) error {
	var completed bool
	err := tx.QueryRow(ctx, `
		select private.complete_whatsapp_unlinked_media_gc($1::uuid, $2, $3, nullif($4, ''))
	`, jobID, unlinkedRetentionWorkerID, deleted, reason).Scan(&completed)
	if err != nil {
		return err
	}
	if !completed {
		return errors.New("unlinked media GC lease lost")
	}
	return nil
}

func unlinkedMediaGCFailureCode(err error) string {
	var statusErr storageDeleteHTTPError
	if errors.As(err, &statusErr) {
		return fmt.Sprintf("storage_http_%d", statusErr.statusCode)
	}
	if errors.Is(err, ErrStorageNotConfigured) {
		return "storage_not_configured"
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "storage_timeout"
	}
	return "storage_delete_failed"
}
