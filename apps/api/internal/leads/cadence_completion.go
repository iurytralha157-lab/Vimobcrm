package leads

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

var ErrCadenceCompletionConflict = errors.New("cadence task was completed with different input")

func sameCadenceCompletion(task LeadTask, request CompleteCadenceTaskRequest) bool {
	normalize := func(value *string) string {
		if value == nil {
			return ""
		}
		return strings.TrimSpace(*value)
	}
	return normalize(task.Outcome) == normalize(request.Outcome) &&
		normalize(task.OutcomeNotes) == normalize(request.OutcomeNotes)
}

// The caller owns commit/rollback and dispatches gamification only for a new completion.
func completeCadenceTaskTx(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, request CompleteCadenceTaskRequest) (LeadTask, bool, error) {
	// Cadence lifecycle paths lock lead -> tasks -> enrollment. Keep completion
	// in the same order so a simultaneous stage move, reassignment or cadence
	// switch cannot deadlock or invalidate this task between authorization and
	// completion.
	if err := ensureLeadEditableForUpdate(ctx, tx, tenantContext, request.LeadID); err != nil {
		return LeadTask{}, false, err
	}

	var existingID, status string
	var outcomeRequired bool
	var templateTaskID pgtype.Text
	err := tx.QueryRow(ctx, `
		select
			lt.id::text,
			coalesce(lt.status, case when coalesce(lt.is_done, false) then 'completed' else 'pending' end),
			case
			  when lower(coalesce(lt.metadata->>'outcome_required', '')) in ('true', '1', 'yes') then true
			  when lower(coalesce(lt.metadata->>'outcome_required', '')) in ('false', '0', 'no') then false
			  else coalesce(ctt.outcome_required, false)
			end,
			lt.cadence_template_task_id::text
		from public.lead_tasks lt
		join public.cadence_enrollments ce
		  on ce.organization_id = lt.organization_id
		 and ce.id = lt.cadence_enrollment_id
		 and ce.status in ('active', 'completed')
		join public.lead_stage_cycles sc
		  on sc.organization_id = ce.organization_id
		 and sc.id = ce.stage_cycle_id
		 and sc.exited_at is null
		join public.leads l
		  on l.organization_id = lt.organization_id
		 and l.id = lt.lead_id
		 and l.deal_status = 'open'
		 and l.stage_id = sc.stage_id
		left join public.cadence_tasks_template ctt
		  on ctt.organization_id = lt.organization_id
		 and ctt.id = lt.cadence_template_task_id
		where lt.organization_id = $1::uuid
		  and lt.lead_id = $2::uuid
		  and coalesce(lt.status, case when coalesce(lt.is_done, false) then 'completed' else 'pending' end) in ('pending', 'completed')
		  and (
			(nullif($3, '') is not null and lt.id = nullif($3, '')::uuid)
			or (
			  nullif($3, '') is null
			  and lt.cadence_template_task_id = nullif($4, '')::uuid
			)
		  )
		order by
		  case coalesce(lt.status, case when coalesce(lt.is_done, false) then 'completed' else 'pending' end)
		    when 'pending' then 0 else 1
		  end,
		  lt.created_at desc,
		  lt.id desc
		limit 1
		for update of lt
	`, tenantContext.OrganizationID, request.LeadID, request.TaskID, request.TemplateTaskID).Scan(
		&existingID,
		&status,
		&outcomeRequired,
		&templateTaskID,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return LeadTask{}, false, ErrInvalidReference
	}
	if err != nil {
		return LeadTask{}, false, err
	}
	if outcomeRequired && (request.Outcome == nil || strings.TrimSpace(*request.Outcome) == "") {
		return LeadTask{}, false, fmt.Errorf("%w: outcome is required for this cadence task", ErrInvalidInput)
	}

	if status == "completed" {
		task, err := scanLeadTask(tx.QueryRow(ctx, `
			select id::text, lead_id::text, day_offset, type, title, description, due_date,
				is_done, done_at, done_by::text, outcome, outcome_notes, created_at
			from public.lead_tasks
			where organization_id = $1::uuid and id = $2::uuid
		`, tenantContext.OrganizationID, existingID))
		if err != nil {
			return LeadTask{}, false, err
		}
		if !sameCadenceCompletion(task, request) {
			return LeadTask{}, false, ErrCadenceCompletionConflict
		}
		return task, false, nil
	}

	task, err := scanLeadTask(tx.QueryRow(ctx, `
		update public.lead_tasks
		set is_done = true,
			status = 'completed',
			done_at = now(),
			completed_at = now(),
			done_by = $3::uuid,
			outcome = coalesce($4, outcome),
			outcome_notes = coalesce($5, outcome_notes)
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and coalesce(
		    status,
		    case when coalesce(is_done, false) then 'completed' else 'pending' end
		  ) = 'pending'
		  and coalesce(is_done, false) = false
		returning id::text, lead_id::text, day_offset, type, title, description, due_date,
			is_done, done_at, done_by::text, outcome, outcome_notes, created_at
	`, tenantContext.OrganizationID, existingID, tenantContext.UserID, request.Outcome, request.OutcomeNotes))
	if err != nil {
		return LeadTask{}, false, err
	}

	activityMetadata := map[string]any{
		"task_id":    task.ID,
		"task_type":  task.Type,
		"day_offset": task.DayOffset,
	}
	if templateTaskID.Valid {
		activityMetadata["template_task_id"] = templateTaskID.String
	}
	if request.Outcome != nil {
		activityMetadata["outcome"] = *request.Outcome
	}
	if request.OutcomeNotes != nil {
		activityMetadata["outcome_notes"] = *request.OutcomeNotes
	}
	if _, err := tx.Exec(ctx, `
		insert into public.activities (
			organization_id, lead_id, type, content, user_id, metadata
		) values (
			$1::uuid, $2::uuid, 'task_completed', $3, $4::uuid, $5::jsonb
		)
	`, tenantContext.OrganizationID, request.LeadID, "Cadencia concluida: "+task.Title, tenantContext.UserID, jsonb(activityMetadata)); err != nil {
		return LeadTask{}, false, err
	}
	return task, true, nil
}
