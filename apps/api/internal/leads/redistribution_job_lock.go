package leads

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

type redistributionJobScanner interface {
	Scan(...any) error
}

func scanRedistributionJob(row redistributionJobScanner) (redistributionJob, error) {
	var job redistributionJob
	var rawMetadata []byte
	if err := row.Scan(
		&job.ID, &job.OrganizationID, &job.LeadID, &job.RoundRobinID,
		&job.CurrentAssignedUserID, &job.AttemptCount, &job.MaxAttempts,
		&job.TimeoutMinutes, &job.WarningMinutes, &job.EnrolledAt,
		&job.LeadName, &rawMetadata, &job.RowVersion,
	); err != nil {
		return redistributionJob{}, err
	}
	job.InitialDistributionPending, job.AllowAssignedRedistribution, job.EntryEventID, job.Source = redistributionJobMetadataFromJSON(rawMetadata)
	return job, nil
}

// The caller holds the organization fence, queue write lock and lead lock. Re-entry can
// replace a job's queue, counters or lifecycle while that lead lock is awaited.
// Treat the list result only as a scoped candidate, then decide from this row.
func (repo Repository) lockWarningRedistributionJob(ctx context.Context, queryer leadTeamQueryer, candidate redistributionJob) (redistributionJob, bool, error) {
	return lockRedistributionJob(ctx, queryer, candidate, `
		and j.status = 'pending'
		and j.warning_due_at is not null
		and j.warning_due_at <= now()
		and j.due_at > now()
		and j.warning_sent_at is null
		and (j.warning_retry_at is null or j.warning_retry_at <= now())
	`)
}

func (repo Repository) lockDueRedistributionJob(ctx context.Context, queryer leadTeamQueryer, candidate redistributionJob) (redistributionJob, bool, error) {
	return lockRedistributionJob(ctx, queryer, candidate, `
		and j.status in ('pending', 'warning_sent')
		and j.due_at <= now()
		and (j.redistribution_retry_at is null or j.redistribution_retry_at <= now())
	`)
}

func lockRedistributionJob(ctx context.Context, queryer leadTeamQueryer, candidate redistributionJob, eligibility string) (redistributionJob, bool, error) {
	job, err := scanRedistributionJob(queryer.QueryRow(ctx, `
		select j.id::text, j.organization_id::text, j.lead_id::text, j.round_robin_id::text,
			coalesce(j.current_assigned_user_id::text, ''), j.attempt_count, j.max_attempts,
			j.timeout_minutes, j.warning_minutes, j.enrolled_at,
			coalesce(nullif(l.name, ''), 'Lead'), coalesce(j.metadata, '{}'::jsonb)::text, j.xmin::text
		from public.lead_redistribution_jobs j
		join public.leads l on l.organization_id = j.organization_id and l.id = j.lead_id
		where j.id = $1::uuid and j.organization_id = $2::uuid and j.lead_id = $3::uuid
		and not exists (select 1 from public.round_robins managed_queue
		  where managed_queue.organization_id = j.organization_id and managed_queue.id = j.round_robin_id
		    and coalesce(managed_queue.settings, '{}'::jsonb) ? 'operating_schedule')
		`+eligibility+`
		for update of j
	`, candidate.ID, candidate.OrganizationID, candidate.LeadID))
	if errors.Is(err, pgx.ErrNoRows) {
		return redistributionJob{}, false, nil
	}
	if err != nil {
		return redistributionJob{}, false, err
	}
	return job, true, nil
}
