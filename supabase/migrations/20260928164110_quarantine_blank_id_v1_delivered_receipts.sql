begin;
set local lock_timeout = '5s';
set local statement_timeout = '2min';

do $preflight$
begin
  if pg_catalog.to_regclass('public.whatsapp_webhook_inbox') is null
     or pg_catalog.to_regclass('public.whatsapp_webhook_routing_snapshots') is null
     or pg_catalog.to_regclass('private.whatsapp_v1_receipt_terminalizations') is null
     or pg_catalog.to_regclass('private.whatsapp_v1_readself_noop_audit') is null
     or pg_catalog.to_regprocedure('private.canonical_jsonb_sha256(jsonb)') is null
     or pg_catalog.to_regprocedure('private.is_v1_status_only_receipt(jsonb)') is null
     or pg_catalog.to_regprocedure(
       'private.v1_receipt_has_canonical_target(uuid,uuid,jsonb)'
     ) is null
     or pg_catalog.to_regprocedure(
       'private.is_frozen_legacy_whatsapp_ingress(uuid,uuid,uuid,text,text)'
     ) is null
     or not exists (
       select 1 from pg_catalog.pg_trigger as guard
       where guard.tgrelid = 'public.whatsapp_webhook_inbox'::regclass
         and guard.tgname = 'guard_whatsapp_webhook_legacy_routing_freeze'
         and guard.tgenabled in ('O','A') and not guard.tgisinternal
     ) then
    raise exception 'blank_id_v1_receipt_prerequisites_missing';
  end if;
end;
$preflight$;

-- The private ledger retains both the exact canonical JSON and its hash.
-- No message, outbox, routing outcome, lead or session row is changed.
create table private.whatsapp_blank_id_v1_delivered_receipt_quarantine (
  inbox_id uuid primary key,
  organization_id uuid not null,
  session_id uuid not null,
  event_key text not null,
  original_status text not null,
  original_attempts integer not null,
  payload_raw jsonb not null,
  payload_sha256 text not null,
  original_expires_at timestamptz not null,
  inbox_retained_until timestamptz not null,
  target_check_at timestamptz not null,
  quarantined_at timestamptz not null,
  reason text not null default 'v1_group_delivered_blank_message_id:v1',
  constraint whatsapp_blank_id_v1_delivered_identity_key
    unique (organization_id, session_id, event_key),
  constraint whatsapp_blank_id_v1_delivered_status_check
    check (original_status in ('pending','retry')),
  constraint whatsapp_blank_id_v1_delivered_attempts_check
    check (original_attempts >= 0),
  constraint whatsapp_blank_id_v1_delivered_hash_check
    check (payload_sha256 = private.canonical_jsonb_sha256(payload_raw)),
  constraint whatsapp_blank_id_v1_delivered_retention_check
    check (inbox_retained_until >= quarantined_at + interval '7 days'),
  constraint whatsapp_blank_id_v1_delivered_time_check
    check (target_check_at <= quarantined_at),
  constraint whatsapp_blank_id_v1_delivered_reason_check
    check (reason = 'v1_group_delivered_blank_message_id:v1')
);
alter table private.whatsapp_blank_id_v1_delivered_receipt_quarantine
  enable row level security;
revoke all on table private.whatsapp_blank_id_v1_delivered_receipt_quarantine
  from public, anon, authenticated, service_role;
comment on table private.whatsapp_blank_id_v1_delivered_receipt_quarantine is
  'Indefinite private raw/hash audit of exact v1 group Delivered receipts with one blank MessageID. The inbox raw event remains for at least seven additional days.';

-- Reuse the production v1 envelope classifier after replacing ONLY the
-- proven blank ID with a sentinel. It still validates all six top-level,
-- thirteen data and two routing fields and rejects added message content.
create or replace function private.is_blank_id_v1_delivered_receipt(
  p_payload jsonb
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $function$
  select p_payload #> '{data,MessageIDs}' = '[""]'::jsonb
     and p_payload #>> '{__vimob_ingress,routing_key}' = '__session__'
     and p_payload #> '{data,IsGroup}' = 'true'::jsonb
     and p_payload #> '{data,IsFromMe}' = 'false'::jsonb
     and p_payload #> '{data,BroadcastRecipients}' = 'null'::jsonb
     and private.is_v1_status_only_receipt(
       pg_catalog.jsonb_set(
         p_payload, '{data,MessageIDs}', '["blank-id-placeholder"]'::jsonb
       )
     ) is true;
$function$;
revoke all on function private.is_blank_id_v1_delivered_receipt(jsonb)
  from public, anon, authenticated, service_role;

create or replace function private.quarantine_blank_id_v1_delivered_receipts(
  p_limit integer default 25
)
returns table (scanned integer, quarantined integer)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_candidate record;
  v_inbox public.whatsapp_webhook_inbox%rowtype;
  v_target_check_at timestamptz;
  v_at timestamptz;
  v_inbox_retained_until timestamptz;
  v_updated integer;
begin
  if p_limit is null or p_limit < 0 or p_limit > 100 then
    raise exception using errcode = '22023',
      message = 'blank_id_v1_receipt_limit_invalid';
  end if;
  scanned := 0;
  quarantined := 0;
  if p_limit = 0 then
    return next;
    return;
  end if;

  for v_candidate in
    select inbox.id
    from public.whatsapp_webhook_inbox as inbox
    where inbox.provider = 'evolution_go'
      and inbox.event_type = 'receipt'
      and inbox.processing_lane = 'backlog'
      and inbox.status in ('pending','retry')
      and inbox.created_at < pg_catalog.now() - interval '10 minutes'
      and inbox.locked_at is null and inbox.locked_by is null
      and inbox.payload ->> 'state' = 'Delivered'
      and inbox.payload #> '{data,MessageIDs}' = '[""]'::jsonb
    order by inbox.next_attempt_at, inbox.created_at, inbox.id
    limit 500
  loop
    exit when quarantined >= p_limit;
    scanned := scanned + 1;
    select inbox.* into v_inbox
    from public.whatsapp_webhook_inbox as inbox
    where inbox.id = v_candidate.id
      and inbox.provider = 'evolution_go'
      and inbox.event_type = 'receipt'
      and inbox.processing_lane = 'backlog'
      and inbox.status in ('pending','retry')
      and inbox.created_at < pg_catalog.now() - interval '10 minutes'
      and inbox.locked_at is null and inbox.locked_by is null
      and inbox.payload ->> 'state' = 'Delivered'
      and inbox.payload #> '{data,MessageIDs}' = '[""]'::jsonb
    for update of inbox skip locked;
    if not found then continue; end if;
    if private.is_blank_id_v1_delivered_receipt(v_inbox.payload)
         is distinct from true
       or private.is_frozen_legacy_whatsapp_ingress(
         v_inbox.id, v_inbox.organization_id, v_inbox.session_id,
         v_inbox.event_key, v_inbox.processing_lane
       ) is distinct from false
       or exists (
         select 1 from public.whatsapp_webhook_routing_snapshots as route
         where route.organization_id = v_inbox.organization_id
           and route.session_id = v_inbox.session_id
           and route.inbox_event_key = v_inbox.event_key
       )
       or exists (
         select 1 from private.whatsapp_v1_receipt_terminalizations as audit
         where audit.inbox_id = v_inbox.id
       )
       or exists (
         select 1 from private.whatsapp_v1_readself_noop_audit as audit
         where audit.inbox_id = v_inbox.id
       )
       or exists (
         select 1
         from private.whatsapp_blank_id_v1_delivered_receipt_quarantine as audit
         where audit.inbox_id = v_inbox.id
       ) then
      continue;
    end if;

    v_target_check_at := pg_catalog.clock_timestamp();
    if private.v1_receipt_has_canonical_target(
      v_inbox.organization_id, v_inbox.session_id,
      v_inbox.payload #> '{data,MessageIDs}'
    ) is distinct from false then
      continue;
    end if;

    v_at := pg_catalog.clock_timestamp();
    v_inbox_retained_until := greatest(
      v_inbox.expires_at, v_at + interval '7 days'
    );
    insert into private.whatsapp_blank_id_v1_delivered_receipt_quarantine (
      inbox_id, organization_id, session_id, event_key,
      original_status, original_attempts, payload_raw, payload_sha256,
      original_expires_at, inbox_retained_until, target_check_at,
      quarantined_at
    ) values (
      v_inbox.id, v_inbox.organization_id, v_inbox.session_id,
      v_inbox.event_key, v_inbox.status, v_inbox.attempts, v_inbox.payload,
      private.canonical_jsonb_sha256(v_inbox.payload),
      v_inbox.expires_at, v_inbox_retained_until, v_target_check_at, v_at
    );
    update public.whatsapp_webhook_inbox as inbox
    set status = 'dead', dead_lettered_at = v_at,
        expires_at = v_inbox_retained_until, updated_at = v_at
    where inbox.id = v_inbox.id
      and inbox.status = v_inbox.status
      and inbox.attempts = v_inbox.attempts
      and inbox.updated_at = v_inbox.updated_at
      and inbox.payload = v_inbox.payload;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception using errcode = '40001',
        message = 'blank_id_v1_receipt_compare_and_swap_failed';
    end if;
    quarantined := quarantined + 1;
  end loop;
  return next;
end;
$function$;
revoke all on function private.quarantine_blank_id_v1_delivered_receipts(integer)
  from public, anon, authenticated, service_role;
grant usage on schema private to service_role;
grant execute on function private.quarantine_blank_id_v1_delivered_receipts(integer)
  to service_role;
comment on function private.quarantine_blank_id_v1_delivered_receipts(integer) is
  'Bounded quarantine of exact old v1 group Delivered receipts with one blank MessageID, no route and no canonical target. Retains raw/hash in private audit and inbox raw for at least seven days.';

do $readback$
declare
  v_payload jsonb := '{
    "__vimob_ingress":{"routing_key":"__session__",
      "routing_snapshot":{"version":1,"messages":[]}},
    "event":"Receipt","state":"Delivered",
    "instanceId":"test","instanceName":"test",
    "data":{"AddressingMode":"pn","MessageSender":"","Type":"",
      "Sender":"","MessageIDs":[""],"Chat":"","Timestamp":"1",
      "SenderAlt":"","RecipientAlt":"","BroadcastListOwner":"",
      "IsFromMe":false,"IsGroup":true,"BroadcastRecipients":null}
  }'::jsonb;
begin
  if private.is_blank_id_v1_delivered_receipt(v_payload) is distinct from true
     or private.is_blank_id_v1_delivered_receipt(
       v_payload || '{"message":{"conversation":"lead content"}}'::jsonb
     ) is distinct from false
     or private.is_blank_id_v1_delivered_receipt(
       pg_catalog.jsonb_set(v_payload,'{data,MessageIDs}','["id"]'::jsonb)
     ) is distinct from false
     or private.is_blank_id_v1_delivered_receipt(
       pg_catalog.jsonb_set(v_payload,'{data,IsGroup}','false'::jsonb)
     ) is distinct from false
     or not exists (
       select 1 from private.quarantine_blank_id_v1_delivered_receipts(0)
       where scanned = 0 and quarantined = 0
     ) then
    raise exception 'blank_id_v1_receipt_readback_failed';
  end if;
end;
$readback$;

commit;
