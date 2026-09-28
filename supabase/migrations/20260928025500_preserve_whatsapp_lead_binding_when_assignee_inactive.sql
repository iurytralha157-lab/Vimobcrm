-- Preserve lead-message ingestion when a historical lead assignee is no longer
-- an active member of the organization. The lead row is never reassigned here.
-- The two function bodies are copied from the deployed 20260919181318
-- definitions (verified by pg_proc.prosrc MD5 before this migration).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';
do $migration_guard$
begin
  if (
    select md5(replace(prosrc, E'\r\n', E'\n'))
    from pg_proc
    where oid = 'public.activate_whatsapp_conversation_lead_binding(uuid,uuid,uuid,text)'::regprocedure
  ) is distinct from 'a76145c276915e4af31f3f3c59b96be7' or (
    select md5(replace(prosrc, E'\r\n', E'\n'))
    from pg_proc
    where oid = 'public.activate_whatsapp_conversation_lead_binding_if_current(uuid,uuid,uuid,text,uuid,uuid)'::regprocedure
  ) is distinct from 'ff3e88778931b03aaef89902cd4aa479' then
    raise exception using errcode = '55000', message = 'whatsapp_binding_function_drift';
  end if;
end;
$migration_guard$;

create or replace function public.activate_whatsapp_conversation_lead_binding(
  p_organization_id uuid,
  p_conversation_id uuid,
  p_lead_id uuid,
  p_provider_message_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation public.whatsapp_conversations%rowtype;
  v_active public.whatsapp_conversation_lead_bindings%rowtype;
  v_replay public.whatsapp_conversation_lead_bindings%rowtype;
  v_lead public.leads%rowtype;
  v_binding_id uuid;
  v_provider_message_id text := nullif(btrim(p_provider_message_id), '');
  v_previous_lead_id uuid;
  v_active_lead_id uuid;
  v_is_current boolean;
  v_switch_at timestamptz := clock_timestamp();
  v_changed boolean;
begin
  if p_organization_id is null
     or p_conversation_id is null
     or p_lead_id is null then
    raise exception using
      errcode = '22023',
      message = 'whatsapp_binding_required_argument_missing';
  end if;

  select conversation.*
  into v_conversation
  from public.whatsapp_conversations as conversation
  where conversation.id = p_conversation_id
    and conversation.organization_id = p_organization_id
  for no key update;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'whatsapp_binding_conversation_not_found';
  end if;

  select binding.*
  into v_active
  from public.whatsapp_conversation_lead_bindings as binding
  where binding.conversation_id = p_conversation_id
    and binding.active_to is null
  for update;

  if found and v_conversation.lead_id is distinct from v_active.lead_id then
    raise exception using
      errcode = '23514',
      message = 'whatsapp_binding_state_mismatch';
  end if;

  if v_provider_message_id is not null then
    select binding.*
    into v_replay
    from public.whatsapp_conversation_lead_bindings as binding
    where binding.organization_id = p_organization_id
      and binding.provider_message_id = v_provider_message_id
      and (
        (v_conversation.session_id is not null and binding.session_id = v_conversation.session_id)
        or (v_conversation.session_id is null and binding.conversation_id = p_conversation_id)
      )
    limit 1;

    if found then
      if v_replay.conversation_id <> p_conversation_id
         or v_replay.lead_id <> p_lead_id then
        raise exception using
          errcode = '23505',
          message = 'whatsapp_binding_provider_message_conflict';
      end if;

      v_active_lead_id := v_conversation.lead_id;
      v_is_current := not v_replay.stale
        and v_replay.lead_id is not distinct from v_active_lead_id
        and private.whatsapp_ingress_routing_event_is_current(
          p_organization_id,
          p_conversation_id,
          v_provider_message_id,
          v_replay.lead_id
        );

      return jsonb_build_object(
        'success', true,
        'changed', false,
        'conversation_id', v_replay.conversation_id,
        'lead_id', v_replay.lead_id,
        'previous_lead_id', v_replay.previous_lead_id,
        'binding_id', v_replay.id,
        'stale', v_replay.stale,
        'is_current', v_is_current,
        'active_lead_id', v_active_lead_id
      );
    end if;
  end if;

  -- Provider-event replay is resolved before dereferencing the lead. Binding
  -- history deliberately survives hard lead deletion, so a replay for a
  -- tombstoned lead can remain idempotent without reopening or reclassifying it.
  select lead.*
  into v_lead
  from public.leads as lead
  where lead.id = p_lead_id
    and lead.organization_id = p_organization_id;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'whatsapp_binding_lead_not_found';
  end if;
  -- An existing lead can retain a historical assignee whose organization
  -- membership was later disabled. Keep the lead and its binding intact, but
  -- never copy that inactive assignee onto a new conversation/binding row.
  if v_lead.assigned_user_id is not null and not exists (
    select 1
    from public.users as app_user
    join public.organization_members as member
      on member.user_id = app_user.id
     and member.organization_id = p_organization_id
    where app_user.id = v_lead.assigned_user_id
      and coalesce(app_user.is_active, false) = true
      and coalesce(member.is_active, false) = true
      and member.deleted_at is null
  ) then
    v_lead.assigned_user_id := null;
  end if;

  v_previous_lead_id := v_conversation.lead_id;
  v_changed := v_previous_lead_id is distinct from p_lead_id;

  if not v_changed then
    update public.whatsapp_conversations
    set assigned_user_id = v_lead.assigned_user_id,
        updated_at = clock_timestamp()
    where id = p_conversation_id;

    update public.whatsapp_contact_identity_aliases as identity_alias
    set
      lead_id = p_lead_id,
      last_seen_at = greatest(identity_alias.last_seen_at, v_switch_at)
    where identity_alias.organization_id = p_organization_id
      and identity_alias.session_id = v_conversation.session_id
      and (
        identity_alias.alias_jid = v_conversation.remote_jid
        or identity_alias.canonical_jid = v_conversation.remote_jid
        or (
          v_conversation.contact_phone is not null
          and public.normalize_phone(identity_alias.contact_phone) =
            public.normalize_phone(v_conversation.contact_phone)
        )
      );

    if v_active.id is null then
      insert into public.whatsapp_conversation_lead_bindings (
        organization_id,
        conversation_id,
        session_id,
        lead_id,
        previous_lead_id,
        assigned_user_id,
        provider_message_id,
        changed,
        active_from
      ) values (
        p_organization_id,
        p_conversation_id,
        v_conversation.session_id,
        p_lead_id,
        v_previous_lead_id,
        v_lead.assigned_user_id,
        v_provider_message_id,
        false,
        v_switch_at
      )
      returning id into v_binding_id;
    elsif v_provider_message_id is not null then
      insert into public.whatsapp_conversation_lead_bindings (
        organization_id,
        conversation_id,
        session_id,
        lead_id,
        previous_lead_id,
        assigned_user_id,
        provider_message_id,
        changed,
        active_from,
        active_to
      ) values (
        p_organization_id,
        p_conversation_id,
        v_conversation.session_id,
        p_lead_id,
        v_previous_lead_id,
        v_lead.assigned_user_id,
        v_provider_message_id,
        false,
        v_switch_at,
        v_switch_at
      )
      returning id into v_binding_id;
    else
      -- An explicit same-card relink is still an operator-visible binding
      -- epoch. Rotate the active row so a provider event accepted before this
      -- intervention cannot pass an unchanged binding-id CAS afterward.
      v_switch_at := greatest(
        v_switch_at,
        v_active.active_from + interval '1 microsecond'
      );
      update public.whatsapp_conversation_lead_bindings
      set active_to = v_switch_at
      where id = v_active.id;

      insert into public.whatsapp_conversation_lead_bindings (
        organization_id,
        conversation_id,
        session_id,
        lead_id,
        previous_lead_id,
        assigned_user_id,
        provider_message_id,
        changed,
        active_from
      ) values (
        p_organization_id,
        p_conversation_id,
        v_conversation.session_id,
        p_lead_id,
        v_previous_lead_id,
        v_lead.assigned_user_id,
        null,
        false,
        v_switch_at
      )
      returning id into v_binding_id;
    end if;

    perform private.update_whatsapp_conversation_routing_head(
      p_organization_id,
      p_conversation_id,
      v_provider_message_id,
      p_lead_id
    );

    return jsonb_build_object(
      'success', true,
      'changed', false,
      'conversation_id', p_conversation_id,
      'lead_id', p_lead_id,
      'previous_lead_id', v_previous_lead_id,
      'binding_id', v_binding_id,
      'stale', false,
      'is_current', true,
      'active_lead_id', p_lead_id
    );
  end if;

  -- A row already past the provider boundary cannot be cancelled safely. Abort
  -- the whole switch before closing the active binding; the caller may retry
  -- only after the worker has reconciled the in-flight outcome. Lock every
  -- cancelable/in-flight row first so a worker cannot cross the boundary
  -- between this check and the cancellation updates below.
  perform outbox.id
  from public.whatsapp_outbox as outbox
  where outbox.organization_id = p_organization_id
    and outbox.conversation_id = p_conversation_id
    and outbox.status in ('pending', 'retry', 'processing', 'failed')
  for update;

  perform legacy_outbox.id
  from public.outbox_messages as legacy_outbox
  where legacy_outbox.organization_id = p_organization_id
    and legacy_outbox.conversation_id = p_conversation_id
    and legacy_outbox.status in ('pending', 'processing')
  for update;

  perform job.id
  from public.ai_jobs as job
  where job.organization_id = p_organization_id
    and job.conversation_id = p_conversation_id
    and job.status in ('pending', 'processing')
  for update;

  -- The Go auto-reply worker uses public.jobs rather than public.ai_jobs.
  -- Lock it under the same conversation row so an enqueue that races this
  -- switch either commits before us (and is cancelled below) or observes the
  -- new binding and refuses to enqueue.
  perform job.id
  from public.jobs as job
  where job.organization_id = p_organization_id
    and job.job_type = 'whatsapp_ai_autoreply'
    and job.payload->>'conversationId' = p_conversation_id::text
    and job.status in ('queued', 'processing')
  for update;

  perform ai_outbox.id
  from public.ai_outbox_messages as ai_outbox
  where ai_outbox.organization_id = p_organization_id
    and ai_outbox.conversation_id = p_conversation_id
    and ai_outbox.status in ('draft', 'pending_approval', 'approved', 'sending')
  for update;

  -- A message_received event may still be waiting to create its execution.
  -- Lock the event itself before inspecting automation_executions so a worker
  -- cannot claim the previous lead context after the binding has moved.
  perform event_outbox.id
  from public.automation_event_outbox as event_outbox
  where event_outbox.organization_id = p_organization_id
    and event_outbox.conversation_id = p_conversation_id
    and event_outbox.status in ('pending', 'failed', 'processing')
  for update;

  perform execution.id
  from public.automation_executions as execution
  where execution.organization_id = p_organization_id
    and execution.conversation_id = p_conversation_id
    and execution.status in ('queued', 'waiting', 'running')
  for update;

  perform step.id
  from public.automation_execution_steps as step
  join public.automation_executions as execution
    on execution.id = step.execution_id
   and execution.organization_id = step.organization_id
  where execution.organization_id = p_organization_id
    and execution.conversation_id = p_conversation_id
    and step.status in ('running', 'waiting')
  for update of step;

  perform dispatch.id
  from public.automation_effect_dispatches as dispatch
  join public.automation_executions as execution
    on execution.id = dispatch.execution_id
   and execution.organization_id = dispatch.organization_id
  where execution.organization_id = p_organization_id
    and execution.conversation_id = p_conversation_id
    and dispatch.status = 'sending'
  for update of dispatch;

  if exists (
    select 1
    from public.whatsapp_outbox as outbox
    where outbox.organization_id = p_organization_id
      and outbox.conversation_id = p_conversation_id
      and outbox.status = 'processing'
  ) or exists (
    select 1
    from public.outbox_messages as legacy_outbox
    where legacy_outbox.organization_id = p_organization_id
      and legacy_outbox.conversation_id = p_conversation_id
      and legacy_outbox.status = 'processing'
  ) or exists (
    select 1
    from public.ai_jobs as job
    where job.organization_id = p_organization_id
      and job.conversation_id = p_conversation_id
      and job.status = 'processing'
  ) or exists (
    select 1
    from public.jobs as job
    where job.organization_id = p_organization_id
      and job.job_type = 'whatsapp_ai_autoreply'
      and job.payload->>'conversationId' = p_conversation_id::text
      and job.status = 'processing'
  ) or exists (
    select 1
    from public.ai_outbox_messages as ai_outbox
    where ai_outbox.organization_id = p_organization_id
      and ai_outbox.conversation_id = p_conversation_id
      and ai_outbox.status = 'sending'
  ) or exists (
    select 1
    from public.automation_event_outbox as event_outbox
    where event_outbox.organization_id = p_organization_id
      and event_outbox.conversation_id = p_conversation_id
      and event_outbox.status = 'processing'
  ) or exists (
    select 1
    from public.automation_executions as execution
    where execution.organization_id = p_organization_id
      and execution.conversation_id = p_conversation_id
      and execution.status = 'running'
  ) or exists (
    select 1
    from public.automation_effect_dispatches as dispatch
    join public.automation_executions as execution
      on execution.id = dispatch.execution_id
     and execution.organization_id = dispatch.organization_id
    where execution.organization_id = p_organization_id
      and execution.conversation_id = p_conversation_id
      and dispatch.status = 'sending'
  ) then
    raise exception using
      errcode = '55000',
      message = 'whatsapp_binding_switch_delivery_in_flight';
  end if;

  if v_active.id is not null then
    v_switch_at := greatest(
      v_switch_at,
      v_active.active_from + interval '1 microsecond'
    );

    update public.whatsapp_conversation_lead_bindings
    set active_to = v_switch_at
    where id = v_active.id;
  end if;

  -- The physical WhatsApp thread is being handed to a different CRM card.
  -- Fail closed on every queued action that was computed with the previous
  -- lead context, and erase mutable summaries/memory before exposing the new
  -- binding. All changes occur under the locked conversation row.
  update public.whatsapp_outbox as outbox
  set
    status = 'dead',
    dead_lettered_at = coalesce(outbox.dead_lettered_at, v_switch_at),
    locked_at = null,
    locked_by = null,
    last_error = 'conversation_lead_binding_changed',
    updated_at = v_switch_at
  where outbox.organization_id = p_organization_id
    and outbox.conversation_id = p_conversation_id
    and outbox.status in ('pending', 'retry', 'failed');

  update public.outbox_messages as legacy_outbox
  set
    status = 'failed',
    processed_at = coalesce(legacy_outbox.processed_at, v_switch_at),
    error_message = 'conversation_lead_binding_changed'
  where legacy_outbox.organization_id = p_organization_id
    and legacy_outbox.conversation_id = p_conversation_id
    and legacy_outbox.status = 'pending';

  update public.ai_jobs as job
  set
    status = 'cancelled',
    error_message = 'conversation_lead_binding_changed',
    completed_at = coalesce(job.completed_at, v_switch_at)
  where job.organization_id = p_organization_id
    and job.conversation_id = p_conversation_id
    and job.status = 'pending';

  update public.jobs as job
  set
    status = 'cancelled',
    locked_at = null,
    last_error = 'conversation_lead_binding_changed',
    updated_at = v_switch_at
  where job.organization_id = p_organization_id
    and job.job_type = 'whatsapp_ai_autoreply'
    and job.payload->>'conversationId' = p_conversation_id::text
    and job.status = 'queued';

  update public.ai_outbox_messages as ai_outbox
  set
    status = 'cancelled',
    failure_reason = 'conversation_lead_binding_changed',
    updated_at = v_switch_at
  where ai_outbox.organization_id = p_organization_id
    and ai_outbox.conversation_id = p_conversation_id
    and ai_outbox.status in ('draft', 'pending_approval', 'approved');

  update public.automation_event_outbox as event_outbox
  set
    status = 'dead_letter',
    dead_lettered_at = coalesce(event_outbox.dead_lettered_at, v_switch_at),
    locked_at = null,
    locked_by = null,
    last_error = 'conversation_lead_binding_changed',
    updated_at = v_switch_at
  where event_outbox.organization_id = p_organization_id
    and event_outbox.conversation_id = p_conversation_id
    and event_outbox.status in ('pending', 'failed');

  update public.automation_executions as execution
  set
    status = 'cancelled',
    cancellation_requested_at = coalesce(
      execution.cancellation_requested_at,
      v_switch_at
    ),
    completed_at = coalesce(execution.completed_at, v_switch_at),
    error_message = 'conversation_lead_binding_changed',
    locked_at = null,
    locked_by = null,
    updated_at = v_switch_at
  where execution.organization_id = p_organization_id
    and execution.conversation_id = p_conversation_id
    and execution.status in ('queued', 'waiting');

  update public.automation_execution_steps as step
  set
    status = 'cancelled',
    completed_at = coalesce(step.completed_at, v_switch_at),
    error_message = 'conversation_lead_binding_changed'
  from public.automation_executions as execution
  where execution.id = step.execution_id
    and execution.organization_id = step.organization_id
    and execution.organization_id = p_organization_id
    and execution.conversation_id = p_conversation_id
    and execution.status = 'cancelled'
    and execution.error_message = 'conversation_lead_binding_changed'
    and step.status in ('running', 'waiting');

  delete from public.conversation_ai_state as ai_state
  where ai_state.organization_id = p_organization_id
    and ai_state.conversation_id = p_conversation_id;

  delete from public.ai_agent_conversations as agent_conversation
  where agent_conversation.conversation_id = p_conversation_id;

  delete from public.ai_conversation_states as control_state
  where control_state.organization_id = p_organization_id
    and control_state.conversation_id = p_conversation_id;

  delete from public.chatbot_conversation_state as chatbot_state
  where chatbot_state.organization_id = p_organization_id
    and chatbot_state.conversation_id = p_conversation_id::text;

  update public.whatsapp_conversations
  set
    lead_id = p_lead_id,
    assigned_user_id = v_lead.assigned_user_id,
    last_message = null,
    last_message_preview = null,
    last_message_at = null,
    last_message_received_at = null,
    unread_count = 0,
    archived_at = null,
    updated_at = v_switch_at
  where id = p_conversation_id;

  update public.whatsapp_contact_identity_aliases as identity_alias
  set
    lead_id = p_lead_id,
    last_seen_at = greatest(identity_alias.last_seen_at, v_switch_at)
  where identity_alias.organization_id = p_organization_id
    and identity_alias.session_id = v_conversation.session_id
    and (
      identity_alias.alias_jid = v_conversation.remote_jid
      or identity_alias.canonical_jid = v_conversation.remote_jid
      or (
        v_conversation.contact_phone is not null
        and public.normalize_phone(identity_alias.contact_phone) =
          public.normalize_phone(v_conversation.contact_phone)
      )
    );

  insert into public.whatsapp_conversation_lead_bindings (
    organization_id,
    conversation_id,
    session_id,
    lead_id,
    previous_lead_id,
    assigned_user_id,
    provider_message_id,
    changed,
    active_from
  ) values (
    p_organization_id,
    p_conversation_id,
    v_conversation.session_id,
    p_lead_id,
    v_previous_lead_id,
    v_lead.assigned_user_id,
    v_provider_message_id,
    true,
    v_switch_at
  )
  returning id into v_binding_id;

  perform private.update_whatsapp_conversation_routing_head(
    p_organization_id,
    p_conversation_id,
    v_provider_message_id,
    p_lead_id
  );

  return jsonb_build_object(
    'success', true,
    'changed', true,
    'conversation_id', p_conversation_id,
    'lead_id', p_lead_id,
    'previous_lead_id', v_previous_lead_id,
    'binding_id', v_binding_id,
    'stale', false,
    'is_current', true,
    'active_lead_id', p_lead_id
  );
end;
$$;

create or replace function public.activate_whatsapp_conversation_lead_binding_if_current(
  p_organization_id uuid,
  p_conversation_id uuid,
  p_lead_id uuid,
  p_provider_message_id text,
  p_expected_active_binding_id uuid,
  p_expected_current_lead_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation public.whatsapp_conversations%rowtype;
  v_active public.whatsapp_conversation_lead_bindings%rowtype;
  v_expected public.whatsapp_conversation_lead_bindings%rowtype;
  v_replay public.whatsapp_conversation_lead_bindings%rowtype;
  v_predecessor_binding public.whatsapp_conversation_lead_bindings%rowtype;
  v_route public.whatsapp_webhook_routing_snapshots%rowtype;
  v_predecessor_route public.whatsapp_webhook_routing_snapshots%rowtype;
  v_routing_head public.whatsapp_conversation_routing_heads%rowtype;
  v_lead public.leads%rowtype;
  v_provider_message_id text := nullif(pg_catalog.btrim(p_provider_message_id), '');
  v_binding_id uuid;
  v_recorded_at timestamptz := clock_timestamp();
  v_is_current boolean;
  v_expected_matches boolean;
  v_route_allows_activation boolean := false;
  v_predecessor_processed boolean := false;
begin
  if p_organization_id is null
     or p_conversation_id is null
     or p_lead_id is null then
    raise exception using
      errcode = '22023',
      message = 'whatsapp_binding_required_argument_missing';
  end if;

  if v_provider_message_id is null then
    raise exception using
      errcode = '22023',
      message = 'whatsapp_binding_provider_message_required';
  end if;

  select conversation.*
  into v_conversation
  from public.whatsapp_conversations as conversation
  where conversation.id = p_conversation_id
    and conversation.organization_id = p_organization_id
  for no key update;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'whatsapp_binding_conversation_not_found';
  end if;

  select binding.*
  into v_active
  from public.whatsapp_conversation_lead_bindings as binding
  where binding.conversation_id = p_conversation_id
    and binding.active_to is null
  for update;

  if v_active.id is not null
     and v_conversation.lead_id is distinct from v_active.lead_id then
    raise exception using
      errcode = '23514',
      message = 'whatsapp_binding_state_mismatch';
  end if;

  select routing_snapshot.*
  into v_route
  from public.whatsapp_webhook_routing_snapshots as routing_snapshot
  where routing_snapshot.organization_id = p_organization_id
    and routing_snapshot.session_id = v_conversation.session_id
    and routing_snapshot.provider_message_id = v_provider_message_id;

  if v_route.provider_message_id is not null
     and v_route.binding_eligible
     and v_route.routing_key <> '__session__' then
    -- Lock order is conversation -> active binding -> applied route head. Every
    -- writer follows this order, so automation FK KEY SHARE and provider CAS
    -- cannot form the previous event/conversation inversion.
    select routing_head.*
    into v_routing_head
    from public.whatsapp_conversation_routing_heads as routing_head
    where routing_head.organization_id = p_organization_id
      and routing_head.conversation_id = p_conversation_id
    for update;

    if v_route.predecessor_provider_message_id is not null then
      select routing_snapshot.*
      into v_predecessor_route
      from public.whatsapp_webhook_routing_snapshots as routing_snapshot
      where routing_snapshot.organization_id = p_organization_id
        and routing_snapshot.session_id = v_conversation.session_id
        and routing_snapshot.provider_message_id = v_route.predecessor_provider_message_id;

      if v_predecessor_route.provider_message_id is null
         or not v_predecessor_route.binding_eligible
         or v_predecessor_route.routing_key is distinct from v_route.routing_key
         or v_predecessor_route.ingress_sequence >= v_route.ingress_sequence then
        raise exception using
          errcode = '23514',
          message = 'whatsapp_ingress_predecessor_chain_invalid';
      end if;

      select v_predecessor_route.inbox_event_key = v_route.inbox_event_key
        or exists (
          select 1
          from public.whatsapp_webhook_inbox as predecessor_inbox
          where predecessor_inbox.organization_id = p_organization_id
            and predecessor_inbox.session_id = v_conversation.session_id
            and predecessor_inbox.event_key = v_predecessor_route.inbox_event_key
            and predecessor_inbox.status = 'processed'
        )
        or exists (
          select 1
          from public.whatsapp_webhook_routing_outcomes as predecessor_outcome
          where predecessor_outcome.organization_id = p_organization_id
            and predecessor_outcome.session_id = v_conversation.session_id
            and predecessor_outcome.provider_message_id = v_predecessor_route.provider_message_id
            and predecessor_outcome.ingress_sequence = v_predecessor_route.ingress_sequence
        )
        or exists (
          select 1
          from public.whatsapp_webhook_inbox as execution_inbox
          where execution_inbox.organization_id = p_organization_id
            and execution_inbox.session_id = v_conversation.session_id
            and execution_inbox.status = 'processing'
            and exists (
              select 1
              from pg_catalog.jsonb_array_elements(
                execution_inbox.payload #> '{__vimob_ingress,routing_snapshot,messages}'
              ) as current_route(snapshot)
              where current_route.snapshot = v_route.snapshot
            )
            and exists (
              select 1
              from pg_catalog.jsonb_array_elements(
                execution_inbox.payload #> '{__vimob_ingress,routing_snapshot,messages}'
              ) as predecessor_route(snapshot)
              where predecessor_route.snapshot = v_predecessor_route.snapshot
            )
        )
      into v_predecessor_processed;

      if not v_predecessor_processed then
        raise exception using
          errcode = '40001',
          message = 'whatsapp_ingress_predecessor_pending';
      end if;
    end if;
  end if;

  -- A provider replay is immutable and safe regardless of the caller's old
  -- expected version. Resolve it before evaluating the CAS pair.
  select binding.*
  into v_replay
  from public.whatsapp_conversation_lead_bindings as binding
  where binding.organization_id = p_organization_id
    and binding.provider_message_id = v_provider_message_id
    and (
      (v_conversation.session_id is not null
        and binding.session_id = v_conversation.session_id)
      or (v_conversation.session_id is null
        and binding.conversation_id = p_conversation_id)
    )
  limit 1;

  if v_replay.id is not null then
    if v_replay.conversation_id <> p_conversation_id
       or v_replay.lead_id <> p_lead_id then
      raise exception using
        errcode = '23505',
        message = 'whatsapp_binding_provider_message_conflict';
    end if;

    v_is_current := not v_replay.stale
      and v_replay.lead_id is not distinct from v_conversation.lead_id
      and private.whatsapp_ingress_routing_event_is_current(
        p_organization_id,
        p_conversation_id,
        v_provider_message_id,
        v_replay.lead_id
      );

    return jsonb_build_object(
      'success', true,
      'changed', false,
      'conversation_id', v_replay.conversation_id,
      'lead_id', v_replay.lead_id,
      'previous_lead_id', v_replay.previous_lead_id,
      'binding_id', v_replay.id,
      'stale', v_replay.stale,
      'is_current', v_is_current,
      'active_lead_id', v_conversation.lead_id
    );
  end if;

  if p_expected_active_binding_id is not null then
    select binding.*
    into v_expected
    from public.whatsapp_conversation_lead_bindings as binding
    where binding.id = p_expected_active_binding_id
      and binding.organization_id = p_organization_id
      and binding.conversation_id = p_conversation_id;

    if v_expected.id is null
       or v_expected.lead_id is distinct from p_expected_current_lead_id then
      raise exception using
        errcode = '23514',
        message = 'whatsapp_binding_expected_snapshot_invalid';
    end if;
  end if;

  v_expected_matches :=
    v_conversation.lead_id is not distinct from p_expected_current_lead_id
    and v_active.id is not distinct from p_expected_active_binding_id;

  if v_route.provider_message_id is null
     or not v_route.binding_eligible
     or v_route.routing_key = '__session__' then
    v_route_allows_activation := v_expected_matches;
  elsif v_route.target_mode = 'inherit_predecessor' then
    if v_route.predecessor_provider_message_id is null then
      raise exception using
        errcode = '23514',
        message = 'whatsapp_ingress_inherited_target_without_predecessor';
    end if;

    select binding.*
    into v_predecessor_binding
    from public.whatsapp_conversation_lead_bindings as binding
    where binding.organization_id = p_organization_id
      and binding.session_id = v_conversation.session_id
      and binding.provider_message_id = v_route.predecessor_provider_message_id
    limit 1;

    if v_predecessor_binding.id is null then
      raise exception using
        errcode = '23514',
        message = 'whatsapp_ingress_predecessor_not_applied';
    end if;
    if v_predecessor_binding.lead_id is distinct from p_lead_id then
      raise exception using
        errcode = '23505',
        message = 'whatsapp_ingress_inherited_target_conflict';
    end if;

    v_route_allows_activation :=
      v_routing_head.provider_message_id is not null
      and v_routing_head.session_id is not distinct from v_conversation.session_id
      and v_routing_head.routing_key is not distinct from v_route.routing_key
      and v_routing_head.provider_message_id = v_route.predecessor_provider_message_id
      and v_routing_head.ingress_sequence = v_predecessor_route.ingress_sequence
      and v_routing_head.lead_id = p_lead_id;
  else
    v_route_allows_activation := v_expected_matches;

    if not v_route_allows_activation
       and v_route.predecessor_provider_message_id is not null then
      v_route_allows_activation :=
        v_routing_head.provider_message_id is not null
        and v_routing_head.session_id is not distinct from v_conversation.session_id
        and v_routing_head.routing_key is not distinct from v_route.routing_key
        and v_routing_head.provider_message_id = v_route.predecessor_provider_message_id
        and v_routing_head.ingress_sequence = v_predecessor_route.ingress_sequence;
    end if;

    -- An older same-target event may finish after a newer accepted event. It is
    -- safe to retain its effects on that same card, but the monotonic head must
    -- never move backward. A missing head means an operator/legacy relink broke
    -- the chain and therefore cannot take this exception.
    if not v_route_allows_activation then
      v_route_allows_activation :=
        v_routing_head.provider_message_id is not null
        and v_routing_head.session_id is not distinct from v_conversation.session_id
        and v_routing_head.routing_key is not distinct from v_route.routing_key
        and v_routing_head.ingress_sequence >= v_route.ingress_sequence
        and v_routing_head.lead_id = p_lead_id
        and v_conversation.lead_id = p_lead_id;
    end if;
  end if;

  if v_route_allows_activation then
    return public.activate_whatsapp_conversation_lead_binding(
      p_organization_id,
      p_conversation_id,
      p_lead_id,
      v_provider_message_id
    );
  end if;

  select lead.*
  into v_lead
  from public.leads as lead
  where lead.id = p_lead_id
    and lead.organization_id = p_organization_id;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'whatsapp_binding_lead_not_found';
  end if;
  -- An existing lead can retain a historical assignee whose organization
  -- membership was later disabled. Keep the lead and its binding intact, but
  -- never copy that inactive assignee onto a new conversation/binding row.
  if v_lead.assigned_user_id is not null and not exists (
    select 1
    from public.users as app_user
    join public.organization_members as member
      on member.user_id = app_user.id
     and member.organization_id = p_organization_id
    where app_user.id = v_lead.assigned_user_id
      and coalesce(app_user.is_active, false) = true
      and coalesce(member.is_active, false) = true
      and member.deleted_at is null
  ) then
    v_lead.assigned_user_id := null;
  end if;

  insert into public.whatsapp_conversation_lead_bindings (
    organization_id,
    conversation_id,
    session_id,
    lead_id,
    previous_lead_id,
    assigned_user_id,
    provider_message_id,
    changed,
    stale,
    active_from,
    active_to
  ) values (
    p_organization_id,
    p_conversation_id,
    v_conversation.session_id,
    p_lead_id,
    v_conversation.lead_id,
    v_lead.assigned_user_id,
    v_provider_message_id,
    false,
    true,
    v_recorded_at,
    v_recorded_at
  )
  returning id into v_binding_id;

  return jsonb_build_object(
    'success', true,
    'changed', false,
    'conversation_id', p_conversation_id,
    'lead_id', p_lead_id,
    'previous_lead_id', v_conversation.lead_id,
    'binding_id', v_binding_id,
    'stale', true,
    'is_current', false,
    'active_lead_id', v_conversation.lead_id
  );
end;
$$;
revoke all on function public.activate_whatsapp_conversation_lead_binding(
  uuid, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.activate_whatsapp_conversation_lead_binding(
  uuid, uuid, uuid, text
) to service_role;

revoke all on function public.activate_whatsapp_conversation_lead_binding_if_current(
  uuid, uuid, uuid, text, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.activate_whatsapp_conversation_lead_binding_if_current(
  uuid, uuid, uuid, text, uuid, uuid
) to service_role;

commit;
