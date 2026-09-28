begin;
set local lock_timeout = '5s';
set local statement_timeout = '2min';

do $preflight$
begin
  if pg_catalog.to_regclass('public.whatsapp_webhook_inbox') is null
     or pg_catalog.to_regclass('public.whatsapp_sessions') is null
     or pg_catalog.to_regclass('public.whatsapp_webhook_routing_snapshots') is null
     or pg_catalog.to_regprocedure('private.canonical_jsonb_sha256(jsonb)') is null
     or pg_catalog.to_regprocedure(
       'private.is_frozen_legacy_whatsapp_ingress(uuid,uuid,uuid,text,text)'
     ) is null
     or not exists (
       select 1 from pg_catalog.pg_trigger as guard
       where guard.tgrelid = 'public.whatsapp_webhook_inbox'::regclass
         and guard.tgname = 'guard_whatsapp_webhook_legacy_routing_freeze'
         and guard.tgenabled in ('O','A') and not guard.tgisinternal
     ) then
    raise exception 'redundant_v1_session_control_prerequisites_missing';
  end if;
end;
$preflight$;

create table private.whatsapp_redundant_v1_session_control_quarantine (
  inbox_id uuid primary key,
  organization_id uuid not null,
  session_id uuid not null,
  event_key text not null,
  event_type text not null,
  session_status_at_quarantine text not null,
  original_status text not null,
  original_attempts integer not null,
  payload_sha256 text not null,
  original_expires_at timestamptz not null,
  retained_until timestamptz not null,
  quarantined_at timestamptz not null,
  reason text not null default 'redundant_v1_session_control_no_state_change:v1',
  constraint whatsapp_redundant_v1_session_control_identity_key
    unique (organization_id, session_id, event_key),
  constraint whatsapp_redundant_v1_session_control_event_status_check
    check ((event_type = 'connected' and session_status_at_quarantine = 'connected')
        or (event_type = 'loggedout' and session_status_at_quarantine = 'disconnected')),
  constraint whatsapp_redundant_v1_session_control_status_check
    check (original_status in ('pending','retry')),
  constraint whatsapp_redundant_v1_session_control_attempts_check
    check (original_attempts >= 0),
  constraint whatsapp_redundant_v1_session_control_hash_check
    check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  constraint whatsapp_redundant_v1_session_control_retention_check
    check (retained_until >= quarantined_at + interval '7 days'),
  constraint whatsapp_redundant_v1_session_control_reason_check
    check (reason = 'redundant_v1_session_control_no_state_change:v1')
);
alter table private.whatsapp_redundant_v1_session_control_quarantine
  enable row level security;
revoke all on table private.whatsapp_redundant_v1_session_control_quarantine
  from public, anon, authenticated, service_role;
comment on table private.whatsapp_redundant_v1_session_control_quarantine is
  'Exact v1 session-only controls quarantined after verifying the current session already has the same connection status. No session or lead row changes; signed raw inbox survives at least seven days.';

create or replace function private.is_redundant_v1_session_control(
  p_event_type text, p_payload jsonb
)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $function$
declare
  v_ingress jsonb;
  v_data jsonb;
begin
  if pg_catalog.jsonb_typeof(p_payload) is distinct from 'object'
     or not (p_payload ?& array['__vimob_ingress','data','event','instanceId','instanceName'])
     or (select count(*) from pg_catalog.jsonb_object_keys(p_payload)) <> 5
     or pg_catalog.jsonb_typeof(p_payload -> 'instanceId') is distinct from 'string'
     or pg_catalog.jsonb_typeof(p_payload -> 'instanceName') is distinct from 'string' then
    return false;
  end if;
  v_ingress := p_payload -> '__vimob_ingress';
  v_data := p_payload -> 'data';
  if pg_catalog.jsonb_typeof(v_ingress) is distinct from 'object'
     or (select count(*) from pg_catalog.jsonb_object_keys(v_ingress)) <> 2
     or v_ingress ->> 'routing_key' is distinct from '__session__'
     or v_ingress -> 'routing_snapshot' is distinct from
       '{"version":1,"messages":[]}'::jsonb
     or pg_catalog.jsonb_typeof(v_data) is distinct from 'object' then
    return false;
  end if;
  if p_event_type = 'connected' then
    return p_payload ->> 'event' = 'Connected'
       and (select count(*) from pg_catalog.jsonb_object_keys(v_data)) = 3
       and v_data ?& array['jid','pushName','status']
       and pg_catalog.jsonb_typeof(v_data -> 'jid') = 'string'
       and pg_catalog.jsonb_typeof(v_data -> 'pushName') = 'string'
       and v_data ->> 'status' = 'open';
  end if;
  if p_event_type = 'loggedout' then
    return p_payload ->> 'event' = 'LoggedOut'
       and pg_catalog.jsonb_typeof(v_data -> 'reason') = 'string'
       and ((select count(*) from pg_catalog.jsonb_object_keys(v_data)) = 1
         or ((select count(*) from pg_catalog.jsonb_object_keys(v_data)) = 3
             and v_data ?& array['reason','Reason','OnConnect']
             and pg_catalog.jsonb_typeof(v_data -> 'Reason') = 'number'
             and pg_catalog.jsonb_typeof(v_data -> 'OnConnect') = 'boolean'));
  end if;
  return false;
end;
$function$;
revoke all on function private.is_redundant_v1_session_control(text,jsonb)
  from public, anon, authenticated, service_role;

create or replace function private.quarantine_redundant_v1_session_controls(
  p_limit integer default 100
)
returns table (scanned integer, quarantined integer)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_candidate record;
  v_inbox public.whatsapp_webhook_inbox%rowtype;
  v_session public.whatsapp_sessions%rowtype;
  v_jid_phone text;
  v_stored_phone text;
  v_at timestamptz;
  v_updated integer;
begin
  if p_limit is null or p_limit < 0 or p_limit > 100 then
    raise exception using errcode = '22023',
      message = 'redundant_v1_session_control_limit_invalid';
  end if;
  scanned := 0;
  quarantined := 0;
  for v_candidate in
    select inbox.id, inbox.organization_id, inbox.session_id
    from public.whatsapp_webhook_inbox as inbox
    join public.whatsapp_sessions as session
      on session.id = inbox.session_id
     and session.organization_id = inbox.organization_id
    where inbox.status in ('pending','retry')
      and inbox.processing_lane = 'backlog'
      and inbox.provider = 'evolution_go'
      and inbox.event_type in ('connected','loggedout')
      and inbox.created_at < pg_catalog.now() - interval '1 hour'
      and inbox.locked_at is null and inbox.locked_by is null
      and inbox.payload #>> '{__vimob_ingress,routing_snapshot,version}' = '1'
      and ((inbox.event_type = 'connected' and session.status = 'connected')
        or (inbox.event_type = 'loggedout' and session.status = 'disconnected'))
    order by inbox.next_attempt_at, inbox.created_at, inbox.id
    limit p_limit
  loop
    scanned := scanned + 1;
    select session.* into v_session
    from public.whatsapp_sessions as session
    where session.id = v_candidate.session_id
      and session.organization_id = v_candidate.organization_id
      and session.provider = 'evolution_go'
      and session.is_active = true
    for share of session skip locked;
    if not found then continue; end if;

    select inbox.* into v_inbox
    from public.whatsapp_webhook_inbox as inbox
    where inbox.id = v_candidate.id
      and inbox.organization_id = v_candidate.organization_id
      and inbox.session_id = v_candidate.session_id
      and inbox.provider = 'evolution_go'
      and inbox.event_type in ('connected','loggedout')
      and inbox.processing_lane = 'backlog'
      and inbox.status in ('pending','retry')
      and inbox.created_at < pg_catalog.now() - interval '1 hour'
      and inbox.locked_at is null and inbox.locked_by is null
    for update of inbox skip locked;
    if not found or private.is_redundant_v1_session_control(
      v_inbox.event_type, v_inbox.payload
    ) is distinct from true or private.is_frozen_legacy_whatsapp_ingress(
      v_inbox.id, v_inbox.organization_id, v_inbox.session_id,
      v_inbox.event_key, v_inbox.processing_lane
    ) or exists (
      select 1 from public.whatsapp_webhook_routing_snapshots as route
      where route.organization_id = v_inbox.organization_id
        and route.session_id = v_inbox.session_id
        and route.inbox_event_key = v_inbox.event_key
    ) or exists (
      select 1 from private.whatsapp_redundant_v1_session_control_quarantine as audit
      where audit.inbox_id = v_inbox.id
    ) then
      continue;
    end if;
    if v_inbox.event_type = 'connected' then
      if v_session.status is distinct from 'connected'
         or v_session.last_error is not null
         or v_session.profile_name is distinct from
           v_inbox.payload #>> '{data,pushName}'
         or split_part(v_inbox.payload #>> '{data,jid}', '@', 2)
           is distinct from 's.whatsapp.net' then
        continue;
      end if;
      v_jid_phone := pg_catalog.regexp_replace(
        split_part(split_part(v_inbox.payload #>> '{data,jid}', '@', 1), ':', 1),
        '[^0-9]', '', 'g'
      );
      v_stored_phone := pg_catalog.regexp_replace(
        coalesce(v_session.phone_number, ''), '[^0-9]', '', 'g'
      );
      if pg_catalog.length(v_jid_phone) < 8
         or v_jid_phone is distinct from v_stored_phone then
        continue;
      end if;
    elsif v_inbox.event_type = 'loggedout' then
      if v_session.status is distinct from 'disconnected' then
        continue;
      end if;
    else
      continue;
    end if;

    v_at := pg_catalog.clock_timestamp();
    insert into private.whatsapp_redundant_v1_session_control_quarantine (
      inbox_id, organization_id, session_id, event_key, event_type,
      session_status_at_quarantine, original_status, original_attempts,
      payload_sha256, original_expires_at, retained_until, quarantined_at
    ) values (
      v_inbox.id, v_inbox.organization_id, v_inbox.session_id,
      v_inbox.event_key, v_inbox.event_type, v_session.status,
      v_inbox.status, v_inbox.attempts,
      private.canonical_jsonb_sha256(v_inbox.payload),
      v_inbox.expires_at, v_at + interval '7 days', v_at
    );
    update public.whatsapp_webhook_inbox as inbox
    set status = 'dead', dead_lettered_at = v_at,
        expires_at = v_at + interval '7 days', updated_at = v_at
    where inbox.id = v_inbox.id
      and inbox.status = v_inbox.status
      and inbox.attempts = v_inbox.attempts
      and inbox.updated_at = v_inbox.updated_at
      and inbox.payload = v_inbox.payload;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception using errcode = '40001',
        message = 'redundant_v1_session_control_compare_and_swap_failed';
    end if;
    quarantined := quarantined + 1;
  end loop;
  return next;
end;
$function$;
revoke all on function private.quarantine_redundant_v1_session_controls(integer)
  from public, anon, authenticated, service_role;
grant usage on schema private to service_role;
grant execute on function private.quarantine_redundant_v1_session_controls(integer)
  to service_role;

create or replace function private.protect_redundant_v1_session_control_raw_until()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if exists (
    select 1 from private.whatsapp_redundant_v1_session_control_quarantine as audit
    where audit.inbox_id = old.id
      and audit.retained_until > pg_catalog.clock_timestamp()
  ) then
    return null;
  end if;
  return old;
end;
$function$;
revoke all on function private.protect_redundant_v1_session_control_raw_until()
  from public, anon, authenticated, service_role;
create trigger protect_redundant_v1_session_control_raw_until
before delete on public.whatsapp_webhook_inbox
for each row
when (old.event_type in ('connected','loggedout'))
execute function private.protect_redundant_v1_session_control_raw_until();

do $readback$
declare
  v_payload jsonb := '{"__vimob_ingress":{"routing_key":"__session__","routing_snapshot":{"version":1,"messages":[]}},"data":{"reason":"test"},"event":"LoggedOut","instanceId":"test","instanceName":"test"}'::jsonb;
begin
  if not private.is_redundant_v1_session_control('loggedout', v_payload)
     or private.is_redundant_v1_session_control('loggedout',
       v_payload || '{"message":{"conversation":"lead text"}}'::jsonb)
     or not exists (
       select 1 from private.quarantine_redundant_v1_session_controls(0)
       where scanned = 0 and quarantined = 0
     )
     or pg_catalog.has_table_privilege('service_role',
       'private.whatsapp_redundant_v1_session_control_quarantine', 'SELECT')
     or pg_catalog.has_function_privilege('anon',
       'private.quarantine_redundant_v1_session_controls(integer)', 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated',
       'private.quarantine_redundant_v1_session_controls(integer)', 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role',
       'private.quarantine_redundant_v1_session_controls(integer)', 'EXECUTE') then
    raise exception 'redundant_v1_session_control_readback_failed';
  end if;
end;
$readback$;

commit;
