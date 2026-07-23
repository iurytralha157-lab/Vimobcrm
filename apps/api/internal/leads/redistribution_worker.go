package leads

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const (
	leadRedistributionWorkerInterval = 30 * time.Second
	leadRedistributionBatchLimit     = 50
	leadRedistributionLockKey        = int64(860421704)
	leadRedistributionNoMemberDelay  = 24 * time.Hour
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

		locked, err := repo.lockWarningRedistributionJob(ctx, tx, job.ID)
		if err != nil {
			return err
		}
		if !locked {
			continue
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
			"attempt_count":   job.AttemptCount,
			"dedupe_key":      redistributionWarningDedupeKey(job),
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

func redistributionWarningDedupeKey(job redistributionJob) string {
	return notificationDedupeKey(
		"lead_redistribution_warning",
		job.ID,
		job.CurrentAssignedUserID,
		fmt.Sprintf("attempt_%d", job.AttemptCount),
	)
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

		locked, err := repo.lockDueRedistributionJob(ctx, tx, job.ID)
		if err != nil {
			return err
		}
		if !locked {
			continue
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

		selection, reason, err := repo.selectRoundRobinMemberForRedistribution(ctx, tx, job.OrganizationID, job.RoundRobinID, current.AssignedUserID, current.TeamID)
		if err != nil {
			return err
		}
		if reason != "" || selection.UserID == "" {
			nextCheckAt, hasAlternative, availabilityErr := repo.nextRoundRobinMemberAvailability(
				ctx,
				tx,
				job.OrganizationID,
				job.RoundRobinID,
				current.AssignedUserID,
				current.TeamID,
			)
			if availabilityErr != nil {
				return availabilityErr
			}
			if hasAlternative {
				if err := repo.deferRedistributionJobUntil(ctx, tx, job.ID, nextCheckAt); err != nil {
					return err
				}
				continue
			}
			if err := repo.finishRedistributionJob(ctx, tx, job.ID, "no_next_member", "no_next_member"); err != nil {
				return err
			}
			continue
		}

		previousUserID := current.AssignedUserID
		systemTenant := tenant.Context{OrganizationID: job.OrganizationID}
		if err := repo.validateRoundRobinAssigneeTeam(ctx, tx, job.OrganizationID, current.TeamID, &selection.UserID); err != nil {
			return err
		}
		reason, err = repo.redistributionStopReason(ctx, tx, job, current)
		if err != nil {
			return err
		}
		if reason != "" {
			if err := repo.stopRedistributionJob(ctx, tx, job.ID, reason); err != nil {
				return err
			}
			continue
		}
		if err := repo.transferLeadAssignee(ctx, tx, systemTenant, current, &selection.UserID, "auto_redistribution"); err != nil {
			return err
		}

		if err := repo.insertAutoRedistributionLog(ctx, tx, job, selection, previousUserID); err != nil {
			return err
		}

		nextAttemptCount := job.AttemptCount + 1
		finalStatus := "pending"
		if job.MaxAttempts > 0 && nextAttemptCount >= job.MaxAttempts {
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
			"attempt_count":   nextAttemptCount,
			"dedupe_key":      notificationDedupeKey("lead_redistributed_received", job.ID, selection.UserID, fmt.Sprint(nextAttemptCount)),
		}); err != nil {
			return err
		}
		if err := repo.insertNotification(ctx, tx, job.OrganizationID, previousUserID, job.LeadID, "Lead redistribuido", fmt.Sprintf("%s foi redistribuido apos %d minuto(s) sem atendimento.", job.LeadName, job.TimeoutMinutes), "lead_redistributed_away", map[string]any{
			"lead_name":       job.LeadName,
			"new_user":        selection.UserID,
			"timeout_minutes": job.TimeoutMinutes,
			"round_robin_id":  job.RoundRobinID,
			"job_id":          job.ID,
			"attempt_count":   nextAttemptCount,
			"dedupe_key":      notificationDedupeKey("lead_redistributed_away", job.ID, previousUserID, fmt.Sprint(nextAttemptCount)),
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
	`, leadRedistributionBatchLimit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return scanRedistributionJobs(rows)
}

// The worker and lead mutations use the same lock order: lead first, then its
// redistribution job. This prevents a stage-move transaction (lead -> job)
// from deadlocking with the worker while still revalidating the candidate
// under a row lock before any notification or transfer is performed.
func (repo Repository) lockWarningRedistributionJob(ctx context.Context, queryer leadTeamQueryer, jobID string) (bool, error) {
	var locked bool
	err := queryer.QueryRow(ctx, `
		select true
		from public.lead_redistribution_jobs
		where id = $1::uuid
		  and status = 'pending'
		  and warning_due_at is not null
		  and warning_due_at <= now()
		  and due_at > now()
		  and warning_sent_at is null
		for update
	`, jobID).Scan(&locked)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return locked, err
}

func (repo Repository) lockDueRedistributionJob(ctx context.Context, queryer leadTeamQueryer, jobID string) (bool, error) {
	var locked bool
	err := queryer.QueryRow(ctx, `
		select true
		from public.lead_redistribution_jobs
		where id = $1::uuid
		  and status in ('pending', 'warning_sent')
		  and due_at <= now()
		for update
	`, jobID).Scan(&locked)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return locked, err
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

	hasHumanAction, err := repo.redistributionHasHumanActivity(ctx, tx, job)
	if err != nil {
		return "", err
	}
	if hasHumanAction {
		return "human_action", nil
	}

	return "", nil
}

func (repo Repository) redistributionHasHumanActivity(ctx context.Context, queryer leadTeamQueryer, job redistributionJob) (bool, error) {
	var hasHumanAction bool
	err := queryer.QueryRow(ctx, `
		with target_lead as (
			select
				l.id,
				l.organization_id,
				l.first_response_at,
				l.first_response_is_automation,
				l.last_contact_at
			from public.leads l
			where l.organization_id = $1::uuid and l.id = $2::uuid
			limit 1
		)
		select exists (
			select 1
			from public.lead_action_facts f
			join target_lead l
			  on l.organization_id = f.organization_id
			 and l.id = f.lead_id
			where f.occurred_at >= $3::timestamptz
			  and f.is_automated = false
			  and (
			    f.is_inbound = true
			    or f.actor_user_id is not null
			    or f.qualifies_first_outreach = true
			    or f.qualifies_stage_inactivity = true
			    or f.is_effective_contact = true
			  )
		) or exists (
			select 1
			from target_lead l
			where (
				l.first_response_at is not null
				and l.first_response_at >= $3::timestamptz
				and coalesce(l.first_response_is_automation, false) = false
			) or (
				l.last_contact_at is not null
				and l.last_contact_at >= $3::timestamptz
				and coalesce(l.first_response_is_automation, false) = false
			)
		) or exists (
			select 1
			from public.activities a
			join target_lead l
			  on l.organization_id = a.organization_id
			 and l.id = a.lead_id
			where a.created_at >= $3::timestamptz
			  and a.user_id is not null
			  and not (
			    lower(coalesce(a.metadata->>'is_automation', a.metadata->>'is_automated', a.metadata->>'automated', 'false')) in ('true', '1', 'yes')
			    or lower(btrim(coalesce(a.metadata->>'origin', ''))) in ('ai', 'openai', 'automation', 'bot', 'ai_autoreply', 'ai_followup')
			    or lower(btrim(coalesce(a.metadata->>'origin', ''))) ~ '^(ai|automation)[_.]'
			    or lower(coalesce(a.metadata->>'sender_type', '')) in ('ai', 'automation', 'bot')
			  )
		) or exists (
			select 1
			from public.lead_timeline_events lte
			join target_lead l
			  on l.organization_id = lte.organization_id
			 and l.id = lte.lead_id
			where lte.created_at >= $3::timestamptz
			  and coalesce(lte.actor_user_id, lte.user_id) is not null
			  and not (
			    lower(coalesce(lte.metadata->>'is_automation', lte.metadata->>'is_automated', lte.metadata->>'automated', 'false')) in ('true', '1', 'yes')
			    or lower(btrim(coalesce(lte.metadata->>'origin', ''))) in ('ai', 'openai', 'automation', 'bot', 'ai_autoreply', 'ai_followup')
			    or lower(btrim(coalesce(lte.metadata->>'origin', ''))) ~ '^(ai|automation)[_.]'
			    or lower(coalesce(lte.metadata->>'sender_type', '')) in ('ai', 'automation', 'bot')
			  )
		) or exists (
			select 1
			from public.whatsapp_messages wm
			join target_lead l
			  on l.organization_id = wm.organization_id
			 and l.id = wm.lead_id
			where coalesce(wm.sent_at, wm.received_at, wm.created_at) >= $3::timestamptz
			  and (
			    (
			      coalesce(wm.from_me, false) = false
			      and lower(coalesce(wm.direction, 'inbound')) <> 'outbound'
			    )
			    or (
			      (coalesce(wm.from_me, false) = true or lower(coalesce(wm.direction, '')) = 'outbound')
			      and wm.sender_user_id is not null
			      and not (
			        lower(coalesce(wm.metadata->>'is_automation', wm.metadata->>'is_automated', wm.metadata->>'automated', 'false')) in ('true', '1', 'yes')
			        or lower(btrim(coalesce(wm.metadata->>'origin', ''))) in ('ai', 'openai', 'automation', 'bot', 'ai_autoreply', 'ai_followup')
			        or lower(btrim(coalesce(wm.metadata->>'origin', ''))) ~ '^(ai|automation)[_.]'
			        or lower(coalesce(wm.metadata->>'sender_type', '')) in ('ai', 'automation', 'bot')
			        or lower(coalesce(wm.client_message_id, '')) like 'ai-%'
			      )
			    )
			  )
		) or exists (
			select 1
			from public.lead_tasks lt
			join target_lead l
			  on l.organization_id = lt.organization_id
			 and l.id = lt.lead_id
			where (
				lt.created_by is not null
				and lt.created_at >= $3::timestamptz
			) or (
				lt.done_by is not null
				and coalesce(lt.completed_at, lt.done_at) >= $3::timestamptz
			)
		) or exists (
			select 1
			from public.schedule_events se
			join target_lead l
			  on l.organization_id = se.organization_id
			 and l.id = se.lead_id
			where se.status not in ('cancelled', 'canceled')
			  and (
			    se.created_at >= $3::timestamptz
			    or se.completed_at >= $3::timestamptz
			  )
		) or exists (
			select 1
			from public.audit_logs al
			join target_lead l
			  on l.organization_id = al.organization_id
			 and l.id::text = al.entity_id
			where al.entity_type = 'lead'
			  and al.user_id is not null
			  and al.created_at >= $3::timestamptz
		)
	`, job.OrganizationID, job.LeadID, job.EnrolledAt).Scan(&hasHumanAction)
	if err != nil {
		return false, err
	}
	return hasHumanAction, nil
}

func (repo Repository) selectRoundRobinMemberForRedistribution(ctx context.Context, tx pgx.Tx, organizationID string, roundRobinID string, excludedUserID string, requiredTeamID string) (roundRobinSelection, string, error) {
	var selection roundRobinSelection
	selection.RoundRobinID = roundRobinID

	err := tx.QueryRow(ctx, `
		with entries as (
			select
				rrm.id,
				rrm.round_robin_id,
				rrm.organization_id,
				rrm.user_id,
				rrm.team_id,
				coalesce(rrm.position, 0) as position,
				rrm.created_at,
				coalesce(entry_logs.total, 0) as entry_total
			from public.round_robin_members rrm
			join public.round_robins rr
			  on rr.id = rrm.round_robin_id
			 and rr.organization_id = rrm.organization_id
			left join lateral (
				select count(*)::bigint as total
				from public.round_robin_logs rrl
				where rrl.organization_id = rrm.organization_id
				  and rrl.round_robin_id = rrm.round_robin_id
				  and (
				    rrl.metadata->>'member_id' = rrm.id::text
				    or (rrm.user_id is not null and rrl.assigned_user_id = rrm.user_id)
				  )
			) entry_logs on true
			where rrm.organization_id = $1::uuid
			  and rrm.round_robin_id = $2::uuid
			  and coalesce(rrm.is_active, true) = true
		),
		candidates as (
			select
				entries.id,
				entries.round_robin_id,
				entries.organization_id,
				entries.user_id,
				entries.position,
				entries.created_at,
				entries.entry_total,
				tm.id as team_member_id,
				tm.created_at as team_member_created_at
			from entries
			left join public.team_members tm
			  on tm.organization_id = entries.organization_id
			 and tm.team_id = entries.team_id
			 and tm.user_id = entries.user_id
			 and coalesce(tm.is_active, true) = true
			where entries.user_id is not null

			union all

			select
				entries.id,
				entries.round_robin_id,
				entries.organization_id,
				tm.user_id,
				entries.position,
				entries.created_at,
				entries.entry_total,
				tm.id as team_member_id,
				tm.created_at as team_member_created_at
			from entries
			join public.teams t
			  on t.id = entries.team_id
			 and t.organization_id = entries.organization_id
			 and coalesce(t.is_active, true) = true
			join public.team_members tm
			  on tm.organization_id = entries.organization_id
			 and tm.team_id = entries.team_id
			 and coalesce(tm.is_active, true) = true
			where entries.user_id is null
			  and entries.team_id is not null
		)
		select candidates.id::text, candidates.user_id::text
		from candidates
		join public.organization_members om
		  on om.organization_id = candidates.organization_id
		 and om.user_id = candidates.user_id
		 and coalesce(om.is_active, true) = true
		join public.users u
		  on u.id = candidates.user_id
		 and coalesce(u.is_active, true) = true
		left join lateral (
			select count(*)::bigint as total
			from public.round_robin_logs rrl
			where rrl.organization_id = candidates.organization_id
			  and rrl.round_robin_id = candidates.round_robin_id
			  and rrl.assigned_user_id = candidates.user_id
		) user_logs on true
		where (nullif($3, '')::uuid is null or candidates.user_id <> nullif($3, '')::uuid)
		  and (
		    nullif($4, '')::uuid is null
		    or exists (
		      select 1
		      from public.team_members required_member
		      where required_member.organization_id = candidates.organization_id
		        and required_member.team_id = nullif($4, '')::uuid
		        and required_member.user_id = candidates.user_id
		        and coalesce(required_member.is_active, true) = true
		    )
		  )
		  and (
		    candidates.team_member_id is null
		    or not exists (
		      select 1
		      from public.member_availability ma_any
		      where ma_any.organization_id = candidates.organization_id
		        and ma_any.team_member_id = candidates.team_member_id
		    )
		    or exists (
		      select 1
		      from public.member_availability ma
		      where ma.organization_id = candidates.organization_id
		        and ma.team_member_id = candidates.team_member_id
		        and ma.day_of_week = extract(dow from now() at time zone 'America/Sao_Paulo')::int
		        and coalesce(ma.is_active, true) = true
		        and (
		          coalesce(ma.is_all_day, false) = true
		          or (
		            ma.start_time is not null
		            and ma.end_time is not null
		            and (
		              (ma.start_time <= ma.end_time and (now() at time zone 'America/Sao_Paulo')::time >= ma.start_time and (now() at time zone 'America/Sao_Paulo')::time <= ma.end_time)
		              or (ma.start_time > ma.end_time and ((now() at time zone 'America/Sao_Paulo')::time >= ma.start_time or (now() at time zone 'America/Sao_Paulo')::time <= ma.end_time))
		            )
		          )
		        )
		    )
		  )
		order by candidates.entry_total asc, candidates.position asc, candidates.created_at asc, coalesce(user_logs.total, 0) asc, candidates.team_member_created_at asc nulls last, candidates.user_id asc
		limit 1
	`, organizationID, roundRobinID, excludedUserID, requiredTeamID).Scan(&selection.MemberID, &selection.UserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return roundRobinSelection{}, "no_next_member", nil
	}
	if err != nil {
		return roundRobinSelection{}, "", err
	}

	return selection, "", nil
}

func (repo Repository) nextRoundRobinMemberAvailability(
	ctx context.Context,
	queryer leadTeamQueryer,
	organizationID string,
	roundRobinID string,
	excludedUserID string,
	requiredTeamID string,
) (time.Time, bool, error) {
	var hasAlternative bool
	var nextAvailability pgtype.Timestamptz

	err := queryer.QueryRow(ctx, `
		with entries as (
			select
				rrm.id,
				rrm.round_robin_id,
				rrm.organization_id,
				rrm.user_id,
				rrm.team_id,
				rrm.created_at
			from public.round_robin_members rrm
			join public.round_robins rr
			  on rr.id = rrm.round_robin_id
			 and rr.organization_id = rrm.organization_id
			where rrm.organization_id = $1::uuid
			  and rrm.round_robin_id = $2::uuid
			  and coalesce(rrm.is_active, true) = true
			  and coalesce(rr.is_active, true) = true
		),
		candidates as (
			select
				entries.organization_id,
				entries.user_id,
				tm.id as team_member_id
			from entries
			left join public.team_members tm
			  on tm.organization_id = entries.organization_id
			 and tm.team_id = entries.team_id
			 and tm.user_id = entries.user_id
			 and coalesce(tm.is_active, true) = true
			where entries.user_id is not null

			union all

			select
				entries.organization_id,
				tm.user_id,
				tm.id as team_member_id
			from entries
			join public.teams t
			  on t.id = entries.team_id
			 and t.organization_id = entries.organization_id
			 and coalesce(t.is_active, true) = true
			join public.team_members tm
			  on tm.organization_id = entries.organization_id
			 and tm.team_id = entries.team_id
			 and coalesce(tm.is_active, true) = true
			where entries.user_id is null
			  and entries.team_id is not null
		),
		eligible as (
			select distinct
				candidates.organization_id,
				candidates.user_id,
				candidates.team_member_id
			from candidates
			join public.organization_members om
			  on om.organization_id = candidates.organization_id
			 and om.user_id = candidates.user_id
			 and coalesce(om.is_active, true) = true
			join public.users u
			  on u.id = candidates.user_id
			 and coalesce(u.is_active, true) = true
			where (nullif($3, '')::uuid is null or candidates.user_id <> nullif($3, '')::uuid)
			  and (
			    nullif($4, '')::uuid is null
			    or exists (
			      select 1
			      from public.team_members required_member
			      where required_member.organization_id = candidates.organization_id
			        and required_member.team_id = nullif($4, '')::uuid
			        and required_member.user_id = candidates.user_id
			        and coalesce(required_member.is_active, true) = true
			    )
			  )
		),
		clock as (
			select now() at time zone 'America/Sao_Paulo' as local_now
		),
		next_windows as (
			select
				(
					(
						(clock.local_now::date + offsets.day_offset)::date
						+ case
						    when coalesce(ma.is_all_day, false) then time '00:00'
						    else ma.start_time
						  end
					) at time zone 'America/Sao_Paulo'
				) as starts_at
			from eligible
			join public.member_availability ma
			  on ma.organization_id = eligible.organization_id
			 and ma.team_member_id = eligible.team_member_id
			 and coalesce(ma.is_active, true) = true
			cross join clock
			cross join generate_series(0, 7) as offsets(day_offset)
			where extract(dow from (clock.local_now::date + offsets.day_offset)::date)::int = ma.day_of_week
			  and (coalesce(ma.is_all_day, false) = true or ma.start_time is not null)
		)
		select
			exists (select 1 from eligible),
			(
				select min(next_windows.starts_at)
				from next_windows
				where next_windows.starts_at > now()
			)
	`, organizationID, roundRobinID, excludedUserID, requiredTeamID).Scan(&hasAlternative, &nextAvailability)
	if err != nil {
		return time.Time{}, false, err
	}

	if !hasAlternative {
		return time.Time{}, false, nil
	}

	now := time.Now().UTC()
	if nextAvailability.Valid && nextAvailability.Time.After(now) {
		return nextAvailability.Time, true, nil
	}
	return now.Add(leadRedistributionNoMemberDelay), true, nil
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

	if _, err := tx.Exec(ctx, `
		update public.leads
		set redistribution_count = coalesce(redistribution_count, 0) + 1,
		    updated_at = now()
		where organization_id = $1::uuid and id = $2::uuid
	`, job.OrganizationID, job.LeadID); err != nil {
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
			    metadata = metadata - 'waiting_for_available_member' - 'next_candidate_check_at',
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
		    due_at = now() + ($4::integer * interval '1 minute'),
		    warning_due_at = case
		      when $5::integer > 0 and $5::integer < $4::integer
		        then now() + (($4::integer - $5::integer) * interval '1 minute')
		      else null
		    end,
		    warning_sent_at = null,
		    last_redistributed_at = now(),
		    metadata = metadata - 'waiting_for_available_member' - 'next_candidate_check_at',
		    updated_at = now()
		where id = $1::uuid
	`, job.ID, nextUserID, attemptCount, job.TimeoutMinutes, job.WarningMinutes)
	return err
}

func (repo Repository) deferRedistributionJobUntil(ctx context.Context, tx pgx.Tx, jobID string, nextCheckAt time.Time) error {
	_, err := tx.Exec(ctx, `
		update public.lead_redistribution_jobs
		set due_at = $2,
		    warning_due_at = null,
		    metadata = metadata || jsonb_build_object(
		      'waiting_for_available_member', true,
		      'next_candidate_check_at', $2::timestamptz
		    ),
		    updated_at = now()
		where id = $1::uuid
		  and status in ('pending', 'warning_sent')
	`, jobID, nextCheckAt)
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
