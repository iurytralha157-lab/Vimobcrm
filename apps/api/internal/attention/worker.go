package attention

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	workerInterval      = 30 * time.Second
	workerBatchLimit    = 50
	reconcileBatchLimit = 500
	attentionWorkerLock = int64(860421707)
)

type candidateInstance struct {
	OrganizationID    string          `json:"organizationId"`
	LeadID            string          `json:"leadId"`
	PolicyID          string          `json:"policyId"`
	PolicyKey         string          `json:"policyKey"`
	PolicyVersion     int             `json:"policyVersion"`
	PolicyType        string          `json:"policyType"`
	PolicyStatus      string          `json:"policyStatus"`
	CycleKey          string          `json:"cycleKey"`
	AssignmentCycleID *string         `json:"assignmentCycleId"`
	StageCycleID      *string         `json:"stageCycleId"`
	AssignedUserID    *string         `json:"assignedUserId"`
	PipelineID        *string         `json:"pipelineId"`
	StageID           *string         `json:"stageId"`
	BaselineAt        time.Time       `json:"baselineAt"`
	LastActionAt      *time.Time      `json:"lastActionAt"`
	ThresholdMinutes  int             `json:"thresholdMinutes"`
	WarningMinutes    int             `json:"warningMinutes"`
	BusinessOnly      bool            `json:"businessOnly"`
	EngineMode        string          `json:"engineMode"`
	Timezone          string          `json:"timezone"`
	BusinessHours     json.RawMessage `json:"businessHours"`
}

type workerInstance struct {
	ID                            string          `json:"id"`
	OrganizationID                string          `json:"organizationId"`
	LeadID                        string          `json:"leadId"`
	LeadName                      string          `json:"leadName"`
	LeadDealStatus                string          `json:"leadDealStatus"`
	LeadAssignedUserID            *string         `json:"leadAssignedUserId"`
	PolicyID                      string          `json:"policyId"`
	PolicyName                    string          `json:"policyName"`
	PolicyType                    string          `json:"policyType"`
	PolicyStatus                  string          `json:"policyStatus"`
	PolicyVersion                 int             `json:"policyVersion"`
	PolicyConfig                  map[string]any  `json:"policyConfig"`
	ThresholdMinutes              int             `json:"thresholdMinutes"`
	WarningMinutes                int             `json:"warningMinutes"`
	RepeatMinutes                 *int            `json:"repeatMinutes"`
	EscalationMinutes             *int            `json:"escalationMinutes"`
	RedistributionMinutes         *int            `json:"redistributionMinutes"`
	BusinessHoursOnly             bool            `json:"businessHoursOnly"`
	RedistributeBeforeContactOnly bool            `json:"redistributeBeforeContactOnly"`
	NotifyAssignee                bool            `json:"notifyAssignee"`
	NotifyLeaders                 bool            `json:"notifyLeaders"`
	NotifyAdmins                  bool            `json:"notifyAdmins"`
	CycleKey                      string          `json:"cycleKey"`
	AssignmentCycleID             *string         `json:"assignmentCycleId"`
	StageCycleID                  *string         `json:"stageCycleId"`
	AssignedUserID                *string         `json:"assignedUserId"`
	PipelineID                    *string         `json:"pipelineId"`
	StageID                       *string         `json:"stageId"`
	BaselineAt                    time.Time       `json:"baselineAt"`
	LastQualifyingActionAt        *time.Time      `json:"lastQualifyingActionAt"`
	LatestQualifyingActionAt      *time.Time      `json:"latestQualifyingActionAt"`
	WarningAt                     *time.Time      `json:"warningAt"`
	DueAt                         time.Time       `json:"dueAt"`
	Status                        string          `json:"status"`
	Shadow                        bool            `json:"shadow"`
	WarningSentAt                 *time.Time      `json:"warningSentAt"`
	BreachSentAt                  *time.Time      `json:"breachSentAt"`
	LastReminderAt                *time.Time      `json:"lastReminderAt"`
	ReminderCount                 int             `json:"reminderCount"`
	SnoozedUntil                  *time.Time      `json:"snoozedUntil"`
	RedistributedAt               *time.Time      `json:"redistributedAt"`
	RedistributionAttempts        int             `json:"redistributionAttempts"`
	Metadata                      map[string]any  `json:"metadata"`
	FirstHumanOutreachAt          *time.Time      `json:"firstHumanOutreachAt"`
	EngineMode                    string          `json:"engineMode"`
	NotificationsEnabled          bool            `json:"notificationsEnabled"`
	RedistributionEnabled         bool            `json:"redistributionEnabled"`
	Timezone                      string          `json:"timezone"`
	BusinessHours                 json.RawMessage `json:"businessHours"`
	DefaultRepeatMinutes          int             `json:"defaultRepeatMinutes"`
	MaxReminders                  int             `json:"maxReminders"`
}

func (repo Repository) StartWorker(ctx context.Context, logger *slog.Logger) {
	if logger == nil {
		logger = slog.Default()
	}
	go func() {
		timer := time.NewTimer(10 * time.Second)
		defer timer.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
				if err := repo.Process(ctx); err != nil && !errors.Is(err, context.Canceled) {
					logger.Error("lead attention worker failed", "error", err)
				}
				timer.Reset(workerInterval)
			}
		}
	}()
}

func (repo Repository) Process(ctx context.Context) error {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var locked bool
	if err := tx.QueryRow(ctx, `select pg_try_advisory_xact_lock($1)`, attentionWorkerLock).Scan(&locked); err != nil {
		return err
	}
	if !locked {
		return nil
	}
	if err := repo.resolveSatisfiedInstances(ctx, tx); err != nil {
		return err
	}
	if err := repo.reconcileInstances(ctx, tx); err != nil {
		return err
	}
	instances, err := repo.claimDueInstances(ctx, tx)
	if err != nil {
		return err
	}

	var firstErr error
	for _, instance := range instances {
		savepoint, err := tx.Begin(ctx)
		if err != nil {
			return err
		}
		if err := repo.processInstance(ctx, savepoint, instance); err != nil {
			_ = savepoint.Rollback(ctx)
			if firstErr == nil {
				firstErr = err
			}
			if markErr := repo.markInstanceError(ctx, tx, instance.ID, err); markErr != nil {
				return markErr
			}
			continue
		}
		if err := savepoint.Commit(ctx); err != nil {
			return err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	return firstErr
}

func (repo Repository) reconcileInstances(ctx context.Context, tx pgx.Tx) error {
	rows, err := tx.Query(ctx, `
		with current_policies as (
			select
				p.*,
				coalesce(os.engine_mode, 'shadow') as engine_mode,
				coalesce(os.timezone, 'America/Sao_Paulo') as timezone,
				coalesce(os.business_hours, '{"days":[1,2,3,4,5],"start":"08:00","end":"18:00"}'::jsonb) as business_hours
			from public.lead_attention_policies p
			left join public.organization_attention_settings os on os.organization_id = p.organization_id
			where p.status in ('shadow', 'enabled')
			  and coalesce(os.engine_mode, 'shadow') <> 'disabled'
		), candidates as (
			select
				p.organization_id, l.id as lead_id, p.id as policy_id, p.policy_key, p.version,
				p.policy_type, p.status as policy_status,
				'unassigned:' || coalesce(last_cycle.id::text, l.attention_enrolled_at::text) as cycle_key,
				null::uuid as assignment_cycle_id, null::uuid as stage_cycle_id,
				null::uuid as assigned_user_id, l.pipeline_id, l.stage_id,
				coalesce(last_cycle.ended_at, l.attention_enrolled_at) as baseline_at,
				null::timestamptz as last_action_at,
				p.threshold_minutes, p.warning_minutes, p.business_hours_only,
				p.engine_mode, p.timezone, p.business_hours
			from current_policies p
			join public.leads l on l.organization_id = p.organization_id
			left join lateral (
				select ac.id, ac.ended_at
				from public.lead_assignment_cycles ac
				where ac.lead_id = l.id and ac.ended_reason = 'unassigned'
				order by ac.ended_at desc nulls last, ac.cycle_number desc
				limit 1
			) last_cycle on true
			where p.policy_type = 'unassigned'
			  and l.attention_eligible = true and l.attention_enrolled_at is not null
			  and l.deal_status = 'open' and l.assigned_user_id is null
			  and (p.pipeline_id is null or p.pipeline_id = l.pipeline_id)
			  and (p.stage_id is null or p.stage_id = l.stage_id)
			union all
			select
				p.organization_id, l.id, p.id, p.policy_key, p.version,
				p.policy_type, p.status,
				'assignment:' || ac.id::text,
				ac.id, null::uuid, ac.assigned_user_id, l.pipeline_id, l.stage_id,
				ac.assigned_at, null::timestamptz,
				p.threshold_minutes, p.warning_minutes, p.business_hours_only,
				p.engine_mode, p.timezone, p.business_hours
			from current_policies p
			join public.leads l on l.organization_id = p.organization_id
			join public.lead_assignment_cycles ac
			  on ac.organization_id = l.organization_id and ac.lead_id = l.id and ac.ended_at is null
			where p.policy_type = 'first_contact'
			  and l.attention_eligible = true and l.attention_enrolled_at is not null
			  and l.deal_status = 'open' and ac.first_human_outreach_at is null
			  and (p.pipeline_id is null or p.pipeline_id = l.pipeline_id)
			  and (p.stage_id is null or p.stage_id = l.stage_id)
			union all
			select
				p.organization_id, l.id, p.id, p.policy_key, p.version,
				p.policy_type, p.status,
				'stage:' || sc.id::text || ':' || p.policy_type,
				null::uuid, sc.id, l.assigned_user_id, sc.pipeline_id, sc.stage_id,
				case when p.policy_type = 'stage_inactivity' then coalesce(last_action.occurred_at, sc.entered_at) else sc.entered_at end,
				case when p.policy_type = 'stage_inactivity' then last_action.occurred_at else null end,
				p.threshold_minutes, p.warning_minutes, p.business_hours_only,
				p.engine_mode, p.timezone, p.business_hours
			from current_policies p
			join public.leads l on l.organization_id = p.organization_id
			join public.lead_stage_cycles sc
			  on sc.organization_id = l.organization_id and sc.lead_id = l.id and sc.exited_at is null
			left join lateral (
				select f.occurred_at
				from public.lead_action_facts f
				where f.stage_cycle_id = sc.id and f.qualifies_stage_inactivity = true
				order by f.occurred_at desc, f.id desc limit 1
			) last_action on true
			where p.policy_type in ('stage_inactivity', 'stage_age')
			  and l.attention_eligible = true and l.attention_enrolled_at is not null
			  and l.deal_status = 'open'
			  and (p.pipeline_id is null or p.pipeline_id = sc.pipeline_id)
			  and (p.stage_id is null or p.stage_id = sc.stage_id)
		)
		select jsonb_build_object(
			'organizationId', c.organization_id, 'leadId', c.lead_id,
			'policyId', c.policy_id, 'policyKey', c.policy_key,
			'policyVersion', c.version, 'policyType', c.policy_type, 'policyStatus', c.policy_status,
			'cycleKey', c.cycle_key, 'assignmentCycleId', c.assignment_cycle_id,
			'stageCycleId', c.stage_cycle_id, 'assignedUserId', c.assigned_user_id,
			'pipelineId', c.pipeline_id, 'stageId', c.stage_id,
			'baselineAt', c.baseline_at, 'lastActionAt', c.last_action_at,
			'thresholdMinutes', c.threshold_minutes, 'warningMinutes', c.warning_minutes,
			'businessOnly', c.business_hours_only, 'engineMode', c.engine_mode,
			'timezone', c.timezone, 'businessHours', c.business_hours
		)
		from candidates c
		where c.baseline_at is not null
		  and not exists (
			select 1
			from public.lead_attention_instances i
			join public.lead_attention_policies old_policy on old_policy.id = i.policy_id
			where i.lead_id = c.lead_id
			  and i.cycle_key = c.cycle_key
			  and old_policy.policy_key = c.policy_key
		  )
		order by c.baseline_at, c.lead_id
		limit $1
	`, reconcileBatchLimit)
	if err != nil {
		return err
	}
	defer rows.Close()

	candidates := []candidateInstance{}
	for rows.Next() {
		var payload []byte
		if err := rows.Scan(&payload); err != nil {
			return err
		}
		var candidate candidateInstance
		if err := json.Unmarshal(payload, &candidate); err != nil {
			return err
		}
		candidates = append(candidates, candidate)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	rows.Close()

	for _, candidate := range candidates {
		dueAt, err := AddPolicyMinutes(candidate.BaselineAt, candidate.ThresholdMinutes, candidate.BusinessOnly, candidate.Timezone, candidate.BusinessHours)
		if err != nil {
			return fmt.Errorf("calculate attention due_at: %w", err)
		}
		warningAt := dueAt
		if candidate.WarningMinutes > 0 {
			warningAt, err = AddPolicyMinutes(candidate.BaselineAt, candidate.ThresholdMinutes-candidate.WarningMinutes, candidate.BusinessOnly, candidate.Timezone, candidate.BusinessHours)
			if err != nil {
				return fmt.Errorf("calculate attention warning_at: %w", err)
			}
		}
		nextAt := dueAt
		if candidate.WarningMinutes > 0 {
			nextAt = warningAt
		}
		shadow := candidate.EngineMode != "enabled" || candidate.PolicyStatus != "enabled"
		metadata := map[string]any{
			"engine_mode_snapshot":   candidate.EngineMode,
			"policy_status_snapshot": candidate.PolicyStatus,
			"policy_key":             candidate.PolicyKey,
			"threshold_minutes":      candidate.ThresholdMinutes,
		}
		_, err = tx.Exec(ctx, `
			insert into public.lead_attention_instances (
				organization_id, lead_id, policy_id, policy_version, cycle_key,
				assignment_cycle_id, stage_cycle_id, assigned_user_id, pipeline_id, stage_id,
				baseline_at, last_qualifying_action_at, warning_at, due_at, next_evaluation_at,
				status, shadow, metadata
			) values (
				$1::uuid, $2::uuid, $3::uuid, $4, $5,
				$6::uuid, $7::uuid, $8::uuid, $9::uuid, $10::uuid,
				$11, $12, $13, $14, $15,
				'monitoring', $16, $17::jsonb
			)
			on conflict (policy_id, lead_id, cycle_key) do nothing
		`, candidate.OrganizationID, candidate.LeadID, candidate.PolicyID, candidate.PolicyVersion, candidate.CycleKey,
			nullableString(candidate.AssignmentCycleID), nullableString(candidate.StageCycleID), nullableString(candidate.AssignedUserID), nullableString(candidate.PipelineID), nullableString(candidate.StageID),
			candidate.BaselineAt, nullableTime(candidate.LastActionAt), warningAt, dueAt, nextAt,
			shadow, jsonValue(metadata),
		)
		if err != nil {
			return err
		}
	}
	return nil
}

func (repo Repository) resolveSatisfiedInstances(ctx context.Context, tx pgx.Tx) error {
	_, err := tx.Exec(ctx, `
		with resolved as (
			update public.lead_attention_instances i
			set status = case when not l.attention_eligible then 'cancelled' else 'resolved' end,
			    resolved_at = now(),
			    resolved_reason = case
			      when not l.attention_eligible then 'ineligible'
			      when l.deal_status in ('won', 'lost') then l.deal_status
			      when p.policy_type = 'unassigned' and l.assigned_user_id is not null then 'assigned'
			      when p.policy_type = 'first_contact' and exists (
			        select 1 from public.lead_assignment_cycles ac
			        where ac.id = i.assignment_cycle_id and ac.first_human_outreach_at is not null
			      ) then 'first_contact_completed'
			      when i.assignment_cycle_id is not null and exists (
			        select 1 from public.lead_assignment_cycles ac
			        where ac.id = i.assignment_cycle_id and ac.ended_at is not null
			      ) then coalesce((
			        select ac.ended_reason from public.lead_assignment_cycles ac where ac.id = i.assignment_cycle_id
			      ), 'assignment_cycle_ended')
			      when i.stage_cycle_id is not null and exists (
			        select 1 from public.lead_stage_cycles sc
			        where sc.id = i.stage_cycle_id and sc.exited_at is not null
			      ) then coalesce((
			        select sc.exited_reason from public.lead_stage_cycles sc where sc.id = i.stage_cycle_id
			      ), 'stage_cycle_ended')
			      else 'cycle_satisfied'
			    end,
			    next_evaluation_at = now(), updated_at = now()
			from public.leads l, public.lead_attention_policies p
			where l.id = i.lead_id and l.organization_id = i.organization_id
			  and p.id = i.policy_id and p.organization_id = i.organization_id
			  and i.status not in ('resolved', 'redistributed', 'cancelled')
			  and (
				not l.attention_eligible
				or l.deal_status in ('won', 'lost')
				or (p.policy_type = 'unassigned' and l.assigned_user_id is not null)
				or (p.policy_type = 'first_contact' and exists (
				  select 1 from public.lead_assignment_cycles ac
				  where ac.id = i.assignment_cycle_id and ac.first_human_outreach_at is not null
				))
				or (i.assignment_cycle_id is not null and exists (
				  select 1 from public.lead_assignment_cycles ac
				  where ac.id = i.assignment_cycle_id and ac.ended_at is not null
				))
				or (i.stage_cycle_id is not null and exists (
				  select 1 from public.lead_stage_cycles sc
				  where sc.id = i.stage_cycle_id and sc.exited_at is not null
				))
			  )
			returning i.organization_id, i.id, i.lead_id, i.status, i.resolved_reason
		)
		insert into public.lead_attention_events (
			organization_id, instance_id, lead_id, event_type, metadata
		)
		select organization_id, id, lead_id, status,
		       jsonb_build_object('reason', resolved_reason, 'source', 'attention_worker')
		from resolved
	`)
	return err
}

func (repo Repository) claimDueInstances(ctx context.Context, tx pgx.Tx) ([]workerInstance, error) {
	rows, err := tx.Query(ctx, `
		select jsonb_build_object(
			'id', i.id, 'organizationId', i.organization_id,
			'leadId', i.lead_id, 'leadName', l.name,
			'leadDealStatus', l.deal_status, 'leadAssignedUserId', l.assigned_user_id,
			'policyId', p.id, 'policyName', p.name, 'policyType', p.policy_type,
			'policyStatus', p.status, 'policyVersion', i.policy_version,
			'policyConfig', p.config, 'thresholdMinutes', p.threshold_minutes,
			'warningMinutes', p.warning_minutes,
			'repeatMinutes', p.repeat_minutes, 'escalationMinutes', p.escalation_minutes,
			'redistributionMinutes', p.redistribution_minutes,
			'businessHoursOnly', p.business_hours_only,
			'redistributeBeforeContactOnly', p.redistribute_before_contact_only,
			'notifyAssignee', p.notify_assignee, 'notifyLeaders', p.notify_leaders,
			'notifyAdmins', p.notify_admins
		) || jsonb_build_object(
			'cycleKey', i.cycle_key, 'assignmentCycleId', i.assignment_cycle_id,
			'stageCycleId', i.stage_cycle_id, 'assignedUserId', i.assigned_user_id,
			'pipelineId', i.pipeline_id, 'stageId', i.stage_id,
			'baselineAt', i.baseline_at, 'lastQualifyingActionAt', i.last_qualifying_action_at,
			'latestQualifyingActionAt', latest_action.occurred_at,
			'warningAt', i.warning_at, 'dueAt', i.due_at,
			'status', i.status, 'shadow', i.shadow,
			'warningSentAt', i.warning_sent_at, 'breachSentAt', i.breach_sent_at,
			'lastReminderAt', i.last_reminder_at, 'reminderCount', i.reminder_count,
			'snoozedUntil', i.snoozed_until, 'redistributedAt', i.redistributed_at,
			'redistributionAttempts', i.redistribution_attempts, 'metadata', i.metadata,
			'firstHumanOutreachAt', active_assignment.first_human_outreach_at,
			'engineMode', coalesce(os.engine_mode, 'shadow'),
			'notificationsEnabled', coalesce(os.notifications_enabled, true),
			'redistributionEnabled', coalesce(os.redistribution_enabled, false),
			'timezone', coalesce(os.timezone, 'America/Sao_Paulo'),
			'businessHours', coalesce(os.business_hours, '{"days":[1,2,3,4,5],"start":"08:00","end":"18:00"}'::jsonb),
			'defaultRepeatMinutes', coalesce(os.default_repeat_minutes, 1440),
			'maxReminders', coalesce(os.max_reminders, 0)
		)
		from public.lead_attention_instances i
		join public.lead_attention_policies p
		  on p.organization_id = i.organization_id and p.id = i.policy_id
		join public.leads l
		  on l.organization_id = i.organization_id and l.id = i.lead_id
		left join public.organization_attention_settings os on os.organization_id = i.organization_id
		left join public.lead_assignment_cycles active_assignment
		  on active_assignment.organization_id = i.organization_id
		 and active_assignment.lead_id = i.lead_id and active_assignment.ended_at is null
		left join lateral (
			select f.occurred_at
			from public.lead_action_facts f
			where f.stage_cycle_id = i.stage_cycle_id and f.qualifies_stage_inactivity = true
			order by f.occurred_at desc, f.id desc limit 1
		) latest_action on true
		where l.attention_eligible = true and l.attention_enrolled_at is not null
		  and i.status in ('monitoring', 'warning', 'breached', 'escalated', 'acknowledged', 'exception')
		  and i.next_evaluation_at <= now()
		  and (i.snoozed_until is null or i.snoozed_until <= now())
		  and coalesce(os.engine_mode, 'shadow') <> 'disabled'
		  and p.status <> 'paused'
		order by i.next_evaluation_at, i.id
		for update of i skip locked
		limit $1
	`, workerBatchLimit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	instances := []workerInstance{}
	for rows.Next() {
		var payload []byte
		if err := rows.Scan(&payload); err != nil {
			return nil, err
		}
		var instance workerInstance
		if err := json.Unmarshal(payload, &instance); err != nil {
			return nil, err
		}
		instances = append(instances, instance)
	}
	return instances, rows.Err()
}

func (repo Repository) processInstance(ctx context.Context, tx pgx.Tx, instance workerInstance) error {
	if instance.PolicyType == "stage_inactivity" && instance.LatestQualifyingActionAt != nil &&
		(instance.LastQualifyingActionAt == nil || instance.LatestQualifyingActionAt.After(*instance.LastQualifyingActionAt)) {
		if err := repo.resetInactivityBaseline(ctx, tx, &instance); err != nil {
			return err
		}
	}

	if terminal, err := repo.reconcileRedistribution(ctx, tx, &instance); err != nil {
		return err
	} else if terminal {
		return nil
	}

	repeatMinutes := instance.DefaultRepeatMinutes
	if instance.RepeatMinutes != nil && *instance.RepeatMinutes > 0 {
		repeatMinutes = *instance.RepeatMinutes
	}
	escalationMinutes := 0
	if instance.EscalationMinutes != nil {
		escalationMinutes = *instance.EscalationMinutes
	}
	var escalationAt *time.Time
	if instance.EscalationMinutes != nil {
		value, err := AddPolicyMinutes(instance.DueAt, escalationMinutes, instance.BusinessHoursOnly, instance.Timezone, instance.BusinessHours)
		if err != nil {
			return err
		}
		escalationAt = &value
	}
	evaluation := Evaluate(EvaluationInput{
		Now:               time.Now().UTC(),
		CurrentStatus:     instance.Status,
		AcknowledgedFrom:  stringMapValue(instance.Metadata, "acknowledged_from_status"),
		DueAt:             instance.DueAt,
		WarningMinutes:    instance.WarningMinutes,
		EscalationMinutes: escalationMinutes,
		WarningAt:         instance.WarningAt,
		EscalationAt:      escalationAt,
		RepeatMinutes:     repeatMinutes,
		LastReminderAt:    instance.LastReminderAt,
		SnoozedUntil:      instance.SnoozedUntil,
	})
	if !evaluation.Notify && initialSeverityNotificationMissing(instance, evaluation.Level) {
		evaluation.Notify = true
		evaluation.Reminder = false
	}

	notify := evaluation.Notify && instance.EngineMode == "enabled" && !instance.Shadow &&
		instance.NotificationsEnabled && instance.PolicyStatus != "shadow" && instance.PolicyStatus != "paused"
	if evaluation.Reminder && instance.MaxReminders > 0 && instance.ReminderCount >= instance.MaxReminders {
		notify = false
	}
	now := time.Now().UTC()
	if notify {
		if err := repo.notifyInstance(ctx, tx, instance, evaluation, repeatMinutes, now); err != nil {
			return err
		}
	}

	metadata := cloneMap(instance.Metadata)
	metadata["last_evaluation_at"] = now.Format(time.RFC3339Nano)
	metadata["last_evaluation_level"] = evaluation.Level
	if notify {
		metadata["last_notification_level"] = evaluation.Level
		metadata["last_notification_at"] = now.Format(time.RFC3339Nano)
	}
	reminderIncrement := 0
	if notify && evaluation.Reminder {
		reminderIncrement = 1
	}
	_, err := tx.Exec(ctx, `
		update public.lead_attention_instances
		set status = $3,
		    warning_sent_at = case when $4 and $5 = 'warning' then coalesce(warning_sent_at, $6) else warning_sent_at end,
		    breach_sent_at = case when $4 and $5 = 'breached' then coalesce(breach_sent_at, $6) else breach_sent_at end,
		    escalated_at = case when $3 = 'escalated' then coalesce(escalated_at, $6) else escalated_at end,
		    last_reminder_at = case when $4 and $5 in ('breached', 'escalated') then $6 else last_reminder_at end,
		    reminder_count = reminder_count + $7,
		    next_evaluation_at = $8,
		    attempts = attempts + 1, locked_at = null, locked_by = null,
		    last_error = null, metadata = $9::jsonb, updated_at = now()
		where organization_id = $1::uuid and id = $2::uuid
	`, instance.OrganizationID, instance.ID, evaluation.Status, notify, evaluation.Level, now,
		reminderIncrement, evaluation.NextAt, jsonValue(metadata))
	if err != nil {
		return err
	}

	if evaluation.Status != evaluation.PreviousStatus {
		if err := insertAttentionEvent(ctx, tx, instance.OrganizationID, instance.ID, instance.LeadID, evaluation.Status, "", map[string]any{
			"from":   evaluation.PreviousStatus,
			"shadow": instance.Shadow || instance.EngineMode != "enabled",
		}); err != nil {
			return err
		}
	}
	if notify && evaluation.Reminder {
		if err := insertAttentionEvent(ctx, tx, instance.OrganizationID, instance.ID, instance.LeadID, "reminder_sent", "", map[string]any{
			"level": evaluation.Level,
			"count": instance.ReminderCount + 1,
		}); err != nil {
			return err
		}
	}

	if err := repo.maybeEnqueueRedistribution(ctx, tx, &instance, evaluation, now); err != nil {
		return err
	}
	return nil
}

func (repo Repository) resetInactivityBaseline(ctx context.Context, tx pgx.Tx, instance *workerInstance) error {
	baseline := instance.LatestQualifyingActionAt.UTC()
	dueAt, err := AddPolicyMinutes(baseline, policyThresholdFromDue(*instance), instance.BusinessHoursOnly, instance.Timezone, instance.BusinessHours)
	if err != nil {
		return err
	}
	warningAt := dueAt
	if instance.WarningMinutes > 0 {
		warningAt, err = AddPolicyMinutes(baseline, policyThresholdFromDue(*instance)-instance.WarningMinutes, instance.BusinessHoursOnly, instance.Timezone, instance.BusinessHours)
		if err != nil {
			return err
		}
	}
	nextAt := dueAt
	if instance.WarningMinutes > 0 {
		nextAt = warningAt
	}
	_, err = tx.Exec(ctx, `
		update public.lead_attention_instances
		set baseline_at = $3, last_qualifying_action_at = $3,
		    warning_at = $4, due_at = $5, next_evaluation_at = $6,
		    status = 'monitoring', warning_sent_at = null, breach_sent_at = null,
		    escalated_at = null, last_reminder_at = null, reminder_count = 0,
		    acknowledged_at = null, acknowledged_by = null, snoozed_until = null,
		    last_error = null, updated_at = now()
		where organization_id = $1::uuid and id = $2::uuid
	`, instance.OrganizationID, instance.ID, baseline, warningAt, dueAt, nextAt)
	if err != nil {
		return err
	}
	if err := insertAttentionEvent(ctx, tx, instance.OrganizationID, instance.ID, instance.LeadID, "baseline_reset", "", map[string]any{
		"baseline_at": baseline,
		"source":      "qualifying_action",
	}); err != nil {
		return err
	}
	instance.BaselineAt = baseline
	instance.LastQualifyingActionAt = &baseline
	instance.WarningAt = &warningAt
	instance.DueAt = dueAt
	instance.Status = "monitoring"
	instance.LastReminderAt = nil
	instance.ReminderCount = 0
	return nil
}

func policyThresholdFromDue(instance workerInstance) int {
	// The versioned policy threshold is not inferred from wall-clock duration when
	// business hours are enabled. It is snapshotted in metadata at reconciliation;
	// older rows fall back to the policy's elapsed baseline only.
	if instance.ThresholdMinutes > 0 {
		return instance.ThresholdMinutes
	}
	if value := intMapValue(instance.Metadata, "threshold_minutes"); value > 0 {
		return value
	}
	minutes := int(instance.DueAt.Sub(instance.BaselineAt).Minutes())
	if minutes <= 0 {
		return 1
	}
	return minutes
}

func (repo Repository) markInstanceError(ctx context.Context, tx pgx.Tx, instanceID string, evaluationErr error) error {
	message := strings.TrimSpace(evaluationErr.Error())
	if len(message) > 2000 {
		message = message[:2000]
	}
	_, err := tx.Exec(ctx, `
		update public.lead_attention_instances
		set status = case when attempts + 1 >= 10 then 'exception' else status end,
		    attempts = attempts + 1,
		    last_error = $2,
		    next_evaluation_at = now() + make_interval(mins => least(60, greatest(1, attempts + 1) * 5)),
		    locked_at = null, locked_by = null, updated_at = now()
		where id = $1::uuid
	`, instanceID, message)
	return err
}

func nullableString(value *string) any {
	if value == nil || strings.TrimSpace(*value) == "" {
		return nil
	}
	return strings.TrimSpace(*value)
}

func nullableTime(value *time.Time) any {
	if value == nil {
		return nil
	}
	return value.UTC()
}

func stringMapValue(values map[string]any, key string) string {
	value, exists := values[key]
	if !exists || value == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func intMapValue(values map[string]any, key string) int {
	value := values[key]
	switch typed := value.(type) {
	case float64:
		return int(typed)
	case int:
		return typed
	case json.Number:
		parsed, _ := typed.Int64()
		return int(parsed)
	default:
		return 0
	}
}

func initialSeverityNotificationMissing(instance workerInstance, level string) bool {
	switch level {
	case "warning":
		return instance.WarningSentAt == nil
	case "breached":
		return instance.BreachSentAt == nil
	case "escalated":
		return stringMapValue(instance.Metadata, "last_notification_level") != "escalated"
	default:
		return false
	}
}
