begin;
set local lock_timeout = '5s';
set local statement_timeout = '2min';

do $preflight$
begin
  if pg_catalog.to_regclass('public.whatsapp_webhook_inbox') is null
     or pg_catalog.to_regclass('public.whatsapp_messages') is null
     or pg_catalog.to_regclass('public.whatsapp_outbox') is null
     or pg_catalog.to_regclass('public.whatsapp_webhook_routing_snapshots') is null
     or pg_catalog.to_regprocedure('private.canonical_jsonb_sha256(jsonb)') is null
     or pg_catalog.to_regprocedure('private.guard_whatsapp_webhook_legacy_routing_freeze()') is null then
    raise exception 'v1_receipt_terminalization_prerequisites_missing';
  end if;
end;
$preflight$;

-- No raw ingress is deleted. The operational queue status is separate from
-- this private audit, which retains the exact envelope hash and every ID.
create table private.whatsapp_v1_receipt_terminalizations (
  inbox_id uuid primary key,
  organization_id uuid not null,
  session_id uuid not null,
  event_key text not null,
  original_status text not null,
  original_attempts integer not null,
  payload_sha256 text not null,
  provider_message_ids jsonb not null,
  receipt_type text not null,
  receipt_state text not null,
  original_expires_at timestamptz not null,
  retained_until timestamptz not null,
  target_check_at timestamptz not null,
  terminalized_at timestamptz not null,
  reason text not null default 'unmatched_v1_status_only_backlog_receipt:v1',
  constraint whatsapp_v1_receipt_terminalizations_status_check
    check (original_status in ('pending', 'retry')),
  constraint whatsapp_v1_receipt_terminalizations_attempts_check
    check (original_attempts >= 0),
  constraint whatsapp_v1_receipt_terminalizations_hash_check
    check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  constraint whatsapp_v1_receipt_terminalizations_ids_check
    check (pg_catalog.jsonb_typeof(provider_message_ids) = 'array'
           and pg_catalog.jsonb_array_length(provider_message_ids) > 0),
  constraint whatsapp_v1_receipt_terminalizations_type_state_check
    check ((receipt_type = 'read-self' and receipt_state = 'ReadSelf')
        or (receipt_type = 'read' and receipt_state = 'Read')
        or (receipt_type = '' and receipt_state = 'Delivered')),
  constraint whatsapp_v1_receipt_terminalizations_reason_check
    check (reason = 'unmatched_v1_status_only_backlog_receipt:v1'),
  constraint whatsapp_v1_receipt_terminalizations_audit_time_check
    check (target_check_at <= terminalized_at and retained_until >= terminalized_at),
  constraint whatsapp_v1_receipt_terminalizations_identity_key
    unique (organization_id, session_id, event_key)
);
alter table private.whatsapp_v1_receipt_terminalizations enable row level security;
revoke all on table private.whatsapp_v1_receipt_terminalizations
  from public, anon, authenticated, service_role;
comment on table private.whatsapp_v1_receipt_terminalizations is
  'Private audit of backlog v1 status-only receipts with no canonical target at terminalization time. Raw ingress remains in the inbox for at least seven days; this ledger keeps its hash and every provider ID.';

create or replace function private.is_v1_status_only_receipt(p_payload jsonb)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $function$
declare
  v_data jsonb;
  v_ingress jsonb;
  v_snapshot jsonb;
  v_ids jsonb;
  v_value jsonb;
  v_field text;
begin
  if pg_catalog.jsonb_typeof(p_payload) is distinct from 'object'
     or not (p_payload ?& array[
       '__vimob_ingress','event','data','state','instanceId','instanceName'
     ])
     or (select count(*) from pg_catalog.jsonb_object_keys(p_payload)) <> 6
     or p_payload ->> 'event' is distinct from 'Receipt'
     or pg_catalog.jsonb_typeof(p_payload -> 'instanceId') is distinct from 'string'
     or pg_catalog.jsonb_typeof(p_payload -> 'instanceName') is distinct from 'string'
     or pg_catalog.jsonb_typeof(p_payload -> 'state') is distinct from 'string' then
    return false;
  end if;

  v_data := p_payload -> 'data';
  v_ingress := p_payload -> '__vimob_ingress';
  v_snapshot := v_ingress -> 'routing_snapshot';
  if pg_catalog.jsonb_typeof(v_data) is distinct from 'object'
     or not (v_data ?& array[
       'AddressingMode','MessageSender','Type','Sender','MessageIDs','Chat',
       'Timestamp','SenderAlt','RecipientAlt','BroadcastListOwner','IsFromMe',
       'IsGroup','BroadcastRecipients'
     ])
     or (select count(*) from pg_catalog.jsonb_object_keys(v_data)) <> 13
     or pg_catalog.jsonb_typeof(v_ingress) is distinct from 'object'
     or not (v_ingress ?& array['routing_key','routing_snapshot'])
     or (select count(*) from pg_catalog.jsonb_object_keys(v_ingress)) <> 2
     or pg_catalog.jsonb_typeof(v_ingress -> 'routing_key') is distinct from 'string'
     or pg_catalog.btrim(v_ingress ->> 'routing_key') = ''
     or pg_catalog.jsonb_typeof(v_snapshot) is distinct from 'object'
     or not (v_snapshot ?& array['version','messages'])
     or (select count(*) from pg_catalog.jsonb_object_keys(v_snapshot)) <> 2
     or v_snapshot -> 'version' is distinct from '1'::jsonb
     or v_snapshot -> 'messages' is distinct from '[]'::jsonb
     or pg_catalog.jsonb_typeof(v_data -> 'Type') is distinct from 'string'
     or not (
       (v_data ->> 'Type' = 'read-self' and p_payload ->> 'state' = 'ReadSelf')
       or (v_data ->> 'Type' = 'read' and p_payload ->> 'state' = 'Read')
       or (v_data ->> 'Type' = '' and p_payload ->> 'state' = 'Delivered')
     )
     or pg_catalog.jsonb_typeof(v_data -> 'IsFromMe') is distinct from 'boolean'
     or pg_catalog.jsonb_typeof(v_data -> 'IsGroup') is distinct from 'boolean'
     or pg_catalog.jsonb_typeof(v_data -> 'Timestamp') not in ('string','number') then
    return false;
  end if;

  foreach v_field in array array[
    'AddressingMode','MessageSender','Sender','Chat','SenderAlt',
    'RecipientAlt','BroadcastListOwner'
  ] loop
    if pg_catalog.jsonb_typeof(v_data -> v_field) not in ('string','null') then
      return false;
    end if;
  end loop;

  if pg_catalog.jsonb_typeof(v_data -> 'BroadcastRecipients') not in ('null','array') then
    return false;
  end if;
  if pg_catalog.jsonb_typeof(v_data -> 'BroadcastRecipients') = 'array' then
    if pg_catalog.jsonb_array_length(v_data -> 'BroadcastRecipients') > 512 then
      return false;
    end if;
    for v_value in
      select value
      from pg_catalog.jsonb_array_elements(v_data -> 'BroadcastRecipients') as member(value)
    loop
      if pg_catalog.jsonb_typeof(v_value) is distinct from 'string' then
        return false;
      end if;
    end loop;
  end if;

  v_ids := v_data -> 'MessageIDs';
  if pg_catalog.jsonb_typeof(v_ids) is distinct from 'array' then
    return false;
  end if;
  if pg_catalog.jsonb_array_length(v_ids) < 1
     or pg_catalog.jsonb_array_length(v_ids) > 512 then
    return false;
  end if;
  for v_value in
    select value from pg_catalog.jsonb_array_elements(v_ids) as member(value)
  loop
    if pg_catalog.jsonb_typeof(v_value) is distinct from 'string'
       or pg_catalog.btrim(v_value #>> '{}') = ''
       or pg_catalog.octet_length(v_value #>> '{}') > 512 then
      return false;
    end if;
  end loop;
  return true;
end;
$function$;
revoke all on function private.is_v1_status_only_receipt(jsonb)
  from public, anon, authenticated, service_role;

-- Each equality is its own index probe: message/session, provider/org,
-- client/org/session, outbox/provider/session, outbox/client/org/session,
-- and the routing snapshot primary key. Avoid scanning either large table.
-- Keep a receipt if ANY ID already has a target, even if its lead_id is NULL.
create or replace function private.v1_receipt_has_canonical_target(
  p_organization_id uuid, p_session_id uuid, p_ids jsonb
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  select exists (
    select 1
    from pg_catalog.jsonb_array_elements_text(p_ids) as item(provider_id)
    where exists (
      select 1 from public.whatsapp_messages as message
      where message.session_id = p_session_id
        and message.message_id = item.provider_id
        and message.organization_id = p_organization_id
    ) or exists (
      select 1 from public.whatsapp_messages as message
      where message.organization_id = p_organization_id
        and message.provider_message_id = item.provider_id
        and message.session_id = p_session_id
    ) or exists (
      select 1 from public.whatsapp_messages as message
      where message.organization_id = p_organization_id
        and message.session_id = p_session_id
        and message.client_message_id = item.provider_id
    ) or exists (
      select 1 from public.whatsapp_outbox as outbox
      where outbox.session_id = p_session_id
        and outbox.provider_message_id = item.provider_id
        and outbox.organization_id = p_organization_id
    ) or exists (
      select 1 from public.whatsapp_outbox as outbox
      where outbox.organization_id = p_organization_id
        and outbox.session_id = p_session_id
        and outbox.client_message_id = item.provider_id
    ) or exists (
      select 1 from public.whatsapp_webhook_routing_snapshots as route
      where route.organization_id = p_organization_id
        and route.session_id = p_session_id
        and route.provider_message_id = item.provider_id
    )
  );
$function$;
revoke all on function private.v1_receipt_has_canonical_target(uuid,uuid,jsonb)
  from public, anon, authenticated, service_role;

-- The existing partial claim index is ordered by this keyset. Page over
-- pending rows WITHOUT a JSON predicate or row lock; the planner can use
-- whatsapp_webhook_inbox_claim_idx. Lock only eligible receipt rows by PK.
-- Run one more pass from the beginning for rows skipped by a busy worker.
create or replace function private.terminalize_unmatched_v1_receipts(
  p_limit integer,
  p_after_next_attempt_at timestamptz default null,
  p_after_created_at timestamptz default null,
  p_after_id uuid default null
)
returns table (
  scanned integer,
  terminalized integer,
  cursor_next_attempt_at timestamptz,
  cursor_created_at timestamptz,
  cursor_id uuid
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_page record;
  v_inbox public.whatsapp_webhook_inbox%rowtype;
  v_at timestamptz;
  v_target_check_at timestamptz;
  v_retain_until timestamptz;
  v_updated integer;
begin
  if (p_after_next_attempt_at is null and
      (p_after_created_at is not null or p_after_id is not null))
     or (p_after_next_attempt_at is not null and
      (p_after_created_at is null or p_after_id is null)) then
    raise exception using
      errcode = '22023', message = 'v1_receipt_cursor_must_be_complete';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_trigger as trigger_state
    where trigger_state.tgrelid = 'public.whatsapp_webhook_inbox'::regclass
      and trigger_state.tgname = 'guard_whatsapp_webhook_legacy_routing_freeze'
      and trigger_state.tgenabled in ('O', 'A')
      and not trigger_state.tgisinternal
  ) then
    raise exception using
      errcode = '55000', message = 'whatsapp_legacy_routing_guard_not_active';
  end if;

  scanned := 0;
  terminalized := 0;
  cursor_next_attempt_at := p_after_next_attempt_at;
  cursor_created_at := p_after_created_at;
  cursor_id := p_after_id;
  for v_page in
    select inbox.id, inbox.next_attempt_at, inbox.created_at,
           inbox.provider, inbox.event_type, inbox.processing_lane,
           inbox.locked_at, inbox.locked_by
    from public.whatsapp_webhook_inbox as inbox
    where inbox.status in ('pending', 'retry')
      and (inbox.next_attempt_at, inbox.created_at, inbox.id) > (
        coalesce(p_after_next_attempt_at, '-infinity'::timestamptz),
        coalesce(p_after_created_at, '-infinity'::timestamptz),
        coalesce(p_after_id, '00000000-0000-0000-0000-000000000000'::uuid)
      )
    order by inbox.next_attempt_at, inbox.created_at, inbox.id
    limit least(greatest(coalesce(p_limit, 0), 0), 500)
  loop
    scanned := scanned + 1;
    cursor_next_attempt_at := v_page.next_attempt_at;
    cursor_created_at := v_page.created_at;
    cursor_id := v_page.id;

    if v_page.provider is distinct from 'evolution_go'
       or v_page.event_type is distinct from 'receipt'
       or v_page.processing_lane is distinct from 'backlog'
       or v_page.created_at >= pg_catalog.now() - interval '10 minutes'
       or v_page.locked_at is not null or v_page.locked_by is not null then
      continue;
    end if;

    select inbox.* into v_inbox
    from public.whatsapp_webhook_inbox as inbox
    where inbox.id = v_page.id
      and inbox.provider = 'evolution_go'
      and inbox.event_type = 'receipt'
      and inbox.processing_lane = 'backlog'
      and inbox.status in ('pending', 'retry')
      and inbox.created_at < pg_catalog.now() - interval '10 minutes'
      and inbox.locked_at is null and inbox.locked_by is null
      and inbox.payload #>> '{__vimob_ingress,routing_snapshot,version}' = '1'
    for update of inbox skip locked;
    if not found then
      continue;
    end if;

    if not private.is_v1_status_only_receipt(v_inbox.payload)
       or exists (
         select 1 from private.whatsapp_webhook_legacy_routing_freeze as frozen
         where frozen.inbox_id = v_inbox.id
       )
       or exists (
         select 1 from private.whatsapp_v1_receipt_terminalizations as audit
         where audit.inbox_id = v_inbox.id
       ) then
      continue;
    end if;
    v_target_check_at := pg_catalog.clock_timestamp();
    if private.v1_receipt_has_canonical_target(
         v_inbox.organization_id, v_inbox.session_id,
         v_inbox.payload #> '{data,MessageIDs}'
       ) then
      continue;
    end if;

    v_at := pg_catalog.clock_timestamp();
    v_retain_until := greatest(v_inbox.expires_at, v_at + interval '7 days');
    insert into private.whatsapp_v1_receipt_terminalizations (
      inbox_id, organization_id, session_id, event_key,
      original_status, original_attempts, payload_sha256,
      provider_message_ids, receipt_type, receipt_state,
      original_expires_at, retained_until, target_check_at, terminalized_at
    ) values (
      v_inbox.id, v_inbox.organization_id, v_inbox.session_id,
      v_inbox.event_key, v_inbox.status, v_inbox.attempts,
      private.canonical_jsonb_sha256(v_inbox.payload),
      v_inbox.payload #> '{data,MessageIDs}',
      v_inbox.payload #>> '{data,Type}',
      v_inbox.payload ->> 'state',
      v_inbox.expires_at, v_retain_until, v_target_check_at, v_at
    );

    update public.whatsapp_webhook_inbox as inbox
    set status = 'dead', dead_lettered_at = v_at,
        expires_at = v_retain_until, updated_at = v_at
    where inbox.id = v_inbox.id
      and inbox.status = v_inbox.status
      and inbox.attempts = v_inbox.attempts
      and inbox.updated_at = v_inbox.updated_at
      and inbox.payload = v_inbox.payload;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception using
        errcode = '40001', message = 'v1_receipt_terminalization_compare_and_swap_failed';
    end if;
    terminalized := terminalized + 1;
  end loop;
  return next;
end;
$function$;
revoke all on function private.terminalize_unmatched_v1_receipts(
  integer,timestamptz,timestamptz,uuid
)
  from public, anon, authenticated, service_role;
grant usage on schema private to service_role;
grant execute on function private.terminalize_unmatched_v1_receipts(
  integer,timestamptz,timestamptz,uuid
)
  to service_role;
comment on function private.terminalize_unmatched_v1_receipts(
  integer,timestamptz,timestamptz,uuid
) is
  'Keyset-paged, 500-row bounded backlog v1 status receipt cleanup after ten minutes and no canonical target across every provider ID. Retains raw inbox seven more days and a private audit; never deletes messages.';

do $readback$
declare
  v_payload jsonb := '{
    "__vimob_ingress": {
      "routing_key": "__session__",
      "routing_snapshot": {"version": 1, "messages": []}
    },
    "event": "Receipt", "state": "ReadSelf",
    "instanceId": "test-instance", "instanceName": "test-instance",
    "data": {
      "AddressingMode": "pn", "MessageSender": "", "Type": "read-self",
      "Sender": "", "MessageIDs": ["test-provider-message"],
      "Chat": "", "Timestamp": "1", "SenderAlt": "",
      "RecipientAlt": "", "BroadcastListOwner": "",
      "IsFromMe": true, "IsGroup": false, "BroadcastRecipients": null
    }
  }'::jsonb;
begin
  if not private.is_v1_status_only_receipt(v_payload)
     or not private.is_v1_status_only_receipt(
       pg_catalog.jsonb_set(
         pg_catalog.jsonb_set(v_payload, '{data,Type}', '"read"'::jsonb),
         '{state}', '"Read"'::jsonb
       )
     )
     or not private.is_v1_status_only_receipt(
       pg_catalog.jsonb_set(
         pg_catalog.jsonb_set(v_payload, '{data,Type}', '""'::jsonb),
         '{state}', '"Delivered"'::jsonb
       )
     )
     or private.is_v1_status_only_receipt(
       v_payload || '{"message":{"conversation":"do not discard"}}'::jsonb
     )
     or private.is_v1_status_only_receipt(
       pg_catalog.jsonb_set(
         v_payload, '{__vimob_ingress,routing_snapshot,messages}',
         '[{"provider_message_id":"test-provider-message"}]'::jsonb
       )
     ) then
    raise exception 'v1_receipt_envelope_readback_failed';
  end if;

  if pg_catalog.to_regclass('public.whatsapp_webhook_inbox_claim_idx') is null
     or pg_catalog.to_regclass('private.whatsapp_v1_receipt_terminalizations') is null
     or not exists (
       select 1 from pg_catalog.pg_class as relation
       where relation.oid = 'private.whatsapp_v1_receipt_terminalizations'::regclass
         and relation.relrowsecurity
     )
     or pg_catalog.has_table_privilege(
       'service_role', 'private.whatsapp_v1_receipt_terminalizations', 'SELECT'
     )
     or pg_catalog.has_function_privilege(
       'anon',
       'private.terminalize_unmatched_v1_receipts(integer,timestamptz,timestamptz,uuid)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'private.terminalize_unmatched_v1_receipts(integer,timestamptz,timestamptz,uuid)',
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       'private.terminalize_unmatched_v1_receipts(integer,timestamptz,timestamptz,uuid)',
       'EXECUTE'
     ) then
    raise exception 'v1_receipt_terminalization_security_readback_failed';
  end if;
  if not exists (
    select 1 from private.terminalize_unmatched_v1_receipts(0)
    where scanned = 0 and terminalized = 0
      and cursor_next_attempt_at is null
      and cursor_created_at is null and cursor_id is null
  ) then
    raise exception 'v1_receipt_zero_limit_readback_failed';
  end if;
end;
$readback$;

commit;
