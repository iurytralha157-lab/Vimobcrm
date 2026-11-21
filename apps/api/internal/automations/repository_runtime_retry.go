package automations

import (
	"context"
	"strings"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) RetryRuntimeIssue(ctx context.Context, tenantContext tenant.Context, kind string, issueID string) error {
	if !canManageAutomations(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}
	issueID, ok := normalizeUUID(issueID)
	if !ok {
		return ErrInvalidInput
	}
	kind = strings.TrimSpace(kind)
	if kind != "dead_letter" && kind != "failed_event" && kind != "failed_effect" && kind != "circuit_decision" {
		return ErrRuntimeIssueNotRetryable
	}
	if kind == "failed_effect" {
		var resetCount int
		err := repo.db.Pool().QueryRow(ctx, `
			with locked_conversation as materialized (
			  select
			    conversation.id,
			    conversation.organization_id,
			    conversation.session_id,
			    conversation.lead_id
			  from public.automation_effect_dispatches dispatch
			  join public.whatsapp_outbox outbox
			    on outbox.organization_id = dispatch.organization_id
			   and dispatch.response->>'outbox_id' = outbox.id::text
			  join public.whatsapp_conversations conversation
			    on conversation.id = outbox.conversation_id
			   and conversation.organization_id = outbox.organization_id
			   and conversation.session_id = outbox.session_id
			  where dispatch.id = $1::uuid
			    and dispatch.organization_id = $2::uuid
			    and dispatch.status = 'failed'
			    and dispatch.request->>'delivery_contract' = 'canonical_whatsapp_outbox_v1'
			    and dispatch.request->>'session_id' = outbox.session_id::text
			    and outbox.status = 'failed'
			  for no key update of conversation
			), target as materialized (
			  select dispatch.id as dispatch_id, outbox.id, outbox.message_id, outbox.organization_id
			  from locked_conversation conversation
			  join public.automation_effect_dispatches dispatch
			    on dispatch.organization_id = conversation.organization_id
			  join public.automation_executions execution
			    on execution.id = dispatch.execution_id
			   and execution.organization_id = dispatch.organization_id
			   and execution.conversation_id = conversation.id
			   and execution.lead_id = conversation.lead_id
			  join public.whatsapp_outbox outbox
			    on outbox.organization_id = dispatch.organization_id
			   and outbox.conversation_id = conversation.id
			   and outbox.session_id = conversation.session_id
			   and dispatch.response->>'outbox_id' = outbox.id::text
			   and dispatch.response->>'message_id' = outbox.message_id::text
			   and outbox.client_message_id = dispatch.effect_key
			  join public.whatsapp_messages message
			    on message.id = outbox.message_id
			   and message.organization_id = outbox.organization_id
			   and message.session_id = outbox.session_id
			   and message.conversation_id = outbox.conversation_id
			   and message.lead_id = conversation.lead_id
			   and message.client_message_id = dispatch.effect_key
			   and message.metadata->>'automation_effect_key' = dispatch.effect_key
			  join public.whatsapp_conversation_lead_bindings binding
			    on binding.organization_id = conversation.organization_id
			   and binding.conversation_id = conversation.id
			   and binding.session_id = conversation.session_id
			   and binding.lead_id = conversation.lead_id
			   and binding.active_to is null
			  join public.whatsapp_sessions session
			    on session.id = outbox.session_id
			   and session.organization_id = outbox.organization_id
			  where dispatch.id = $1::uuid
			    and dispatch.organization_id = $2::uuid
			    and dispatch.status = 'failed'
			    and dispatch.request->>'delivery_contract' = 'canonical_whatsapp_outbox_v1'
			    and dispatch.request->>'session_id' = outbox.session_id::text
			    and outbox.status = 'failed'
			    and session.provider = 'evolution_go'
			    and session.status = 'connected'
			    and coalesce(session.is_active, true)
			    and exists (
			      select 1 from public.organization_modules module
			      where module.organization_id = dispatch.organization_id
			        and lower(trim(module.module_name)) = 'automations'
			        and coalesce(module.is_enabled, false)
			    )
			  for update of dispatch, outbox
			), reset_outbox as (
			  update public.whatsapp_outbox outbox
			  set status = 'pending', attempts = 0, next_attempt_at = now(),
			      locked_at = null, locked_by = null, last_error = null,
			      failed_at = null, dead_lettered_at = null, updated_at = now()
			  from target
			  where outbox.id = target.id and outbox.organization_id = target.organization_id
			  returning outbox.id, outbox.message_id, outbox.organization_id
			), reset_dispatch as (
			  update public.automation_effect_dispatches dispatch
			  set status = 'succeeded',
			      response = (coalesce(dispatch.response, '{}'::jsonb) - 'last_error')
			        || jsonb_build_object('status', 'queued', 'delivery_status', 'queued'),
			      provider_id = null,
			      error_message = null,
			      attempted_at = now(),
			      completed_at = now()
			  from target
			  where dispatch.id = target.dispatch_id
			    and dispatch.organization_id = target.organization_id
			  returning dispatch.id
			), reset_message as (
			  update public.whatsapp_messages message
			  set status = 'queued', updated_at = now()
			  from reset_outbox
			  where message.id = reset_outbox.message_id
			    and message.organization_id = reset_outbox.organization_id
			  returning message.id
			), reset_timeline as (
			  update public.lead_timeline_events timeline
			  set event_type = 'whatsapp_message_queued',
			      title = 'Mensagem WhatsApp reenfileirada',
			      metadata = (coalesce(timeline.metadata, '{}'::jsonb) - 'last_error')
			        || jsonb_build_object('delivery_status', 'queued')
			  from reset_outbox
			  where timeline.organization_id = reset_outbox.organization_id
			    and timeline.metadata->>'outbox_id' = reset_outbox.id::text
			  returning timeline.id
			)
			select count(*)::integer from reset_outbox
		`, issueID, tenantContext.OrganizationID).Scan(&resetCount)
		if err != nil {
			return err
		}
		if resetCount != 1 {
			return ErrRuntimeIssueNotRetryable
		}
		return nil
	}

	// A conversation-scoped event belongs to one binding epoch, not merely to a
	// lead id. Lock the conversation before the event (the same order used by a
	// rebind), and require the immutable binding id captured with the message.
	// This keeps both A->B and A->B->A retries fail-closed. Lead-only events keep
	// the historical event-row-only retry path.
	tag, err := repo.db.Pool().Exec(ctx, `
		with event_route as materialized (
		  select event.conversation_id
		  from public.automation_event_outbox event
		  where event.id = $1::uuid
		    and event.organization_id = $2::uuid
		), locked_conversation as materialized (
		  select
		    conversation.id,
		    conversation.organization_id,
		    conversation.session_id,
		    conversation.lead_id
		  from event_route route
		  join public.whatsapp_conversations conversation
		    on conversation.id = route.conversation_id
		   and conversation.organization_id = $2::uuid
		  where route.conversation_id is not null
		    and conversation.deleted_at is null
		    and coalesce(conversation.is_group, false) = false
		  for no key update of conversation
		), target as materialized (
		  select event.id, event.organization_id
		  from event_route route
		  join public.automation_event_outbox event
		    on event.id = $1::uuid
		   and event.organization_id = $2::uuid
		   and event.conversation_id is not distinct from route.conversation_id
		  left join locked_conversation conversation
		    on conversation.id = event.conversation_id
		   and conversation.organization_id = event.organization_id
		  left join public.whatsapp_conversation_lead_bindings binding
		    on binding.organization_id = conversation.organization_id
		   and binding.conversation_id = conversation.id
		   and binding.session_id = conversation.session_id
		   and binding.lead_id = conversation.lead_id
		   and binding.active_to is null
		  left join public.whatsapp_messages message
		    on message.id = event.aggregate_id
		   and message.organization_id = conversation.organization_id
		   and message.session_id = conversation.session_id
		   and message.conversation_id = conversation.id
		   and message.lead_id = conversation.lead_id
		  where exists (
		    select 1 from public.organization_modules module
		    where module.organization_id = event.organization_id
		      and lower(trim(module.module_name)) = 'automations'
		      and coalesce(module.is_enabled, false)
		  )
		  and (
		    ($3 in ('dead_letter', 'failed_event') and event.status in ('dead_letter', 'failed'))
		    or (
		      $3 = 'circuit_decision'
		      and event.status = 'completed'
		      and exists (
		        select 1
		        from jsonb_array_elements(
		          coalesce(event.payload->'runtime_decisions', '[]'::jsonb)
		        ) decision
		        where decision->>'type' = 'circuit_open'
		      )
		      and not exists (
		        select 1
		        from jsonb_array_elements(
		          coalesce(event.payload->'runtime_decisions', '[]'::jsonb)
		        ) decision
		        join public.automation_circuit_breakers breaker
		          on breaker.organization_id = event.organization_id
		         and breaker.automation_id = nullif(decision->>'automation_id', '')::uuid
		         and breaker.lead_id = event.lead_id
		         and breaker.open_until > now()
		        where decision->>'type' = 'circuit_open'
		      )
		    )
		  )
		  and (
		    (
		      event.conversation_id is null
		      and event.event_type <> 'message_received'
		      and event.aggregate_type <> 'whatsapp_message'
		      and nullif(btrim(event.payload->>'conversation_id'), '') is null
		      and nullif(btrim(event.payload->>'whatsapp_binding_id'), '') is null
		    )
		    or (
		      conversation.id is not null
		      and conversation.lead_id is not null
		      and event.lead_id = conversation.lead_id
		      and event.payload->>'conversation_id' = conversation.id::text
		      and event.payload->>'lead_id' = conversation.lead_id::text
		      and event.payload->>'session_id' = conversation.session_id::text
		      and event.payload->>'whatsapp_binding_id' = binding.id::text
		      and (
		        event.event_type <> 'message_received'
		        or (
		          event.aggregate_type = 'whatsapp_message'
		          and event.payload->>'message_id' = message.id::text
		        )
		      )
		    )
		  )
		  for update of event
		)
		update public.automation_event_outbox event
		set status = 'pending',
		    attempts = 0,
		    available_at = now(),
		    locked_at = null,
		    locked_by = null,
		    completed_at = null,
		    dead_lettered_at = null,
		    last_error = null,
		    payload = event.payload - 'runtime_decisions',
		    updated_at = now()
		from target
		where event.id = target.id
		  and event.organization_id = target.organization_id
	`, issueID, tenantContext.OrganizationID, kind)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return ErrRuntimeIssueNotRetryable
	}
	return nil
}
