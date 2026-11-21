package automations

import (
	"context"
	"encoding/json"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/leadscope"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) ListRuntimeIssues(ctx context.Context, tenantContext tenant.Context, limit int, offset int) (RuntimeIssuesResult, error) {
	if !canViewAutomations(tenantContext) {
		return RuntimeIssuesResult{}, tenant.ErrOrganizationAccessDenied
	}
	if limit < 1 || limit > 200 {
		limit = 50
	}
	if offset < 0 || offset > 10000 {
		return RuntimeIssuesResult{}, ErrInvalidInput
	}

	result := RuntimeIssuesResult{Issues: []RuntimeIssue{}}
	if err := repo.db.Pool().QueryRow(ctx, `
		select
		  (select count(*) from public.automation_event_outbox o where o.organization_id = $1::uuid and o.status = 'dead_letter'),
		  (select count(*) from public.automation_event_outbox o where o.organization_id = $1::uuid and o.status = 'failed'),
		  (select count(*)
		   from public.automation_effect_dispatches d
		   join public.whatsapp_outbox outbox
		     on outbox.organization_id = d.organization_id
		    and d.response->>'outbox_id' = outbox.id::text
		   where d.organization_id = $1::uuid
		     and d.status = 'failed'
		     and d.request->>'delivery_contract' = 'canonical_whatsapp_outbox_v1'
		     and outbox.status = 'failed'),
		  (select count(*) from public.automation_circuit_breakers c where c.organization_id = $1::uuid and c.open_until > now()),
		  (select count(*)
		   from public.automation_event_outbox o
		   cross join lateral jsonb_array_elements(coalesce(o.payload->'runtime_decisions', '[]'::jsonb)) decision
		   where o.organization_id = $1::uuid and decision->>'type' = 'duplicate_or_already_active'),
		  (select count(*) from public.automation_effect_dispatches d where d.organization_id = $1::uuid and d.status = 'unknown'),
		  (select count(*) from public.automation_effect_dispatches d where d.organization_id = $1::uuid and d.status = 'sending' and d.attempted_at < now() - interval '2 minutes')
	`, tenantContext.OrganizationID).Scan(
		&result.Summary.DeadLetters,
		&result.Summary.FailedEvents,
		&result.Summary.FailedEffects,
		&result.Summary.OpenCircuits,
		&result.Summary.DuplicateDecisions,
		&result.Summary.UnknownEffects,
		&result.Summary.StaleSendingEffects,
	); err != nil {
		return RuntimeIssuesResult{}, err
	}

	leadVisibility := leadscope.VisibilitySQL("l", "$5", "$4", "$6", leadscope.CanViewOwn(tenantContext))
	rows, err := repo.db.Pool().Query(ctx, `
		with issue_rows as (
		  select
		    o.id::text as id,
		    case when o.status = 'dead_letter' then 'dead_letter' else 'failed_event' end as kind,
		    case when o.status = 'dead_letter' then 'error' else 'warning' end as severity,
		    o.status,
		    null::text as automation_id,
		    null::text as automation_name,
		    null::text as execution_id,
		    o.lead_id,
		    left(coalesce(o.last_error, 'trigger processing failed'), 500) as message,
		    jsonb_build_object('eventType', o.event_type, 'attempts', o.attempts, 'maxAttempts', o.max_attempts) as details,
		    exists (
		      select 1 from public.organization_modules module
		      where module.organization_id = o.organization_id
		        and lower(trim(module.module_name)) = 'automations'
		        and coalesce(module.is_enabled, false)
		    ) as retryable,
		    coalesce(o.dead_lettered_at, o.updated_at, o.created_at) as occurred_at
		  from public.automation_event_outbox o
		  where o.organization_id = $1::uuid and o.status in ('dead_letter', 'failed')

		  union all

		  select
		    d.id::text,
		    'failed_effect',
		    'error',
		    outbox.status,
		    e.automation_id::text,
		    a.name,
		    d.execution_id::text,
		    e.lead_id,
		    left(coalesce(d.error_message, outbox.last_error, 'WhatsApp delivery failed'), 500),
		    jsonb_build_object(
		      'effectType', d.effect_type,
		      'nodeKey', d.node_key,
		      'effectKey', d.effect_key,
		      'outboxId', outbox.id,
		      'outboxStatus', outbox.status,
		      'attempts', outbox.attempts,
		      'maxAttempts', outbox.max_attempts
		    ),
		    outbox.status = 'failed'
		      and session.provider = 'evolution_go'
		      and session.status = 'connected'
		      and coalesce(session.is_active, true),
		    coalesce(outbox.dead_lettered_at, outbox.failed_at, outbox.updated_at)
		  from public.automation_effect_dispatches d
		  join public.automation_executions e on e.id = d.execution_id and e.organization_id = d.organization_id
		  left join public.automations a on a.id = e.automation_id and a.organization_id = e.organization_id
		  join public.whatsapp_outbox outbox
		    on outbox.organization_id = d.organization_id
		   and d.response->>'outbox_id' = outbox.id::text
		  join public.whatsapp_sessions session
		    on session.id = outbox.session_id
		   and session.organization_id = outbox.organization_id
		  where d.organization_id = $1::uuid
		    and d.status = 'failed'
		    and d.request->>'delivery_contract' = 'canonical_whatsapp_outbox_v1'
		    and outbox.status = 'failed'

		  union all

		  select
		    o.id::text,
		    case when decision->>'type' = 'circuit_open' then 'circuit_decision' else 'duplicate_decision' end,
		    case when decision->>'type' = 'circuit_open' then 'warning' else 'info' end,
		    o.status,
		    decision->>'automation_id',
		    a.name,
		    null::text,
		    o.lead_id,
		    decision->>'type',
		    decision,
		    decision->>'type' = 'circuit_open' and not exists (
		      select 1 from public.automation_circuit_breakers breaker
		      where breaker.organization_id = o.organization_id
		        and breaker.automation_id = nullif(decision->>'automation_id', '')::uuid
		        and breaker.lead_id = o.lead_id
		        and breaker.open_until > now()
		    ),
		    coalesce(private.safe_automation_timestamptz(decision->>'recorded_at'), o.updated_at)
		  from public.automation_event_outbox o
		  cross join lateral jsonb_array_elements(coalesce(o.payload->'runtime_decisions', '[]'::jsonb)) decision
		  left join public.automations a
		    on a.id = nullif(decision->>'automation_id', '')::uuid and a.organization_id = o.organization_id
		  where o.organization_id = $1::uuid

		  union all

		  select
		    d.id::text,
		    'ambiguous_effect',
		    'error',
		    d.status,
		    e.automation_id::text,
		    a.name,
		    d.execution_id::text,
		    e.lead_id,
		    left(coalesce(d.error_message, 'provider outcome is ambiguous; automatic resend is disabled'), 500),
		    jsonb_build_object('effectType', d.effect_type, 'nodeKey', d.node_key, 'effectKey', d.effect_key, 'providerId', d.provider_id),
		    false,
		    d.attempted_at
		  from public.automation_effect_dispatches d
		  join public.automation_executions e on e.id = d.execution_id and e.organization_id = d.organization_id
		  left join public.automations a on a.id = e.automation_id and a.organization_id = e.organization_id
		  where d.organization_id = $1::uuid
		    and (d.status = 'unknown' or (d.status = 'sending' and d.attempted_at < now() - interval '2 minutes'))

		  union all

		  select
		    c.id::text,
		    'circuit_open',
		    'warning',
		    'open',
		    c.automation_id::text,
		    a.name,
		    null::text,
		    c.lead_id,
		    coalesce(c.reason, 'automation circuit is open'),
		    jsonb_build_object('executionCount', c.execution_count, 'openUntil', c.open_until),
		    false,
		    c.updated_at
		  from public.automation_circuit_breakers c
		  left join public.automations a on a.id = c.automation_id and a.organization_id = c.organization_id
		  where c.organization_id = $1::uuid and c.open_until > now()
		)
		select issue.id, issue.kind, issue.severity, issue.status,
		       coalesce(issue.automation_id, ''), coalesce(issue.automation_name, ''),
		       coalesce(issue.execution_id, ''), coalesce(l.id::text, ''),
		       case when l.id is not null then coalesce(issue.message, '') else issue.kind end,
		       case when l.id is not null then issue.details::text else '{}' end,
		       issue.retryable, issue.occurred_at::text
		from issue_rows issue
		left join public.leads l on l.id = issue.lead_id and l.organization_id = $1::uuid
		  and `+leadVisibility+`
		order by issue.occurred_at desc, issue.id desc
		limit $2 offset $3
	`, tenantContext.OrganizationID, limit, offset, tenantContext.UserID,
		leadscope.CanViewAll(tenantContext), leadscope.CanViewTeam(tenantContext))
	if err != nil {
		return RuntimeIssuesResult{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var issue RuntimeIssue
		var automationID, automationName, executionID, leadID, message, details string
		if err := rows.Scan(
			&issue.ID, &issue.Kind, &issue.Severity, &issue.Status,
			&automationID, &automationName, &executionID, &leadID, &message,
			&details, &issue.Retryable, &issue.OccurredAt,
		); err != nil {
			return RuntimeIssuesResult{}, err
		}
		issue.AutomationID = stringPtrFromSQL(automationID)
		issue.AutomationName = stringPtrFromSQL(automationName)
		issue.ExecutionID = stringPtrFromSQL(executionID)
		issue.LeadID = stringPtrFromSQL(leadID)
		issue.Message = stringPtrFromSQL(message)
		issue.Details = json.RawMessage(details)
		result.Issues = append(result.Issues, issue)
	}
	return result, rows.Err()
}
