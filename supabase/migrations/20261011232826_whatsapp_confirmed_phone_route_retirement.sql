-- Prepare one explicitly confirmed phone-route transition. The Go caller holds
-- this in the same transaction as terminal projections, binding closure,
-- retirement and opening/consenting the destination. No provider I/O or replay.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create function private.prepare_whatsapp_confirmed_phone_route_retirement(
  p_organization_id uuid,
  p_session_id uuid,
  p_conversation_id uuid,
  p_expected_lead_id uuid,
  p_actor_user_id uuid
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_session public.whatsapp_sessions%rowtype;
  v_conversation public.whatsapp_conversations%rowtype;
  v_canceled_ids uuid[] := '{}'::uuid[];
  v_now timestamptz := clock_timestamp();
begin
  if p_organization_id is null or p_session_id is null
     or p_conversation_id is null or p_expected_lead_id is null
     or p_actor_user_id is null then
    raise exception using errcode='22023', message='whatsapp_phone_retirement_arguments_invalid';
  end if;
  if auth.uid() is not null and auth.uid() is distinct from p_actor_user_id then
    raise exception using errcode='42501', message='whatsapp_phone_retirement_actor_denied';
  end if;

  select session.* into v_session from public.whatsapp_sessions session
  where session.organization_id=p_organization_id and session.id=p_session_id
    and session.provider='evolution_go' and coalesce(session.is_active,true)
    and session.status='connected'
  for share;
  if not found then
    raise exception using errcode='40001', message='whatsapp_phone_retirement_session_changed';
  end if;
  select conversation.* into v_conversation from public.whatsapp_conversations conversation
  where conversation.organization_id=p_organization_id and conversation.id=p_conversation_id
    and conversation.session_id=p_session_id and conversation.lead_id=p_expected_lead_id
    and conversation.deleted_at is null and conversation.retired_at is null
    and not conversation.is_group
  for update;
  if not found then
    raise exception using errcode='40001', message='whatsapp_phone_retirement_binding_changed';
  end if;

  perform lead.id from public.leads lead
  where lead.organization_id=p_organization_id and lead.id=p_expected_lead_id
  for share;
  if not found then
    raise exception using errcode='40001', message='whatsapp_phone_retirement_lead_changed';
  end if;
  perform actor.id from public.users actor
  join public.organization_members member on member.user_id=actor.id and member.organization_id=actor.organization_id
  where actor.id=p_actor_user_id and actor.organization_id=p_organization_id
    and coalesce(actor.is_active,false) and member.is_active and member.deleted_at is null
  for share of actor,member;
  if not found or not private.whatsapp_actor_can_read_lead(p_organization_id,p_expected_lead_id,p_actor_user_id)
     or not (
       v_session.owner_user_id=p_actor_user_id
       or exists (
         select 1 from public.whatsapp_session_access access
         join public.users owner_user on owner_user.id=v_session.owner_user_id
           and owner_user.organization_id=p_organization_id and coalesce(owner_user.is_active,false)
         join public.organization_members owner_member on owner_member.user_id=owner_user.id
           and owner_member.organization_id=p_organization_id and owner_member.is_active and owner_member.deleted_at is null
         join public.leads lead on lead.id=p_expected_lead_id and lead.organization_id=p_organization_id
           and lead.assigned_user_id=p_actor_user_id
         where access.organization_id=p_organization_id and access.session_id=p_session_id
           and access.user_id=p_actor_user_id and access.granted_by=v_session.owner_user_id
           and access.can_view and access.can_read and access.can_send and access.only_leads_access
           and access.access_mode='assigned_leads_only' and access.grant_scope='organization'
           and access.grant_team_id is null and owner_member.role in ('owner','admin')
       )
     ) then
    raise exception using errcode='42501', message='whatsapp_phone_retirement_actor_denied';
  end if;

  -- Preserve the core binding-switch lock and in-flight fences across all
  -- seven durable work families. One conversation is the outer writer lock.
  perform queued.id from public.whatsapp_outbox queued
  where queued.organization_id=p_organization_id and queued.conversation_id=p_conversation_id
    and queued.status in ('pending','retry','processing','failed') for update;
  perform queued.id from public.outbox_messages queued
  where queued.organization_id=p_organization_id and queued.conversation_id=p_conversation_id
    and queued.status in ('pending','processing') for update;
  perform job.id from public.ai_jobs job
  where job.organization_id=p_organization_id and job.conversation_id=p_conversation_id
    and job.status in ('pending','processing') for update;
  perform job.id from public.jobs job
  where job.organization_id=p_organization_id and job.job_type='whatsapp_ai_autoreply'
    and job.payload->>'conversationId'=p_conversation_id::text and job.status in ('queued','processing') for update;
  perform queued.id from public.ai_outbox_messages queued
  where queued.organization_id=p_organization_id and queued.conversation_id=p_conversation_id
    and queued.status in ('draft','pending_approval','approved','sending') for update;
  perform queued.id from public.automation_event_outbox queued
  where queued.organization_id=p_organization_id and queued.conversation_id=p_conversation_id
    and queued.status in ('pending','failed','processing') for update;
  perform execution.id from public.automation_executions execution
  where execution.organization_id=p_organization_id and execution.conversation_id=p_conversation_id
    and execution.status in ('queued','waiting','running') for update;
  perform step.id from public.automation_execution_steps step
  join public.automation_executions execution on execution.id=step.execution_id and execution.organization_id=step.organization_id
  where execution.organization_id=p_organization_id and execution.conversation_id=p_conversation_id
    and step.status in ('running','waiting') for update of step;
  perform dispatch.id from public.automation_effect_dispatches dispatch
  join public.automation_executions execution on execution.id=dispatch.execution_id and execution.organization_id=dispatch.organization_id
  where execution.organization_id=p_organization_id and execution.conversation_id=p_conversation_id
    and dispatch.status='sending' for update of dispatch;

  if exists (select 1 from public.whatsapp_outbox queued
       where queued.organization_id=p_organization_id and queued.conversation_id=p_conversation_id
       and (queued.status='processing' or (queued.status in ('pending','retry') and queued.last_error in
         ('provider_accepted_finalization_pending','provider_delivery_started','provider_delivery_outcome_unknown'))))
     or exists (select 1 from public.outbox_messages queued where queued.organization_id=p_organization_id and queued.conversation_id=p_conversation_id and queued.status='processing')
     or exists (select 1 from public.ai_jobs job where job.organization_id=p_organization_id and job.conversation_id=p_conversation_id and job.status='processing')
     or exists (select 1 from public.jobs job where job.organization_id=p_organization_id and job.job_type='whatsapp_ai_autoreply' and job.payload->>'conversationId'=p_conversation_id::text and job.status='processing')
     or exists (select 1 from public.ai_outbox_messages queued where queued.organization_id=p_organization_id and queued.conversation_id=p_conversation_id and queued.status='sending')
     or exists (select 1 from public.automation_event_outbox queued where queued.organization_id=p_organization_id and queued.conversation_id=p_conversation_id and queued.status='processing')
     or exists (select 1 from public.automation_executions execution where execution.organization_id=p_organization_id and execution.conversation_id=p_conversation_id and execution.status='running')
     or exists (select 1 from public.automation_effect_dispatches dispatch
       join public.automation_executions execution on execution.id=dispatch.execution_id and execution.organization_id=dispatch.organization_id
       where execution.organization_id=p_organization_id and execution.conversation_id=p_conversation_id and dispatch.status='sending') then
    raise exception using errcode='55000', message='whatsapp_phone_retirement_delivery_in_flight';
  end if;

  with canceled as (
    update public.whatsapp_outbox queued
    set status='failed',failed_at=coalesce(failed_at,v_now),locked_at=null,locked_by=null,
        last_error='conversation_phone_changed',updated_at=v_now
    where queued.organization_id=p_organization_id and queued.conversation_id=p_conversation_id
      and queued.status in ('pending','retry') and coalesce(queued.last_error,'') not in
        ('provider_accepted_finalization_pending','provider_delivery_started','provider_delivery_outcome_unknown')
    returning queued.id
  ) select coalesce(array_agg(id),'{}'::uuid[]) into v_canceled_ids from canceled;
  update public.outbox_messages queued set status='failed',processed_at=coalesce(processed_at,v_now),error_message='conversation_phone_changed'
  where queued.organization_id=p_organization_id and queued.conversation_id=p_conversation_id and queued.status='pending';
  update public.ai_jobs job set status='cancelled',error_message='conversation_phone_changed',completed_at=coalesce(completed_at,v_now)
  where job.organization_id=p_organization_id and job.conversation_id=p_conversation_id and job.status='pending';
  update public.jobs job set status='cancelled',locked_at=null,last_error='conversation_phone_changed',updated_at=v_now
  where job.organization_id=p_organization_id and job.job_type='whatsapp_ai_autoreply'
    and job.payload->>'conversationId'=p_conversation_id::text and job.status='queued';
  update public.ai_outbox_messages queued set status='cancelled',failure_reason='conversation_phone_changed',updated_at=v_now
  where queued.organization_id=p_organization_id and queued.conversation_id=p_conversation_id and queued.status in ('draft','pending_approval','approved');
  update public.automation_event_outbox queued set status='dead_letter',dead_lettered_at=coalesce(dead_lettered_at,v_now),
    locked_at=null,locked_by=null,last_error='conversation_phone_changed',updated_at=v_now
  where queued.organization_id=p_organization_id and queued.conversation_id=p_conversation_id and queued.status in ('pending','failed');
  update public.automation_executions execution set status='cancelled',
    cancellation_requested_at=coalesce(cancellation_requested_at,v_now),completed_at=coalesce(completed_at,v_now),
    error_message='conversation_phone_changed',locked_at=null,locked_by=null,updated_at=v_now
  where execution.organization_id=p_organization_id and execution.conversation_id=p_conversation_id and execution.status in ('queued','waiting');
  update public.automation_execution_steps step set status='cancelled',
    completed_at=coalesce(step.completed_at,v_now),error_message='conversation_phone_changed'
  from public.automation_executions execution
  where execution.id=step.execution_id and execution.organization_id=step.organization_id
    and execution.organization_id=p_organization_id and execution.conversation_id=p_conversation_id
    and execution.status='cancelled' and execution.error_message='conversation_phone_changed'
    and step.status in ('running','waiting');
  delete from public.conversation_ai_state state
  where state.organization_id=p_organization_id and state.conversation_id=p_conversation_id;
  delete from public.ai_agent_conversations state where state.conversation_id=p_conversation_id;
  delete from public.ai_conversation_states state
  where state.organization_id=p_organization_id and state.conversation_id=p_conversation_id;
  delete from public.chatbot_conversation_state state
  where state.organization_id=p_organization_id and state.conversation_id=p_conversation_id::text;

  return jsonb_build_object('prepared',true,'conversation_id',p_conversation_id,
    'canceled_outbox_ids',v_canceled_ids);
end;
$$;

revoke all on function private.prepare_whatsapp_confirmed_phone_route_retirement(uuid,uuid,uuid,uuid,uuid)
from public,anon,authenticated,service_role;
grant execute on function private.prepare_whatsapp_confirmed_phone_route_retirement(uuid,uuid,uuid,uuid,uuid)
to service_role;
comment on function private.prepare_whatsapp_confirmed_phone_route_retirement(uuid,uuid,uuid,uuid,uuid) is
'Backend-only confirmed phone change preparation. Guards/cancels old durable work; caller projects failures, closes binding and retires/opens routes in the same transaction. Does not send, replay or rewrite history.';
commit;
