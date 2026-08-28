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
	workerBatchLimit    = 10
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
	PolicyUpdatedAt   time.Time       `json:"policyUpdatedAt"`
	CycleKey          string          `json:"cycleKey"`
	AssignmentCycleID *string         `json:"assignmentCycleId"`
	StageCycleID      *string         `json:"stageCycleId"`
	AssignedUserID    *string         `json:"assignedUserId"`
	PipelineID        *string         `json:"pipelineId"`
	StageID           *string         `json:"stageId"`
	BaselineAt        time.Time       `json:"baselineAt"`
	LastActionAt      *time.Time      `json:"lastActionAt"`
	DueAtOverride     *time.Time      `json:"dueAtOverride"`
	WarningAtOverride *time.Time      `json:"warningAtOverride"`
	ThresholdMinutes  int             `json:"thresholdMinutes"`
	WarningMinutes    int             `json:"warningMinutes"`
	BusinessOnly      bool            `json:"businessOnly"`
	EngineMode        string          `json:"engineMode"`
	Timezone          string          `json:"timezone"`
	BusinessHours     json.RawMessage `json:"businessHours"`
	Metadata          map[string]any  `json:"metadata"`
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
	if _, err := tx.Exec(ctx, `
		update public.lead_attention_instances i
		set shadow = (
		      coalesce(os.engine_mode, 'shadow') <> 'enabled'
		      or p.status <> 'enabled'
		      or coalesce((i.metadata->>'historical_backfill')::boolean, false)
		      or coalesce((i.metadata->>'grandfathered_shadow')::boolean, false)
		    ),
		    metadata = coalesce(i.metadata, '{}'::jsonb) || jsonb_build_object(
		      'engine_mode_snapshot', coalesce(os.engine_mode, 'shadow'),
		      'policy_status_snapshot', p.status
		    ),
		    updated_at = now()
		from public.lead_attention_policies p
		left join public.organization_attention_settings os on os.organization_id = p.organization_id
		where p.id = i.policy_id and p.organization_id = i.organization_id
		  and i.status not in ('resolved', 'redistributed', 'cancelled')
		  and i.shadow is distinct from (
		    coalesce(os.engine_mode, 'shadow') <> 'enabled'
		    or p.status <> 'enabled'
		    or coalesce((i.metadata->>'historical_backfill')::boolean, false)
		    or coalesce((i.metadata->>'grandfathered_shadow')::boolean, false)
		  )
	`); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		update public.lead_attention_instances i
		set assigned_user_id = coalesce(lt.assigned_user_id, l.assigned_user_id),
		    updated_at = now()
		from public.lead_attention_policies p, public.lead_tasks lt, public.leads l
		where p.id = i.policy_id and p.policy_type = 'cadence_task'
		  and lt.id = (i.metadata->>'lead_task_id')::uuid
		  and l.id = i.lead_id and l.organization_id = i.organization_id
		  and i.status not in ('resolved', 'redistributed', 'cancelled')
		  and i.assigned_user_id is distinct from coalesce(lt.assigned_user_id, l.assigned_user_id)
	`); err != nil {
		return err
	}
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
				p.policy_type, p.status as policy_status, p.updated_at as policy_updated_at,
				case when p.stage_id is not null then 3 when p.pipeline_id is not null then 2 else 1 end as policy_scope_rank,
				'unassigned:' || coalesce(last_cycle.id::text, l.attention_enrolled_at::text) as precedence_key,
				'unassigned:' || coalesce(last_cycle.id::text, l.attention_enrolled_at::text) as cycle_key,
				null::uuid as assignment_cycle_id, null::uuid as stage_cycle_id,
				null::uuid as assigned_user_id, l.pipeline_id, l.stage_id,
				coalesce(last_cycle.ended_at, l.attention_enrolled_at) as baseline_at,
				null::timestamptz as last_action_at,
				null::timestamptz as due_at_override,
				null::timestamptz as warning_at_override,
				p.threshold_minutes, p.warning_minutes, p.business_hours_only,
				p.engine_mode, p.timezone, p.business_hours,
				'{}'::jsonb as metadata
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
			  and (
			    (l.attention_eligible = true and l.attention_enrolled_at is not null)
			    or coalesce(p.config->>'source', '') = 'stage_operational_rules'
			  )
			  and l.deal_status = 'open' and l.assigned_user_id is null
			  and (p.pipeline_id is null or p.pipeline_id = l.pipeline_id)
			  and (p.stage_id is null or p.stage_id = l.stage_id)
			  and (
			    coalesce(p.config->>'source', '') <> 'stage_operational_rules'
			    or coalesce(last_cycle.ended_at, l.attention_enrolled_at) >=
			      coalesce(nullif(p.config->>'effective_from', '')::timestamptz, p.created_at)
			  )
			union all
			select
				p.organization_id, l.id, p.id, p.policy_key, p.version,
				p.policy_type, p.status, p.updated_at,
				case when p.stage_id is not null then 3 when p.pipeline_id is not null then 2 else 1 end,
				'assignment:' || ac.id::text,
				'assignment:' || ac.id::text ||
				  case
				    when p.stage_id is not null then ':stage:' || current_stage.id::text
				    else ''
				  end,
				ac.id,
				case when p.stage_id is not null then current_stage.id else null::uuid end,
				ac.assigned_user_id, l.pipeline_id, l.stage_id,
				case
				  when p.stage_id is not null then greatest(ac.assigned_at, current_stage.entered_at)
				  else ac.assigned_at
				end,
				null::timestamptz,
				null::timestamptz,
				null::timestamptz,
				p.threshold_minutes, p.warning_minutes, p.business_hours_only,
				p.engine_mode, p.timezone, p.business_hours,
				jsonb_build_object(
				  'historical_backfill',
				  (
				    coalesce(
				      case lower(nullif(ac.metadata->>'historical_backfill', ''))
				        when 'true' then true
				        when 'false' then false
				        else null
				      end,
				      false
				    )
				    or (
				      p.stage_id is not null
				      and coalesce(
				        case lower(nullif(current_stage.metadata->>'historical_backfill', ''))
				          when 'true' then true
				          when 'false' then false
				          else null
				        end,
				        false
				      )
				    )
				  )
				)
			from current_policies p
			join public.leads l on l.organization_id = p.organization_id
			join public.lead_assignment_cycles ac
			  on ac.organization_id = l.organization_id and ac.lead_id = l.id and ac.ended_at is null
			left join lateral (
				select sc.id, sc.entered_at, sc.metadata
				from public.lead_stage_cycles sc
				where sc.organization_id = l.organization_id
				  and sc.lead_id = l.id
				  and sc.pipeline_id = l.pipeline_id
				  and sc.stage_id = l.stage_id
				  and sc.exited_at is null
				order by sc.entered_at desc, sc.id desc
				limit 1
			) current_stage on p.stage_id is not null
			where p.policy_type in ('first_contact', 'first_effective_contact')
			  and (
			    (l.attention_eligible = true and l.attention_enrolled_at is not null)
			    or coalesce(p.config->>'source', '') = 'stage_operational_rules'
			  )
			  and l.deal_status = 'open'
			  and (
			    (p.policy_type = 'first_contact' and ac.first_human_outreach_at is null)
			    or (
			      p.policy_type = 'first_effective_contact'
			      and ac.first_effective_contact_at is null
			    )
			  )
			  and (p.pipeline_id is null or p.pipeline_id = l.pipeline_id)
			  and (p.stage_id is null or p.stage_id = l.stage_id)
			  and (p.stage_id is null or current_stage.id is not null)
			  and (
			    coalesce(p.config->>'source', '') <> 'stage_operational_rules'
			    or (
			      case
			        when p.stage_id is not null then greatest(ac.assigned_at, current_stage.entered_at)
			        else ac.assigned_at
			      end
			    ) >= coalesce(
			      nullif(p.config->>'effective_from', '')::timestamptz,
			      p.created_at
			    )
			  )
			union all
			select
				p.organization_id, l.id, p.id, p.policy_key, p.version,
				p.policy_type, p.status, p.updated_at,
				case when p.stage_id is not null then 3 when p.pipeline_id is not null then 2 else 1 end,
				'stage:' || sc.id::text || ':' || p.policy_type,
				'stage:' || sc.id::text || ':' || p.policy_type,
				null::uuid, sc.id, l.assigned_user_id, sc.pipeline_id, sc.stage_id,
				case when p.policy_type = 'stage_inactivity' then coalesce(last_action.occurred_at, sc.entered_at) else sc.entered_at end,
				case when p.policy_type = 'stage_inactivity' then last_action.occurred_at else null end,
				null::timestamptz,
				null::timestamptz,
				p.threshold_minutes, p.warning_minutes, p.business_hours_only,
				p.engine_mode, p.timezone, p.business_hours,
				jsonb_build_object(
				  'historical_backfill',
				  coalesce(
				    case lower(nullif(sc.metadata->>'historical_backfill', ''))
				      when 'true' then true
				      when 'false' then false
				      else null
				    end,
				    false
				  )
				)
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
			  and (
			    (l.attention_eligible = true and l.attention_enrolled_at is not null)
			    or coalesce(p.config->>'source', '') = 'stage_operational_rules'
			  )
			  and l.deal_status = 'open'
			  and (p.pipeline_id is null or p.pipeline_id = sc.pipeline_id)
			  and (p.stage_id is null or p.stage_id = sc.stage_id)
			  and (
			    coalesce(p.config->>'source', '') <> 'stage_operational_rules'
			    or sc.entered_at >= coalesce(
			      nullif(p.config->>'effective_from', '')::timestamptz,
			      p.created_at
			    )
			  )
			union all
			select
				p.organization_id, l.id, p.id, p.policy_key, p.version,
				p.policy_type, p.status, p.updated_at,
				case when p.stage_id is not null then 3 when p.pipeline_id is not null then 2 else 1 end,
				'cadence_task:' || lt.id::text,
				'cadence_task:' || lt.id::text,
				null::uuid, ce.stage_cycle_id,
				coalesce(lt.assigned_user_id, l.assigned_user_id), l.pipeline_id, l.stage_id,
				lt.created_at,
				null::timestamptz,
				lt.due_at,
				lt.due_at - make_interval(
				  mins => coalesce(
				    case
				      when nullif(lt.metadata->>'warning_minutes', '') ~ '^[0-9]+$'
				        then (lt.metadata->>'warning_minutes')::integer
				      else null
				    end,
				    p.warning_minutes
				  )
				),
				p.threshold_minutes,
				coalesce(
				  case
				    when nullif(lt.metadata->>'warning_minutes', '') ~ '^[0-9]+$'
				      then (lt.metadata->>'warning_minutes')::integer
				    else null
				  end,
				  p.warning_minutes
				),
				p.business_hours_only,
				p.engine_mode, p.timezone, p.business_hours,
				jsonb_build_object(
				  'lead_task_id', lt.id,
				  'cadence_enrollment_id', ce.id,
				  'cadence_template_id', ce.cadence_template_id,
				  'task_title', lt.title,
				  'task_type', lt.type,
				  'task_due_at', lt.due_at,
				  'historical_backfill', coalesce(
				    case lower(nullif(ce.metadata->>'historical_backfill', ''))
				      when 'true' then true
				      when 'false' then false
				      else null
				    end,
				    false
				  )
				)
			from current_policies p
			join public.lead_tasks lt
			  on lt.organization_id = p.organization_id
			 and lt.status = 'pending' and lt.is_done = false and lt.due_at is not null
			join public.cadence_enrollments ce
			  on ce.id = lt.cadence_enrollment_id and ce.organization_id = lt.organization_id and ce.status = 'active'
			join public.leads l
			  on l.id = lt.lead_id and l.organization_id = lt.organization_id
			where p.policy_type = 'cadence_task'
			  and (
			    (l.attention_eligible = true and l.attention_enrolled_at is not null)
			    or coalesce(p.config->>'source', '') = 'stage_operational_rules'
			  )
			  and l.deal_status = 'open'
			  and (p.pipeline_id is null or p.pipeline_id = l.pipeline_id)
			  and (p.stage_id is null or p.stage_id = l.stage_id)
			  and (
			    coalesce(p.config->>'source', '') <> 'stage_operational_rules'
			    or lt.created_at >= coalesce(
			      nullif(p.config->>'effective_from', '')::timestamptz,
			      p.created_at
			    )
			  )
		), preferred_candidates as (
			select ranked.*
			from (
				select
					c.*,
					row_number() over (
					  partition by c.organization_id, c.lead_id, c.policy_type, c.precedence_key
					  order by c.policy_scope_rank desc, c.policy_id
					) as precedence_rank
				from candidates c
			) ranked
			where ranked.precedence_rank = 1
		), eligible_candidates as (
			select c.*
			from preferred_candidates c
			where c.baseline_at is not null
			  and not exists (
				select 1
				from public.lead_attention_policies higher
				where higher.organization_id = c.organization_id
				  and higher.policy_type = c.policy_type
				  and (
				    higher.status in ('shadow', 'enabled')
				    or (
				      higher.status = 'paused'
				      and coalesce(lower(higher.config->>'disabled_override') = 'true', false)
				    )
				  )
				  and (higher.pipeline_id is null or higher.pipeline_id = c.pipeline_id)
				  and (higher.stage_id is null or higher.stage_id = c.stage_id)
				  and (
				    case
				      when higher.stage_id is not null then 3
				      when higher.pipeline_id is not null then 2
				      else 1
				    end
				  ) > c.policy_scope_rank
			  )
			  and not exists (
				select 1
				from public.lead_attention_instances i
				join public.lead_attention_policies old_policy on old_policy.id = i.policy_id
				where i.lead_id = c.lead_id
				  and i.cycle_key = c.cycle_key
				  and old_policy.policy_key = c.policy_key
			  )
		), ranked_candidates as (
			select c.*,
			       row_number() over (
			         partition by c.organization_id, c.policy_type
			         order by c.baseline_at, c.lead_id
			       ) as candidate_rank
			from eligible_candidates c
		)
		select jsonb_build_object(
			'organizationId', c.organization_id, 'leadId', c.lead_id,
			'policyId', c.policy_id, 'policyKey', c.policy_key,
			'policyVersion', c.version, 'policyType', c.policy_type, 'policyStatus', c.policy_status,
			'policyUpdatedAt', c.policy_updated_at,
			'cycleKey', c.cycle_key, 'assignmentCycleId', c.assignment_cycle_id,
			'stageCycleId', c.stage_cycle_id, 'assignedUserId', c.assigned_user_id,
			'pipelineId', c.pipeline_id, 'stageId', c.stage_id,
			'baselineAt', c.baseline_at, 'lastActionAt', c.last_action_at,
			'dueAtOverride', c.due_at_override, 'warningAtOverride', c.warning_at_override,
			'thresholdMinutes', c.threshold_minutes, 'warningMinutes', c.warning_minutes,
			'businessOnly', c.business_hours_only, 'engineMode', c.engine_mode,
			'timezone', c.timezone, 'businessHours', c.business_hours,
			'metadata', c.metadata
		)
		from ranked_candidates c
		where c.candidate_rank <= 50
		order by c.candidate_rank, c.baseline_at, c.organization_id, c.lead_id
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

	var inserts pgx.Batch
	for _, candidate := range candidates {
		var dueAt time.Time
		if candidate.DueAtOverride != nil {
			dueAt = candidate.DueAtOverride.UTC()
		} else {
			dueAt, err = AddPolicyMinutes(candidate.BaselineAt, candidate.ThresholdMinutes, candidate.BusinessOnly, candidate.Timezone, candidate.BusinessHours)
			if err != nil {
				return fmt.Errorf("calculate attention due_at: %w", err)
			}
		}
		warningAt := dueAt
		if candidate.WarningAtOverride != nil {
			warningAt = candidate.WarningAtOverride.UTC()
		} else if candidate.WarningMinutes > 0 {
			warningAt, err = AddPolicyMinutes(candidate.BaselineAt, candidate.ThresholdMinutes-candidate.WarningMinutes, candidate.BusinessOnly, candidate.Timezone, candidate.BusinessHours)
			if err != nil {
				return fmt.Errorf("calculate attention warning_at: %w", err)
			}
		}
		nextAt := dueAt
		if candidate.WarningMinutes > 0 {
			nextAt = warningAt
		}
		historicalBackfill, _ := candidate.Metadata["historical_backfill"].(bool)
		shadow := candidate.EngineMode != "enabled" || candidate.PolicyStatus != "enabled" || historicalBackfill
		metadata := map[string]any{
			"engine_mode_snapshot":   candidate.EngineMode,
			"policy_status_snapshot": candidate.PolicyStatus,
			"policy_key":             candidate.PolicyKey,
			"threshold_minutes":      candidate.ThresholdMinutes,
		}
		for key, value := range candidate.Metadata {
			metadata[key] = value
		}
		inserts.Queue(`
			insert into public.lead_attention_instances (
				organization_id, lead_id, policy_id, policy_version, cycle_key,
				assignment_cycle_id, stage_cycle_id, assigned_user_id, pipeline_id, stage_id,
				baseline_at, last_qualifying_action_at, warning_at, due_at, next_evaluation_at,
				status, shadow, metadata
			)
			select
				$1::uuid, $2::uuid, $3::uuid, $4, $5,
				$6::uuid, $7::uuid, $8::uuid, $9::uuid, $10::uuid,
				$11, $12, $13, $14, $15,
				'monitoring', $16, $17::jsonb
			from public.lead_attention_policies current_policy
			where current_policy.organization_id = $1::uuid
			  and current_policy.id = $3::uuid
			  and current_policy.version = $4
			  and current_policy.updated_at = $18::timestamptz
			  and current_policy.status in ('shadow', 'enabled')
			on conflict (policy_id, lead_id, cycle_key) do nothing
		`, candidate.OrganizationID, candidate.LeadID, candidate.PolicyID, candidate.PolicyVersion, candidate.CycleKey,
			nullableString(candidate.AssignmentCycleID), nullableString(candidate.StageCycleID), nullableString(candidate.AssignedUserID), nullableString(candidate.PipelineID), nullableString(candidate.StageID),
			candidate.BaselineAt, nullableTime(candidate.LastActionAt), warningAt, dueAt, nextAt,
			shadow, jsonValue(metadata), candidate.PolicyUpdatedAt,
		)
	}
	if len(candidates) == 0 {
		return nil
	}
	results := tx.SendBatch(ctx, &inserts)
	for range candidates {
		if _, err := results.Exec(); err != nil {
			_ = results.Close()
			return err
		}
	}
	return results.Close()
}

func (repo Repository) resolveSatisfiedInstances(ctx context.Context, tx pgx.Tx) error {
	_, err := tx.Exec(ctx, `
		with resolved as (
			update public.lead_attention_instances i
			set status = case
			      when not (
			        (l.attention_eligible = true and l.attention_enrolled_at is not null)
			        or coalesce(p.config->>'source', '') = 'stage_operational_rules'
			      ) then 'cancelled'
			      when p.status not in ('shadow', 'enabled') then 'cancelled'
			      else 'resolved'
			    end,
			    resolved_at = now(),
			    resolved_reason = case
			      when not (
			        (l.attention_eligible = true and l.attention_enrolled_at is not null)
			        or coalesce(p.config->>'source', '') = 'stage_operational_rules'
			      ) then 'ineligible'
			      when p.status not in ('shadow', 'enabled') then 'policy_inactive'
			      when l.deal_status in ('won', 'lost') then l.deal_status
			      when (p.pipeline_id is not null and p.pipeline_id is distinct from l.pipeline_id)
			        or (p.stage_id is not null and p.stage_id is distinct from l.stage_id)
			        then 'policy_scope_changed'
			      when p.policy_type = 'unassigned' and l.assigned_user_id is not null then 'assigned'
			      when p.policy_type = 'first_contact' and exists (
			        select 1 from public.lead_assignment_cycles ac
			        where ac.id = i.assignment_cycle_id and ac.first_human_outreach_at is not null
			      ) then 'first_contact_completed'
			      when p.policy_type = 'first_effective_contact' and exists (
			        select 1 from public.lead_assignment_cycles ac
			        where ac.id = i.assignment_cycle_id and ac.first_effective_contact_at is not null
			      ) then 'first_effective_contact_completed'
			      when p.policy_type = 'cadence_task' and not exists (
			        select 1 from public.lead_tasks lt
			        where lt.id = (i.metadata->>'lead_task_id')::uuid
			          and lt.status = 'pending' and lt.is_done = false
			      ) then 'cadence_task_completed_or_cancelled'
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
				not (
				  (l.attention_eligible = true and l.attention_enrolled_at is not null)
				  or coalesce(p.config->>'source', '') = 'stage_operational_rules'
				)
				or p.status not in ('shadow', 'enabled')
				or l.deal_status in ('won', 'lost')
				or (p.pipeline_id is not null and p.pipeline_id is distinct from l.pipeline_id)
				or (p.stage_id is not null and p.stage_id is distinct from l.stage_id)
				or (p.policy_type = 'unassigned' and l.assigned_user_id is not null)
				or (p.policy_type = 'first_contact' and exists (
				  select 1 from public.lead_assignment_cycles ac
				  where ac.id = i.assignment_cycle_id and ac.first_human_outreach_at is not null
				))
				or (p.policy_type = 'first_effective_contact' and exists (
				  select 1 from public.lead_assignment_cycles ac
				  where ac.id = i.assignment_cycle_id and ac.first_effective_contact_at is not null
				))
				or (p.policy_type = 'cadence_task' and not exists (
				  select 1 from public.lead_tasks lt
				  where lt.id = (i.metadata->>'lead_task_id')::uuid
				    and lt.status = 'pending' and lt.is_done = false
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
		with ranked_due as (
			select
				i.id,
				case
				  when coalesce(os.engine_mode, 'shadow') = 'enabled'
				   and p.status = 'enabled'
				   and coalesce(i.shadow, true) = false then 0
				  else 1
				end as delivery_rank,
				row_number() over (
				  partition by i.organization_id, p.policy_type
				  order by
				    case
				      when coalesce(os.engine_mode, 'shadow') = 'enabled'
				       and p.status = 'enabled'
				       and coalesce(i.shadow, true) = false then 0
				      else 1
				    end,
				    i.next_evaluation_at,
				    i.id
				) as group_rank
			from public.lead_attention_instances i
			join public.lead_attention_policies p
			  on p.organization_id = i.organization_id and p.id = i.policy_id
			join public.leads l
			  on l.organization_id = i.organization_id and l.id = i.lead_id
			left join public.organization_attention_settings os on os.organization_id = i.organization_id
			where (
			    (l.attention_eligible = true and l.attention_enrolled_at is not null)
			    or coalesce(p.config->>'source', '') = 'stage_operational_rules'
			  )
			  and i.status in ('monitoring', 'warning', 'breached', 'escalated', 'acknowledged', 'exception')
			  and i.next_evaluation_at <= now()
			  and (i.snoozed_until is null or i.snoozed_until <= now())
			  and coalesce(os.engine_mode, 'shadow') <> 'disabled'
			  and p.status <> 'paused'
			  and (p.pipeline_id is null or p.pipeline_id = l.pipeline_id)
			  and (p.stage_id is null or p.stage_id = l.stage_id)
			  and not exists (
			    select 1
			    from public.lead_attention_policies higher
			    where higher.organization_id = p.organization_id
			      and higher.policy_type = p.policy_type
			      and (
			        higher.status in ('shadow', 'enabled')
			        or (
			          higher.status = 'paused'
			          and coalesce(lower(higher.config->>'disabled_override') = 'true', false)
			        )
			      )
			      and (higher.pipeline_id is null or higher.pipeline_id = l.pipeline_id)
			      and (higher.stage_id is null or higher.stage_id = l.stage_id)
			      and (
			        case
			          when higher.stage_id is not null then 3
			          when higher.pipeline_id is not null then 2
			          else 1
			        end
			      ) > (
			        case
			          when p.stage_id is not null then 3
			          when p.pipeline_id is not null then 2
			          else 1
			        end
			      )
			  )
		)
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
		join ranked_due due on due.id = i.id and due.group_rank <= $1
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
		where (
		    (l.attention_eligible = true and l.attention_enrolled_at is not null)
		    or coalesce(p.config->>'source', '') = 'stage_operational_rules'
		  )
		  and i.status in ('monitoring', 'warning', 'breached', 'escalated', 'acknowledged', 'exception')
		  and i.next_evaluation_at <= now()
		  and (i.snoozed_until is null or i.snoozed_until <= now())
		  and coalesce(os.engine_mode, 'shadow') <> 'disabled'
		  and p.status <> 'paused'
		  and (p.pipeline_id is null or p.pipeline_id = l.pipeline_id)
		  and (p.stage_id is null or p.stage_id = l.stage_id)
		  and not exists (
		    select 1
		    from public.lead_attention_policies higher
		    where higher.organization_id = p.organization_id
		      and higher.policy_type = p.policy_type
		      and (
		        higher.status in ('shadow', 'enabled')
		        or (
		          higher.status = 'paused'
		          and coalesce(lower(higher.config->>'disabled_override') = 'true', false)
		        )
		      )
		      and (higher.pipeline_id is null or higher.pipeline_id = l.pipeline_id)
		      and (higher.stage_id is null or higher.stage_id = l.stage_id)
		      and (
		        case
		          when higher.stage_id is not null then 3
		          when higher.pipeline_id is not null then 2
		          else 1
		        end
		      ) > (
		        case
		          when p.stage_id is not null then 3
		          when p.pipeline_id is not null then 2
		          else 1
		        end
		      )
		  )
		order by due.delivery_rank, due.group_rank, i.next_evaluation_at, i.id
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

	notify := shouldEmitAttentionNotification(instance, evaluation)
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

func shouldEmitAttentionNotification(instance workerInstance, evaluation Evaluation) bool {
	if strings.EqualFold(strings.TrimSpace(instance.PolicyType), "cadence_task") {
		return false
	}
	return evaluation.Notify && instance.EngineMode == "enabled" && !instance.Shadow &&
		instance.NotificationsEnabled && instance.PolicyStatus != "shadow" && instance.PolicyStatus != "paused"
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
