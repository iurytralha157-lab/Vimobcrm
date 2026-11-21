package automations

import (
	"context"
	"strconv"
	"strings"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/leadscope"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type ExecutionFilter struct {
	AutomationID string
	LeadID       string
	ActiveOnly   bool
	Limit        int
	Offset       int
	Status       string
	DateFrom     *time.Time
	DateTo       *time.Time
}

type ExecutionStepFilter struct {
	Limit  int
	Offset int
}

func (repo Repository) ListExecutions(ctx context.Context, tenantContext tenant.Context, filter ExecutionFilter) ([]AutomationExecution, error) {
	if !canViewAutomations(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	if filter.Limit <= 0 || filter.Limit > 200 {
		filter.Limit = 50
	}

	args := []any{tenantContext.OrganizationID, filter.Limit, tenantContext.UserID,
		leadscope.CanViewAll(tenantContext), leadscope.CanViewTeam(tenantContext)}
	// Join only visible leads so monitoring can show status without exposing
	// lead identifiers, raw payloads, or error text to other operators.
	leadVisibility := leadscope.VisibilitySQL("l", "$4", "$3", "$5", leadscope.CanViewOwn(tenantContext))
	where := []string{"ae.organization_id = $1::uuid"}
	if filter.AutomationID != "" {
		automationID, ok := normalizeUUID(filter.AutomationID)
		if !ok {
			return nil, ErrInvalidInput
		}
		args = append(args, automationID)
		where = append(where, "ae.automation_id = $"+strconv.Itoa(len(args))+"::uuid")
	}
	if filter.LeadID != "" {
		leadID, ok := normalizeUUID(filter.LeadID)
		if !ok {
			return nil, ErrInvalidInput
		}
		args = append(args, leadID)
		leadParameter := "$" + strconv.Itoa(len(args)) + "::uuid"
		where = append(where, "ae.lead_id = "+leadParameter+" and l.id is not null")
	}
	if filter.ActiveOnly {
		where = append(where, "ae.status in ('queued', 'running', 'waiting')")
	}
	if filter.Offset < 0 || filter.Offset > 100000 {
		return nil, ErrInvalidInput
	}
	if filter.Status != "" {
		statuses, ok := executionStatusFilterValues(filter.Status)
		if !ok {
			return nil, ErrInvalidInput
		}
		args = append(args, statuses)
		where = append(where, "ae.status = any($"+strconv.Itoa(len(args))+"::text[])")
	}
	if filter.DateFrom != nil {
		args = append(args, *filter.DateFrom)
		where = append(where, "ae.started_at >= $"+strconv.Itoa(len(args))+"::timestamptz")
	}
	if filter.DateTo != nil {
		args = append(args, *filter.DateTo)
		where = append(where, "ae.started_at <= $"+strconv.Itoa(len(args))+"::timestamptz")
	}
	if filter.DateFrom != nil && filter.DateTo != nil && filter.DateTo.Before(*filter.DateFrom) {
		return nil, ErrInvalidInput
	}
	args = append(args, filter.Offset)

	rows, err := repo.db.Pool().Query(ctx, `
		select
			ae.id::text,
			coalesce(ae.automation_id::text, ''),
			coalesce(l.id::text, ''),
			case when l.id is not null then coalesce(ae.conversation_id::text, '') else '' end,
			ae.organization_id::text,
			ae.status,
			coalesce(ae.current_node_id::text, ''),
			coalesce(ae.current_node_key, ''),
			coalesce(ae.started_at::text, ''),
			coalesce(ae.completed_at::text, ''),
			case when l.id is not null then coalesce(ae.error_message, '') else '' end,
			case when l.id is not null then coalesce(ae.execution_data, '{}'::jsonb)::text else '{}' end,
			coalesce(ae.next_execution_at::text, ''),
			coalesce(l.id::text, ''),
			coalesce(l.name, ''),
			coalesce(a.id::text, ''),
			coalesce(a.name, '')
		from public.automation_executions ae
		left join public.leads l on l.id = ae.lead_id and l.organization_id = ae.organization_id
		  and `+leadVisibility+`
		left join public.automations a on a.id = ae.automation_id and a.organization_id = ae.organization_id
		where `+strings.Join(where, " and ")+`
		order by ae.started_at desc, ae.id desc
		limit $2::integer
		offset $`+strconv.Itoa(len(args))+`::integer
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []AutomationExecution{}
	for rows.Next() {
		item, err := scanExecution(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}

	return items, rows.Err()
}

func (repo Repository) ListExecutionSummaries(ctx context.Context, tenantContext tenant.Context) ([]AutomationExecutionSummary, error) {
	if !canViewAutomations(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	rows, err := repo.db.Pool().Query(ctx, `
		select
		  a.id::text,
		  count(execution.id)::integer,
		  count(*) filter (where execution.status = 'queued')::integer,
		  count(*) filter (where execution.status = 'running')::integer,
		  count(*) filter (where execution.status = 'waiting')::integer,
		  count(*) filter (where execution.status = 'completed')::integer,
		  count(*) filter (where execution.status = 'failed')::integer,
		  count(*) filter (where execution.status in ('cancelled', 'canceled'))::integer,
		  coalesce(array(
		    select active_execution.id::text
		    from public.automation_executions active_execution
		    where active_execution.automation_id = a.id
		      and active_execution.organization_id = a.organization_id
		      and active_execution.status in ('queued', 'running', 'waiting')
		    order by active_execution.started_at desc, active_execution.id desc
		    limit 100
		  ), array[]::text[]),
		  count(*) filter (where execution.status in ('queued', 'running', 'waiting')) > 100,
		  coalesce(max(execution.started_at)::text, '')
		from public.automations a
		left join public.automation_executions execution
		  on execution.automation_id = a.id and execution.organization_id = a.organization_id
		where a.organization_id = $1::uuid and a.deleted_at is null
		group by a.id, a.organization_id
		order by a.created_at desc, a.id desc
	`, tenantContext.OrganizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []AutomationExecutionSummary{}
	for rows.Next() {
		var item AutomationExecutionSummary
		var lastStartedAt string
		if err := rows.Scan(
			&item.AutomationID, &item.Total, &item.Queued, &item.Running,
			&item.Waiting, &item.Completed, &item.Failed, &item.Cancelled,
			&item.ActiveExecutionIDs, &item.ActiveIDsTruncated, &lastStartedAt,
		); err != nil {
			return nil, err
		}
		item.LastStartedAt = stringPtrFromSQL(lastStartedAt)
		items = append(items, item)
	}
	return items, rows.Err()
}

func (repo Repository) ListExecutionSteps(ctx context.Context, tenantContext tenant.Context, executionID string, filter ExecutionStepFilter) ([]AutomationExecutionStep, error) {
	if !canViewAutomations(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	executionID, ok := normalizeUUID(executionID)
	if !ok {
		return nil, ErrInvalidInput
	}
	if filter.Limit < 1 || filter.Limit > 200 {
		filter.Limit = 50
	}
	if filter.Offset < 0 || filter.Offset > 10000 {
		return nil, ErrInvalidInput
	}

	var executionExists bool
	if err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1 from public.automation_executions
			where id = $1::uuid and organization_id = $2::uuid
		)
	`, executionID, tenantContext.OrganizationID).Scan(&executionExists); err != nil {
		return nil, err
	}
	if !executionExists {
		return nil, ErrExecutionNotFound
	}

	leadVisibility := leadscope.VisibilitySQL("l", "$6", "$5", "$7", leadscope.CanViewOwn(tenantContext))
	rows, err := repo.db.Pool().Query(ctx, `
		select
			step.id::text,
			step.execution_id::text,
			step.node_key,
			step.node_type,
			coalesce(step.action_type, ''),
			step.status,
			step.attempt,
			coalesce(step.started_at::text, ''),
			coalesce(step.completed_at::text, ''),
			case when l.id is not null then coalesce(left(step.error_message, 500), '') else '' end
		from public.automation_execution_steps step
		join public.automation_executions execution
		  on execution.id = step.execution_id and execution.organization_id = step.organization_id
		left join public.leads l on l.id = execution.lead_id and l.organization_id = execution.organization_id
		  and `+leadVisibility+`
		where step.execution_id = $1::uuid
		  and step.organization_id = $2::uuid
		order by step.started_at asc, step.id asc
		limit $3 offset $4
	`, executionID, tenantContext.OrganizationID, filter.Limit, filter.Offset, tenantContext.UserID,
		leadscope.CanViewAll(tenantContext), leadscope.CanViewTeam(tenantContext))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	steps := []AutomationExecutionStep{}
	for rows.Next() {
		var step AutomationExecutionStep
		var actionType, completedAt, errorMessage string
		if err := rows.Scan(
			&step.ID,
			&step.ExecutionID,
			&step.NodeKey,
			&step.NodeType,
			&actionType,
			&step.Status,
			&step.Attempt,
			&step.StartedAt,
			&completedAt,
			&errorMessage,
		); err != nil {
			return nil, err
		}
		step.ActionType = stringPtrFromSQL(actionType)
		step.CompletedAt = stringPtrFromSQL(completedAt)
		step.ErrorMessage = stringPtrFromSQL(errorMessage)
		steps = append(steps, step)
	}
	return steps, rows.Err()
}

func scanExecution(row scanner) (AutomationExecution, error) {
	var item AutomationExecution
	var automationID string
	var leadID string
	var conversationID string
	var currentNodeID string
	var currentNodeKey string
	var completedAt string
	var errorMessage string
	var executionData string
	var nextExecutionAt string
	var leadRefID string
	var leadName string
	var automationRefID string
	var automationName string
	if err := row.Scan(
		&item.ID,
		&automationID,
		&leadID,
		&conversationID,
		&item.OrganizationID,
		&item.Status,
		&currentNodeID,
		&currentNodeKey,
		&item.StartedAt,
		&completedAt,
		&errorMessage,
		&executionData,
		&nextExecutionAt,
		&leadRefID,
		&leadName,
		&automationRefID,
		&automationName,
	); err != nil {
		return AutomationExecution{}, err
	}

	item.AutomationID = stringPtrFromSQL(automationID)
	item.LeadID = stringPtrFromSQL(leadID)
	item.ConversationID = stringPtrFromSQL(conversationID)
	item.CurrentNodeID = stringPtrFromSQL(currentNodeID)
	item.CurrentNodeKey = stringPtrFromSQL(currentNodeKey)
	item.CompletedAt = stringPtrFromSQL(completedAt)
	item.ErrorMessage = stringPtrFromSQL(errorMessage)
	item.ExecutionData = rawJSON(executionData, "{}")
	item.NextExecutionAt = stringPtrFromSQL(nextExecutionAt)
	if leadRefID != "" {
		item.Lead = &Ref{ID: leadRefID, Name: stringPtrFromSQL(leadName)}
	}
	if automationRefID != "" {
		item.Automation = &Ref{ID: automationRefID, Name: stringPtrFromSQL(automationName)}
	}

	return item, nil
}
