package leads

import (
	"context"
	"errors"
)

// Technical failures do not consume an assignment attempt or move its business
// deadline. Persist a separate ready time after the failed transaction rolls
// back, so a failed first page cannot monopolize every subsequent batch.
func (repo Repository) deferFailedRedistributionJob(ctx context.Context, job redistributionJob, attemptedVersion string, warning bool) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer rollbackRedistributionTransaction(ctx, tx)
	var locked bool
	if err := tx.QueryRow(ctx, `select pg_try_advisory_xact_lock($1::integer, hashtext($2::text))`, leadRedistributionLockKey, job.ID).Scan(&locked); err != nil {
		return err
	}
	if !locked {
		return errors.New("redistribution retry deferred: another executor owns the job")
	}
	if _, err := tx.Exec(ctx, `set local lock_timeout = '2s'`); err != nil {
		return err
	}
	// The MVCC version was read with the job lock before the failed operation.
	// A manual edit, successful replica or newer enrollment invalidates this CAS.
	// No-op on a newer version is intentional; never delay that replacement work.
	query := `update public.lead_redistribution_jobs
		set redistribution_retry_at = clock_timestamp() + interval '60 seconds'
		where organization_id=$1::uuid and id=$2::uuid and lead_id=$3::uuid
		  and xmin::text=$4 and status in ('pending','warning_sent')`
	if warning {
		query = `update public.lead_redistribution_jobs
			set warning_retry_at = clock_timestamp() + interval '60 seconds'
			where organization_id=$1::uuid and id=$2::uuid and lead_id=$3::uuid
			  and xmin::text=$4 and status='pending' and warning_sent_at is null`
	}
	if _, err := tx.Exec(ctx, query, job.OrganizationID, job.ID, job.LeadID, attemptedVersion); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
