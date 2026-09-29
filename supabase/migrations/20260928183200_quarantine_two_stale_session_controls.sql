-- Two pinned historical session controls can no longer describe their
-- provider's current observed state. This installs an operator, not a sweep.
-- The 2026-09-14 Connected event for the phone-empty connected session is
-- deliberately excluded until its current provider JID is verified.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '2min';

do $preflight$
begin
  if pg_catalog.to_regclass('private.whatsapp_webhook_legacy_routing_freeze') is null
     or pg_catalog.to_regclass('private.whatsapp_session_supervisor_state') is null
     or pg_catalog.to_regprocedure(
       'private.is_frozen_legacy_whatsapp_ingress(uuid,uuid,uuid,text,text)'
     ) is null
     or pg_catalog.to_regprocedure('private.canonical_jsonb_sha256(jsonb)') is null
     or pg_catalog.to_regprocedure('private.guard_whatsapp_webhook_legacy_routing_freeze()') is null then
    raise exception 'stale_session_control_prerequisites_missing';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_trigger as trigger_state
    where trigger_state.tgrelid =
      'public.whatsapp_webhook_inbox'::regclass
      and trigger_state.tgname =
        'guard_whatsapp_webhook_legacy_routing_freeze'
      and trigger_state.tgfoid =
        'private.guard_whatsapp_webhook_legacy_routing_freeze()'::regprocedure
      and trigger_state.tgenabled in ('O', 'A')
      and not trigger_state.tgisinternal
  ) then
    raise exception 'stale_session_control_guard_trigger_missing';
  end if;
end;
$preflight$;

create table private.whatsapp_stale_session_control_raw_audit (
  inbox_id uuid primary key,
  organization_id uuid not null,
  session_id uuid not null,
  event_key text not null,
  event_type text not null check (event_type in ('connected','disconnected')),
  original_inbox jsonb not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  original_status text not null check (original_status in ('pending','retry')),
  session_status_at_quarantine text not null
    check (session_status_at_quarantine in ('connected','disconnected')),
  supervisor_status_at_quarantine text not null
    check (supervisor_status_at_quarantine in ('connected','disconnected')),
  supervisor_provider_instance_key text not null,
  supervisor_observed_at timestamptz not null,
  quarantined_at timestamptz not null,
  retained_until timestamptz not null default 'infinity'::timestamptz
    check (retained_until = 'infinity'::timestamptz),
  reason text not null default 'stale_session_control_supervisor_verified_raw_preserved:v1'
    check (reason = 'stale_session_control_supervisor_verified_raw_preserved:v1')
);
alter table private.whatsapp_stale_session_control_raw_audit enable row level security;
revoke all on private.whatsapp_stale_session_control_raw_audit
  from public, anon, authenticated, service_role;
comment on table private.whatsapp_stale_session_control_raw_audit is
  'Operator-only full raw and supervisor proof for two exact stale session controls; retained indefinitely without changing session state.';

-- The frozen v0 guard remains closed unless an exact private raw audit row
-- exists in the same transaction and no field other than status/terminal time
-- and retention changes.
create or replace function private.is_authorized_frozen_stale_session_control_quarantine(
  p_old public.whatsapp_webhook_inbox,
  p_new public.whatsapp_webhook_inbox
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select (
      ((p_old).id = 'e8064c3a-1161-4f58-87c3-a1b17c8b1f8c'::uuid
        and (p_old).event_type = 'disconnected'
        and private.canonical_jsonb_sha256((p_old).payload) =
          '57aa604d9ca4ca06a914dac68efdc0d0df4aea1add4a12cac6316e529ba25828')
      or ((p_old).id = 'c4ef8d6c-3c80-4241-9e2c-12b6a4326110'::uuid
        and (p_old).event_type = 'connected'
        and private.canonical_jsonb_sha256((p_old).payload) =
          '17c3e802d6f36de89fca8be14d676f660d75ce62eca621b955f74e1fb65f8817')
    )
    and (p_old).provider = 'evolution_go'
    and (p_old).processing_lane = 'backlog'
    and (p_old).status = 'pending'
    and (p_new).status = 'dead'
    and (p_new).dead_lettered_at is not null
    and (p_new).updated_at = (p_new).dead_lettered_at
    and (p_new).expires_at = 'infinity'::timestamptz
    and (pg_catalog.to_jsonb(p_new) - array[
      'status','dead_lettered_at','updated_at','expires_at'
    ]) = (pg_catalog.to_jsonb(p_old) - array[
      'status','dead_lettered_at','updated_at','expires_at'
    ])
    and exists (
      select 1
      from private.whatsapp_stale_session_control_raw_audit as audit
      where audit.inbox_id = (p_old).id
        and audit.organization_id = (p_old).organization_id
        and audit.session_id = (p_old).session_id
        and audit.event_key = (p_old).event_key
        and audit.event_type = (p_old).event_type
        and audit.original_status = (p_old).status
        and audit.original_inbox = pg_catalog.to_jsonb(p_old)
        and audit.payload_sha256 =
          private.canonical_jsonb_sha256((p_old).payload)
        and audit.quarantined_at = (p_new).dead_lettered_at
        and audit.retained_until = 'infinity'::timestamptz
        and audit.reason =
          'stale_session_control_supervisor_verified_raw_preserved:v1'
    );
$function$;
revoke all on function private.is_authorized_frozen_stale_session_control_quarantine(
  public.whatsapp_webhook_inbox,public.whatsapp_webhook_inbox
) from public, anon, authenticated, service_role;

do $patch_guard$
declare
  v_def text;
  v_old text := E'       or private.is_authorized_frozen_redundant_v0_connected_quarantine(old, new) then';
  v_new text := E'       or private.is_authorized_frozen_redundant_v0_connected_quarantine(old, new)\n       or private.is_authorized_frozen_stale_session_control_quarantine(old, new) then';
begin
  v_def := pg_catalog.replace(pg_catalog.pg_get_functiondef(
    'private.guard_whatsapp_webhook_legacy_routing_freeze()'::regprocedure
  ), E'\r\n', E'\n');
  if v_def is null
     or pg_catalog.strpos(v_def, 'is_authorized_frozen_stale_session_control_quarantine') <> 0
     or (pg_catalog.length(v_def) - pg_catalog.length(
       pg_catalog.replace(v_def, v_old, '')
     )) <> pg_catalog.length(v_old) then
    raise exception 'stale_session_control_guard_definition_drifted';
  end if;
  execute pg_catalog.replace(v_def, v_old, v_new);
end;
$patch_guard$;

-- One pinned row per invocation. Row locks serialize the inbox worker and the
-- supervisor; SKIP LOCKED fails closed if either is currently changing. The
-- latest observation must describe the same current provider instance.
create or replace function private.quarantine_stale_session_control_20260928(
  p_inbox_id uuid,
  p_expected_payload_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_expected record;
  v_inbox public.whatsapp_webhook_inbox%rowtype;
  v_session public.whatsapp_sessions%rowtype;
  v_supervisor private.whatsapp_session_supervisor_state%rowtype;
  v_ingress jsonb;
  v_data jsonb;
  v_at timestamptz;
  v_updated integer;
begin
  select * into v_expected
  from (values
    (
      'e8064c3a-1161-4f58-87c3-a1b17c8b1f8c'::uuid,
      '444369a8-bd52-481b-829c-2e00e01d294e'::uuid,
      '1a3ef575-a23f-4901-be80-7da50350239e'::uuid,
      'evolution_go:583001f4fe84c5fbbe643237d12ed4b1728ecf7fc185bf3208f282112d06a2f9'::text,
      '57aa604d9ca4ca06a914dac68efdc0d0df4aea1add4a12cac6316e529ba25828'::text,
      '2026-09-14 18:42:22.912636+00'::timestamptz,
      'disconnected'::text, 'pending'::text, 'connected'::text
    ),
    (
      'c4ef8d6c-3c80-4241-9e2c-12b6a4326110'::uuid,
      '3a90575d-77c6-4282-a609-176b282cd6e6'::uuid,
      '19ed6224-3a9f-4a3b-a026-4f40a1e49795'::uuid,
      'evolution_go:283d9b602546c47ce06ea0c1b2d6d6668377851609fb9453a6971a1e40b1d368'::text,
      '17c3e802d6f36de89fca8be14d676f660d75ce62eca621b955f74e1fb65f8817'::text,
      '2026-09-15 14:35:57.888348+00'::timestamptz,
      'connected'::text, 'pending'::text, 'disconnected'::text
    )
  ) as pin(
    inbox_id, organization_id, session_id, event_key, payload_sha256,
    created_at, event_type, original_status, current_status
  )
  where pin.inbox_id = p_inbox_id;
  if not found
     or p_expected_payload_sha256 is distinct from v_expected.payload_sha256 then
    raise exception using errcode = '22023',
      message = 'stale_session_control_pin_not_approved';
  end if;

  select inbox.* into v_inbox
  from public.whatsapp_webhook_inbox as inbox
  where inbox.id = p_inbox_id
  for update of inbox skip locked;
  if not found then
    raise exception using errcode = '40001',
      message = 'stale_session_control_inbox_not_available';
  end if;
  v_ingress := v_inbox.payload -> '__vimob_ingress';
  v_data := v_inbox.payload -> 'data';
  if v_inbox.organization_id is distinct from v_expected.organization_id
     or v_inbox.session_id is distinct from v_expected.session_id
     or v_inbox.event_key is distinct from v_expected.event_key
     or v_inbox.created_at is distinct from v_expected.created_at
     or v_inbox.provider is distinct from 'evolution_go'
     or v_inbox.processing_lane is distinct from 'backlog'
     or v_inbox.event_type is distinct from v_expected.event_type
     or v_inbox.status is distinct from v_expected.original_status
     or v_inbox.locked_at is not null or v_inbox.locked_by is not null
     or v_inbox.dead_lettered_at is not null
     or v_inbox.max_attempts is distinct from 12
     or v_inbox.attempts is distinct from 0
     or v_inbox.last_error is not null
     or not private.is_frozen_legacy_whatsapp_ingress(
       v_inbox.id, v_inbox.organization_id, v_inbox.session_id,
       v_inbox.event_key, v_inbox.processing_lane
     )
     or private.canonical_jsonb_sha256(v_inbox.payload)
          is distinct from v_expected.payload_sha256
     or pg_catalog.jsonb_typeof(v_inbox.payload) is distinct from 'object'
     or not (v_inbox.payload ?& array[
       '__vimob_ingress','data','event','instanceId','instanceName'
     ])
     or (select count(*) from pg_catalog.jsonb_object_keys(v_inbox.payload)) <> 5
     or (v_expected.event_type = 'connected'
         and (v_inbox.payload ->> 'event') is distinct from 'Connected')
     or (v_expected.event_type = 'disconnected'
         and (v_inbox.payload ->> 'event') is distinct from 'Disconnected')
     or pg_catalog.jsonb_typeof(v_inbox.payload -> 'instanceId') is distinct from 'string'
     or pg_catalog.jsonb_typeof(v_inbox.payload -> 'instanceName') is distinct from 'string'
     or pg_catalog.jsonb_typeof(v_ingress) is distinct from 'object'
     or (v_ingress ->> 'routing_key') is distinct from '__session__'
     or v_ingress is distinct from '{"routing_key":"__session__"}'::jsonb
     or (v_expected.event_type = 'disconnected' and
         v_data is distinct from '{}'::jsonb)
     or (v_expected.event_type = 'connected' and
         (pg_catalog.jsonb_typeof(v_data) is distinct from 'object'
          or not (v_data ?& array['jid','pushName','status'])
          or (select count(*) from pg_catalog.jsonb_object_keys(v_data)) <> 3
           or (v_data ->> 'status') is distinct from 'open'
          or pg_catalog.jsonb_typeof(v_data -> 'pushName') is distinct from 'string'
          or pg_catalog.jsonb_typeof(v_data -> 'jid') is distinct from 'string'
           or (v_data ->> 'jid') !~ '^[0-9]{10,15}@s[.]whatsapp[.]net$'))
     or exists (
       select 1 from public.whatsapp_webhook_routing_snapshots as route
       where route.organization_id = v_inbox.organization_id
         and route.session_id = v_inbox.session_id
         and route.inbox_event_key = v_inbox.event_key
     )
     or exists (
       select 1 from private.whatsapp_stale_session_control_raw_audit as audit
       where audit.inbox_id = v_inbox.id
     ) then
    raise exception using errcode = '23514',
      message = 'stale_session_control_inbox_drifted';
  end if;

  -- A session-wide old control must be the oldest active backlog event.
  if exists (
    select 1 from public.whatsapp_webhook_inbox as older
    where older.session_id = v_inbox.session_id
      and older.processing_lane = 'backlog'
      and older.status in ('pending','retry','processing')
      and (older.created_at, older.id) < (v_inbox.created_at, v_inbox.id)
  ) or exists (
    select 1 from public.whatsapp_webhook_inbox as active
    where active.session_id = v_inbox.session_id
      and active.id <> v_inbox.id
      and active.status = 'processing'
  ) then
    raise exception using errcode = '40001',
      message = 'stale_session_control_not_head';
  end if;

  select session.* into v_session
  from public.whatsapp_sessions as session
  where session.id = v_inbox.session_id
    and session.organization_id = v_inbox.organization_id
  for share of session skip locked;
  if not found
     or v_session.provider is distinct from 'evolution_go'
     or v_session.is_active is distinct from true
     or v_session.status is distinct from v_expected.current_status
     or v_session.last_error is not null
     or v_session.instance_id is distinct from v_inbox.payload ->> 'instanceId'
     or v_session.instance_name is distinct from v_inbox.payload ->> 'instanceName' then
    raise exception using errcode = '23514',
      message = 'stale_session_control_session_changed';
  end if;
  select supervisor.* into v_supervisor
  from private.whatsapp_session_supervisor_state as supervisor
  where supervisor.session_id = v_inbox.session_id
    and supervisor.organization_id = v_inbox.organization_id
  for share of supervisor skip locked;
  if not found
     or v_supervisor.provider_instance_key is distinct from coalesce(
       nullif(pg_catalog.btrim(v_session.advanced_settings ->>
         'evolution_go_resolved_instance_key'), ''),
       nullif(pg_catalog.btrim(v_session.instance_id), ''),
       nullif(pg_catalog.btrim(v_session.instance_name), ''),
       'missing:' || v_session.id::text
     )
     or v_supervisor.last_provider_status is distinct from
       v_expected.current_status
     or v_supervisor.last_provider_observed_at is null
     or v_supervisor.last_provider_observed_at <= v_inbox.created_at
     or v_supervisor.last_provider_observed_at <
       pg_catalog.clock_timestamp() - interval '15 minutes'
     or v_supervisor.last_error_code is not null then
    raise exception using errcode = '23514',
      message = 'stale_session_control_supervisor_proof_stale';
  end if;

  v_at := pg_catalog.clock_timestamp();
  insert into private.whatsapp_stale_session_control_raw_audit (
    inbox_id, organization_id, session_id, event_key, event_type,
    original_inbox, payload_sha256, original_status,
    session_status_at_quarantine, supervisor_status_at_quarantine,
    supervisor_provider_instance_key, supervisor_observed_at,
    quarantined_at
  ) values (
    v_inbox.id, v_inbox.organization_id, v_inbox.session_id,
    v_inbox.event_key, v_inbox.event_type, pg_catalog.to_jsonb(v_inbox),
    private.canonical_jsonb_sha256(v_inbox.payload), v_inbox.status,
    v_session.status, v_supervisor.last_provider_status,
    v_supervisor.provider_instance_key,
    v_supervisor.last_provider_observed_at, v_at
  );
  update public.whatsapp_webhook_inbox as inbox
  set status = 'dead', dead_lettered_at = v_at,
      expires_at = 'infinity'::timestamptz, updated_at = v_at
  where inbox.id = v_inbox.id
    and inbox.status = v_inbox.status
    and inbox.attempts = v_inbox.attempts
    and inbox.updated_at = v_inbox.updated_at
    and inbox.payload = v_inbox.payload
    and inbox.locked_at is null and inbox.locked_by is null;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 or not exists (
    select 1 from public.whatsapp_webhook_inbox as terminal
    join private.whatsapp_stale_session_control_raw_audit as audit
      on audit.inbox_id = terminal.id
    where terminal.id = v_inbox.id
      and terminal.status = 'dead'
      and terminal.dead_lettered_at = v_at
      and terminal.expires_at = 'infinity'::timestamptz
      and terminal.payload = v_inbox.payload
      and audit.original_inbox = pg_catalog.to_jsonb(v_inbox)
      and audit.payload_sha256 = v_expected.payload_sha256
      and audit.quarantined_at = v_at
      and audit.retained_until = 'infinity'::timestamptz
  ) then
    raise exception using errcode = '40001',
      message = 'stale_session_control_terminal_readback_failed';
  end if;
  return pg_catalog.jsonb_build_object(
    'inbox_id', v_inbox.id,
    'original_status', v_inbox.status,
    'supervisor_status', v_supervisor.last_provider_status,
    'supervisor_observed_at', v_supervisor.last_provider_observed_at,
    'payload_sha256', v_expected.payload_sha256
  );
end;
$function$;
revoke all on function private.quarantine_stale_session_control_20260928(uuid,text)
  from public, anon, authenticated, service_role;
comment on function private.quarantine_stale_session_control_20260928(uuid,text) is
  'Operator-only one-row quarantine for two pinned stale session controls; full raw and current supervisor proof retained forever, with no session state mutation.';

commit;
