-- Retire only status pointers with no canonical target after seven days.
-- Full original receipt and SHA256 stay in the private audit indefinitely.
begin;
set local lock_timeout = '250ms';
set local statement_timeout = '4s';
set local transaction_timeout = '5s';

do $preflight$
begin
  if pg_catalog.to_regclass('private.whatsapp_deferred_receipt_ledger') is null
     or pg_catalog.to_regclass('private.whatsapp_v1_partial_live_receipt_audit') is null
     or pg_catalog.to_regprocedure('private.is_v1_status_only_receipt(jsonb)') is null
     or pg_catalog.to_regprocedure('private.canonical_jsonb_sha256(jsonb)') is null
     or pg_catalog.to_regprocedure(
       'private.v1_receipt_any_id_has_delivery_target(uuid,uuid,jsonb)'
     ) is null then
    raise exception 'partial_live_receipt_expiry_prerequisites_missing';
  end if;
end;
$preflight$;

create table private.whatsapp_partial_live_receipt_retirements (
  inbox_id uuid not null references private.whatsapp_v1_partial_live_receipt_audit(inbox_id)
    on delete restrict,
  provider_message_id text not null
    check (pg_catalog.btrim(provider_message_id) <> ''
      and pg_catalog.octet_length(provider_message_id) <= 512),
  organization_id uuid not null,
  session_id uuid not null,
  receipt_status text not null check (receipt_status in ('read','delivered')),
  provider_occurred_at timestamptz not null,
  deferred_at timestamptz not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  retired_at timestamptz not null default pg_catalog.clock_timestamp(),
  retained_until timestamptz not null default 'infinity'::timestamptz
    check (retained_until = 'infinity'::timestamptz),
  reason text not null default 'partial_live_receipt_no_target_after_7d:v1'
    check (reason = 'partial_live_receipt_no_target_after_7d:v1'),
  primary key (inbox_id,provider_message_id)
);
alter table private.whatsapp_partial_live_receipt_retirements enable row level security;
revoke all on private.whatsapp_partial_live_receipt_retirements
  from public, anon, authenticated, service_role;
comment on table private.whatsapp_partial_live_receipt_retirements is
  'One private, permanent terminal record per partial live receipt ID whose canonical delivery target was still absent seven days after deferral. The original inbox payload and hash remain in the referenced raw audit.';

create index whatsapp_deferred_receipt_partial_age_idx
  on private.whatsapp_deferred_receipt_ledger
  (deferred_at,inbox_id,provider_message_id)
  where state = 'deferred';

create function private.expire_unmatched_partial_live_receipt_ids(p_limit integer)
returns integer language plpgsql security definer set search_path = '' as $function$
declare
  v_pointer private.whatsapp_deferred_receipt_ledger%rowtype;
  v_audit private.whatsapp_v1_partial_live_receipt_audit%rowtype;
  v_retirement private.whatsapp_partial_live_receipt_retirements%rowtype;
  v_expired integer := 0;
  v_deleted integer;
begin
  if p_limit is null or p_limit not between 1 and 1000 then
    raise exception using errcode = '22023',
      message = 'partial_live_receipt_expiry_limit_invalid';
  end if;
  for v_pointer in
    select pointer.*
    from private.whatsapp_deferred_receipt_ledger as pointer
    join private.whatsapp_v1_partial_live_receipt_audit as audit
      on audit.inbox_id = pointer.inbox_id
    where pointer.state = 'deferred'
      and pointer.deferred_at <= pg_catalog.now() - interval '7 days'
      -- A reconciliation claim reserves five minutes. Wait through that lease
      -- and another full interval before retiring a pointer.
      and pointer.next_reconcile_at <= pg_catalog.now()
      and (pointer.last_reconcile_at is null
        or pointer.last_reconcile_at <= pg_catalog.now() - interval '10 minutes')
    order by pointer.deferred_at,pointer.inbox_id,pointer.provider_message_id
    limit p_limit
    for update of pointer skip locked
  loop
    select audit.* into v_audit
    from private.whatsapp_v1_partial_live_receipt_audit as audit
    where audit.inbox_id = v_pointer.inbox_id
    for key share of audit;
    if not found
       or v_audit.organization_id is distinct from v_pointer.organization_id
       or v_audit.session_id is distinct from v_pointer.session_id
       or v_audit.receipt_status is distinct from v_pointer.receipt_status
       or v_audit.provider_occurred_at is distinct from v_pointer.provider_occurred_at
       or v_audit.deferred_at is distinct from v_pointer.deferred_at
       or v_audit.retained_until is distinct from 'infinity'::timestamptz
       or v_audit.reason is distinct from 'partial_live_receipt_missing_ids_deferred:v1'
       or not (v_audit.initially_missing_ids ? v_pointer.provider_message_id)
       or v_audit.original_inbox ->> 'id' is distinct from v_pointer.inbox_id::text
       or v_audit.original_inbox ->> 'organization_id' is distinct from
         v_pointer.organization_id::text
       or v_audit.original_inbox ->> 'session_id' is distinct from
         v_pointer.session_id::text
       or v_audit.original_inbox ->> 'event_key' is distinct from v_audit.event_key
       or v_audit.original_inbox ->> 'provider' is distinct from 'evolution_go'
       or v_audit.original_inbox ->> 'processing_lane' is distinct from 'live'
       or v_audit.original_inbox ->> 'event_type' is distinct from 'receipt'
       or v_audit.original_inbox ->> 'status' is distinct from 'processing'
       or private.is_v1_status_only_receipt(v_audit.original_inbox -> 'payload')
         is distinct from true
       or private.canonical_jsonb_sha256(v_audit.original_inbox -> 'payload')
         is distinct from v_audit.payload_sha256
       or not exists (
         select 1
         from pg_catalog.jsonb_array_elements_text(
           v_audit.original_inbox #> '{payload,data,MessageIDs}'
         ) as original(provider_id)
         where original.provider_id = v_pointer.provider_message_id
       )
       or exists (
         select 1 from public.whatsapp_webhook_inbox as inbox
         where inbox.id = v_pointer.inbox_id
           and (inbox.organization_id is distinct from v_pointer.organization_id
             or inbox.session_id is distinct from v_pointer.session_id
             or inbox.event_key is distinct from v_audit.event_key
             or inbox.payload is distinct from v_audit.original_inbox -> 'payload')
       ) then
      raise exception using errcode = '23514',
        message = 'partial_live_receipt_expiry_raw_proof_failed';
    end if;
    -- Existing targets must keep their status pointer for native reconciliation.
    if private.v1_receipt_any_id_has_delivery_target(
         v_pointer.organization_id,v_pointer.session_id,
         pg_catalog.jsonb_build_array(v_pointer.provider_message_id)
       ) is distinct from false then
      continue;
    end if;

    insert into private.whatsapp_partial_live_receipt_retirements (
      inbox_id,provider_message_id,organization_id,session_id,receipt_status,
      provider_occurred_at,deferred_at,payload_sha256
    ) values (
      v_pointer.inbox_id,v_pointer.provider_message_id,
      v_pointer.organization_id,v_pointer.session_id,v_pointer.receipt_status,
      v_pointer.provider_occurred_at,v_pointer.deferred_at,v_audit.payload_sha256
    ) on conflict (inbox_id,provider_message_id) do nothing;
    select retirement.* into v_retirement
    from private.whatsapp_partial_live_receipt_retirements as retirement
    where retirement.inbox_id = v_pointer.inbox_id
      and retirement.provider_message_id = v_pointer.provider_message_id
    for update of retirement;
    if not found
       or v_retirement.organization_id is distinct from v_pointer.organization_id
       or v_retirement.session_id is distinct from v_pointer.session_id
       or v_retirement.receipt_status is distinct from v_pointer.receipt_status
       or v_retirement.provider_occurred_at is distinct from v_pointer.provider_occurred_at
       or v_retirement.deferred_at is distinct from v_pointer.deferred_at
       or v_retirement.payload_sha256 is distinct from v_audit.payload_sha256
       or v_retirement.reason is distinct from 'partial_live_receipt_no_target_after_7d:v1'
       or v_retirement.retained_until is distinct from 'infinity'::timestamptz then
      raise exception using errcode = '23514',
        message = 'partial_live_receipt_expiry_tombstone_mismatch';
    end if;
    delete from private.whatsapp_deferred_receipt_ledger as pointer
    where pointer.inbox_id = v_pointer.inbox_id
      and pointer.provider_message_id = v_pointer.provider_message_id
      and pointer.organization_id = v_pointer.organization_id
      and pointer.session_id = v_pointer.session_id
      and pointer.state = 'deferred'
      and pointer.receipt_status = v_pointer.receipt_status
      and pointer.provider_occurred_at = v_pointer.provider_occurred_at
      and pointer.deferred_at = v_pointer.deferred_at
      and pointer.reconcile_attempts = v_pointer.reconcile_attempts
      and pointer.claim_token is not distinct from v_pointer.claim_token
      and pointer.next_reconcile_at <= pg_catalog.now()
      and (pointer.last_reconcile_at is null
        or pointer.last_reconcile_at <= pg_catalog.now() - interval '10 minutes')
      and private.v1_receipt_any_id_has_delivery_target(
        pointer.organization_id,pointer.session_id,
        pg_catalog.jsonb_build_array(pointer.provider_message_id)
      ) is false;
    get diagnostics v_deleted = row_count;
    if v_deleted <> 1 then
      raise exception using errcode = '23514',
        message = 'partial_live_receipt_expiry_compare_and_swap_failed';
    end if;
    v_expired := v_expired + 1;
  end loop;
  return v_expired;
end;
$function$;
revoke all on function private.expire_unmatched_partial_live_receipt_ids(integer)
  from public, anon, authenticated, service_role;
grant execute on function private.expire_unmatched_partial_live_receipt_ids(integer)
  to service_role;

commit;
