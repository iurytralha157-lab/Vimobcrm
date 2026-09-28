begin;
set local lock_timeout = '5s';
set local statement_timeout = '2min';

do $preflight$
begin
  if pg_catalog.to_regclass('public.whatsapp_webhook_inbox') is null
     or pg_catalog.to_regclass('public.whatsapp_webhook_inbox_claim_idx') is null
     or pg_catalog.to_regprocedure('private.is_v1_status_only_receipt(jsonb)') is null
     or pg_catalog.to_regprocedure('private.canonical_jsonb_sha256(jsonb)') is null
     or not exists (
       select 1 from pg_catalog.pg_trigger as trigger_state
       where trigger_state.tgrelid = 'public.whatsapp_webhook_inbox'::regclass
         and trigger_state.tgname = 'guard_whatsapp_webhook_legacy_routing_freeze'
         and trigger_state.tgenabled in ('O', 'A')
         and not trigger_state.tgisinternal
     ) then
    raise exception 'v1_readself_noop_prerequisites_missing';
  end if;
end;
$preflight$;

-- This ledger records the exact ingress before the no-op status transition.
-- No canonical message, outbox row, routing snapshot or lead is changed.
create table if not exists private.whatsapp_v1_readself_noop_audit (
  inbox_id uuid primary key,
  organization_id uuid not null,
  session_id uuid not null,
  event_key text not null,
  original_status text not null,
  original_attempts integer not null,
  payload_sha256 text not null,
  provider_message_ids jsonb not null,
  original_expires_at timestamptz not null,
  retained_until timestamptz not null,
  processed_at timestamptz not null,
  reason text not null default 'v1_readself_status_noop:v1',
  constraint whatsapp_v1_readself_noop_status_check
    check (original_status in ('pending', 'retry')),
  constraint whatsapp_v1_readself_noop_attempts_check
    check (original_attempts >= 0),
  constraint whatsapp_v1_readself_noop_hash_check
    check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  constraint whatsapp_v1_readself_noop_ids_check
    check (pg_catalog.jsonb_typeof(provider_message_ids) = 'array'
           and pg_catalog.jsonb_array_length(provider_message_ids) > 0),
  constraint whatsapp_v1_readself_noop_retention_check
    check (retained_until >= processed_at + interval '7 days'),
  constraint whatsapp_v1_readself_noop_reason_check
    check (reason = 'v1_readself_status_noop:v1'),
  constraint whatsapp_v1_readself_noop_identity_key
    unique (organization_id, session_id, event_key)
);
alter table private.whatsapp_v1_readself_noop_audit enable row level security;
revoke all on table private.whatsapp_v1_readself_noop_audit
  from public, anon, authenticated, service_role;
comment on table private.whatsapp_v1_readself_noop_audit is
  'Private audit of exact Evolution Go ReadSelf receipts processed as a no-op. Raw inbox survives at least seven days; no lead delivery/read state is projected.';

-- Mirror nativeIsReadSelfOnlyReceipt in webhook_native_processor.go.
-- The base classifier validates the exact six-field provider envelope,
-- thirteen-field data object, nonempty MessageIDs and empty v1 snapshot.
create or replace function private.is_v1_readself_noop_receipt(p_payload jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $function$
  select private.is_v1_status_only_receipt(p_payload)
     and p_payload ->> 'state' = 'ReadSelf'
     and p_payload #>> '{data,Type}' = 'read-self'
     and p_payload #>> '{__vimob_ingress,routing_key}' = '__session__'
     and p_payload #> '{data,IsGroup}' = 'false'::jsonb
     and p_payload #> '{data,BroadcastRecipients}' = 'null'::jsonb
     and pg_catalog.jsonb_typeof(p_payload #> '{data,Timestamp}') = 'string'
     and not exists (
       select 1
       from (values
         ('AddressingMode'), ('BroadcastListOwner'), ('Chat'),
         ('MessageSender'), ('RecipientAlt'), ('Sender'), ('SenderAlt')
       ) as expected(field_name)
       where pg_catalog.jsonb_typeof(
         p_payload -> 'data' -> expected.field_name
       ) is distinct from 'string'
     );
$function$;
revoke all on function private.is_v1_readself_noop_receipt(jsonb)
  from public, anon, authenticated, service_role;

-- Page over the existing partial claim index, then lock only one eligible
-- receipt by primary key. Concurrent webhook workers can proceed normally.
create or replace function private.process_v1_readself_noop_receipts(
  p_limit integer,
  p_after_next_attempt_at timestamptz default null,
  p_after_created_at timestamptz default null,
  p_after_id uuid default null
)
returns table (
  scanned integer,
  processed_count integer,
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
  v_retain_until timestamptz;
  v_updated integer;
begin
  if (p_after_next_attempt_at is null and
      (p_after_created_at is not null or p_after_id is not null))
     or (p_after_next_attempt_at is not null and
      (p_after_created_at is null or p_after_id is null)) then
    raise exception using
      errcode = '22023', message = 'v1_readself_cursor_must_be_complete';
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
  processed_count := 0;
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

    if not private.is_v1_readself_noop_receipt(v_inbox.payload)
       or exists (
         select 1 from private.whatsapp_webhook_legacy_routing_freeze as frozen
         where frozen.inbox_id = v_inbox.id
       )
       or exists (
         select 1 from private.whatsapp_v1_receipt_terminalizations as old_audit
         where old_audit.inbox_id = v_inbox.id
       )
       or exists (
         select 1 from private.whatsapp_v1_readself_noop_audit as audit
         where audit.inbox_id = v_inbox.id
       ) then
      continue;
    end if;

    v_at := pg_catalog.clock_timestamp();
    v_retain_until := greatest(v_inbox.expires_at, v_at + interval '7 days');
    insert into private.whatsapp_v1_readself_noop_audit (
      inbox_id, organization_id, session_id, event_key,
      original_status, original_attempts, payload_sha256,
      provider_message_ids, original_expires_at,
      retained_until, processed_at
    ) values (
      v_inbox.id, v_inbox.organization_id, v_inbox.session_id,
      v_inbox.event_key, v_inbox.status, v_inbox.attempts,
      private.canonical_jsonb_sha256(v_inbox.payload),
      v_inbox.payload #> '{data,MessageIDs}', v_inbox.expires_at,
      v_retain_until, v_at
    );

    update public.whatsapp_webhook_inbox as inbox
    set status = 'processed', processed_at = v_at,
        dead_lettered_at = null, expires_at = v_retain_until,
        locked_at = null, locked_by = null, last_error = null,
        updated_at = v_at
    where inbox.id = v_inbox.id
      and inbox.status = v_inbox.status
      and inbox.attempts = v_inbox.attempts
      and inbox.updated_at = v_inbox.updated_at
      and inbox.payload = v_inbox.payload;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception using
        errcode = '40001', message = 'v1_readself_noop_compare_and_swap_failed';
    end if;
    processed_count := processed_count + 1;
  end loop;
  return next;
end;
$function$;
revoke all on function private.process_v1_readself_noop_receipts(
  integer,timestamptz,timestamptz,uuid
)
  from public, anon, authenticated, service_role;
grant usage on schema private to service_role;
grant execute on function private.process_v1_readself_noop_receipts(
  integer,timestamptz,timestamptz,uuid
)
  to service_role;
comment on function private.process_v1_readself_noop_receipts(
  integer,timestamptz,timestamptz,uuid
) is
  'Bounded status=processed transition for exact v1 ReadSelf events that native Go processing treats as a no-op. Retains raw inbox at least seven days; never updates messages or outbox.';

-- The deployed retention function does not delete inbox rows. Protect this
-- seven-day raw window against any other direct or scheduled delete without
-- replacing the deployed function or changing unrelated retention policies.
create or replace function private.protect_v1_readself_noop_raw_until()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if exists (
    select 1 from private.whatsapp_v1_readself_noop_audit as audit
    where audit.inbox_id = old.id
      and audit.retained_until > pg_catalog.clock_timestamp()
  ) then
    return null;
  end if;
  return old;
end;
$function$;
revoke all on function private.protect_v1_readself_noop_raw_until()
  from public, anon, authenticated, service_role;
create or replace trigger protect_v1_readself_noop_raw_until
before delete on public.whatsapp_webhook_inbox
for each row
when (old.event_type = 'receipt')
execute function private.protect_v1_readself_noop_raw_until();
comment on trigger protect_v1_readself_noop_raw_until
  on public.whatsapp_webhook_inbox is
  'Keeps exact audited ReadSelf raw ingress for seven days, then allows normal deletion.';


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
  if not private.is_v1_readself_noop_receipt(v_payload)
     or private.is_v1_readself_noop_receipt(
       v_payload || '{"message":{"conversation":"lead text"}}'::jsonb
     )
     or private.is_v1_readself_noop_receipt(
       pg_catalog.jsonb_set(v_payload, '{data,IsGroup}', 'true'::jsonb)
     )
     or private.is_v1_readself_noop_receipt(
       pg_catalog.jsonb_set(v_payload, '{data,Type}', '"read"'::jsonb)
     )
     or private.is_v1_readself_noop_receipt(
       pg_catalog.jsonb_set(
         v_payload, '{__vimob_ingress,routing_snapshot,messages}',
         '[{"provider_message_id":"test-provider-message"}]'::jsonb
       )
     ) then
    raise exception 'v1_readself_noop_classifier_readback_failed';
  end if;

  if pg_catalog.to_regclass('private.whatsapp_v1_readself_noop_audit') is null
     or not exists (
       select 1 from pg_catalog.pg_class as relation
       where relation.oid = 'private.whatsapp_v1_readself_noop_audit'::regclass
         and relation.relrowsecurity
     )
     or pg_catalog.has_table_privilege(
       'service_role', 'private.whatsapp_v1_readself_noop_audit', 'SELECT'
     )
     or pg_catalog.has_function_privilege(
       'anon',
       'private.process_v1_readself_noop_receipts(integer,timestamptz,timestamptz,uuid)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'private.process_v1_readself_noop_receipts(integer,timestamptz,timestamptz,uuid)',
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       'private.process_v1_readself_noop_receipts(integer,timestamptz,timestamptz,uuid)',
       'EXECUTE'
     )
     or not exists (
       select 1 from pg_catalog.pg_trigger as trigger_state
       where trigger_state.tgrelid = 'public.whatsapp_webhook_inbox'::regclass
         and trigger_state.tgname = 'protect_v1_readself_noop_raw_until'
         and trigger_state.tgenabled in ('O', 'A')
         and not trigger_state.tgisinternal
     ) then
    raise exception 'v1_readself_noop_security_or_retention_readback_failed';
  end if;

  if not exists (
    select 1 from private.process_v1_readself_noop_receipts(0)
    where scanned = 0 and processed_count = 0
      and cursor_next_attempt_at is null
      and cursor_created_at is null and cursor_id is null
  ) then
    raise exception 'v1_readself_noop_zero_limit_readback_failed';
  end if;
end;
$readback$;

commit;
