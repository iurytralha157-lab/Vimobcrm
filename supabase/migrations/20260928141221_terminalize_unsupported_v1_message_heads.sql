begin;
set local lock_timeout = '5s';
set local statement_timeout = '2min';

do $preflight$
begin
  if pg_catalog.to_regclass('public.whatsapp_webhook_inbox') is null
     or pg_catalog.to_regclass('public.whatsapp_webhook_routing_snapshots') is null
     or pg_catalog.to_regclass('public.whatsapp_sessions') is null
     or pg_catalog.to_regclass('private.whatsapp_webhook_legacy_routing_freeze') is null
     or pg_catalog.to_regprocedure('private.canonical_jsonb_sha256(jsonb)') is null
     or pg_catalog.to_regprocedure(
          'private.capture_whatsapp_webhook_routing_snapshot(uuid,uuid,text,text,text,text,boolean,text[],text,text,text,boolean,boolean,boolean,uuid,uuid,uuid)'
        ) is null
     or pg_catalog.to_regprocedure('private.guard_whatsapp_webhook_legacy_routing_freeze()') is null then
    raise exception 'unsupported_v1_message_quarantine_prerequisites_missing';
  end if;
end;
$preflight$;

-- These are inbound provider envelopes that the current native parser cannot
-- represent. This audit is an independent copy of the complete raw payload;
-- inbox retention may later delete the terminal row without losing the event.
-- No lead or conversation is assigned by this procedure.
create table private.whatsapp_v1_unsupported_message_quarantine (
  inbox_id uuid primary key,
  organization_id uuid not null,
  session_id uuid not null,
  event_key text not null,
  provider text not null,
  provider_instance_id text,
  provider_message_id text not null,
  event_type text not null,
  processing_lane text not null,
  subtype text not null,
  original_status text not null,
  original_attempts integer not null,
  original_error text not null,
  original_created_at timestamptz not null,
  original_updated_at timestamptz not null,
  original_next_attempt_at timestamptz not null,
  payload jsonb not null,
  payload_sha256 text not null,
  original_expires_at timestamptz not null,
  quarantined_at timestamptz not null,
  reason text not null default 'unsupported_v1_inbound_message_raw_preserved:v1',
  constraint whatsapp_v1_unsupported_message_quarantine_identity_key
    unique (organization_id, session_id, event_key),
  constraint whatsapp_v1_unsupported_message_quarantine_provider_id_check
    check (pg_catalog.btrim(provider_message_id) <> ''
           and pg_catalog.octet_length(provider_message_id) <= 512),
  constraint whatsapp_v1_unsupported_message_quarantine_subtype_check
    check (subtype in (
      'questionReplyMessage', 'secretEncryptedMessage', 'templateMessage'
    )),
  constraint whatsapp_v1_unsupported_message_quarantine_original_check
    check (original_status = 'retry' and original_attempts >= 3
           and provider = 'evolution_go' and event_type = 'message'
           and processing_lane = 'backlog'
           and original_error =
             'native WhatsApp processor does not support this event'),
  constraint whatsapp_v1_unsupported_message_quarantine_hash_check
    check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  constraint whatsapp_v1_unsupported_message_quarantine_reason_check
    check (reason = 'unsupported_v1_inbound_message_raw_preserved:v1')
);
alter table private.whatsapp_v1_unsupported_message_quarantine
  enable row level security;
revoke all on table private.whatsapp_v1_unsupported_message_quarantine
  from public, anon, authenticated, service_role;
comment on table private.whatsapp_v1_unsupported_message_quarantine is
  'Private, full-payload audit of unsupported direct inbound message heads removed from the operational v1 backlog. No lead binding is inferred; keep the raw event for parser recovery.';

create or replace function private.unsupported_v1_message_subtype(p_payload jsonb)
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
  v_ingress jsonb;
  v_snapshot jsonb;
  v_routes jsonb;
  v_route jsonb;
  v_provider_id text;
  v_subtype text;
begin
  if pg_catalog.jsonb_typeof(p_payload) is distinct from 'object'
     or p_payload ->> 'event' is distinct from 'Message'
     or pg_catalog.jsonb_typeof(p_payload -> 'data') is distinct from 'object' then
    return null;
  end if;

  v_info := p_payload #> '{data,Info}';
  v_message := p_payload #> '{data,Message}';
  v_ingress := p_payload -> '__vimob_ingress';
  v_snapshot := v_ingress -> 'routing_snapshot';
  if pg_catalog.jsonb_typeof(v_info) is distinct from 'object'
     or pg_catalog.jsonb_typeof(v_message) is distinct from 'object'
     or pg_catalog.jsonb_typeof(v_ingress) is distinct from 'object'
     or pg_catalog.jsonb_typeof(v_snapshot) is distinct from 'object'
     or v_snapshot -> 'version' is distinct from '1'::jsonb
     or v_info -> 'IsGroup' is distinct from 'false'::jsonb
     or v_info -> 'IsFromMe' is distinct from 'false'::jsonb
     or pg_catalog.jsonb_typeof(v_info -> 'ID') is distinct from 'string'
     or pg_catalog.jsonb_typeof(v_message -> 'messageContextInfo')
          is distinct from 'object'
     or (select count(*) from pg_catalog.jsonb_object_keys(v_message)) <> 2 then
    return null;
  end if;

  v_provider_id := nullif(pg_catalog.btrim(v_info ->> 'ID'), '');
  if v_provider_id is null or pg_catalog.octet_length(v_provider_id) > 512 then
    return null;
  end if;

  if pg_catalog.jsonb_typeof(v_message -> 'questionReplyMessage') = 'object' then
    v_subtype := 'questionReplyMessage';
  elsif pg_catalog.jsonb_typeof(v_message -> 'secretEncryptedMessage') = 'object' then
    v_subtype := 'secretEncryptedMessage';
  elsif pg_catalog.jsonb_typeof(v_message -> 'templateMessage') = 'object' then
    v_subtype := 'templateMessage';
  else
    return null;
  end if;

  v_routes := v_snapshot -> 'messages';
  if pg_catalog.jsonb_typeof(v_routes) is distinct from 'array' then
    return null;
  end if;
  if pg_catalog.jsonb_array_length(v_routes) <> 1 then
    return null;
  end if;
  v_route := v_routes -> 0;
  if pg_catalog.jsonb_typeof(v_route) is distinct from 'object'
     or v_route -> 'binding_eligible' is distinct from 'false'::jsonb
     or v_route ->> 'target_mode' is distinct from 'snapshot'
     or v_route ->> 'provider_message_id' is distinct from v_provider_id
     or nullif(pg_catalog.btrim(coalesce(
          v_route ->> 'predecessor_inbox_event_key', '')), '') is not null
     or nullif(pg_catalog.btrim(coalesce(
          v_route ->> 'predecessor_provider_message_id', '')), '') is not null then
    return null;
  end if;
  return v_subtype;
end;
$function$;
revoke all on function private.unsupported_v1_message_subtype(jsonb)
  from public, anon, authenticated, service_role;

-- A call is at most three heads. The current ingress transaction calls
-- private.capture_whatsapp_webhook_routing_snapshot before inserting the inbox
-- row; that SQL function takes the same organization/session/routing-key lock.
-- The native processor uses a different lock and is fenced by the inbox row
-- lock here. Require READ COMMITTED so rechecks after waiting on the route lock
-- see newly committed successors from the current ingress path.
-- Migration installation does not call this function. An operator must review
-- a read-only candidate count, then call it explicitly with a limit of 1..3.
create or replace function private.quarantine_unsupported_v1_message_heads(
  p_limit integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_candidate record;
  v_inbox public.whatsapp_webhook_inbox%rowtype;
  v_provider_id text;
  v_subtype text;
  v_at timestamptz;
  v_updated integer;
  v_count integer := 0;
begin
  if p_limit is null or p_limit < 1 or p_limit > 3 then
    raise exception using
      errcode = '22023', message = 'unsupported_v1_message_limit_must_be_1_to_3';
  end if;
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception using
      errcode = '25001', message = 'unsupported_v1_message_requires_read_committed';
  end if;
  if not coalesce(
    pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
      'private.capture_whatsapp_webhook_routing_snapshot(uuid,uuid,text,text,text,text,boolean,text[],text,text,text,boolean,boolean,boolean,uuid,uuid,uuid)'
    )) like '%pg_advisory_xact_lock%', false
  ) or not coalesce(
    pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
      'private.capture_whatsapp_webhook_routing_snapshot(uuid,uuid,text,text,text,text,boolean,text[],text,text,text,boolean,boolean,boolean,uuid,uuid,uuid)'
    )) like
      '%p_organization_id::text || '':'' || p_session_id::text || '':'' || v_routing_key%',
    false
  ) then
    raise exception using
      errcode = '55000', message = 'whatsapp_ingress_route_lock_contract_changed';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_trigger as guard
    where guard.tgrelid = 'public.whatsapp_webhook_inbox'::regclass
      and guard.tgname = 'guard_whatsapp_webhook_legacy_routing_freeze'
      and guard.tgenabled in ('O', 'A') and not guard.tgisinternal
  ) then
    raise exception using
      errcode = '55000', message = 'whatsapp_legacy_routing_guard_not_active';
  end if;

  for v_candidate in
    select head.id, head.organization_id, head.session_id,
           route.routing_key
    from public.whatsapp_sessions as session
    cross join lateral (
      select inbox.id, inbox.organization_id, inbox.session_id,
             inbox.event_key, inbox.provider, inbox.event_type,
             inbox.payload, inbox.status, inbox.attempts,
             inbox.max_attempts, inbox.locked_at, inbox.locked_by,
             inbox.last_error, inbox.created_at
      from public.whatsapp_webhook_inbox as inbox
      where inbox.session_id = session.id
        and inbox.processing_lane = 'backlog'
        and inbox.status in ('pending', 'retry')
        and inbox.attempts < inbox.max_attempts
        and inbox.payload #>> '{__vimob_ingress,routing_snapshot,version}' = '1'
      order by inbox.created_at, inbox.id
      limit 1
    ) as head
    join public.whatsapp_webhook_routing_snapshots as route
      on route.organization_id = head.organization_id
     and route.session_id = head.session_id
     and route.inbox_event_key = head.event_key
     and route.provider_message_id = head.payload #>> '{data,Info,ID}'
     and route.processing_lane = 'backlog'
     and route.binding_eligible = false
     and route.target_mode = 'snapshot'
    where session.organization_id = head.organization_id
      and session.provider = 'evolution_go'
      and coalesce(session.is_active, true) = true
      and pg_catalog.lower(pg_catalog.btrim(coalesce(session.status, '')))
            not in ('deleted', 'disabled')
      and head.provider = 'evolution_go'
      and head.event_type = 'message'
      and head.status = 'retry'
      and head.attempts >= 3
      and head.locked_at is null and head.locked_by is null
      and head.last_error =
        'native WhatsApp processor does not support this event'
      and head.created_at < pg_catalog.now() - interval '10 minutes'
      and private.unsupported_v1_message_subtype(head.payload) is not null
    order by head.created_at, head.id
    limit p_limit
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        v_candidate.organization_id::text || ':' ||
        v_candidate.session_id::text || ':' || v_candidate.routing_key,
        0
      )
    );

    select inbox.* into v_inbox
    from public.whatsapp_webhook_inbox as inbox
    where inbox.id = v_candidate.id
    for update of inbox skip locked;
    if not found then
      continue;
    end if;
    v_subtype := private.unsupported_v1_message_subtype(v_inbox.payload);
    v_provider_id := v_inbox.payload #>> '{data,Info,ID}';
    if v_inbox.organization_id is distinct from v_candidate.organization_id
       or v_inbox.session_id is distinct from v_candidate.session_id
       or v_inbox.provider is distinct from 'evolution_go'
       or v_inbox.event_type is distinct from 'message'
       or v_inbox.processing_lane is distinct from 'backlog'
       or v_inbox.status is distinct from 'retry'
       or v_inbox.attempts < 3
       or v_inbox.attempts >= v_inbox.max_attempts
       or v_inbox.locked_at is not null or v_inbox.locked_by is not null
       or v_inbox.last_error is distinct from
            'native WhatsApp processor does not support this event'
       or v_inbox.created_at >= pg_catalog.now() - interval '10 minutes'
       or v_subtype is null then
      continue;
    end if;

    if not exists (
      select 1 from public.whatsapp_sessions as session
      where session.id = v_inbox.session_id
        and session.organization_id = v_inbox.organization_id
        and session.provider = 'evolution_go'
        and coalesce(session.is_active, true) = true
        and pg_catalog.lower(pg_catalog.btrim(coalesce(session.status, '')))
              not in ('deleted', 'disabled')
    ) or not exists (
      select 1 from public.whatsapp_webhook_routing_snapshots as route
      where route.organization_id = v_inbox.organization_id
        and route.session_id = v_inbox.session_id
        and route.inbox_event_key = v_inbox.event_key
        and route.provider_message_id = v_provider_id
        and route.routing_key = v_candidate.routing_key
        and route.processing_lane = 'backlog'
        and route.binding_eligible = false
        and route.target_mode = 'snapshot'
    ) or exists (
      select 1 from private.whatsapp_webhook_legacy_routing_freeze as frozen
      where frozen.inbox_id = v_inbox.id
    ) or exists (
      select 1 from private.whatsapp_v1_unsupported_message_quarantine as audit
      where audit.inbox_id = v_inbox.id
    ) then
      continue;
    end if;

    -- Only the oldest compatible backlog row of this physical session can
    -- be removed. Later rows stay in their original order after this head.
    if exists (
      select 1 from public.whatsapp_webhook_inbox as older
      where older.session_id = v_inbox.session_id
        and older.processing_lane = 'backlog'
        and older.status in ('pending', 'retry')
        and older.attempts < older.max_attempts
        and older.payload #>> '{__vimob_ingress,routing_snapshot,version}' = '1'
        and (older.created_at, older.id) < (v_inbox.created_at, v_inbox.id)
    ) or exists (
      select 1 from public.whatsapp_webhook_routing_snapshots as successor
      where successor.organization_id = v_inbox.organization_id
        and successor.session_id = v_inbox.session_id
        and successor.predecessor_provider_message_id = v_provider_id
    ) or exists (
      select 1
      from public.whatsapp_webhook_inbox as successor
      cross join lateral pg_catalog.jsonb_array_elements(
        case
          when pg_catalog.jsonb_typeof(successor.payload #>
               '{__vimob_ingress,routing_snapshot,messages}') = 'array'
          then successor.payload #>
               '{__vimob_ingress,routing_snapshot,messages}'
          else '[]'::jsonb
        end
      ) as route(snapshot)
      where successor.organization_id = v_inbox.organization_id
        and successor.session_id = v_inbox.session_id
        and successor.id <> v_inbox.id
        and (
          route.snapshot ->> 'predecessor_inbox_event_key' = v_inbox.event_key
          or route.snapshot ->> 'predecessor_provider_message_id' = v_provider_id
        )
    ) then
      continue;
    end if;

    v_at := pg_catalog.clock_timestamp();
    insert into private.whatsapp_v1_unsupported_message_quarantine (
      inbox_id, organization_id, session_id, event_key, provider,
      provider_instance_id, provider_message_id, event_type, processing_lane,
      subtype, original_status, original_attempts, original_error,
      original_created_at, original_updated_at, original_next_attempt_at,
      payload, payload_sha256, original_expires_at,
      quarantined_at
    ) values (
      v_inbox.id, v_inbox.organization_id, v_inbox.session_id,
      v_inbox.event_key, v_inbox.provider, v_inbox.provider_instance_id,
      v_provider_id, v_inbox.event_type, v_inbox.processing_lane, v_subtype,
      v_inbox.status, v_inbox.attempts, v_inbox.last_error,
      v_inbox.created_at, v_inbox.updated_at, v_inbox.next_attempt_at,
      v_inbox.payload, private.canonical_jsonb_sha256(v_inbox.payload),
      v_inbox.expires_at, v_at
    );

    update public.whatsapp_webhook_inbox as inbox
    set status = 'dead', dead_lettered_at = v_at,
        expires_at = greatest(v_inbox.expires_at, v_at + interval '30 days'),
        updated_at = v_at
    where inbox.id = v_inbox.id
      and inbox.status = v_inbox.status
      and inbox.attempts = v_inbox.attempts
      and inbox.updated_at = v_inbox.updated_at
      and inbox.payload = v_inbox.payload
      and inbox.locked_at is null and inbox.locked_by is null;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception using
        errcode = '40001',
        message = 'unsupported_v1_message_quarantine_compare_and_swap_failed';
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;
revoke all on function private.quarantine_unsupported_v1_message_heads(integer)
  from public, anon, authenticated, service_role;
comment on function private.quarantine_unsupported_v1_message_heads(integer) is
  'Operator-only, bounded terminal quarantine of exact unsupported inbound v1 backlog heads. Keeps a full private payload copy and never assigns a lead.';

commit;
