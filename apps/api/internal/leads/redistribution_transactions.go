package leads

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const redistributionTransactionAttempts = 3

// processLegacyLeadRedistribution discovers work without holding lead or queue locks.
// Every warning/transfer then commits independently. A queue lock acquired for
// lead A must be released before the worker tries to lock lead B, which manual
// redistribution may already own while waiting for that same queue.
func (repo Repository) processLegacyLeadRedistribution(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer rollbackRedistributionTransaction(ctx, tx)
	policies, err := repo.listPendingRedistributionPolicyJobs(ctx, tx)
	if err != nil {
		return err
	}
	warnings, warningErr := repo.listWarningRedistributionJobs(ctx, tx)
	if warningErr != nil {
		return warningErr
	}
	jobs, err := repo.listDueRedistributionJobs(ctx, tx)
	if err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}

	var failures []error
	for _, group := range []struct {
		jobs    []redistributionJob
		warning bool
		policy  bool
	}{{policies, false, true}, {warnings, true, false}, {jobs, false, false}} {
		for _, job := range group.jobs {
			if err := ctx.Err(); err != nil {
				return errors.Join(append(failures, err)...)
			}
			attemptedVersion := job.RowVersion
			err := retryRedistributionTransaction(ctx, func() error {
				return repo.processRedistributionTransaction(ctx, job, group.warning, group.policy, &attemptedVersion)
			})
			if err != nil {
				failures = append(failures, fmt.Errorf("redistribution job %s: %w", job.ID, err))
				if !group.policy && !errors.Is(err, errRedistributionConfigurationBusy) {
					if deferErr := repo.deferFailedRedistributionJob(ctx, job, attemptedVersion, group.warning); deferErr != nil {
						failures = append(failures, fmt.Errorf("persist redistribution retry for job %s: %w", job.ID, deferErr))
					}
				}
			}
		}
	}
	return errors.Join(failures...)
}

func (repo Repository) processRedistributionTransaction(ctx context.Context, job redistributionJob, warning bool, policy bool, attemptedVersion *string) error {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer rollbackRedistributionTransaction(ctx, tx)

	// Transaction locks disappear on commit, rollback or connection loss. The
	// per-job key lets another replica skip this job and process other queues.
	var locked bool
	err = tx.QueryRow(ctx, `select pg_try_advisory_xact_lock($1::integer, hashtext($2::text))`, leadRedistributionLockKey, job.ID).Scan(&locked)
	if err != nil || !locked {
		return err
	}
	// A manual transaction can legitimately hold this lead. Bound that wait so
	// one busy lead cannot prevent the rest of the discovered work from running.
	if _, err := tx.Exec(ctx, `set local lock_timeout = '2s'`); err != nil {
		return err
	}
	if policy {
		err = repo.processRedistributionPolicy(ctx, tx, job, attemptedVersion)
	} else if warning {
		err = repo.processRedistributionWarning(ctx, tx, job, attemptedVersion)
	} else {
		err = repo.processDueRedistribution(ctx, tx, job, attemptedVersion)
	}
	if err != nil {
		if errors.Is(err, errRedistributionConfigurationBusy) {
			return nil // Another transaction owns this organization's config fence.
		}
		return err
	}
	return tx.Commit(ctx)
}

func rollbackRedistributionTransaction(ctx context.Context, tx pgx.Tx) {
	cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	_ = tx.Rollback(cleanupCtx)
}

// Only PostgreSQL errors that guarantee transaction rollback may be replayed.
// In particular, a transport error during COMMIT is not retried here because
// the caller cannot know whether that transaction committed.
func retryRedistributionTransaction(ctx context.Context, attempt func() error) error {
	for n := 0; ; n++ {
		err := attempt()
		var postgresErr *pgconn.PgError
		if err == nil || !errors.As(err, &postgresErr) ||
			(postgresErr.Code != "40001" && postgresErr.Code != "40P01") ||
			n+1 >= redistributionTransactionAttempts {
			return err
		}
		timer := time.NewTimer(time.Duration(n+1) * 10 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}
}
