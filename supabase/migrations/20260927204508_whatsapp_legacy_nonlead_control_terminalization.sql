-- Audited, fail-closed terminalization of frozen pre-v1 control events.
-- Message, reaction, campaign, receipt and unknown events are never eligible.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '2min';

do $preflight$
begin
  if pg_catalog.to_regclass('private.whatsapp_webhook_legacy_routing_freeze') is null
     or pg_catalog.to_regprocedure('private.canonical_jsonb_sha256(jsonb)') is null
     or pg_catalog.to_regprocedure('private.guard_whatsapp_webhook_legacy_routing_freeze()') is null then
    raise exception 'whatsapp_legacy_nonlead_control_prerequisites_missing';
  end if;
end;
$preflight$;

create table if not exists private.whatsapp_webhook_legacy_control_terminalizations (
  inbox_id uuid primary key
    references private.whatsapp_webhook_legacy_routing_freeze(inbox_id) on delete restrict,
  organization_id uuid not null,
  session_id uuid not null,
  event_key text not null,
  event_type text not null,
  original_status text not null,
  payload_sha256 text not null,
  decision text not null default 'nonlead_connection_control',
  decided_at timestamptz not null default clock_timestamp(),
  applied_at timestamptz,
  constraint whatsapp_webhook_legacy_control_decision_check
    check (decision = 'nonlead_connection_control'),
  constraint whatsapp_webhook_legacy_control_original_status_check
    check (original_status in ('pending', 'retry')),
  constraint whatsapp_webhook_legacy_control_payload_sha_check
    check (payload_sha256 ~ '^[0-9a-f]{64}$')
);

comment on table private.whatsapp_webhook_legacy_control_terminalizations is
'Audited decisions for frozen pre-v1 QR/connection controls proven to contain no lead signal. This ledger keeps the raw inbox row and never authorizes message or receipt discard.';

alter table private.whatsapp_webhook_legacy_control_terminalizations enable row level security;
revoke all on table private.whatsapp_webhook_legacy_control_terminalizations
from public, anon, authenticated, service_role;

-- A narrow exact-name gate plus a recursive key scan. Unknown nesting and
-- message-like keys fail closed; ordinary provider text is never interpreted
-- as proof of a lead's absence.
create or replace function private.whatsapp_legacy_payload_has_lead_signal(
  p_value jsonb,
  p_depth integer default 0
)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_item record;
  v_key text;
  v_scalar text;
begin
  if p_depth > 16 then
    return true;
  end if;
  if pg_catalog.jsonb_typeof(p_value) = 'object' then
    for v_item in select key, value from pg_catalog.jsonb_each(p_value) loop
      v_key := pg_catalog.lower(
        pg_catalog.regexp_replace(v_item.key, '[^a-zA-Z0-9]', '', 'g')
      );
      if v_key ~ '(message|receipt|reaction|referral|campaign|ctwa|externalad|buttonclick|contact|lead|conversation|remotejid|chat|sender|recipient)' then
        return true;
      end if;
      if private.whatsapp_legacy_payload_has_lead_signal(v_item.value, p_depth + 1) then
        return true;
      end if;
    end loop;
  elsif pg_catalog.jsonb_typeof(p_value) = 'array' then
    for v_item in select value from pg_catalog.jsonb_array_elements(p_value) loop
      if private.whatsapp_legacy_payload_has_lead_signal(v_item.value, p_depth + 1) then
        return true;
      end if;
    end loop;
  elsif pg_catalog.jsonb_typeof(p_value) = 'string' then
    v_scalar := pg_catalog.lower(p_value #>> '{}');
    if pg_catalog.length(v_scalar) > 20000
       or v_scalar ~ '^[[:space:]]*[\{\[]'
       or v_scalar ~ '(message|receipt|reaction|referral|campaign|ctwa|externalad|buttonclick|lead|conversation|@s\.whatsapp\.net|@lid)' then
      return true;
    end if;
  end if;
  return false;
end;
$$;

revoke all on function private.whatsapp_legacy_payload_has_lead_signal(jsonb,integer)
from public, anon, authenticated, service_role;

create or replace function private.whatsapp_legacy_is_nonlead_control(
  p_event_type text,
  p_payload jsonb
)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_event text := pg_catalog.lower(
    pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_event_type, '')), '[^a-zA-Z0-9]', '', 'g')
  );
  v_payload_event text;
  v_data jsonb;
  v_state text;
  v_provider_payload jsonb;
  v_ingress jsonb;
  v_snapshot jsonb;
begin
  if pg_catalog.jsonb_typeof(p_payload) <> 'object'
     or v_event not in (
       'qrcodeupdated', 'qrcode', 'connectionupdate',
       'connectionstatus', 'instanceupdate',
       'connected', 'disconnected', 'loggedout'
     ) then
    return false;
  end if;
  v_provider_payload := p_payload;
  if p_payload ? '__vimob_ingress' then
    v_ingress := p_payload->'__vimob_ingress';
    v_snapshot := v_ingress->'routing_snapshot';
    if pg_catalog.jsonb_typeof(v_ingress) <> 'object'
       or pg_catalog.jsonb_typeof(v_snapshot) <> 'object'
       or v_ingress->>'routing_key' is distinct from '__session__'
       or v_snapshot->'version' is distinct from '1'::jsonb
       or v_snapshot->'messages' is distinct from '[]'::jsonb
       or exists (
         select 1 from pg_catalog.jsonb_object_keys(v_ingress) as ingress_key(key)
         where ingress_key.key not in ('routing_key', 'routing_snapshot')
       )
       or exists (
         select 1 from pg_catalog.jsonb_object_keys(v_snapshot) as snapshot_key(key)
         where snapshot_key.key not in ('version', 'messages')
       ) then
      return false;
    end if;
    v_provider_payload := p_payload - '__vimob_ingress';
  end if;
  -- Positive schema proof. The recursive deny scanner below cannot know
  -- every provider alias for message text, a phone or a lead identifier.
  -- Unknown top-level or data keys therefore hold the entire event.
  if exists (
       select 1
       from pg_catalog.jsonb_object_keys(v_provider_payload) as top_key(key)
       where top_key.key not in ('event', 'date_time', 'data')
     )
     or pg_catalog.jsonb_typeof(v_provider_payload->'event') <> 'string'
     or pg_catalog.jsonb_typeof(v_provider_payload->'data') <> 'object' then
    return false;
  end if;
  if v_provider_payload ? 'date_time' then
    if pg_catalog.jsonb_typeof(v_provider_payload->'date_time') <> 'string'
       or (v_provider_payload->>'date_time') !~
          '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?(Z|[+-][0-9]{2}:[0-9]{2})$' then
      return false;
    end if;
  end if;
  v_payload_event := pg_catalog.lower(pg_catalog.regexp_replace(
    pg_catalog.btrim(v_provider_payload ->> 'event'),
    '[^a-zA-Z0-9]', '', 'g'
  ));
  if v_payload_event <> v_event then
    return false;
  end if;
  v_data := v_provider_payload->'data';
  if v_event in ('qrcodeupdated', 'qrcode') then
    if exists (
         select 1
         from pg_catalog.jsonb_object_keys(v_data) as data_key(key)
         where data_key.key <> 'qrcode'
       )
       or (v_data ? 'qrcode' and (
         pg_catalog.jsonb_typeof(v_data->'qrcode') <> 'string'
         or pg_catalog.length(v_data->>'qrcode') > 20000
       )) then
      return false;
    end if;
  else
    if exists (
         select 1
         from pg_catalog.jsonb_object_keys(v_data) as data_key(key)
         where data_key.key not in ('state', 'status', 'loggedIn', 'connected')
       )
       or not (
         v_data ? 'state' or v_data ? 'status'
         or v_data ? 'loggedIn' or v_data ? 'connected'
       )
       or (v_data ? 'state' and v_data ? 'status')
       or (v_data ? 'loggedIn' and pg_catalog.jsonb_typeof(v_data->'loggedIn') <> 'boolean')
       or (v_data ? 'connected' and pg_catalog.jsonb_typeof(v_data->'connected') <> 'boolean') then
      return false;
    end if;
    v_state := pg_catalog.lower(coalesce(v_data->>'state', v_data->>'status', ''));
    if (v_data ? 'state' or v_data ? 'status')
       and (pg_catalog.jsonb_typeof(coalesce(v_data->'state', v_data->'status')) <> 'string'
            or v_state not in (
              'open', 'connected', 'qr', 'qrcode', 'qr_ready', 'pairing',
              'connecting', 'close', 'closed', 'disconnected', 'offline',
              'logged_out', 'error', 'failed', 'failure'
            )) then
      return false;
    end if;
  end if;
  return not private.whatsapp_legacy_payload_has_lead_signal(v_provider_payload, 0);
end;
$$;

revoke all on function private.whatsapp_legacy_is_nonlead_control(text,jsonb)
from public, anon, authenticated, service_role;

-- Preserve the original freeze behavior. Its sole exception requires a
-- postgres-written decision bound to exact identity and payload hash and
-- permits only pending/retry -> processed, with no payload or route changes.
-- The frozen ledger restricts inbox deletion, so approved rows use infinity
-- expiry until an independent evidence-retention cutover is reviewed.
create or replace function private.guard_whatsapp_webhook_legacy_routing_freeze()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_frozen boolean := false;
  v_new_snapshot_version text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_old_frozen := private.is_frozen_legacy_whatsapp_ingress(
      old.id, old.organization_id, old.session_id,
      old.event_key, old.processing_lane
    );
  end if;

  if tg_op = 'DELETE' then
    if v_old_frozen then
      raise exception using
        errcode = '55000',
        message = 'frozen_legacy_whatsapp_ingress_delete_forbidden',
        hint = 'Use a separately audited recovery procedure; do not delete preserved pre-v1 ingress.';
    end if;
    return old;
  end if;

  if v_old_frozen then
    if old.status in ('pending', 'retry')
       and new.status = 'processed'
       and new.processed_at is not null
       and new.processed_at >= old.created_at
       and new.expires_at = 'infinity'::timestamptz
       and (pg_catalog.to_jsonb(new) - 'status' - 'processed_at' - 'updated_at' - 'expires_at')
           is not distinct from
           (pg_catalog.to_jsonb(old) - 'status' - 'processed_at' - 'updated_at' - 'expires_at')
       and private.whatsapp_legacy_is_nonlead_control(old.event_type, old.payload)
       and exists (
         select 1
         from private.whatsapp_webhook_legacy_control_terminalizations as decision
         where decision.inbox_id = old.id
           and decision.organization_id = old.organization_id
           and decision.session_id = old.session_id
           and decision.event_key = old.event_key
           and decision.event_type = old.event_type
           and decision.original_status = old.status
           and decision.payload_sha256 = private.canonical_jsonb_sha256(old.payload)
           and decision.applied_at is null
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
        hint = 'The legacy row is intentionally preserved and excluded from claims until an audited recovery exists.';
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
$$;

comment on function private.guard_whatsapp_webhook_legacy_routing_freeze() is
'vimob.whatsapp_legacy_routing_freeze.v2: preserves frozen ingress, allowing only audited exact-payload nonlead QR/connection controls to become processed.';

revoke all on function private.guard_whatsapp_webhook_legacy_routing_freeze()
from public, anon, authenticated, service_role;

do $readback$
begin
  if not exists (
      select 1 from pg_catalog.pg_trigger
      where tgrelid = 'public.whatsapp_webhook_inbox'::regclass
        and tgname = 'guard_whatsapp_webhook_legacy_routing_freeze'
        and not tgisinternal and tgenabled in ('O', 'A')
    )
    or not exists (
      select 1 from pg_catalog.pg_class
      where oid = 'private.whatsapp_webhook_legacy_control_terminalizations'::regclass
        and relrowsecurity
    )
    or pg_catalog.has_table_privilege(
      'service_role', 'private.whatsapp_webhook_legacy_control_terminalizations', 'INSERT'
    )
    or pg_catalog.has_function_privilege(
      'service_role', 'private.whatsapp_legacy_is_nonlead_control(text,jsonb)', 'EXECUTE'
    ) then
    raise exception 'whatsapp_legacy_control_terminalization_contract_failed';
  end if;
end;
$readback$;

commit;
