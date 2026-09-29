-- A legacy dead event may have no v1 route ledger. A private provider-ID
-- tombstone prevents its future replay from joining the current lead after a
-- route cutoff. Installation creates no tombstone or inbox mutation.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

create table private.whatsapp_legacy_provider_tombstones (
  organization_id uuid not null,
  session_id uuid not null,
  provider_message_id text not null,
  routing_key text not null,
  source_inbox_id uuid not null unique,
  original_inbox jsonb not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  retained_until timestamptz not null default 'infinity'::timestamptz
    check (retained_until = 'infinity'::timestamptz),
  primary key (organization_id, session_id, provider_message_id),
  check (btrim(provider_message_id) <> '' and octet_length(provider_message_id) <= 512),
  check (btrim(routing_key) <> '' and routing_key <> '__session__')
);
alter table private.whatsapp_legacy_provider_tombstones enable row level security;
revoke all on private.whatsapp_legacy_provider_tombstones
  from public, anon, authenticated, service_role;

create table private.whatsapp_legacy_provider_replay_raw_audit (
  inbox_id uuid primary key,
  organization_id uuid not null,
  session_id uuid not null,
  provider_message_id text not null,
  source_inbox_id uuid not null,
  terminal_inbox jsonb not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  audited_at timestamptz not null default clock_timestamp(),
  retained_until timestamptz not null default 'infinity'::timestamptz
    check (retained_until = 'infinity'::timestamptz),
  foreign key (organization_id, session_id, provider_message_id)
    references private.whatsapp_legacy_provider_tombstones
      (organization_id, session_id, provider_message_id)
);
alter table private.whatsapp_legacy_provider_replay_raw_audit enable row level security;
revoke all on private.whatsapp_legacy_provider_replay_raw_audit
  from public, anon, authenticated, service_role;
comment on table private.whatsapp_legacy_provider_replay_raw_audit is
  'Private full replay payload and terminal inbox record, retained indefinitely. The original pre-v1 inbox record is stored separately in whatsapp_legacy_provider_tombstones.';

-- Force an exact tombstoned provider ID into non-binding quarantine under
-- the existing per-route advisory lock, before any new route ledger is saved.
-- Existing provider snapshots still return immutable provenance; the inbox
-- trigger below rejects anything other than the quarantined snapshot.
do $patch_capture$
declare
  v_def text;
  v_old text := E'  if v_quarantine_reason is not null then\n    v_state := ''quarantine'';\n    v_target_lead_id := null;\n  end if;';
  v_new text := E'  if exists (\n    select 1 from private.whatsapp_legacy_provider_tombstones as tombstone\n    where tombstone.organization_id = p_organization_id\n      and tombstone.session_id = p_session_id\n      and tombstone.provider_message_id = v_provider_message_id\n  ) then\n    if not exists (\n      select 1 from private.whatsapp_legacy_provider_tombstones as tombstone\n      where tombstone.organization_id = p_organization_id\n        and tombstone.session_id = p_session_id\n        and tombstone.provider_message_id = v_provider_message_id\n        and tombstone.routing_key = v_routing_key\n    ) then\n      raise exception using errcode = ''23505'',\n        message = ''whatsapp_legacy_tombstone_route_conflict'';\n    end if;\n    v_quarantine_reason := ''legacy_provider_replay_tombstoned'';\n  end if;\n\n  if v_quarantine_reason is not null then\n    v_state := ''quarantine'';\n    v_target_lead_id := null;\n  end if;';
begin
  v_def := pg_catalog.replace(pg_catalog.pg_get_functiondef(
    'private.capture_whatsapp_webhook_routing_snapshot(uuid,uuid,text,text,text,text,boolean,text[],text,text,text,boolean,boolean,boolean,uuid,uuid,uuid)'::regprocedure
  ), E'\r\n', E'\n');
  if v_def is null
     or pg_catalog.strpos(v_def, 'pg_advisory_xact_lock') = 0
     or pg_catalog.strpos(v_def, 'whatsapp_invalidated_route_barriers') = 0
     or pg_catalog.strpos(v_def, 'whatsapp_legacy_provider_tombstones') <> 0
     or (pg_catalog.length(v_def) - pg_catalog.length(
       pg_catalog.replace(v_def, v_old, ''))) <> pg_catalog.length(v_old) then
    raise exception 'whatsapp_legacy_tombstone_capture_definition_drifted';
  end if;
  execute pg_catalog.replace(v_def, v_old, v_new);
end;
$patch_capture$;

create or replace function private.quarantine_legacy_provider_tombstone_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_provider_id text;
  v_messages jsonb;
  v_snapshot jsonb;
  v_message_count integer;
  v_tombstone private.whatsapp_legacy_provider_tombstones%rowtype;
  v_route public.whatsapp_webhook_routing_snapshots%rowtype;
begin
  -- A mixed/unsplit webhook must roll back before any live member is queued.
  -- The API may retry an isolated message without losing other lead data.
  if pg_catalog.jsonb_typeof(new.payload #> '{data,messages}') = 'array' then
    if exists (
       select 1 from pg_catalog.jsonb_array_elements(
         new.payload #> '{data,messages}') as member(payload)
       join private.whatsapp_legacy_provider_tombstones as tombstone
         on tombstone.organization_id = new.organization_id
        and tombstone.session_id = new.session_id
        and tombstone.provider_message_id = member.payload #>> '{Info,ID}'
    ) then
      raise exception using errcode = '23514',
        message = 'legacy_tombstone_mixed_provider_batch_requires_isolation';
    end if;
  end if;
  v_messages := new.payload #> '{__vimob_ingress,routing_snapshot,messages}';
  if pg_catalog.jsonb_typeof(v_messages) = 'array' then
    v_message_count := pg_catalog.jsonb_array_length(v_messages);
  else
    v_message_count := -1;
  end if;
  if exists (
    select 1 from private.whatsapp_legacy_provider_tombstones as tombstone
    where tombstone.organization_id = new.organization_id
      and tombstone.session_id = new.session_id
      and tombstone.provider_message_id = new.payload #>> '{data,Info,ID}'
      and (v_message_count <> 1
        or v_messages -> 0 ->> 'provider_message_id'
          is distinct from tombstone.provider_message_id)
  ) then
    raise exception using errcode = '23514',
      message = 'legacy_tombstone_envelope_snapshot_mismatch';
  end if;
  if v_message_count > 1 then
    if exists (
       select 1 from pg_catalog.jsonb_array_elements(v_messages) as member(snapshot)
       join private.whatsapp_legacy_provider_tombstones as tombstone
         on tombstone.organization_id = new.organization_id
        and tombstone.session_id = new.session_id
        and tombstone.provider_message_id = member.snapshot ->> 'provider_message_id'
    ) then
      raise exception using errcode = '23514',
        message = 'legacy_tombstone_mixed_snapshot_requires_isolation';
    end if;
  end if;
  -- The scheduling envelope may be __session__ or have no data.Info.ID
  -- even when one valid provider snapshot was captured from a batch.
  -- Match the immutable snapshot first; an inconsistent envelope fails
  -- closed below instead of reintroducing the tombstoned ID to the worker.
  v_provider_id := v_messages -> 0 ->> 'provider_message_id';
  if v_provider_id is null then return new; end if;
  select tombstone.* into v_tombstone
  from private.whatsapp_legacy_provider_tombstones as tombstone
  where tombstone.organization_id = new.organization_id
    and tombstone.session_id = new.session_id
    and tombstone.provider_message_id = v_provider_id
  for key share of tombstone;
  if not found then return new; end if;
  if new.provider is distinct from 'evolution_go'
     or new.event_type is distinct from 'message'
     or new.status is distinct from 'pending'
     or new.payload #>> '{data,Info,ID}' is distinct from v_provider_id
     or new.payload #>> '{__vimob_ingress,routing_key}' is distinct from
          v_tombstone.routing_key
     or new.payload #>> '{__vimob_ingress,routing_snapshot,version}' is distinct from '1'
     or v_message_count <> 1 then
    raise exception using errcode = '23514',
      message = 'legacy_tombstone_replay_envelope_invalid';
  end if;
  v_snapshot := v_messages -> 0;
  select route.* into v_route
  from public.whatsapp_webhook_routing_snapshots as route
  where route.organization_id = new.organization_id
    and route.session_id = new.session_id
    and route.provider_message_id = v_provider_id
    and route.inbox_event_key = v_snapshot ->> 'inbox_event_key'
    and route.routing_key = v_tombstone.routing_key
    and route.snapshot = v_snapshot
    and route.target_mode = 'snapshot'
    and route.binding_eligible = false
  for key share of route;
  if not found
     or v_snapshot ->> 'provider_message_id' is distinct from v_provider_id
     or v_snapshot ->> 'routing_key' is distinct from v_tombstone.routing_key
     or v_snapshot ->> 'state' is distinct from 'quarantine'
     or v_snapshot ->> 'quarantine_reason' is distinct from
          'legacy_provider_replay_tombstoned'
     or v_snapshot -> 'binding_eligible' is distinct from 'false'::jsonb
     or v_snapshot ->> 'target_mode' is distinct from 'snapshot'
     or v_snapshot ->> 'event_lead_id' is not null
     or v_snapshot ->> 'predecessor_provider_message_id' is not null then
    raise exception using errcode = '23514',
      message = 'legacy_tombstone_replay_snapshot_invalid';
  end if;
  new.status := 'dead';
  new.attempts := new.max_attempts;
  new.last_error := 'legacy_provider_tombstone_replay_raw_preserved:v1';
  new.dead_lettered_at := pg_catalog.clock_timestamp();
  new.expires_at := 'infinity'::timestamptz;
  new.locked_at := null;
  new.locked_by := null;
  return new;
end;
$function$;
revoke all on function private.quarantine_legacy_provider_tombstone_before_insert()
  from public, anon, authenticated, service_role;
create trigger quarantine_legacy_provider_tombstone_before_insert
before insert on public.whatsapp_webhook_inbox
for each row execute function private.quarantine_legacy_provider_tombstone_before_insert();

create or replace function private.audit_legacy_provider_tombstone_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tombstone private.whatsapp_legacy_provider_tombstones%rowtype;
begin
  if new.last_error is distinct from
       'legacy_provider_tombstone_replay_raw_preserved:v1'
     or new.status is distinct from 'dead' then
    return new;
  end if;
  select tombstone.* into v_tombstone
  from private.whatsapp_legacy_provider_tombstones as tombstone
  where tombstone.organization_id = new.organization_id
    and tombstone.session_id = new.session_id
    and tombstone.provider_message_id = new.payload #>> '{data,Info,ID}'
    and tombstone.routing_key = new.payload #>> '{__vimob_ingress,routing_key}'
  for key share of tombstone;
  if not found or new.expires_at is distinct from 'infinity'::timestamptz then
    raise exception using errcode = '23514',
      message = 'legacy_tombstone_replay_audit_identity_invalid';
  end if;
  insert into private.whatsapp_legacy_provider_replay_raw_audit (
    inbox_id, organization_id, session_id, provider_message_id,
    source_inbox_id, terminal_inbox, payload_sha256, audited_at
  ) values (
    new.id, new.organization_id, new.session_id,
    v_tombstone.provider_message_id, v_tombstone.source_inbox_id,
    pg_catalog.to_jsonb(new), private.canonical_jsonb_sha256(new.payload),
    pg_catalog.clock_timestamp()
  );
  return new;
end;
$function$;
revoke all on function private.audit_legacy_provider_tombstone_after_insert()
  from public, anon, authenticated, service_role;
create trigger audit_legacy_provider_tombstone_after_insert
after insert on public.whatsapp_webhook_inbox
for each row execute function private.audit_legacy_provider_tombstone_after_insert();

commit;
