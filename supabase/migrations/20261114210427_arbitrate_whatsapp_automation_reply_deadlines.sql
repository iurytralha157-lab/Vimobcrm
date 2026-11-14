begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table private.whatsapp_automation_pending_replies (
  organization_id uuid not null,
  session_id uuid not null,
  conversation_id uuid not null,
  lead_id uuid not null,
  binding_id uuid not null,
  account_generation uuid not null,
  inbox_id uuid not null references public.whatsapp_webhook_inbox(id) on delete cascade,
  provider_message_id text not null check (btrim(provider_message_id) <> ''),
  provider_occurred_at timestamptz not null,
  inbox_accepted_at timestamptz not null,
  hold_until timestamptz not null,
  primary key (organization_id, session_id, provider_message_id),
  check (provider_occurred_at <= inbox_accepted_at),
  check (hold_until between inbox_accepted_at and inbox_accepted_at + interval '30 seconds')
);

create index whatsapp_automation_pending_replies_wait_idx
  on private.whatsapp_automation_pending_replies (organization_id, lead_id, hold_until);
create index whatsapp_automation_pending_replies_inbox_idx
  on private.whatsapp_automation_pending_replies (inbox_id);

alter table private.whatsapp_automation_pending_replies enable row level security;
revoke all on private.whatsapp_automation_pending_replies from public, anon, authenticated, service_role;

create function private.whatsapp_automation_reply_scope_key(p_organization_id uuid, p_lead_id uuid)
returns bigint language sql immutable strict set search_path = ''
as $$
  select pg_catalog.hashtextextended(
    'whatsapp-automation-reply:' || p_organization_id::text || ':' || p_lead_id::text, 0
  )
$$;

-- Ingress takes this before persisting candidates, in lead ID order when a
-- callback spans leads. It must commit without taking automation row locks.
create function private.lock_whatsapp_automation_reply_scope(p_organization_id uuid, p_lead_id uuid)
returns void language sql strict set search_path = ''
as $$
  select pg_catalog.pg_advisory_xact_lock(private.whatsapp_automation_reply_scope_key(p_organization_id, p_lead_id))
$$;

create function private.whatsapp_automation_reply_pending_for_wait(
  p_organization_id uuid, p_lead_id uuid, p_conversation_id uuid,
  p_wait_started_at timestamptz, p_deadline timestamptz
)
returns boolean language sql stable set search_path = ''
as $$
  select exists (
    select 1
    from private.whatsapp_automation_pending_replies pending
    join public.whatsapp_sessions session
      on session.id = pending.session_id and session.organization_id = pending.organization_id
     and session.automation_reply_generation = pending.account_generation
     and session.provider = 'evolution_go' and coalesce(session.is_active, true)
     and session.status not in ('deleted', 'disabled')
    join public.whatsapp_conversation_lead_bindings binding
      on binding.id = pending.binding_id and binding.organization_id = pending.organization_id
     and binding.conversation_id = pending.conversation_id and binding.session_id = pending.session_id
     and binding.lead_id = pending.lead_id and binding.active_to is null and not binding.stale
    join public.whatsapp_webhook_inbox inbox
      on inbox.id = pending.inbox_id and inbox.organization_id = pending.organization_id
     and inbox.session_id = pending.session_id and inbox.created_at = pending.inbox_accepted_at
     and inbox.processing_lane = 'live' and inbox.status in ('pending', 'processing', 'retry')
    where pending.organization_id = p_organization_id and pending.lead_id = p_lead_id
      and (p_conversation_id is null or pending.conversation_id = p_conversation_id)
      and pending.hold_until > pg_catalog.statement_timestamp()
      and pending.provider_occurred_at >= coalesce(p_wait_started_at, '-infinity'::timestamptz)
      and pending.inbox_accepted_at <= p_deadline
  )
$$;

revoke all on function private.whatsapp_automation_reply_scope_key(uuid, uuid),
  private.lock_whatsapp_automation_reply_scope(uuid, uuid),
  private.whatsapp_automation_reply_pending_for_wait(uuid, uuid, uuid, timestamptz, timestamptz)
from public, anon, authenticated, service_role;

-- Marked inbound messages must have exact evidence written by trusted ingress.
-- Keep normal inbound timestamps unchanged and let processing delete evidence
-- in the same transaction that inserts the message and its automation event.
create or replace function private.capture_automation_inbound_message_event()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_conversation public.whatsapp_conversations%rowtype;
  v_binding public.whatsapp_conversation_lead_bindings%rowtype;
  v_occurred_at timestamptz := coalesce(new.received_at, new.created_at, now());
  v_inbox_accepted_at timestamptz;
begin
  if coalesce(new.from_me, false) is distinct from false
     or new.direction is distinct from 'inbound'
     or new.lead_id is null
     or coalesce(new.metadata->>'whatsapp_event_binding_is_current', 'false') <> 'true'
     or private.is_terminal_whatsapp_lead_resolution_quarantine(
       new.metadata, new.from_me, new.provider_message_id, new.message_id
     ) then
    return new;
  end if;

  select conversation.* into v_conversation
  from public.whatsapp_conversations as conversation
  where conversation.id = new.conversation_id
  for share;

  if not found
     or v_conversation.organization_id is distinct from new.organization_id
     or v_conversation.session_id is distinct from new.session_id
     or v_conversation.lead_id is distinct from new.lead_id then
    return new;
  end if;

  select binding.* into v_binding
  from public.whatsapp_conversation_lead_bindings as binding
  where binding.organization_id = new.organization_id
    and binding.conversation_id = new.conversation_id
    and binding.active_to is null
  for share;

  if not found
     or v_binding.session_id is distinct from v_conversation.session_id
     or v_binding.lead_id is distinct from v_conversation.lead_id
     or v_binding.lead_id is distinct from new.lead_id then
    return new;
  end if;

  if new.metadata ? 'automation_reply_inbox_id' then
    select pending.provider_occurred_at, pending.inbox_accepted_at
      into v_occurred_at, v_inbox_accepted_at
    from private.whatsapp_automation_pending_replies pending
    join public.whatsapp_sessions session
      on session.id = pending.session_id and session.organization_id = pending.organization_id
     and session.automation_reply_generation = pending.account_generation
    join public.whatsapp_webhook_inbox inbox
      on inbox.id = pending.inbox_id and inbox.organization_id = pending.organization_id
     and inbox.session_id = pending.session_id and inbox.created_at = pending.inbox_accepted_at
     and inbox.processing_lane = 'live' and inbox.status = 'processing'
    where pending.organization_id = new.organization_id and pending.session_id = new.session_id
      and pending.conversation_id = new.conversation_id and pending.lead_id = new.lead_id
      and pending.binding_id = v_binding.id and not v_binding.stale
      and pending.provider_message_id = new.provider_message_id
      and pending.inbox_id::text = new.metadata->>'automation_reply_inbox_id';
    if not found then
      return new;
    end if;
  end if;

  perform private.enqueue_automation_event(
    new.organization_id, 'message_received', 'whatsapp_message', new.id,
    new.lead_id, new.conversation_id, 'message_received:' || new.id::text,
    pg_catalog.jsonb_build_object(
      'message_id', new.id,
      'lead_id', new.lead_id,
      'conversation_id', new.conversation_id,
      'session_id', new.session_id,
      'whatsapp_binding_id', v_binding.id,
      'message_type', coalesce(nullif(new.message_type, ''), 'text'),
      'content', new.content,
      'occurred_at', v_occurred_at
    ) || case when v_inbox_accepted_at is not null
      then pg_catalog.jsonb_build_object('automation_reply_inbox_accepted_at', v_inbox_accepted_at)
      else '{}'::jsonb end
  );
  return new;
exception when others then
  if new.metadata ? 'automation_reply_inbox_id' then
    raise;
  end if;
  raise warning 'automation message event enqueue failed: %', sqlerrm;
  return new;
end;
$$;

-- Preserve the existing RPC definition, grants and guarded branch behavior.
-- A failed definition check aborts the whole migration.
do $migration$
declare
  target regprocedure := 'public.resume_automation_delay(uuid,uuid,text,timestamptz,jsonb,uuid,uuid)'::regprocedure;
  definition text;
  prior constant text := replace($prior$    if is_reply_aware and exists (
      select 1
      from public.automation_event_outbox o$prior$, chr(13), '');
  replacement constant text := replace($replacement$    -- The timeout already holds the execution. Never wait on ingress with
    -- that row locked. A short deferral lets ingress commit and release.
    if is_reply_aware and target_execution.lead_id is not null and not
      pg_catalog.pg_try_advisory_xact_lock(private.whatsapp_automation_reply_scope_key(
        target_execution.organization_id, target_execution.lead_id
      )) then
      return jsonb_build_object('ok', false, 'status', 'reply_pending');
    end if;

    -- A successful capture atomically replaces the candidate with an event.
    -- Read both in one statement so neither disappears between snapshots.
    if is_reply_aware and (private.whatsapp_automation_reply_pending_for_wait(
      target_execution.organization_id, target_execution.lead_id, target_execution.conversation_id,
      wait_started_at, target_execution.next_execution_at
    ) or exists (
      select 1
      from public.automation_event_outbox o$replacement$, chr(13), '');
  prior_end constant text := replace($end$        and private.safe_automation_timestamptz(o.payload->>'occurred_at') <= target_execution.next_execution_at
    ) then$end$, chr(13), '');
  replacement_end constant text := replace($end$        and private.safe_automation_timestamptz(o.payload->>'occurred_at') <= target_execution.next_execution_at
        and (not (o.payload ? 'automation_reply_inbox_accepted_at') or
          private.safe_automation_timestamptz(o.payload->>'automation_reply_inbox_accepted_at') <= target_execution.next_execution_at)
    )) then$end$, chr(13), '');
begin
  select replace(pg_catalog.pg_get_functiondef(target::oid), E'\r\n', E'\n') into strict definition;
  if length(definition) - length(replace(definition, prior, '')) <> length(prior)
     or length(definition) - length(replace(definition, prior_end, '')) <> length(prior_end) then
    raise exception 'automation_reply_deadline_contract_drift';
  end if;
  execute replace(replace(definition, prior, replacement), prior_end, replacement_end);
end;
$migration$;

do $migration$
declare
  target regprocedure := 'public.process_automation_inbound_message(uuid,uuid,uuid,uuid,text,text,timestamptz)'::regprocedure;
  definition text;
  prior_declaration constant text := '  wait_step record;';
  replacement_declaration constant text := replace($replacement$  wait_step record;
  inbox_accepted_at timestamptz;$replacement$, chr(13), '');
  prior_preview constant text := '  preview := left(coalesce(nullif(trim(p_content),';
  replacement_preview constant text := replace($replacement$  select private.safe_automation_timestamptz(event.payload->>'automation_reply_inbox_accepted_at')
  into inbox_accepted_at
  from public.automation_event_outbox event
  where event.organization_id = p_organization_id and event.lead_id = p_lead_id
    and event.conversation_id is not distinct from p_conversation_id and event.aggregate_id = p_message_id
    and event.event_type = 'message_received' and event.dedupe_key = 'message_received:' || p_message_id::text;

  preview := left(coalesce(nullif(trim(p_content),$replacement$, chr(13), '');
  prior_deadline constant text := '       or p_occurred_at > candidate.next_execution_at then';
  replacement_deadline constant text := replace($replacement$       or p_occurred_at > candidate.next_execution_at
       or inbox_accepted_at > candidate.next_execution_at then$replacement$, chr(13), '');
begin
  select replace(pg_catalog.pg_get_functiondef(target::oid), E'\r\n', E'\n') into strict definition;
  if length(definition) - length(replace(definition, prior_declaration, '')) <> length(prior_declaration)
     or length(definition) - length(replace(definition, prior_preview, '')) <> length(prior_preview)
     or length(definition) - length(replace(definition, prior_deadline, '')) <> length(prior_deadline) then
    raise exception 'automation_reply_inbound_contract_drift';
  end if;
  execute replace(replace(replace(definition, prior_declaration, replacement_declaration),
    prior_preview, replacement_preview), prior_deadline, replacement_deadline);
end;
$migration$;

-- Do not consume a due slot for a wait already known to be held. The locked
-- resume RPC rechecks candidates that arrive after this initial selection.
do $migration$
declare
  target regprocedure := 'public.release_due_automation_delays(integer)'::regprocedure;
  definition text;
  prior constant text := '      and e.next_execution_at <= now()';
  replacement constant text := replace($replacement$      and e.next_execution_at <= now()
      and not case when private.whatsapp_automation_reply_pending_for_wait(
        e.organization_id, e.lead_id, e.conversation_id, null, e.next_execution_at
      ) then exists (
        select 1
        from public.automation_flow_versions fv
        cross join lateral pg_catalog.jsonb_array_elements(coalesce(fv.graph->'nodes', '[]'::jsonb)) node
        cross join lateral (
          select step.started_at
          from public.automation_execution_steps step
          where step.organization_id = e.organization_id and step.execution_id = e.id
            and step.node_key = e.current_node_key and step.status = 'waiting'
          order by step.attempt desc, step.started_at desc
          limit 1
        ) wait_step
        where fv.id = e.flow_version_id and fv.organization_id = e.organization_id and not fv.requires_review
          and node->>'id' = e.current_node_key and node->>'type' = 'delay'
          and coalesce((node->'config'->>'stop_on_reply')::boolean, false)
          and private.whatsapp_automation_reply_pending_for_wait(
            e.organization_id, e.lead_id, e.conversation_id, wait_step.started_at, e.next_execution_at
          )
      ) else false end$replacement$, chr(13), '');
begin
  select replace(pg_catalog.pg_get_functiondef(target::oid), E'\r\n', E'\n') into strict definition;
  if length(definition) - length(replace(definition, prior, '')) <> length(prior) then
    raise exception 'automation_reply_sweep_contract_drift';
  end if;
  execute replace(definition, prior, replacement);
end;
$migration$;

commit;
