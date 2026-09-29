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
     or pg_catalog.to_regprocedure(
       'private.is_authorized_frozen_buttonclick_quarantine(public.whatsapp_webhook_inbox,public.whatsapp_webhook_inbox)'
     ) is null
     or not exists (
       select 1 from pg_catalog.pg_trigger as guard
       where guard.tgrelid = 'public.whatsapp_webhook_inbox'::regclass
         and guard.tgname = 'guard_whatsapp_webhook_legacy_routing_freeze'
         and guard.tgenabled in ('O', 'A') and not guard.tgisinternal
     ) then
    raise exception 'deleted_session_v0_control_prerequisites_missing';
  end if;
end;
$preflight$;

-- The original signed ingress remains in the inbox indefinitely under the
-- pre-v1 freeze guard.
-- Only the exact v0 session-control envelope is eligible, never message or
-- receipt content. This audit keeps immutable identity and payload hash.
create table private.whatsapp_deleted_session_v0_control_quarantine (
  inbox_id uuid primary key,
  organization_id uuid not null,
  session_id uuid not null,
  event_key text not null,
  event_type text not null,
  original_status text not null,
  original_attempts integer not null,
  payload_sha256 text not null,
  was_frozen boolean not null default true,
  original_expires_at timestamptz not null,
  retained_until timestamptz not null,
  quarantined_at timestamptz not null,
  reason text not null default 'deleted_session_v0_control_no_state_effect:v1',
  constraint whatsapp_deleted_session_v0_control_identity_key
    unique (organization_id, session_id, event_key),
  constraint whatsapp_deleted_session_v0_control_event_check
    check (event_type in ('connected', 'loggedout')),
  constraint whatsapp_deleted_session_v0_control_status_check
    check (original_status in ('pending', 'retry')),
  constraint whatsapp_deleted_session_v0_control_attempts_check
    check (original_attempts >= 0),
  constraint whatsapp_deleted_session_v0_control_hash_check
    check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  constraint whatsapp_deleted_session_v0_control_frozen_check
    check (was_frozen),
  constraint whatsapp_deleted_session_v0_control_retention_check
    check (retained_until >= quarantined_at + interval '7 days'),
  constraint whatsapp_deleted_session_v0_control_reason_check
    check (reason = 'deleted_session_v0_control_no_state_effect:v1')
);
alter table private.whatsapp_deleted_session_v0_control_quarantine
  enable row level security;
revoke all on table private.whatsapp_deleted_session_v0_control_quarantine
  from public, anon, authenticated, service_role;
comment on table private.whatsapp_deleted_session_v0_control_quarantine is
  'Exact frozen v0 Connected/LoggedOut control quarantine for deleted inactive sessions; no session state is changed and raw signed ingress is retained indefinitely under the legacy freeze.';

create or replace function private.is_deleted_session_v0_control(p_event_type text, p_payload jsonb)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $function$
declare
  v_data jsonb;
  v_ingress jsonb;
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
     or (select count(*) from pg_catalog.jsonb_object_keys(v_ingress)) <> 1
     or v_ingress ->> 'routing_key' is distinct from '__session__'
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
revoke all on function private.is_deleted_session_v0_control(text,jsonb)
  from public, anon, authenticated, service_role;

-- The legacy freeze allows only this audited, byte-preserving transition.
-- Its existing message, receipt and ButtonClick exceptions are kept below.
create or replace function private.is_authorized_frozen_deleted_session_v0_control_quarantine(
  p_old public.whatsapp_webhook_inbox,
  p_new public.whatsapp_webhook_inbox
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select (p_old).provider = 'evolution_go'
     and (p_old).event_type in ('connected', 'loggedout')
     and (p_old).processing_lane = 'backlog'
     and (p_old).status in ('pending', 'retry')
     and (p_old).created_at < pg_catalog.now() - interval '1 hour'
     and (p_old).locked_at is null and (p_old).locked_by is null
     and (p_new).status = 'dead'
     and (p_new).dead_lettered_at is not null
     and (p_new).updated_at = (p_new).dead_lettered_at
     and (p_new).expires_at = 'infinity'::timestamptz
     and (pg_catalog.to_jsonb(p_new) - array['status','dead_lettered_at','updated_at','expires_at'])
       = (pg_catalog.to_jsonb(p_old) - array['status','dead_lettered_at','updated_at','expires_at'])
     and private.is_deleted_session_v0_control((p_old).event_type, (p_old).payload)
     and exists (
       select 1 from public.whatsapp_sessions as session
       where session.organization_id = (p_old).organization_id
         and session.id = (p_old).session_id
         and session.provider = 'evolution_go'
         and session.status = 'deleted'
         and session.is_active = false
     )
     and not exists (
       select 1 from public.whatsapp_webhook_routing_snapshots as route
       where route.organization_id = (p_old).organization_id
         and route.session_id = (p_old).session_id
         and route.inbox_event_key = (p_old).event_key
     )
     and exists (
       select 1
       from private.whatsapp_deleted_session_v0_control_quarantine as audit
       join private.whatsapp_webhook_legacy_routing_freeze as frozen
         on frozen.inbox_id = audit.inbox_id
        and frozen.organization_id = audit.organization_id
        and frozen.session_id = audit.session_id
        and frozen.event_key = audit.event_key
        and frozen.processing_lane = 'backlog'
        and frozen.original_status = audit.original_status
       where audit.inbox_id = (p_old).id
         and audit.organization_id = (p_old).organization_id
         and audit.session_id = (p_old).session_id
         and audit.event_key = (p_old).event_key
         and audit.event_type = (p_old).event_type
         and audit.original_status = (p_old).status
         and audit.original_attempts = (p_old).attempts
         and audit.original_expires_at = (p_old).expires_at
         and audit.payload_sha256 = private.canonical_jsonb_sha256((p_old).payload)
         and audit.was_frozen
         and audit.retained_until = 'infinity'::timestamptz
         and audit.quarantined_at = (p_new).dead_lettered_at
         and audit.reason = 'deleted_session_v0_control_no_state_effect:v1'
     );
$function$;
revoke all on function private.is_authorized_frozen_deleted_session_v0_control_quarantine(
  public.whatsapp_webhook_inbox, public.whatsapp_webhook_inbox
) from public, anon, authenticated, service_role;

create or replace function private.guard_whatsapp_webhook_legacy_routing_freeze()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_old_frozen boolean := false;
  v_new_snapshot_version text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_old_frozen := private.is_frozen_legacy_whatsapp_ingress(
      old.id, old.organization_id, old.session_id, old.event_key, old.processing_lane
    );
  end if;
  if tg_op = 'DELETE' then
    if v_old_frozen then
      raise exception using
        errcode = '55000',
        message = 'frozen_legacy_whatsapp_ingress_delete_forbidden',
        hint = 'The preserved raw ingress cannot be deleted by queue quarantine.';
    end if;
    return old;
  end if;

  if v_old_frozen then
    if private.is_authorized_frozen_legacy_message_quarantine(old, new)
       or private.is_authorized_frozen_buttonclick_quarantine(old, new)
       or private.is_authorized_frozen_deleted_session_v0_control_quarantine(old, new) then
      return new;
    end if;
    if tg_op = 'UPDATE'
       and old.event_type = 'receipt'
       and old.provider = 'evolution_go'
       and old.status in ('pending', 'retry')
       and old.created_at < pg_catalog.now() - interval '7 days'
       and old.locked_at is null and old.locked_by is null
       and new.status = 'dead'
       and new.dead_lettered_at is not null
       and new.updated_at = new.dead_lettered_at
       and new.expires_at = 'infinity'::timestamptz
       and (pg_catalog.to_jsonb(new) - array['status','dead_lettered_at','updated_at','expires_at'])
         = (pg_catalog.to_jsonb(old) - array['status','dead_lettered_at','updated_at','expires_at'])
       and private.is_frozen_legacy_status_only_receipt(old.payload)
       and exists (
         select 1
         from private.whatsapp_legacy_receipt_terminalizations as audit
         join private.whatsapp_webhook_legacy_routing_freeze as frozen
           on frozen.inbox_id = audit.inbox_id
          and frozen.organization_id = audit.organization_id
          and frozen.session_id = audit.session_id
          and frozen.event_key = audit.event_key
          and frozen.processing_lane = audit.processing_lane
          and frozen.original_status = audit.original_status
         where audit.inbox_id = old.id
           and audit.organization_id = old.organization_id
           and audit.session_id = old.session_id
           and audit.event_key = old.event_key
           and audit.processing_lane = old.processing_lane
           and audit.original_status = old.status
           and audit.payload_sha256 = private.canonical_jsonb_sha256(old.payload)
           and audit.provider_message_ids = old.payload #> '{data,MessageIDs}'
           and audit.receipt_type = old.payload #>> '{data,Type}'
           and audit.terminalized_at = new.dead_lettered_at
           and audit.reason = 'frozen_legacy_status_only_receipt_after_7_days:v1'
       ) then
      return new;
    end if;
    if new.organization_id is distinct from old.organization_id
       or new.session_id is distinct from old.session_id
       or new.event_key is distinct from old.event_key
       or new.event_type is distinct from old.event_type
       or new.provider_instance_id is distinct from old.provider_instance_id
       or new.processing_lane is distinct from old.processing_lane
       or new.payload is distinct from old.payload
       or new.status is distinct from old.status then
      raise exception using
        errcode = '55000',
        message = 'frozen_legacy_whatsapp_ingress_mutation_forbidden',
        hint = 'Use only an audited procedure for preserved pre-v1 ingress.';
    end if;
    return new;
  end if;

  v_new_snapshot_version := coalesce(
    new.payload #>> '{__vimob_ingress,routing_snapshot,version}', ''
  );
  if new.status in ('pending', 'retry', 'processing')
     and v_new_snapshot_version <> '1' then
    raise exception using
      errcode = '23514',
      message = 'active_whatsapp_ingress_requires_routing_snapshot_v1';
  end if;
  return new;
end;
$function$;
revoke all on function private.guard_whatsapp_webhook_legacy_routing_freeze()
  from public, anon, authenticated, service_role;
comment on function private.guard_whatsapp_webhook_legacy_routing_freeze() is
  'Preserves frozen pre-v1 ingress; only exact audit-backed receipt, message, unroutable ButtonClick and deleted-session v0 control status transitions may leave the active queue.';


create or replace function private.quarantine_deleted_session_v0_controls(p_limit integer default 100)
returns table (scanned integer, quarantined integer)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_candidate record;
  v_inbox public.whatsapp_webhook_inbox%rowtype;
  v_session_status text;
  v_session_active boolean;
  v_at timestamptz;
  v_updated integer;
begin
  if p_limit is null or p_limit < 0 or p_limit > 100 then
    raise exception using errcode = '22023',
      message = 'deleted_session_v0_control_limit_invalid';
  end if;
  scanned := 0;
  quarantined := 0;
  for v_candidate in
    select inbox.id, inbox.organization_id, inbox.session_id
    from public.whatsapp_webhook_inbox as inbox
    join public.whatsapp_sessions as session
      on session.id = inbox.session_id
     and session.organization_id = inbox.organization_id
    where inbox.status in ('pending', 'retry')
      and inbox.processing_lane = 'backlog'
      and inbox.provider = 'evolution_go'
      and inbox.event_type in ('connected', 'loggedout')
      and inbox.created_at < pg_catalog.now() - interval '1 hour'
      and inbox.locked_at is null and inbox.locked_by is null
      and inbox.payload #> '{__vimob_ingress,routing_snapshot}' is null
      and session.provider = 'evolution_go'
      and session.status = 'deleted'
      and session.is_active = false
    order by inbox.next_attempt_at, inbox.created_at, inbox.id
    limit p_limit
  loop
    scanned := scanned + 1;

    -- Match the deleted-session recovery lock order (session before inbox).
    select session.status, session.is_active
      into v_session_status, v_session_active
    from public.whatsapp_sessions as session
    where session.id = v_candidate.session_id
      and session.organization_id = v_candidate.organization_id
      and session.provider = 'evolution_go'
    for share of session skip locked;
    if not found or v_session_status is distinct from 'deleted'
       or v_session_active is distinct from false then
      continue;
    end if;

    select inbox.* into v_inbox
    from public.whatsapp_webhook_inbox as inbox
    where inbox.id = v_candidate.id
      and inbox.organization_id = v_candidate.organization_id
      and inbox.session_id = v_candidate.session_id
      and inbox.provider = 'evolution_go'
      and inbox.event_type in ('connected', 'loggedout')
      and inbox.processing_lane = 'backlog'
      and inbox.status in ('pending', 'retry')
      and inbox.created_at < pg_catalog.now() - interval '1 hour'
      and inbox.locked_at is null and inbox.locked_by is null
    for update of inbox skip locked;
    if not found or private.is_deleted_session_v0_control(
      v_inbox.event_type, v_inbox.payload
    ) is distinct from true or exists (
      select 1 from public.whatsapp_webhook_routing_snapshots as route
      where route.organization_id = v_inbox.organization_id
        and route.session_id = v_inbox.session_id
        and route.inbox_event_key = v_inbox.event_key
    ) or not private.is_frozen_legacy_whatsapp_ingress(
      v_inbox.id, v_inbox.organization_id, v_inbox.session_id,
      v_inbox.event_key, v_inbox.processing_lane
    ) or exists (
      select 1 from private.whatsapp_deleted_session_v0_control_quarantine as audit
      where audit.inbox_id = v_inbox.id
    ) then
      continue;
    end if;

    v_at := pg_catalog.clock_timestamp();
    insert into private.whatsapp_deleted_session_v0_control_quarantine (
      inbox_id, organization_id, session_id, event_key, event_type,
      original_status, original_attempts, payload_sha256, was_frozen,
      original_expires_at, retained_until, quarantined_at
    ) values (
      v_inbox.id, v_inbox.organization_id, v_inbox.session_id,
      v_inbox.event_key, v_inbox.event_type, v_inbox.status,
      v_inbox.attempts, private.canonical_jsonb_sha256(v_inbox.payload), true,
      v_inbox.expires_at, 'infinity'::timestamptz, v_at
    );

    update public.whatsapp_webhook_inbox as inbox
    set status = 'dead', dead_lettered_at = v_at,
        expires_at = 'infinity'::timestamptz, updated_at = v_at
    where inbox.id = v_inbox.id
      and inbox.status = v_inbox.status
      and inbox.attempts = v_inbox.attempts
      and inbox.updated_at = v_inbox.updated_at
      and inbox.payload = v_inbox.payload;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception using errcode = '40001',
        message = 'deleted_session_v0_control_compare_and_swap_failed';
    end if;
    quarantined := quarantined + 1;
  end loop;
  return next;
end;
$function$;
revoke all on function private.quarantine_deleted_session_v0_controls(integer)
  from public, anon, authenticated, service_role;
grant usage on schema private to service_role;
grant execute on function private.quarantine_deleted_session_v0_controls(integer)
  to service_role;
comment on function private.quarantine_deleted_session_v0_controls(integer) is
  'Quarantines only exact v0 Connected/LoggedOut controls belonging to currently deleted inactive sessions. Session state and lead messages are untouched.';

do $readback$
declare
  v_connected jsonb := '{"__vimob_ingress":{"routing_key":"__session__"},"data":{"jid":"test@server","pushName":"Test","status":"open"},"event":"Connected","instanceId":"test","instanceName":"test"}'::jsonb;
  v_loggedout jsonb := '{"__vimob_ingress":{"routing_key":"__session__"},"data":{"reason":"test","Reason":401,"OnConnect":false},"event":"LoggedOut","instanceId":"test","instanceName":"test"}'::jsonb;
begin
  if not private.is_deleted_session_v0_control('connected', v_connected)
     or not private.is_deleted_session_v0_control('loggedout', v_loggedout)
     or private.is_deleted_session_v0_control('connected',
       v_connected || '{"message":{"conversation":"lead text"}}'::jsonb)
     or private.is_deleted_session_v0_control('loggedout',
       pg_catalog.jsonb_set(v_loggedout,
         '{__vimob_ingress,routing_snapshot}',
         '{"version":1,"messages":[]}'::jsonb))
     or not exists (
       select 1 from private.quarantine_deleted_session_v0_controls(0)
       where scanned = 0 and quarantined = 0
     ) then
    raise exception 'deleted_session_v0_control_classifier_readback_failed';
  end if;
  if pg_catalog.has_table_privilege('service_role',
       'private.whatsapp_deleted_session_v0_control_quarantine', 'SELECT')
     or pg_catalog.has_function_privilege('anon',
       'private.quarantine_deleted_session_v0_controls(integer)', 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated',
       'private.quarantine_deleted_session_v0_controls(integer)', 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role',
       'private.quarantine_deleted_session_v0_controls(integer)', 'EXECUTE') then
    raise exception 'deleted_session_v0_control_security_readback_failed';
  end if;
end;
$readback$;

commit;
