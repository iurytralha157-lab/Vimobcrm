package cadences

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/authorization"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type LeadCadenceState struct {
	LeadID         string                      `json:"lead_id"`
	DealStatus     string                      `json:"deal_status"`
	StageID        string                      `json:"stage_id"`
	StageName      string                      `json:"stage_name"`
	StageCycleID   *string                     `json:"stage_cycle_id,omitempty"`
	StageEnteredAt *time.Time                  `json:"stage_entered_at,omitempty"`
	CadenceEnabled bool                        `json:"cadence_enabled"`
	Enrollment     *LeadCadenceEnrollmentState `json:"enrollment,omitempty"`
	Tasks          []LeadCadenceTaskState      `json:"tasks"`
	Summary        LeadCadenceSummary          `json:"summary"`
}

type LeadCadenceEnrollmentState struct {
	ID           string     `json:"id"`
	TemplateID   string     `json:"template_id"`
	TemplateName string     `json:"template_name"`
	Status       string     `json:"status"`
	StartedAt    time.Time  `json:"started_at"`
	CompletedAt  *time.Time `json:"completed_at,omitempty"`
}

type LeadCadenceTaskState struct {
	ID                 string     `json:"id"`
	TemplateTaskID     *string    `json:"template_task_id,omitempty"`
	Position           int        `json:"position"`
	Type               string     `json:"type"`
	Title              string     `json:"title"`
	Description        *string    `json:"description,omitempty"`
	Observation        *string    `json:"observation,omitempty"`
	RecommendedMessage *string    `json:"recommended_message,omitempty"`
	DueAt              *time.Time `json:"due_at,omitempty"`
	Status             string     `json:"status"`
	IsDone             bool       `json:"is_done"`
	DoneAt             *time.Time `json:"done_at,omitempty"`
	Outcome            *string    `json:"outcome,omitempty"`
	OutcomeNotes       *string    `json:"outcome_notes,omitempty"`
	IsRequired         bool       `json:"is_required"`
	OutcomeRequired    bool       `json:"outcome_required"`
}

type LeadCadenceSummary struct {
	Total      int     `json:"total"`
	Completed  int     `json:"completed"`
	Pending    int     `json:"pending"`
	Overdue    int     `json:"overdue"`
	NextTaskID *string `json:"next_task_id,omitempty"`
}

func (repo Repository) GetLeadCadenceState(ctx context.Context, tenantContext tenant.Context, leadID string) (LeadCadenceState, error) {
	leadID, ok := normalizeUUID(leadID)
	if !ok {
		return LeadCadenceState{}, ErrInvalidInput
	}

	var state LeadCadenceState
	var assignedUserID, teamID pgtype.Text
	var stageCycleID pgtype.Text
	var stageEnteredAt pgtype.Timestamptz
	var enrollmentID, templateID, templateName, enrollmentStatus pgtype.Text
	var enrollmentStartedAt, enrollmentCompletedAt pgtype.Timestamptz
	err := repo.db.Pool().QueryRow(ctx, `
		select
			l.id::text,
			coalesce(l.deal_status, 'open'),
			l.stage_id::text,
			s.name,
			l.assigned_user_id::text,
			l.team_id::text,
			sc.id::text,
			sc.entered_at,
			(
			  coalesce(soc.cadence_enabled, false)
			  or (
			    ce.id is not null
			    and ce.status in ('active', 'completed')
			  )
			),
			ce.id::text,
			ce.cadence_template_id::text,
			coalesce(
				ce.template_snapshot->'template'->>'name',
				ce.template_snapshot->>'name',
				ct.name,
				''
			),
			ce.status,
			ce.started_at,
			ce.completed_at
		from public.leads l
		join public.stages s
		  on s.organization_id = l.organization_id and s.id = l.stage_id
		left join public.stage_operational_configs soc
		  on soc.organization_id = l.organization_id and soc.stage_id = l.stage_id
		left join lateral (
			select cycle.id, cycle.entered_at
			from public.lead_stage_cycles cycle
			where cycle.organization_id = l.organization_id
			  and cycle.lead_id = l.id
			  and cycle.stage_id = l.stage_id
			  and (
				(l.deal_status = 'open' and cycle.exited_at is null)
				or l.deal_status <> 'open'
			  )
			order by (cycle.exited_at is null) desc, cycle.entered_at desc, cycle.id desc
			limit 1
		) sc on true
		left join lateral (
			select enrollment.*
			from public.cadence_enrollments enrollment
			where enrollment.organization_id = l.organization_id
			  and enrollment.lead_id = l.id
			  and enrollment.stage_cycle_id = sc.id
			order by
			  case enrollment.status when 'active' then 0 when 'completed' then 1 else 2 end,
			  enrollment.started_at desc,
			  enrollment.id desc
			limit 1
		) ce on true
		left join public.cadence_templates ct
		  on ct.organization_id = ce.organization_id and ct.id = ce.cadence_template_id
		where l.organization_id = $1::uuid and l.id = $2::uuid
	`, tenantContext.OrganizationID, leadID).Scan(
		&state.LeadID,
		&state.DealStatus,
		&state.StageID,
		&state.StageName,
		&assignedUserID,
		&teamID,
		&stageCycleID,
		&stageEnteredAt,
		&state.CadenceEnabled,
		&enrollmentID,
		&templateID,
		&templateName,
		&enrollmentStatus,
		&enrollmentStartedAt,
		&enrollmentCompletedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return LeadCadenceState{}, ErrCadenceNotFound
	}
	if err != nil {
		return LeadCadenceState{}, err
	}
	if !authorization.CanViewLead(tenantContext, authorization.LeadResource{
		AssignedUserID: textValue(assignedUserID),
		TeamID:         textValue(teamID),
	}) {
		return LeadCadenceState{}, tenant.ErrOrganizationAccessDenied
	}

	state.Tasks = []LeadCadenceTaskState{}
	state.StageCycleID = textPointer(stageCycleID)
	state.StageEnteredAt = pgTimePointer(stageEnteredAt)
	if enrollmentID.Valid {
		state.Enrollment = &LeadCadenceEnrollmentState{
			ID:           enrollmentID.String,
			TemplateID:   textValue(templateID),
			TemplateName: textValue(templateName),
			Status:       textValue(enrollmentStatus),
			StartedAt:    enrollmentStartedAt.Time,
			CompletedAt:  pgTimePointer(enrollmentCompletedAt),
		}
		if err := repo.loadLeadCadenceTasks(ctx, tenantContext.OrganizationID, state.Enrollment.ID, &state); err != nil {
			return LeadCadenceState{}, err
		}
	}
	return state, nil
}

func (repo Repository) loadLeadCadenceTasks(ctx context.Context, organizationID, enrollmentID string, state *LeadCadenceState) error {
	rows, err := repo.db.Pool().Query(ctx, `
		select
			lt.id::text,
			coalesce(
				lt.cadence_template_task_id::text,
				nullif(lt.metadata#>>'{template_task_snapshot,id}', '')
			),
			coalesce(lt.sequence, lt.day_offset, 0),
			coalesce(lt.type, 'note'),
			lt.title,
			lt.description,
			coalesce(
				nullif(lt.metadata#>>'{template_task_snapshot,observation}', ''),
				nullif(lt.metadata->>'observation', ''),
				ctt.observation
			),
			coalesce(
				nullif(lt.metadata#>>'{template_task_snapshot,recommended_message}', ''),
				nullif(lt.metadata#>>'{template_task_snapshot,message_template}', ''),
				nullif(lt.metadata->>'recommended_message', ''),
				nullif(lt.metadata->>'message_template', ''),
				ctt.recommended_message,
				ctt.message_template
			),
			coalesce(lt.due_at, lt.due_date),
			coalesce(lt.status, case when coalesce(lt.is_done, false) then 'completed' else 'pending' end),
			coalesce(lt.is_done, false),
			coalesce(lt.done_at, lt.completed_at),
			lt.outcome,
			lt.outcome_notes,
			coalesce(
				case lower(nullif(lt.metadata#>>'{template_task_snapshot,is_required}', ''))
				  when 'true' then true
				  when 'false' then false
				  else null
				end,
				case lower(nullif(lt.metadata->>'is_required', ''))
				  when 'true' then true
				  when 'false' then false
				  else null
				end,
				ctt.is_required,
				true
			),
			coalesce(
				case lower(nullif(lt.metadata#>>'{template_task_snapshot,outcome_required}', ''))
				  when 'true' then true
				  when 'false' then false
				  else null
				end,
				case lower(nullif(lt.metadata->>'outcome_required', ''))
				  when 'true' then true
				  when 'false' then false
				  else null
				end,
				ctt.outcome_required,
				false
			)
		from public.lead_tasks lt
		left join public.cadence_tasks_template ctt
		  on ctt.organization_id = lt.organization_id
		 and ctt.id = lt.cadence_template_task_id
		where lt.organization_id = $1::uuid
		  and lt.cadence_enrollment_id = $2::uuid
		order by coalesce(lt.sequence, lt.day_offset, 0), coalesce(lt.due_at, lt.due_date), lt.created_at, lt.id
	`, organizationID, enrollmentID)
	if err != nil {
		return err
	}
	defer rows.Close()

	now := time.Now().UTC()
	for rows.Next() {
		var task LeadCadenceTaskState
		var templateTaskID, description, observation, recommendedMessage pgtype.Text
		var dueAt, doneAt pgtype.Timestamptz
		var outcome, outcomeNotes pgtype.Text
		if err := rows.Scan(
			&task.ID,
			&templateTaskID,
			&task.Position,
			&task.Type,
			&task.Title,
			&description,
			&observation,
			&recommendedMessage,
			&dueAt,
			&task.Status,
			&task.IsDone,
			&doneAt,
			&outcome,
			&outcomeNotes,
			&task.IsRequired,
			&task.OutcomeRequired,
		); err != nil {
			return err
		}
		task.TemplateTaskID = textPointer(templateTaskID)
		task.Description = textPointer(description)
		task.Observation = textPointer(observation)
		task.RecommendedMessage = textPointer(recommendedMessage)
		task.DueAt = pgTimePointer(dueAt)
		task.DoneAt = pgTimePointer(doneAt)
		task.Outcome = textPointer(outcome)
		task.OutcomeNotes = textPointer(outcomeNotes)
		state.Tasks = append(state.Tasks, task)
		state.Summary.Total++
		switch task.Status {
		case "completed":
			state.Summary.Completed++
		case "pending":
			state.Summary.Pending++
			if task.DueAt != nil && task.DueAt.Before(now) {
				state.Summary.Overdue++
			}
			if state.Summary.NextTaskID == nil {
				taskID := task.ID
				state.Summary.NextTaskID = &taskID
			}
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("list lead cadence tasks: %w", err)
	}
	return nil
}

func pgTimePointer(value pgtype.Timestamptz) *time.Time {
	if !value.Valid {
		return nil
	}
	result := value.Time
	return &result
}
