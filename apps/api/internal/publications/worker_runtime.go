package publications

import (
	"context"
	"errors"
	"fmt"
	"sync/atomic"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type publicationWorkerState struct {
	running       atomic.Bool
	lastStarted   atomic.Int64
	lastCompleted atomic.Int64
	lastProgress  atomic.Int64
	processed     atomic.Int64
	failed        atomic.Int64
}

// WorkerStats is safe to read from health endpoints without querying the queue.
// Completion timestamps distinguish an enabled worker from a stalled executor.
func (repo Repository) WorkerStats() map[string]any {
	stats := map[string]any{"enabled": repo.config.Worker.Enabled, "running": false}
	if repo.workerState == nil {
		return stats
	}
	stats["running"] = repo.workerState.running.Load()
	stats["last_batch_started_at"] = workerTimestamp(repo.workerState.lastStarted.Load())
	stats["last_batch_completed_at"] = workerTimestamp(repo.workerState.lastCompleted.Load())
	stats["last_progress_at"] = workerTimestamp(repo.workerState.lastProgress.Load())
	stats["processed"] = repo.workerState.processed.Load()
	stats["failed"] = repo.workerState.failed.Load()
	return stats
}

// Disabled execution is intentional: commands fail closed, while the remaining
// API remains usable. Enabled execution must keep making bounded progress.
func (repo Repository) WorkerReady(now time.Time) error {
	if !repo.config.Worker.Enabled {
		return nil
	}
	if repo.workerState == nil || !repo.workerState.running.Load() {
		return ErrWorkerUnavailable
	}
	latest := repo.workerState.lastProgress.Load()
	grace := 2*publicationJobTimeout(repo.config.Worker.Lease) + 2*repo.config.Worker.Interval + 10*time.Second
	if latest == 0 || now.Sub(time.Unix(0, latest)) > grace {
		return ErrWorkerUnavailable
	}
	return nil
}

func workerTimestamp(nanos int64) any {
	if nanos == 0 {
		return nil
	}
	return time.Unix(0, nanos).UTC().Format(time.RFC3339Nano)
}

func publicationStatusAvailable(status string) bool {
	switch normalizedASCII(status) {
	case "active", "ativo", "available", "disponivel":
		return true
	default:
		return false
	}
}

func publicationJobTimeout(lease time.Duration) time.Duration {
	// Finish before the claim can be reclaimed by another replica.
	if lease <= 0 {
		return 30 * time.Second
	}
	return min(30*time.Second, lease/2)
}

var errPublicationWorkerPanic = errors.New("publication worker panic")

func executePublicationJob(ctx context.Context, timeout time.Duration, execute func(context.Context) error) (err error) {
	jobCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	defer func() {
		if recover() != nil {
			// Never include panic values: they may contain source data or secrets.
			err = errPublicationWorkerPanic
		}
	}()
	return execute(jobCtx)
}

func (repo Repository) processJobSafely(ctx context.Context, workerID string, job pendingJob) error {
	err := executePublicationJob(ctx, publicationJobTimeout(repo.config.Worker.Lease), func(jobCtx context.Context) error {
		return repo.processJob(jobCtx, workerID, job)
	})
	if !errors.Is(err, context.DeadlineExceeded) && !errors.Is(err, errPublicationWorkerPanic) {
		return err
	}
	code, message := "worker_timeout", "O processamento excedeu o prazo e será tentado novamente."
	if errors.Is(err, errPublicationWorkerPanic) {
		code, message = "worker_panic", "O processamento foi interrompido e será tentado novamente."
	}
	// The canceled job context cannot record its failure. Use a fresh bounded
	// context while the app is alive; lease fencing still prevents stale writes.
	failureCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return errors.Join(err, repo.failJob(failureCtx, workerID, job, code, message, false))
}

func (repo Repository) workerTenantForPublish(ctx context.Context, job pendingJob) (tenant.Context, error) {
	if job.RequestedBy == nil {
		return tenant.Context{}, tenant.ErrOrganizationAccessDenied
	}
	// Resolve afresh for every delivery, rather than granting the worker the
	// super-admin powers used only for failure diagnostics and withdrawal.
	current, err := tenant.NewRepository(repo.db).Resolve(ctx, *job.RequestedBy, job.OrganizationID)
	if err != nil {
		return tenant.Context{}, err
	}
	if err := validateWorkerPublicationAuthorization(current, job.OrganizationID); err != nil {
		return tenant.Context{}, err
	}
	return current, nil
}

func validateWorkerPublicationAuthorization(current tenant.Context, organizationID string) error {
	if current.OrganizationID != organizationID || !current.HasPermission(permissions.PropertyManage) ||
		!current.HasModule("properties") || !current.HasBillingAccessAt(time.Now().UTC()) {
		return tenant.ErrOrganizationAccessDenied
	}
	return nil
}

func publicationAuthorizationFailurePermanent(err error) bool {
	for _, sentinel := range []error{tenant.ErrOrganizationAccessDenied, tenant.ErrUserInactive,
		tenant.ErrUserProfileNotFound, tenant.ErrOrganizationNotFound, tenant.ErrOrganizationRequired} {
		if errors.Is(err, sentinel) {
			return true
		}
	}
	return false
}

func publicationRefreshAllowed(publication publicationRecord, job pendingJob) bool {
	return publishJobIsCurrent(publication, job) && job.Attempts < job.MaxAttempts
}

func publicationRefreshExhaustedError(job pendingJob) error {
	return fmt.Errorf("publication snapshot refresh budget exhausted after %d attempts", job.Attempts)
}
