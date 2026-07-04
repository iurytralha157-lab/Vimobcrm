package leads

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const (
	leadRedistributionWorkerInterval = 30 * time.Second
	leadRedistributionBatchLimit     = 50
	leadRedistributionLockKey        = int64(860421704)
)

type redistributionJob struct {
	ID                    string
	OrganizationID        string
	LeadID                string
	RoundRobinID          string
	CurrentAssignedUserID string
	AttemptCount          int
	MaxAttempts           int
	TimeoutMinutes        int
	WarningMinutes        int
	EnrolledAt            time.Time
	LeadName              string
}

func (repo Repository) StartRedistributionWorker(ctx context.Context, logger *slog.Logger) {
	if logger == nil {
		logger = slog.Default()
	}

	go func() {
		timer := time.NewTimer(5 * time.Second)
		defer timer.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
				if err := repo.ProcessLeadRedistribution(ctx); err != nil && !errors.Is(err, context.Canceled) {
					logger.Error("lead redistribution worker failed", "error", err)
				}
				timer.Reset(leadRedistributionWorkerInterval)
			}
		}
	}()
}

func (repo Repository) ProcessLeadRedistribution(ctx context.Context) error {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var locked bool
	if err := tx.QueryRow(ctx, `select pg_try_advisory_xact_lock($1)`, leadRedistributionLockKey).Scan(&locked); err != nil {
		return err
	}
	if !locked {
		return nil
	}

	if err := repo.processRedistributionWarnings(ctx, tx); err != nil {
		return err
	}
	if err := repo.processDueRedistributions(ctx, tx); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func (repo Repository) processRedistributionWarnings(ctx context.Context, tx pgx.Tx) error {
	jobs, err := repo.listWarningRedistributionJobs(ctx, tx)
	if err != nil {
		return err
	}

	for _, job := range jobs {
		current, err := repo.getLeadSnapshotForUpdate(ctx, tx, job.OrganizationID, job.LeadID)
		if err != nil {
			if errors.Is(err, ErrLeadNotFound) {
				if stopErr := repo.stopRedistributionJob(ctx, tx, job.ID, "lead_not_found"); stopErr != nil {
					return stopErr
				}
				continue
			}
			return err
		}

		reason, err := repo.redistributionStopReason(ctx, tx, job, current)
		if err != nil {
			return err
		}
		if reason != "" {
			if err := repo.stopRedistributionJob(ctx, tx, job.ID, reason); err != nil {
				return err
			}
			continue
		}

		if err := repo.insertNotification(ctx, tx, job.OrganizationID, job.CurrentAssignedUserID, job.LeadID, "Lead quase redistribuido", fmt.Sprintf("%s sera redistribuido em %d minuto(s) se nao houver atendimento.", job.LeadName, job.WarningMinutes), "lead_redistribution_warning", map[string]any{
			"lead_name":       job.LeadName,
			"timeout_minutes": job.TimeoutMinutes,
			"warning_minutes": job.WarningMinutes,
			"round_robin_id":  job.RoundRobinID,
			"job_id":          job.ID,
		}); err != nil {
			return err
		}

		if _, err := tx.Exec(ctx, `
			update public.lead_redistribution_jobs
			set status = 'warning_sent',
			    warning_sent_at = now(),
			    updated_at = now()
			where id = $1::uuid
		`, job.ID); err != nil {
			return err
		}
	}

	return nil
}

func (repo Repository) processDueRedistributions(ctx context.Context, tx pgx.Tx) error {
	jobs, err := repo.listDueRedistributionJobs(ctx, tx)
	if err != nil {
		return err
	}

	for _, job := range jobs {
		current, err := repo.getLeadSnapshotForUpdate(ctx, tx, job.OrganizationID, job.LeadID)
		if err != nil {
			if errors.Is(err, ErrLeadNotFound) {
				if stopErr := repo.stopRedistributionJob(ctx, tx, job.ID, "lead_not_found"); stopErr != nil {
					return stopErr
				}
				continue
			}
			return err
		}

		reason, err := repo.redistributionStopReason(ctx, tx, job, current)
		if err != nil {
			return err
		}
		if reason != "" {
			if err := repo.stopRedistributionJob(ctx, tx, job.ID, reason); err != nil {
				return err
			}
			continue
		}

		selection, reason, err := repo.selectRoundRobinMemberForRedistribution(ctx, tx, job.OrganizationID, job.RoundRobinID, current.AssignedUserID)
		if err != nil {
			return err
		}
		if reason != "" || selection.UserID == "" {
			if err := repo.finishRedistributionJob(ctx, tx, job.ID, "no_next_member", "no_next_member"); err != nil {
				return err
			}
			continue
		}

		previousUserID := current.AssignedUserID
		systemTenant := tenant.Context{OrganizationID: job.OrganizationID}
		if err := repo.transferLeadAssignee(ctx, tx, systemTenant, current, &selection.UserID, "auto_redistribution"); err != nil {
			return err
		}

		if err := repo.insertAutoRedistributionLog(ctx, tx, job, selection, previousUserID); err != nil {
			return err
		}

		nextAttemptCount := job.AttemptCount + 1
		finalStatus := "pending"
		if nextAttemptCount >= job.MaxAttempts {
			finalStatus = "max_attempts_reached"
		}

		if err := repo.updateRedistributionJobAfterTransfer(ctx, tx, job, selection.UserID, nextAttemptCount, finalStatus); err != nil {
			return err
		}

		if err := repo.insertNotification(ctx, tx, job.OrganizationID, selection.UserID, job.LeadID, "Lead redistribuido para voce", fmt.Sprintf("%s estava parado ha %d minuto(s) e foi redistribuido.", job.LeadName, job.TimeoutMinutes), "lead_redistributed_received", map[string]any{
			"lead_name":       job.LeadName,
			"previous_user":   previousUserID,
			"timeout_minutes": job.TimeoutMinutes,
			"round_robin_id":  job.RoundRobinID,
			"job_id":          job.ID,
		}); err != nil {
			return err
		}
		if err := repo.insertNotification(ctx, tx, job.OrganizationID, previousUserID, job.LeadID, "Lead redistribuido", fmt.Sprintf("%s foi redistribuido apos %d minuto(s) sem atendimento.", job.LeadName, job.TimeoutMinutes), "lead_redistributed_away", map[string]any{
			"lead_name":       job.LeadName,
			"new_user":        selection.UserID,
			"timeout_minutes": job.TimeoutMinutes,
			"round_robin_id":  job.RoundRobinID,
			"job_id":          job.ID,
		}); err != nil {
			return err
		}

		if err := repo.insertActivity(ctx, tx, job.OrganizationID, job.LeadID, "", "lead_auto_redistributed", fmt.Sprintf(`Lead "%s" redistribuido automaticamente`, job.LeadName), map[string]any{
			"from_user_id":    previousUserID,
			"to_user_id":      selection.UserID,
			"round_robin_id":  job.RoundRobinID,
			"timeout_minutes": job.TimeoutMinutes,
			"attempt_count":   nextAttemptCount,
			"max_attempts":    job.MaxAttempts,
		}); err != nil {
			return err
		}
	}

	return nil
}

func (repo Repository) listWarningRedistributionJobs(ctx context.Context, tx pgx.Tx) ([]redistributionJob, error) {
	rows, err := tx.Query(ctx, `
		select
			j.id::text,
			j.organization_id::text,
			j.lead_id::text,
			j.round_robin_id::text,
			coalesce(j.current_assigned_user_id::text, ''),
			j.attempt_count,
			j.max_attempts,
			j.timeout_minutes,
			j.warning_minutes,
			j.enrolled_at,
			coalesce(nullif(l.name, ''), 'Lead')
		from public.lead_redistribution_jobs j
		join public.leads l
		  on l.organization_id = j.organization_id
		 and l.id = j.lead_id
		where j.status = 'pending'
		  and j.warning_due_at is not null
		  and j.warning_due_at <= now()
		  and j.due_at > now()
		  and j.warning_sent_at is null
		order by j.warning_due_at asc
		limit $1
		for update of j skip locked
	`, leadRedistributionBatchLimit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return scanRedistributionJobs(rows)
}

func (repo Repository) listDueRedistributionJobs(ctx context.Context, tx pgx.Tx) ([]redistributionJob, error) {
	rows, err := tx.Query(ctx, `
		select
			j.id::text,
			j.organization_id::text,
			j.lead_id::text,
			j.round_robin_id::text,
			coalesce(j.current_assigned_user_id::text, ''),
			j.attempt_count,
			j.max_attempts,
			j.timeout_minutes,
			j.warning_minutes,
			j.enrolled_at,
			coalesce(nullif(l.name, ''), 'Lead')
		from public.lead_redistribution_jobs j
		join public.leads l
		  on l.organization_id = j.organization_id
		 and l.id = j.lead_id
		where j.status in ('pending', 'warning_sent')
		  and j.due_at <= now()
		order by j.due_at asc
		limit $1
		for update of j skip locked
	`, leadRedistributionBatchLimit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return scanRedistributionJobs(rows)
}

func scanRedistributionJobs(rows pgx.Rows) ([]redistributionJob, error) {
	jobs := []redistributionJob{}
	for rows.Next() {
		var job redistributionJob
		if err := rows.Scan(
			&job.ID,
			&job.OrganizationID,
			&job.LeadID,
			&job.RoundRobinID,
			&job.CurrentAssignedUserID,
			&job.AttemptCount,
			&job.MaxAttempts,
			&job.TimeoutMinutes,
			&job.WarningMinutes,
			&job.EnrolledAt,
			&job.LeadName,
		); err != nil {
			return nil, err
		}
		jobs = append(jobs, job)
	}
	return jobs, rows.Err()
}

func (repo Repository) redistributionStopReason(ctx context.Context, tx pgx.Tx, job redistributionJob, current leadSnapshot) (string, error) {
	if job.CurrentAssignedUserID == "" {
		return "unassigned", nil
	}
	if current.AssignedUserID != job.CurrentAssignedUserID {
		return "assignee_changed", nil
	}
	if current.DealStatus != "" && current.DealStatus != "open" {
		return "deal_closed", nil
	}

	var hasHumanAction bool
	err := tx.QueryRow(ctx, `
		select exists (
			select 1
			from public.leads l
			where l.organization_id = $1::uuid
			  and l.id = $2::uuid
			  and l.first_response_at is not null
			  and l.first_response_at >= $3::timestamptz
			  and coalesce(l.first_response_is_automation, false) = false
		) or exists (
			select 1
			from public.activities a
			where a.organization_id = $1::uuid
			  and a.lead_id = $2::uuid
			  and a.created_at >= $3::timestamptz
			  and a.user_id is not null
			  and a.type in (
			    'stage_change',
			    'call',
			    'message',
			    'task_completed',
			    'lead_updated',
			    'feedback',
			    'tag_added',
			    'tag_removed'
			  )
		) or exists (
			select 1
			from public.lead_timeline_events lte
			where lte.organization_id = $1::uuid
			  and lte.lead_id = $2::uuid
			  and lte.created_at >= $3::timestamptz
			  and coalesce(lte.actor_user_id, lte.user_id) is not null
			  and lte.event_type in (
			    'whatsapp_message_sent',
			    'call_initiated',
			    'stage_changed',
			    'stage_change'
			  )
		)
	`, job.OrganizationID, job.LeadID, job.EnrolledAt).Scan(&hasHumanAction)
	if err != nil {
		return "", err
	}
	if hasHumanAction {
		return "human_action", nil
	}

	return "", nil
}

func (repo Repository) selectRoundRobinMemberForRedistribution(ctx context.Context, tx pgx.Tx, organizationID string, roundRobinID string, excludedUserID string) (roundRobinSelection, string, error) {
	var selection roundRobinSelection
	selection.RoundRobinID = roundRobinID

	err := tx.QueryRow(ctx, `
		select rrm.id::text, rrm.user_id::text
		from public.round_robin_members rrm
		join public.organization_members om
		  on om.organization_id = rrm.organization_id
		 and om.user_id = rrm.user_id
		 and coalesce(om.is_active, true) = true
		join public.users u
		  on u.id = rrm.user_id
		 and coalesce(u.is_active, true) = true
		left join lateral (
			select count(*)::bigint as total
			from public.round_robin_logs rrl
			where rrl.organization_id = rrm.organization_id
			  and rrl.round_robin_id = rrm.round_robin_id
			  and rrl.assigned_user_id = rrm.user_id
		) logs on true
		where rrm.organization_id = $1::uuid
		  and rrm.round_robin_id = $2::uuid
		  and coalesce(rrm.is_active, true) = true
		  and (nullif($3, '')::uuid is null or rrm.user_id <> nullif($3, '')::uuid)
		order by coalesce(logs.total, 0) asc, coalesce(rrm.position, 0) asc, rrm.created_at asc
		limit 1
	`, organizationID, roundRobinID, excludedUserID).Scan(&selection.MemberID, &selection.UserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return roundRobinSelection{}, "no_next_member", nil
	}
	if err != nil {
		return roundRobinSelection{}, "", err
	}

	return selection, "", nil
}

func (repo Repository) insertAutoRedistributionLog(ctx context.Context, tx pgx.Tx, job redistributionJob, selection roundRobinSelection, previousUserID string) error {
	_, err := tx.Exec(ctx, `
		insert into public.round_robin_logs (
			organization_id,
			round_robin_id,
			lead_id,
			assigned_user_id,
			reason,
			metadata
		)
		values (
			$1::uuid,
			$2::uuid,
			$3::uuid,
			$4::uuid,
			'auto_redistribution',
			$5::jsonb
		)
	`, job.OrganizationID, job.RoundRobinID, job.LeadID, selection.UserID, jsonb(map[string]any{
		"job_id":           job.ID,
		"previous_user_id": previousUserID,
		"member_id":        selection.MemberID,
		"attempt_count":    job.AttemptCount + 1,
		"timeout_minutes":  job.TimeoutMinutes,
	}))
	if err != nil {
		return err
	}

	_, err = tx.Exec(ctx, `
		update public.round_robins
		set current_position = coalesce(current_position, 0) + 1,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, job.OrganizationID, job.RoundRobinID)
	return err
}

func (repo Repository) updateRedistributionJobAfterTransfer(ctx context.Context, tx pgx.Tx, job redistributionJob, nextUserID string, attemptCount int, status string) error {
	if status == "max_attempts_reached" {
		_, err := tx.Exec(ctx, `
			update public.lead_redistribution_jobs
			set current_assigned_user_id = $2::uuid,
			    attempt_count = $3,
			    status = 'max_attempts_reached',
			    last_redistributed_at = now(),
			    stopped_at = now(),
			    stopped_reason = 'max_attempts_reached',
			    warning_sent_at = null,
			    updated_at = now()
			where id = $1::uuid
		`, job.ID, nextUserID, attemptCount)
		return err
	}

	_, err := tx.Exec(ctx, `
		update public.lead_redistribution_jobs
		set current_assigned_user_id = $2::uuid,
		    attempt_count = $3,
		    status = 'pending',
		    due_at = now() + ($4 * interval '1 minute'),
		    warning_due_at = case
		    	when $5 > 0 and $5 < $4 then now() + (($4 - $5) * interval '1 minute')
		    	else null
		    end,
		    warning_sent_at = null,
		    last_redistributed_at = now(),
		    updated_at = now()
		where id = $1::uuid
	`, job.ID, nextUserID, attemptCount, job.TimeoutMinutes, job.WarningMinutes)
	return err
}

func (repo Repository) stopRedistributionJob(ctx context.Context, tx pgx.Tx, jobID string, reason string) error {
	return repo.finishRedistributionJob(ctx, tx, jobID, "stopped", reason)
}

func (repo Repository) finishRedistributionJob(ctx context.Context, tx pgx.Tx, jobID string, status string, reason string) error {
	_, err := tx.Exec(ctx, `
		update public.lead_redistribution_jobs
		set status = $2,
		    stopped_reason = $3,
		    stopped_at = now(),
		    updated_at = now()
		where id = $1::uuid
	`, jobID, status, reason)
	return err
}
