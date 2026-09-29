begin;
set local lock_timeout = '5s';
set local statement_timeout = '2min';

do $preflight$
begin
  if pg_catalog.to_regclass('public.whatsapp_webhook_inbox') is null
     or pg_catalog.to_regclass('public.whatsapp_webhook_routing_snapshots') is null
     or pg_catalog.to_regclass('public.whatsapp_webhook_routing_outcomes') is null
     or pg_catalog.to_regclass('public.whatsapp_conversation_routing_heads') is null
     or pg_catalog.to_regclass('public.whatsapp_attendance_entries') is null
     or pg_catalog.to_regclass('private.whatsapp_webhook_legacy_routing_freeze') is null
     or pg_catalog.to_regprocedure('private.canonical_jsonb_sha256(jsonb)') is null
     or pg_catalog.to_regprocedure(
          'public.activate_whatsapp_conversation_lead_binding_if_current(uuid,uuid,uuid,text,uuid,uuid)'
        ) is null then
    raise exception 'v1_opaque_root_recovery_prerequisites_missing';
  end if;
end;
$preflight$;

-- These provider objects contain no recoverable text or media bytes. An
-- operator may advance only an already-bound route through the normal binding
-- CAS, then mark the object as a processed routing control. Keep its complete
-- original ingress indefinitely so a later provider decoder can inspect it.
create table private.whatsapp_v1_opaque_lead_root_recovery (
  inbox_id uuid primary key,
  organization_id uuid not null,
  session_id uuid not null,
  event_key text not null,
  routing_key text not null,
  provider_message_id text not null,
  ingress_sequence bigint not null,
  subtype text not null check (subtype in ('secretEncryptedMessage', 'albumMessage')),
  original_status text not null check (original_status = 'dead'),
  original_attempts integer not null,
  original_max_attempts integer not null,
  original_last_error text not null check (
    original_last_error = 'native WhatsApp processor does not support this event'
  ),
  original_payload jsonb not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  original_created_at timestamptz not null,
  original_updated_at timestamptz not null,
  original_dead_lettered_at timestamptz not null,
  original_expires_at timestamptz not null,
  conversation_id uuid not null,
  lead_id uuid not null,
  active_binding_id_at_check uuid not null,
  predecessor_provider_message_id text,
  recovered_at timestamptz not null,
  reason text not null default 'opaque_provider_routing_control_raw_preserved:v1'
    check (reason = 'opaque_provider_routing_control_raw_preserved:v1'),
  unique (organization_id, session_id, event_key),
  check (original_attempts >= original_max_attempts)
);
alter table private.whatsapp_v1_opaque_lead_root_recovery enable row level security;
revoke all on table private.whatsapp_v1_opaque_lead_root_recovery
  from public, anon, authenticated, service_role;
comment on table private.whatsapp_v1_opaque_lead_root_recovery is
  'Private full-payload audit of opaque inbound lead-route controls. No message body, media, preview or unread event was projected; exact existing lead binding CAS advanced the route.';

create or replace function private.v1_opaque_lead_control_subtype(p_payload jsonb)
returns text
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $function$
declare
  v_info jsonb;
  v_message jsonb;
  v_part jsonb;
begin
  if pg_catalog.jsonb_typeof(p_payload) is distinct from 'object'
     or p_payload ->> 'event' is distinct from 'Message'
     or pg_catalog.jsonb_typeof(p_payload -> 'data') is distinct from 'object' then
    return null;
  end if;
  v_info := p_payload #> '{data,Info}';
  v_message := p_payload #> '{data,Message}';
  if pg_catalog.jsonb_typeof(v_info) is distinct from 'object'
     or v_info -> 'IsFromMe' is distinct from 'false'::jsonb
     or v_info -> 'IsGroup' is distinct from 'false'::jsonb
     or pg_catalog.jsonb_typeof(v_info -> 'ID') is distinct from 'string'
     or pg_catalog.btrim(v_info ->> 'ID') = ''
     or pg_catalog.octet_length(v_info ->> 'ID') > 512
     or pg_catalog.jsonb_typeof(v_message) is distinct from 'object'
     or (select count(*) from pg_catalog.jsonb_object_keys(v_message)) <> 2
     or pg_catalog.jsonb_typeof(v_message -> 'messageContextInfo')
          is distinct from 'object' then
    return null;
  end if;

  v_part := v_message -> 'secretEncryptedMessage';
  if pg_catalog.jsonb_typeof(v_part) = 'object'
     and (select count(*) from pg_catalog.jsonb_object_keys(v_part)) = 4
     and v_part ?& array['encIV', 'encPayload', 'secretEncType', 'targetMessageKey']
     and pg_catalog.jsonb_typeof(v_part -> 'encIV') = 'string'
     and pg_catalog.jsonb_typeof(v_part -> 'encPayload') = 'string'
     and pg_catalog.jsonb_typeof(v_part -> 'secretEncType') = 'number'
     and pg_catalog.jsonb_typeof(v_part -> 'targetMessageKey') = 'object'
     and pg_catalog.octet_length(v_part ->> 'encIV') between 1 and 256
     and pg_catalog.octet_length(v_part ->> 'encPayload') between 1 and 262144
     and (v_part ->> 'secretEncType')::numeric between 0 and 1000 then
    return 'secretEncryptedMessage';
  end if;

  v_part := v_message -> 'albumMessage';
  if pg_catalog.jsonb_typeof(v_part) = 'object'
     and (select count(*) from pg_catalog.jsonb_object_keys(v_part)) = 2
     and v_part ?& array['expectedImageCount', 'expectedVideoCount']
     and pg_catalog.jsonb_typeof(v_part -> 'expectedImageCount') = 'number'
     and pg_catalog.jsonb_typeof(v_part -> 'expectedVideoCount') = 'number'
     and (v_part ->> 'expectedImageCount')::numeric between 0 and 100
     and (v_part ->> 'expectedVideoCount')::numeric between 0 and 100
     and ((v_part ->> 'expectedImageCount')::numeric % 1) = 0
     and ((v_part ->> 'expectedVideoCount')::numeric % 1) = 0 then
    return 'albumMessage';
  end if;
  return null;
end;
$function$;
revoke all on function private.v1_opaque_lead_control_subtype(jsonb)
  from public, anon, authenticated, service_role;

-- Installation performs no recovery. Each explicit call handles at most three
-- roots, permitting one-root production canaries and exact before/after checks.
create or replace function private.recover_v1_opaque_lead_roots(p_limit integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_candidate record;
  v_root public.whatsapp_webhook_inbox%rowtype;
  v_route public.whatsapp_webhook_routing_snapshots%rowtype;
  v_conversation public.whatsapp_conversations%rowtype;
  v_binding public.whatsapp_conversation_lead_bindings%rowtype;
  v_head public.whatsapp_conversation_routing_heads%rowtype;
  v_snapshot jsonb;
  v_subtype text;
  v_provider_id text;
  v_routing_key text;
  v_conversation_id uuid;
  v_lead_id uuid;
  v_expected_binding_id uuid;
  v_cas_binding_id uuid;
  v_predecessor_provider_id text;
  v_message_count integer;
  v_target_mode text;
  v_result jsonb;
  v_target jsonb;
  v_at timestamptz;
  v_updated integer;
  v_count integer := 0;
begin
  if p_limit is null or p_limit < 1 or p_limit > 3 then
    raise exception using errcode = '22023',
      message = 'v1_opaque_root_limit_must_be_1_to_3';
  end if;
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode = '25001',
      message = 'v1_opaque_root_requires_read_committed';
  end if;

  for v_candidate in
    with live_heads as materialized (
      select distinct on (
        inbox.session_id,
        inbox.payload #>> '{__vimob_ingress,routing_key}'
      ) inbox.organization_id, inbox.session_id,
        inbox.payload #>> '{__vimob_ingress,routing_key}' as routing_key,
        inbox.payload #> '{__vimob_ingress,routing_snapshot,messages,0}' as snapshot
      from public.whatsapp_webhook_inbox inbox
      where inbox.processing_lane = 'live'
        and inbox.event_type = 'message'
        and inbox.status in ('pending', 'retry')
        and inbox.attempts < inbox.max_attempts
        and inbox.payload #>> '{__vimob_ingress,routing_snapshot,version}' = '1'
      order by inbox.session_id,
        inbox.payload #>> '{__vimob_ingress,routing_key}',
        inbox.created_at, inbox.id
    )
    select distinct root.id, root.organization_id, root.session_id,
      root.event_key, root.created_at,
      root.payload #>> '{__vimob_ingress,routing_key}' as routing_key
    from live_heads head
    join public.whatsapp_webhook_inbox root
      on root.organization_id = head.organization_id
     and root.session_id = head.session_id
     and root.event_key = head.snapshot ->> 'predecessor_inbox_event_key'
    where root.provider = 'evolution_go'
      and root.processing_lane = 'backlog'
      and root.event_type = 'message'
      and root.status = 'dead'
      and root.attempts >= root.max_attempts
      and root.locked_at is null and root.locked_by is null
      and root.last_error = 'native WhatsApp processor does not support this event'
      and root.payload #>> '{__vimob_ingress,routing_snapshot,version}' = '1'
      and private.v1_opaque_lead_control_subtype(root.payload) is not null
      and pg_catalog.btrim(coalesce(head.routing_key, '')) <> ''
      and head.routing_key <> '__session__'
      and head.routing_key = root.payload #>> '{__vimob_ingress,routing_key}'
    order by root.created_at, root.id
  loop
    exit when v_count >= p_limit;
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        v_candidate.organization_id::text || ':' ||
        v_candidate.session_id::text || ':' || v_candidate.routing_key, 0
      )
    );

    select inbox.* into v_root
    from public.whatsapp_webhook_inbox inbox
    where inbox.id = v_candidate.id
    for update of inbox skip locked;
    if not found then continue; end if;
    v_subtype := private.v1_opaque_lead_control_subtype(v_root.payload);
    v_snapshot := v_root.payload #> '{__vimob_ingress,routing_snapshot,messages,0}';
    v_provider_id := v_root.payload #>> '{data,Info,ID}';
    v_routing_key := v_root.payload #>> '{__vimob_ingress,routing_key}';
    if pg_catalog.jsonb_typeof(
      v_root.payload #> '{__vimob_ingress,routing_snapshot,messages}'
    ) = 'array' then
      v_message_count := pg_catalog.jsonb_array_length(
        v_root.payload #> '{__vimob_ingress,routing_snapshot,messages}'
      );
    else
      v_message_count := 0;
    end if;
    if v_root.organization_id is distinct from v_candidate.organization_id
       or v_root.session_id is distinct from v_candidate.session_id
       or v_root.provider is distinct from 'evolution_go'
       or v_root.processing_lane is distinct from 'backlog'
       or v_root.event_type is distinct from 'message'
       or v_root.status is distinct from 'dead'
       or v_root.attempts < v_root.max_attempts
       or v_root.locked_at is not null or v_root.locked_by is not null
       or v_root.dead_lettered_at is null
       or v_root.last_error is distinct from
            'native WhatsApp processor does not support this event'
       or v_root.created_at >= pg_catalog.now() - interval '10 minutes'
       or v_subtype is null
       or v_routing_key is distinct from v_candidate.routing_key
       or v_message_count <> 1
       or v_snapshot -> 'binding_eligible' is distinct from 'true'::jsonb
       or v_snapshot ->> 'context_kind' is distinct from 'organic'
       or v_snapshot ->> 'context_proof' is not null
       or v_snapshot -> 'managed_message_distribution' is distinct from 'false'::jsonb
       or v_snapshot -> 'managed_event_pending' is distinct from 'false'::jsonb
       or v_snapshot -> 'managed_event_handled' is distinct from 'false'::jsonb
       or v_snapshot ->> 'provider_message_id' is distinct from v_provider_id
       or v_snapshot ->> 'inbox_event_key' is distinct from v_root.event_key
       or v_snapshot ->> 'routing_key' is distinct from v_routing_key
       or coalesce(v_snapshot ->> 'state', '') not in ('bound', 'predecessor_inherit')
       or v_routing_key = '__session__'
       or exists (
         select 1 from private.whatsapp_webhook_legacy_routing_freeze frozen
         where frozen.inbox_id = v_root.id
       )
       or exists (
         select 1 from private.whatsapp_v1_opaque_lead_root_recovery audit
         where audit.inbox_id = v_root.id
       ) then
      continue;
    end if;
    if not exists (
      select 1 from public.whatsapp_sessions session
      where session.id = v_root.session_id
        and session.organization_id = v_root.organization_id
        and session.provider = 'evolution_go'
        and coalesce(session.is_active, true) = true
        and coalesce(session.status, '') not in ('deleted', 'disabled')
    ) or not exists (
      select 1 from public.whatsapp_webhook_inbox head
      where head.organization_id = v_root.organization_id
        and head.session_id = v_root.session_id
        and head.processing_lane = 'live'
        and head.event_type = 'message'
        and head.status in ('pending', 'retry')
        and head.attempts < head.max_attempts
        and head.payload #>> '{__vimob_ingress,routing_key}' = v_routing_key
        and (head.payload #> '{__vimob_ingress,routing_snapshot,messages,0}')
              ->> 'predecessor_inbox_event_key' = v_root.event_key
    ) then
      continue;
    end if;

    select route.* into v_route
    from public.whatsapp_webhook_routing_snapshots route
    where route.organization_id = v_root.organization_id
      and route.session_id = v_root.session_id
      and route.provider_message_id = v_provider_id
      and route.inbox_event_key = v_root.event_key
      and route.processing_lane = 'backlog'
      and route.routing_key = v_routing_key
      and route.binding_eligible = true
      and route.snapshot = v_snapshot
    for key share of route;
    if not found then continue; end if;

    v_conversation_id := nullif(v_snapshot ->> 'conversation_id', '')::uuid;
    v_lead_id := nullif(v_snapshot ->> 'current_lead_id', '')::uuid;
    v_expected_binding_id := nullif(v_snapshot ->> 'active_binding_id', '')::uuid;
    v_predecessor_provider_id := nullif(
      v_snapshot ->> 'predecessor_provider_message_id', ''
    );
    if v_snapshot ->> 'state' = 'bound' then
      v_target_mode := 'snapshot';
    elsif v_snapshot ->> 'state' = 'predecessor_inherit' then
      v_target_mode := 'inherit_predecessor';
    else
      v_target_mode := '';
    end if;
    if v_conversation_id is null or v_lead_id is null
       or v_expected_binding_id is null
       or v_route.target_mode is distinct from v_target_mode then
      continue;
    end if;
    if v_snapshot ->> 'state' = 'bound' then
      if v_snapshot ->> 'event_lead_id' is distinct from v_lead_id::text then
        continue;
      end if;
    else
      if v_snapshot ->> 'event_lead_id' is not null
         or v_predecessor_provider_id is null then
        continue;
      end if;
      select public.resolve_whatsapp_webhook_inherited_routing_target(
        v_root.organization_id, v_root.session_id, v_provider_id
      ) into v_target;
      if v_target -> 'ready' is distinct from 'true'::jsonb
         or v_target ->> 'conversation_id' is distinct from v_conversation_id::text
         or v_target ->> 'lead_id' is distinct from v_lead_id::text
         or v_target ->> 'active_binding_id' is distinct from
            v_expected_binding_id::text then
        continue;
      end if;
    end if;

    select conversation.* into v_conversation
    from public.whatsapp_conversations conversation
    where conversation.id = v_conversation_id
      and conversation.organization_id = v_root.organization_id
      and conversation.session_id = v_root.session_id
      and conversation.lead_id = v_lead_id
      and conversation.deleted_at is null
    for update of conversation;
    if not found then continue; end if;
    select binding.* into v_binding
    from public.whatsapp_conversation_lead_bindings binding
    where binding.id = v_expected_binding_id
      and binding.organization_id = v_root.organization_id
      and binding.session_id = v_root.session_id
      and binding.conversation_id = v_conversation_id
      and binding.lead_id = v_lead_id
      and binding.active_to is null
    for update of binding;
    if not found then continue; end if;

    if not exists (
      select 1 from public.leads lead
      where lead.id = v_lead_id and lead.organization_id = v_root.organization_id
    ) or exists (
      select 1 from public.whatsapp_attendance_entries attendance
      where attendance.organization_id = v_root.organization_id
        and attendance.session_id = v_root.session_id
        and attendance.conversation_id = v_conversation_id
        and attendance.lead_id = v_lead_id
    ) or exists (
      select 1 from public.whatsapp_messages message
      where message.organization_id = v_root.organization_id
        and message.session_id = v_root.session_id
        and (message.provider_message_id = v_provider_id
             or message.message_id = v_provider_id
             or message.client_message_id = v_provider_id)
    ) or exists (
      select 1 from public.whatsapp_outbox outbox
      where outbox.organization_id = v_root.organization_id
        and outbox.session_id = v_root.session_id
        and (outbox.provider_message_id = v_provider_id
             or outbox.client_message_id = v_provider_id)
    ) or exists (
      select 1 from public.whatsapp_webhook_routing_outcomes outcome
      where outcome.organization_id = v_root.organization_id
        and outcome.session_id = v_root.session_id
        and outcome.provider_message_id = v_provider_id
    ) then
      continue;
    end if;

    -- A prior operator relink or another route must not be overwritten merely
    -- because the active card still has the same lead. Lock in the same order
    -- as the binding CAS: conversation, active binding, applied route head.
    select head.* into v_head
    from public.whatsapp_conversation_routing_heads head
    where head.organization_id = v_root.organization_id
      and head.conversation_id = v_conversation_id
    for update of head;
    if found and (
      v_head.session_id is distinct from v_root.session_id
      or v_head.routing_key is distinct from v_routing_key
      or v_head.lead_id is distinct from v_lead_id
      or v_head.ingress_sequence > v_route.ingress_sequence
    ) then
      continue;
    end if;
    if v_snapshot ->> 'state' = 'predecessor_inherit' then
      if v_head.provider_message_id is distinct from v_predecessor_provider_id
         or v_head.ingress_sequence is distinct from (
           select predecessor.ingress_sequence
           from public.whatsapp_webhook_routing_snapshots predecessor
           where predecessor.organization_id = v_root.organization_id
             and predecessor.session_id = v_root.session_id
             and predecessor.provider_message_id = v_predecessor_provider_id
         ) then
        continue;
      end if;
    end if;

    select public.activate_whatsapp_conversation_lead_binding_if_current(
      v_root.organization_id, v_conversation_id, v_lead_id, v_provider_id,
      v_expected_binding_id, v_lead_id
    ) into v_result;
    if v_result -> 'success' is distinct from 'true'::jsonb
       or v_result -> 'is_current' is distinct from 'true'::jsonb
       or v_result -> 'stale' is distinct from 'false'::jsonb
       or v_result ->> 'conversation_id' is distinct from v_conversation_id::text
       or v_result ->> 'lead_id' is distinct from v_lead_id::text
       or v_result ->> 'active_lead_id' is distinct from v_lead_id::text then
      raise exception using errcode = '40001',
        message = 'v1_opaque_root_binding_cas_not_current';
    end if;
    v_cas_binding_id := nullif(v_result ->> 'binding_id', '')::uuid;
    if v_cas_binding_id is null or not exists (
      select 1 from public.whatsapp_conversation_lead_bindings binding
      where binding.id = v_cas_binding_id
        and binding.organization_id = v_root.organization_id
        and binding.session_id = v_root.session_id
        and binding.conversation_id = v_conversation_id
        and binding.lead_id = v_lead_id
        and binding.provider_message_id = v_provider_id
        and binding.stale = false
    ) then
      raise exception using errcode = '40001',
        message = 'v1_opaque_root_binding_ledger_not_exact';
    end if;
    if not exists (
      select 1 from public.whatsapp_conversation_routing_heads head
      where head.organization_id = v_root.organization_id
        and head.conversation_id = v_conversation_id
        and head.session_id = v_root.session_id
        and head.routing_key = v_routing_key
        and head.provider_message_id = v_provider_id
        and head.ingress_sequence = v_route.ingress_sequence
        and head.lead_id = v_lead_id
    ) then
      raise exception using errcode = '40001',
        message = 'v1_opaque_root_routing_head_not_advanced';
    end if;

    v_at := pg_catalog.clock_timestamp();
    insert into private.whatsapp_v1_opaque_lead_root_recovery (
      inbox_id, organization_id, session_id, event_key, routing_key,
      provider_message_id, ingress_sequence, subtype, original_status,
      original_attempts, original_max_attempts, original_last_error,
      original_payload, payload_sha256, original_created_at,
      original_updated_at, original_dead_lettered_at, original_expires_at,
      conversation_id, lead_id, active_binding_id_at_check,
      predecessor_provider_message_id, recovered_at
    ) values (
      v_root.id, v_root.organization_id, v_root.session_id, v_root.event_key,
      v_routing_key, v_provider_id, v_route.ingress_sequence, v_subtype,
      v_root.status, v_root.attempts, v_root.max_attempts, v_root.last_error,
      v_root.payload, private.canonical_jsonb_sha256(v_root.payload),
      v_root.created_at, v_root.updated_at, v_root.dead_lettered_at,
      v_root.expires_at, v_conversation_id, v_lead_id,
      v_expected_binding_id, v_predecessor_provider_id, v_at
    );
    insert into public.whatsapp_webhook_routing_outcomes (
      organization_id, session_id, provider_message_id, ingress_sequence,
      completed_inbox_event_key, completed_at
    ) values (
      v_root.organization_id, v_root.session_id, v_provider_id,
      v_route.ingress_sequence, v_root.event_key, v_at
    );
    update public.whatsapp_webhook_inbox inbox
    set status = 'processed', processed_at = v_at,
        dead_lettered_at = null, expires_at = 'infinity'::timestamptz,
        last_error = null, updated_at = v_at
    where inbox.id = v_root.id
      and inbox.status = 'dead'
      and inbox.attempts = v_root.attempts
      and inbox.max_attempts = v_root.max_attempts
      and inbox.updated_at = v_root.updated_at
      and inbox.payload = v_root.payload
      and inbox.locked_at is null and inbox.locked_by is null;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception using errcode = '40001',
        message = 'v1_opaque_root_inbox_compare_and_swap_failed';
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;
revoke all on function private.recover_v1_opaque_lead_roots(integer)
  from public, anon, authenticated, service_role;
comment on function private.recover_v1_opaque_lead_roots(integer) is
  'Operator-only bounded recovery of exact opaque inbound route controls using the existing lead binding CAS. Raw payload is kept indefinitely; no user-visible message is fabricated.';

commit;
