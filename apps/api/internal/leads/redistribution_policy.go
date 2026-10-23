package leads

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
)

type redistributionPolicy struct {
	Enabled        bool `json:"enable_redistribution"`
	TimeoutMinutes int  `json:"redistribution_timeout_minutes"`
	WarningMinutes int  `json:"redistribution_warning_minutes"`
	MaxAttempts    int  `json:"redistribution_max_attempts"`
}

var errRedistributionConfigurationBusy = errors.New("redistribution configuration is being edited")

// Configuration locks all queue parents in UUID order. A batch worker may touch
// parents in job order, so it must fence configuration before any lead/job lock.
// Never wait while holding locks for a previous organization in this batch.
func lockRedistributionConfigurationDomain(ctx context.Context, tx pgx.Tx, organizationID string) error {
	var acquired bool
	if err := tx.QueryRow(ctx, `select pg_try_advisory_xact_lock(hashtextextended('round_robin_conditions:' || $1::text, 0))`, organizationID).Scan(&acquired); err != nil {
		return err
	}
	if !acquired {
		return errRedistributionConfigurationBusy
	}
	return nil
}

func decodeRedistributionPolicy(raw []byte) (redistributionPolicy, error) {
	// Defaults match the queue gateway. Invalid explicit decimals/types must
	// never silently turn an operator's new deadline into a different deadline.
	policy := redistributionPolicy{TimeoutMinutes: 20, WarningMinutes: 5, MaxAttempts: 10}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return redistributionPolicy{}, err
	}
	if enabled, ok := fields["enable_redistribution"]; ok {
		value, valid := parseFlexibleJSONBoolean(enabled)
		if !valid && string(enabled) != "null" {
			return redistributionPolicy{}, fmt.Errorf("invalid redistribution switch")
		}
		policy.Enabled = value
	}
	if !policy.Enabled {
		return policy, nil
	}
	for field, destination := range map[string]*int{
		"redistribution_timeout_minutes": &policy.TimeoutMinutes,
		"redistribution_warning_minutes": &policy.WarningMinutes,
		"redistribution_max_attempts":    &policy.MaxAttempts,
	} {
		value, present := fields[field]
		if !present || strings.TrimSpace(string(value)) == "null" {
			continue
		}
		var number int
		if err := json.Unmarshal(value, &number); err != nil {
			var legacy string
			if json.Unmarshal(value, &legacy) != nil {
				return redistributionPolicy{}, fmt.Errorf("invalid redistribution integer")
			}
			parsed, parseErr := strconv.Atoi(strings.TrimSpace(legacy))
			if parseErr != nil {
				return redistributionPolicy{}, fmt.Errorf("invalid redistribution integer")
			}
			number = parsed
		}
		*destination = number
	}
	if policy.TimeoutMinutes <= 5 && policy.WarningMinutes >= 0 {
		policy.WarningMinutes = 0
	}
	if policy.TimeoutMinutes < 1 || policy.TimeoutMinutes > 10080 || policy.WarningMinutes < 0 ||
		policy.WarningMinutes >= policy.TimeoutMinutes || policy.MaxAttempts < 0 || policy.MaxAttempts > 1000 {
		return redistributionPolicy{}, fmt.Errorf("invalid redistribution policy")
	}
	return policy, nil
}

// Configuration and workers first coordinate through the organization fence.
// The worker then takes queue -> lead -> job, retaining the queue write lock.
// Thus a completed disable cannot race a later transfer without introducing a
// queue -> job lock cycle in the configuration transaction.
func (repo Repository) redistributionQueueStopReason(ctx context.Context, tx pgx.Tx, job redistributionJob) (string, error) {
	if err := lockRedistributionConfigurationDomain(ctx, tx, job.OrganizationID); err != nil {
		return "", err
	}
	var active bool
	var settings []byte
	err := tx.QueryRow(ctx, `
		select coalesce(is_active, true), coalesce(settings, '{}'::jsonb)::text
		from public.round_robins
		where organization_id = $1::uuid and id = $2::uuid and deleted_at is null
		for share
	`, job.OrganizationID, job.RoundRobinID).Scan(&active, &settings)
	if errors.Is(err, pgx.ErrNoRows) {
		return "queue_removed", nil
	}
	if err != nil {
		return "", err
	}
	if !active {
		return "queue_inactive", nil
	}
	// Attention already evaluated its own SLA and enqueued a due-now transfer.
	// The queue must exist/be active, but its inactivity toggle, timer and limit
	// do not own this job. Keep the attention policy's explicit attempt limit.
	if isAttentionRedistributionJob(job) {
		if job.MaxAttempts > 0 && job.AttemptCount >= job.MaxAttempts {
			return "max_attempts_reached", nil
		}
		return "", nil
	}
	policy, err := decodeRedistributionPolicy(settings)
	if err != nil {
		return "queue_configuration_invalid", nil
	}
	if !policy.Enabled {
		return "redistribution_disabled", nil
	}
	if policy.MaxAttempts > 0 && job.AttemptCount >= policy.MaxAttempts {
		return "max_attempts_reached", nil
	}
	return "", nil
}

// Update only non-terminal inactivity jobs. Initial intake retries belong to a
// different lifecycle and must continue even when inactivity is disabled.
func (repo Repository) listPendingRedistributionPolicyJobs(ctx context.Context, tx pgx.Tx) ([]redistributionJob, error) {
	cursor := repo.redistributionBatchCursor(redistributionPolicyPage)
	rows, err := tx.Query(ctx, `
		select j.id::text, j.organization_id::text, j.lead_id::text, j.round_robin_id::text,
		  coalesce(j.current_assigned_user_id::text, ''), j.attempt_count, j.max_attempts,
		  j.timeout_minutes, j.warning_minutes, j.enrolled_at, coalesce(l.name, ''),
		  coalesce(j.metadata, '{}'::jsonb)::text, j.xmin::text
		from public.lead_redistribution_jobs j
		join public.leads l on l.id = j.lead_id and l.organization_id = j.organization_id
		left join public.round_robins q on q.id = j.round_robin_id and q.organization_id = j.organization_id and q.deleted_at is null
		where j.status in ('pending', 'warning_sent')
		  and not (coalesce(q.settings, '{}'::jsonb) ? 'operating_schedule')
		  and lower(btrim(coalesce(j.metadata->>'initial_distribution_pending', 'false'))) not in ('true','1','yes')
		  and lower(btrim(coalesce(j.metadata->>'source', ''))) <> 'lead_attention'
		  and (q.id is null or coalesce(q.is_active, true) = false
		    or lower(btrim(coalesce(q.settings->>'enable_redistribution','false'))) not in ('true','1','yes')
		    or case when btrim(coalesce(q.settings->>'redistribution_timeout_minutes','20')) ~ '^[+-]?[0-9]+$'
		      then btrim(coalesce(q.settings->>'redistribution_timeout_minutes','20'))::numeric <> j.timeout_minutes else true end
		    or case when btrim(coalesce(q.settings->>'redistribution_warning_minutes','5')) ~ '^[+-]?[0-9]+$'
		      then btrim(coalesce(q.settings->>'redistribution_warning_minutes','5'))::numeric <> j.warning_minutes else true end
		    or case when btrim(coalesce(q.settings->>'redistribution_max_attempts','10')) ~ '^[+-]?[0-9]+$'
		      then btrim(coalesce(q.settings->>'redistribution_max_attempts','10'))::numeric <> j.max_attempts else true end)
		order by j.updated_at, j.id limit $1 offset $2
		for update of j skip locked
	`, leadRedistributionBatchLimit, redistributionBatchOffset(cursor))
	if err != nil {
		return nil, err
	}
	jobs, err := scanRedistributionJobs(rows)
	rows.Close()
	if err != nil {
		return nil, err
	}
	advanceRedistributionBatchCursor(cursor, len(jobs))
	return jobs, nil
}

func (repo Repository) processRedistributionPolicy(ctx context.Context, tx pgx.Tx, job redistributionJob, attemptedVersion *string) error {
	if err := lockRedistributionConfigurationDomain(ctx, tx, job.OrganizationID); err != nil {
		return err
	}
	queueLocked, err := lockRedistributionQueueBeforeLead(ctx, tx, job)
	if err != nil {
		return err
	}
	if !queueLocked {
		return nil
	}
	lockedQueueID := job.RoundRobinID
	if _, err := repo.getRedistributionLeadSnapshotForUpdate(ctx, tx, job.OrganizationID, job.LeadID); err != nil {
		if errors.Is(err, errRedistributionLeadBusy) {
			return nil
		}
		if errors.Is(err, ErrLeadNotFound) {
			return nil
		}
		return err
	}
	// Re-entry can reset this same job while we wait for the lead lock.
	// Decide from the locked row, especially its current attempt counter.
	err = tx.QueryRow(ctx, `select round_robin_id::text, coalesce(current_assigned_user_id::text, ''),
	    attempt_count, max_attempts, timeout_minutes, warning_minutes, enrolled_at, xmin::text
	  from public.lead_redistribution_jobs
	  where id = $1::uuid and organization_id = $2::uuid and lead_id = $3::uuid
	    and status in ('pending','warning_sent')
	    and not exists (select 1 from public.round_robins managed_queue
	      where managed_queue.organization_id = lead_redistribution_jobs.organization_id
	        and managed_queue.id = lead_redistribution_jobs.round_robin_id
	        and coalesce(managed_queue.settings, '{}'::jsonb) ? 'operating_schedule')
	    and lower(btrim(coalesce(metadata->>'initial_distribution_pending','false'))) not in ('true','1','yes')
	    and lower(btrim(coalesce(metadata->>'source',''))) <> 'lead_attention' for update`,
		job.ID, job.OrganizationID, job.LeadID).Scan(&job.RoundRobinID, &job.CurrentAssignedUserID,
		&job.AttemptCount, &job.MaxAttempts, &job.TimeoutMinutes, &job.WarningMinutes, &job.EnrolledAt, &job.RowVersion)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	*attemptedVersion = job.RowVersion
	if job.RoundRobinID != lockedQueueID {
		return nil // Re-entry moved the job; lock its new queue on the next tick.
	}
	if _, err := repo.reconcileLockedRedistributionPolicy(ctx, tx, job); err != nil {
		return err
	}
	return nil
}

// Usable is false for a stopped job or a failed compare-and-swap. Changed jobs
// must be re-read with the warning/due eligibility predicate before any action.
type redistributionPolicyReconciliation struct {
	Changed bool
	Usable  bool
}

// Callers hold the organization fence, queue write lock, lead and current job.
// The bounded maintenance pass is an optimization, not a precondition for a
// candidate to observe the operator's current inactivity policy.
func (repo Repository) reconcileLockedRedistributionPolicy(ctx context.Context, tx pgx.Tx, job redistributionJob) (redistributionPolicyReconciliation, error) {
	if job.InitialDistributionPending {
		return redistributionPolicyReconciliation{}, nil
	}
	reason, err := repo.redistributionQueueStopReason(ctx, tx, job)
	if err != nil {
		return redistributionPolicyReconciliation{}, err
	}
	if reason != "" {
		if err := repo.stopRedistributionJob(ctx, tx, job.ID, reason); err != nil {
			return redistributionPolicyReconciliation{}, err
		}
		return redistributionPolicyReconciliation{}, nil
	}
	if isAttentionRedistributionJob(job) {
		return redistributionPolicyReconciliation{Usable: true}, nil
	}
	var settings []byte
	if err := tx.QueryRow(ctx, `select coalesce(settings, '{}'::jsonb)::text from public.round_robins
	  where organization_id = $1::uuid and id = $2::uuid`, job.OrganizationID, job.RoundRobinID).Scan(&settings); err != nil {
		return redistributionPolicyReconciliation{}, err
	}
	policy, err := decodeRedistributionPolicy(settings)
	if err != nil {
		return redistributionPolicyReconciliation{}, err
	}
	if policy.TimeoutMinutes == job.TimeoutMinutes && policy.WarningMinutes == job.WarningMinutes && policy.MaxAttempts == job.MaxAttempts {
		return redistributionPolicyReconciliation{Usable: true}, nil
	}
	// Keep elapsed inactivity: changing a duration does not reset the clock.
	// Repeated transfers start their timer at last_redistributed_at.
	commandTag, err := tx.Exec(ctx, `update public.lead_redistribution_jobs
	  set timeout_minutes = $2, warning_minutes = $3, max_attempts = $4,
	    due_at = coalesce(last_redistributed_at, enrolled_at) + ($2::integer * interval '1 minute'),
	    warning_due_at = case when $3::integer > 0 then
	      coalesce(last_redistributed_at, enrolled_at) + (($2::integer - $3::integer) * interval '1 minute') else null end,
	    warning_sent_at = null, warning_retry_at = null, redistribution_retry_at = null, status = 'pending', updated_at = now(),
	    metadata = metadata - 'waiting_for_available_member' - 'next_candidate_check_at'
	  where id = $1::uuid and organization_id = $5::uuid and lead_id = $6::uuid
		    and round_robin_id = $7::uuid and status in ('pending','warning_sent')
		    and attempt_count = $8 and enrolled_at = $9::timestamptz
		    and current_assigned_user_id is not distinct from nullif($10, '')::uuid
		    and timeout_minutes = $11 and warning_minutes = $12 and max_attempts = $13
		    and lower(btrim(coalesce(metadata->>'initial_distribution_pending','false'))) not in ('true','1','yes')
		    and lower(btrim(coalesce(metadata->>'source',''))) <> 'lead_attention'`, job.ID, policy.TimeoutMinutes, policy.WarningMinutes, policy.MaxAttempts,
		job.OrganizationID, job.LeadID, job.RoundRobinID, job.AttemptCount, job.EnrolledAt,
		job.CurrentAssignedUserID, job.TimeoutMinutes, job.WarningMinutes, job.MaxAttempts)
	if err != nil {
		return redistributionPolicyReconciliation{}, err
	}
	if commandTag.RowsAffected() != 1 {
		return redistributionPolicyReconciliation{}, nil
	}
	return redistributionPolicyReconciliation{Changed: true, Usable: true}, nil
}

func isAttentionRedistributionJob(job redistributionJob) bool {
	return normalizeInitialDistributionSource(job.Source) == "lead_attention"
}
