-- An unresolved live receipt must not hold unrelated later receipts for the
-- same chat forever. This operator preserves the entire raw inbox and every
-- provider ID indefinitely. It creates no delivery outcome or CRM message.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '2min';

do $preflight$
begin
  if pg_catalog.to_regclass('public.whatsapp_webhook_inbox') is null
     or pg_catalog.to_regclass('public.whatsapp_messages') is null
     or pg_catalog.to_regclass('public.whatsapp_outbox') is null
     or pg_catalog.to_regclass('private.notification_deliveries') is null
     or pg_catalog.to_regclass('public.notifications') is null
     or pg_catalog.to_regprocedure('private.is_v1_status_only_receipt(jsonb)') is null
     or pg_catalog.to_regprocedure('private.canonical_jsonb_sha256(jsonb)') is null then
    raise exception 'live_receipt_gap_prerequisites_missing';
  end if;
end;
$preflight$;

create table private.whatsapp_v1_live_receipt_gap_audit (
  inbox_id uuid primary key,
  organization_id uuid not null,
  session_id uuid not null,
  event_key text not null,
  original_inbox jsonb not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  provider_message_ids jsonb not null
    check (pg_catalog.jsonb_typeof(provider_message_ids) = 'array'),
  receipt_state text not null check (receipt_state in ('Read', 'Delivered')),
  original_status text not null check (original_status = 'retry'),
  original_attempts integer not null check (original_attempts > 0),
  target_check_at timestamptz not null,
  quarantined_at timestamptz not null,
  retained_until timestamptz not null default 'infinity'::timestamptz
    check (retained_until = 'infinity'::timestamptz),
  reason text not null default 'v1_live_receipt_gap_raw_preserved:v1'
    check (reason = 'v1_live_receipt_gap_raw_preserved:v1'),
  unique (organization_id, session_id, event_key)
);
alter table private.whatsapp_v1_live_receipt_gap_audit enable row level security;
revoke all on table private.whatsapp_v1_live_receipt_gap_audit
  from public, anon, authenticated, service_role;
comment on table private.whatsapp_v1_live_receipt_gap_audit is
  'Operator-only indefinite full raw live receipt audit. No status is projected; original payload and provider time support later manual replay.';

-- Routing snapshots are deliberately excluded: they prove ingress identity,
-- not that a delivery/read status can currently be applied to a message.
-- Malformed or empty ID arrays return true so the caller fails closed.
create or replace function private.v1_receipt_any_id_has_delivery_target(
  p_organization_id uuid, p_session_id uuid, p_ids jsonb
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  select case
    when pg_catalog.jsonb_typeof(p_ids) is distinct from 'array' then true
    when pg_catalog.jsonb_array_length(p_ids) < 1 then true
    else exists (
      select 1
      from pg_catalog.jsonb_array_elements_text(p_ids) as item(provider_id)
      where (
        exists (
          select 1 from public.whatsapp_messages as message
          where message.organization_id = p_organization_id
            and message.session_id = p_session_id
            and (message.message_id = item.provider_id
              or message.provider_message_id = item.provider_id
              or message.client_message_id = item.provider_id)
        )
        or exists (
          select 1 from public.whatsapp_outbox as outbox
          where outbox.organization_id = p_organization_id
            and outbox.session_id = p_session_id
            and (outbox.provider_message_id = item.provider_id
              or outbox.client_message_id = item.provider_id)
        )
        or exists (
          select 1 from private.notification_deliveries as delivery
          where delivery.organization_id = p_organization_id
            and delivery.channel = 'whatsapp'
            and (delivery.provider_message_id = item.provider_id
              or delivery.metadata ->> 'expected_message_id' = item.provider_id)
        )
        or exists (
          select 1 from public.notifications as notification
          where notification.organization_id = p_organization_id
            and notification.metadata #>> '{dispatch,whatsapp,expected_message_id}' =
              item.provider_id
        )
      )
    )
  end;
$function$;
revoke all on function private.v1_receipt_any_id_has_delivery_target(uuid,uuid,jsonb)
  from public, anon, authenticated, service_role;

-- One exact retry head per call. The row lock competes with the worker; a
-- concurrent claim or a newly available target makes this call fail closed.
create or replace function private.quarantine_stalled_v1_live_receipt_head(
  p_inbox_id uuid,
  p_expected_payload_sha256 text,
  p_expected_attempts integer,
  p_expected_next_attempt_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_inbox public.whatsapp_webhook_inbox%rowtype;
  v_routing_key text;
  v_target_check_at timestamptz;
  v_at timestamptz;
  v_updated integer;
begin
  if p_inbox_id is null
     or p_expected_payload_sha256 is null
     or p_expected_payload_sha256 !~ '^[0-9a-f]{64}$'
     or p_expected_attempts is null or p_expected_attempts < 1
     or p_expected_next_attempt_at is null then
    raise exception using errcode = '22023',
      message = 'live_receipt_gap_expected_values_required';
  end if;

  select inbox.* into v_inbox
  from public.whatsapp_webhook_inbox as inbox
  where inbox.id = p_inbox_id
  for update of inbox skip locked;
  if not found then
    raise exception using errcode = '40001', message = 'live_receipt_gap_not_available';
  end if;
  v_routing_key := v_inbox.payload #>> '{__vimob_ingress,routing_key}';
  if v_inbox.provider is distinct from 'evolution_go'
     or v_inbox.processing_lane is distinct from 'live'
     or v_inbox.event_type is distinct from 'receipt'
     or v_inbox.status is distinct from 'retry'
     or v_inbox.attempts is distinct from p_expected_attempts
     or v_inbox.attempts >= v_inbox.max_attempts
     or v_inbox.next_attempt_at is distinct from p_expected_next_attempt_at
     or v_inbox.created_at >= pg_catalog.now() - interval '10 minutes'
     or v_inbox.locked_at is not null or v_inbox.locked_by is not null
     or v_inbox.last_error is distinct from 'notification_receipt_target_not_found'
     or v_inbox.payload #>> '{__vimob_ingress,routing_snapshot,version}' is distinct from '1'
     or v_routing_key is null or v_routing_key not like 'receipt:%'
     or v_routing_key = '__session__'
     or private.is_v1_status_only_receipt(v_inbox.payload) is distinct from true
     or (v_inbox.payload ->> 'state' is distinct from 'Read'
         and v_inbox.payload ->> 'state' is distinct from 'Delivered')
     or v_inbox.payload #> '{data,IsGroup}' is distinct from 'false'::jsonb
     or private.canonical_jsonb_sha256(v_inbox.payload)
          is distinct from p_expected_payload_sha256
     or not exists (
       select 1 from public.whatsapp_sessions as session
       where session.id = v_inbox.session_id
         and session.organization_id = v_inbox.organization_id
         and session.is_active = true
         and session.status = 'connected'
     )
     or exists (
       select 1 from private.whatsapp_webhook_legacy_routing_freeze as frozen
       where frozen.inbox_id = v_inbox.id
     )
     or exists (
       select 1 from private.whatsapp_v1_live_receipt_gap_audit as audit
       where audit.inbox_id = v_inbox.id
     ) then
    raise exception using errcode = '23514', message = 'live_receipt_gap_not_exact';
  end if;

  -- The oldest outstanding item on this receipt route may be retired; a
  -- session-wide control, older receipt, or in-flight worker still wins.
  if exists (
    select 1 from public.whatsapp_webhook_inbox as older
    where older.session_id = v_inbox.session_id
      and older.processing_lane = 'live'
      and older.status in ('pending','retry')
      and older.attempts < older.max_attempts
      and older.payload #>> '{__vimob_ingress,routing_snapshot,version}' = '1'
      and (older.created_at, older.id) < (v_inbox.created_at, v_inbox.id)
      and coalesce(nullif(older.payload #>> '{__vimob_ingress,routing_key}', ''),
                   '__session__') in ('__session__', v_routing_key)
  ) or exists (
    select 1 from public.whatsapp_webhook_inbox as active
    where active.session_id = v_inbox.session_id
      and active.status = 'processing'
      and coalesce(nullif(active.payload #>> '{__vimob_ingress,routing_key}', ''),
                   '__session__') in ('__session__', v_routing_key)
  ) then
    raise exception using errcode = '40001', message = 'live_receipt_gap_not_head';
  end if;

  v_target_check_at := pg_catalog.clock_timestamp();
  if private.v1_receipt_any_id_has_delivery_target(
       v_inbox.organization_id, v_inbox.session_id,
       v_inbox.payload #> '{data,MessageIDs}'
     ) is distinct from false then
    raise exception using errcode = '23514',
      message = 'live_receipt_gap_any_target_present';
  end if;

  v_at := pg_catalog.clock_timestamp();
  insert into private.whatsapp_v1_live_receipt_gap_audit (
    inbox_id, organization_id, session_id, event_key,
    original_inbox, payload_sha256, provider_message_ids,
    receipt_state, original_status, original_attempts,
    target_check_at, quarantined_at
  ) values (
    v_inbox.id, v_inbox.organization_id, v_inbox.session_id,
    v_inbox.event_key, pg_catalog.to_jsonb(v_inbox),
    private.canonical_jsonb_sha256(v_inbox.payload),
    v_inbox.payload #> '{data,MessageIDs}',
    v_inbox.payload ->> 'state', v_inbox.status, v_inbox.attempts,
    v_target_check_at, v_at
  );

  update public.whatsapp_webhook_inbox as inbox
  set status = 'dead', attempts = inbox.max_attempts,
      last_error = 'live_receipt_gap_raw_preserved:v1',
      dead_lettered_at = v_at, expires_at = 'infinity'::timestamptz,
      locked_at = null, locked_by = null, updated_at = v_at
  where inbox.id = v_inbox.id
    and inbox.status = v_inbox.status
    and inbox.attempts = v_inbox.attempts
    and inbox.updated_at = v_inbox.updated_at
    and inbox.payload = v_inbox.payload
    and inbox.locked_at is null and inbox.locked_by is null
    and private.v1_receipt_any_id_has_delivery_target(
      inbox.organization_id, inbox.session_id,
      inbox.payload #> '{data,MessageIDs}'
    ) is false;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception using errcode = '40001',
      message = 'live_receipt_gap_compare_and_swap_failed';
  end if;

  return pg_catalog.jsonb_build_object(
    'inbox_id', v_inbox.id,
    'raw_sha256', p_expected_payload_sha256,
    'original_attempts', v_inbox.attempts,
    'provider_ids', pg_catalog.jsonb_array_length(
      v_inbox.payload #> '{data,MessageIDs}'
    ),
    'target_check_at', v_target_check_at
  );
end;
$function$;
revoke all on function private.quarantine_stalled_v1_live_receipt_head(
  uuid,text,integer,timestamptz
) from public, anon, authenticated, service_role;
comment on function private.quarantine_stalled_v1_live_receipt_head(
  uuid,text,integer,timestamptz
) is
  'Operator-only exact live receipt FIFO gap quarantine. Keeps full raw payload and hash indefinitely; no delivery outcome or CRM message is produced.';

commit;
