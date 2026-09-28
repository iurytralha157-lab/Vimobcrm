-- A multi-ID live receipt may contain both existing message targets and IDs
-- whose targets have not arrived. Keep one durable pointer per missing ID so
-- the native processor can commit the statuses it did apply and release FIFO.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '2min';

do $preflight$
begin
  if pg_catalog.to_regclass('private.whatsapp_deferred_receipt_ledger') is null
     or pg_catalog.to_regprocedure('private.is_v1_status_only_receipt(jsonb)') is null
     or pg_catalog.to_regprocedure('private.canonical_jsonb_sha256(jsonb)') is null
     or pg_catalog.to_regprocedure(
       'private.v1_receipt_any_id_has_delivery_target(uuid,uuid,jsonb)'
     ) is null then
    raise exception 'partial_live_receipt_prerequisites_missing';
  end if;
end;
$preflight$;

-- The old deferred ledger has one Read ID per inbox. Its existing rows and
-- reconciliation RPC remain valid after widening the key and status set.
alter table private.whatsapp_deferred_receipt_ledger
  drop constraint whatsapp_deferred_receipt_ledger_pkey;
alter table private.whatsapp_deferred_receipt_ledger
  add constraint whatsapp_deferred_receipt_ledger_pkey
  primary key (inbox_id, provider_message_id);
alter table private.whatsapp_deferred_receipt_ledger
  drop constraint whatsapp_deferred_receipt_ledger_status_check;
alter table private.whatsapp_deferred_receipt_ledger
  add constraint whatsapp_deferred_receipt_ledger_status_check
  check (receipt_status in ('read', 'delivered'));
alter table private.whatsapp_deferred_receipt_ledger
  drop constraint whatsapp_deferred_receipt_ledger_provider_check;
alter table private.whatsapp_deferred_receipt_ledger
  add constraint whatsapp_deferred_receipt_ledger_provider_check
  check (pg_catalog.btrim(provider_message_id) <> ''
    and pg_catalog.octet_length(provider_message_id) <= 512);

create table private.whatsapp_v1_partial_live_receipt_audit (
  inbox_id uuid primary key,
  organization_id uuid not null,
  session_id uuid not null,
  event_key text not null,
  original_inbox jsonb not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  receipt_status text not null check (receipt_status in ('read', 'delivered')),
  provider_occurred_at timestamptz not null,
  initially_missing_ids jsonb not null
    check (pg_catalog.jsonb_typeof(initially_missing_ids) = 'array'
      and pg_catalog.jsonb_array_length(initially_missing_ids) between 1 and 512),
  reason text not null default 'partial_live_receipt_missing_ids_deferred:v1'
    check (reason = 'partial_live_receipt_missing_ids_deferred:v1'),
  deferred_at timestamptz not null default pg_catalog.clock_timestamp(),
  retained_until timestamptz not null default 'infinity'::timestamptz
    check (retained_until = 'infinity'::timestamptz),
  unique (organization_id, session_id, event_key)
);
alter table private.whatsapp_v1_partial_live_receipt_audit enable row level security;
revoke all on private.whatsapp_v1_partial_live_receipt_audit
  from public, anon, authenticated, service_role;
comment on table private.whatsapp_v1_partial_live_receipt_audit is
  'Full original live v1 receipt inbox retained indefinitely when missing IDs are deferred. Existing IDs are applied by the native processor in the same transaction.';

create or replace function private.defer_partial_v1_live_receipt_ids(
  p_inbox_id uuid,
  p_organization_id uuid,
  p_session_id uuid,
  p_payload jsonb,
  p_receipt_status text,
  p_provider_occurred_at timestamptz,
  p_missing_ids text[],
  p_worker_id text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_inbox public.whatsapp_webhook_inbox%rowtype;
  v_audit private.whatsapp_v1_partial_live_receipt_audit%rowtype;
  v_original_ids jsonb;
  v_at timestamptz;
  v_retain_until timestamptz;
  v_matching integer;
begin
  if p_inbox_id is null or p_organization_id is null or p_session_id is null
     or p_payload is null or p_provider_occurred_at is null
     or p_worker_id is null or pg_catalog.btrim(p_worker_id) = ''
     or p_receipt_status is null
     or p_receipt_status not in ('read', 'delivered')
     or p_missing_ids is null
     or pg_catalog.cardinality(p_missing_ids) not between 1 and 512
     or exists (
       select 1 from pg_catalog.unnest(p_missing_ids) as missing(provider_id)
       where missing.provider_id is null
          or pg_catalog.btrim(missing.provider_id) = ''
          or pg_catalog.octet_length(missing.provider_id) > 512
     )
     or (select count(distinct missing.provider_id)
         from pg_catalog.unnest(p_missing_ids) as missing(provider_id))
         is distinct from pg_catalog.cardinality(p_missing_ids) then
    raise exception using errcode = '22023',
      message = 'partial_live_receipt_arguments_invalid';
  end if;

  select inbox.* into v_inbox
  from public.whatsapp_webhook_inbox as inbox
  where inbox.id = p_inbox_id
  for update of inbox skip locked;
  if not found
     or v_inbox.organization_id is distinct from p_organization_id
     or v_inbox.session_id is distinct from p_session_id
     or v_inbox.provider is distinct from 'evolution_go'
     or v_inbox.processing_lane is distinct from 'live'
     or v_inbox.event_type is distinct from 'receipt'
     or v_inbox.status is distinct from 'processing'
     or v_inbox.locked_by is distinct from p_worker_id
     or v_inbox.locked_at is null
     or v_inbox.payload is distinct from p_payload
     or v_inbox.payload #>> '{__vimob_ingress,routing_snapshot,version}'
          is distinct from '1'
     or coalesce(v_inbox.payload #>> '{__vimob_ingress,routing_key}', '')
          not like 'receipt:%'
     or private.is_v1_status_only_receipt(v_inbox.payload)
          is distinct from true
     or v_inbox.payload #> '{data,IsGroup}' is distinct from 'false'::jsonb
     or pg_catalog.lower(v_inbox.payload ->> 'state')
          is distinct from p_receipt_status
     or v_inbox.provider_occurred_at is distinct from p_provider_occurred_at then
    raise exception using errcode = '23514',
      message = 'partial_live_receipt_not_exact';
  end if;
  v_original_ids := v_inbox.payload #> '{data,MessageIDs}';
  if exists (
    select 1 from pg_catalog.unnest(p_missing_ids) as missing(provider_id)
    where not exists (
      select 1
      from pg_catalog.jsonb_array_elements_text(v_original_ids) as original(provider_id)
      where original.provider_id = missing.provider_id
    )
  ) then
    raise exception using errcode = '23514',
      message = 'partial_live_receipt_id_outside_payload';
  end if;
  if private.v1_receipt_any_id_has_delivery_target(
       v_inbox.organization_id, v_inbox.session_id,
       pg_catalog.to_jsonb(p_missing_ids)
     ) is distinct from false then
    raise exception using errcode = '23514',
      message = 'partial_live_receipt_missing_id_has_target';
  end if;

  v_at := pg_catalog.clock_timestamp();
  v_retain_until := greatest(
    v_inbox.expires_at, v_at + interval '30 days'
  );
  insert into private.whatsapp_v1_partial_live_receipt_audit (
    inbox_id, organization_id, session_id, event_key,
    original_inbox, payload_sha256, receipt_status,
    provider_occurred_at, initially_missing_ids, deferred_at
  ) values (
    v_inbox.id, v_inbox.organization_id, v_inbox.session_id,
    v_inbox.event_key, pg_catalog.to_jsonb(v_inbox),
    private.canonical_jsonb_sha256(v_inbox.payload), p_receipt_status,
    p_provider_occurred_at, pg_catalog.to_jsonb(p_missing_ids), v_at
  ) on conflict (inbox_id) do nothing;
  select audit.* into v_audit
  from private.whatsapp_v1_partial_live_receipt_audit as audit
  where audit.inbox_id = v_inbox.id
  for update of audit;
  if not found
     or v_audit.organization_id is distinct from v_inbox.organization_id
     or v_audit.session_id is distinct from v_inbox.session_id
     or v_audit.event_key is distinct from v_inbox.event_key
     or v_audit.payload_sha256 is distinct from
       private.canonical_jsonb_sha256(v_inbox.payload)
     or v_audit.original_inbox -> 'payload' is distinct from v_inbox.payload
     or v_audit.receipt_status is distinct from p_receipt_status
     or v_audit.provider_occurred_at is distinct from p_provider_occurred_at
     or v_audit.retained_until is distinct from 'infinity'::timestamptz
     or v_audit.reason is distinct from
       'partial_live_receipt_missing_ids_deferred:v1'
     or exists (
       select 1 from pg_catalog.unnest(p_missing_ids) as missing(provider_id)
       where not (v_audit.initially_missing_ids ? missing.provider_id)
     ) then
    raise exception using errcode = '23514',
      message = 'partial_live_receipt_audit_mismatch';
  end if;

  insert into private.whatsapp_deferred_receipt_ledger as existing (
    inbox_id, organization_id, session_id, provider_message_id,
    receipt_status, provider_occurred_at, expires_at,
    state, deferred_at, next_reconcile_at
  )
  select v_inbox.id, v_inbox.organization_id, v_inbox.session_id,
    missing.provider_id, p_receipt_status, p_provider_occurred_at,
    v_retain_until, 'deferred', v_at, v_at + interval '5 minutes'
  from pg_catalog.unnest(p_missing_ids) as missing(provider_id)
  on conflict (inbox_id, provider_message_id) do update
    set expires_at = greatest(existing.expires_at,
      excluded.expires_at)
    where existing.organization_id = excluded.organization_id
      and existing.session_id = excluded.session_id
      and existing.receipt_status = excluded.receipt_status
      and existing.provider_occurred_at = excluded.provider_occurred_at;
  select count(*)::integer into v_matching
  from private.whatsapp_deferred_receipt_ledger as ledger
  where ledger.inbox_id = v_inbox.id
    and ledger.organization_id = v_inbox.organization_id
    and ledger.session_id = v_inbox.session_id
    and ledger.provider_message_id = any(p_missing_ids)
    and ledger.state = 'deferred'
    and ledger.receipt_status = p_receipt_status
    and ledger.provider_occurred_at = p_provider_occurred_at
    and ledger.expires_at >= v_retain_until;
  if v_matching is distinct from pg_catalog.cardinality(p_missing_ids) then
    raise exception using errcode = '23514',
      message = 'partial_live_receipt_deferred_readback_failed';
  end if;
  return v_matching;
end;
$function$;
revoke all on function private.defer_partial_v1_live_receipt_ids(
  uuid,uuid,uuid,jsonb,text,timestamptz,text[],text
) from public, anon, authenticated, service_role;
grant execute on function private.defer_partial_v1_live_receipt_ids(
  uuid,uuid,uuid,jsonb,text,timestamptz,text[],text
) to service_role;

-- Claim only the selected composite key. An inbox can now have more than one
-- deferred provider ID and each gets its own lease and outcome.
create or replace function private.claim_deferred_whatsapp_receipt_reconciliation(p_limit integer)
returns table (
  inbox_id uuid, organization_id uuid, session_id uuid,
  provider_message_id text, receipt_status text,
  provider_occurred_at timestamptz, claim_token uuid,
  reconcile_attempts integer
)
language sql
security definer
set search_path = ''
as $function$
  with candidate as materialized (
    select l.inbox_id, l.provider_message_id
    from private.whatsapp_deferred_receipt_ledger as l
    where l.state = 'deferred' and l.next_reconcile_at <= pg_catalog.now()
    order by l.next_reconcile_at, l.inbox_id, l.provider_message_id
    limit least(greatest(coalesce(p_limit, 0), 0), 4)
    for update of l skip locked
  ), claimed as (
    update private.whatsapp_deferred_receipt_ledger as l
    set claim_token = pg_catalog.gen_random_uuid(),
        next_reconcile_at = pg_catalog.now() + interval '5 minutes',
        last_reconcile_at = pg_catalog.now(),
        reconcile_attempts = l.reconcile_attempts + 1
    from candidate as c
    where l.inbox_id = c.inbox_id
      and l.provider_message_id = c.provider_message_id
      and l.state = 'deferred'
    returning l.inbox_id, l.organization_id, l.session_id,
      l.provider_message_id, l.receipt_status, l.provider_occurred_at,
      l.claim_token, l.reconcile_attempts
  )
  select c.inbox_id, c.organization_id, c.session_id,
    c.provider_message_id, c.receipt_status, c.provider_occurred_at,
    c.claim_token, c.reconcile_attempts
  from claimed as c;
$function$;
revoke all on function private.claim_deferred_whatsapp_receipt_reconciliation(integer)
  from public, anon, authenticated;
grant execute on function private.claim_deferred_whatsapp_receipt_reconciliation(integer)
  to service_role;

create or replace function private.cleanup_deferred_whatsapp_receipts(p_limit integer)
returns table (deferred_overdue integer, resolved_expired integer)
language sql
security definer
set search_path = ''
as $function$
  with overdue as (
    select count(*)::integer as amount from (
      select 1 from private.whatsapp_deferred_receipt_ledger as l
      where l.state = 'deferred' and l.expires_at <= pg_catalog.now()
      order by l.expires_at, l.inbox_id, l.provider_message_id
      limit 1000
    ) bounded
  ), candidate as materialized (
    select l.inbox_id, l.provider_message_id
    from private.whatsapp_deferred_receipt_ledger as l
    where l.state = 'resolved' and l.expires_at <= pg_catalog.now()
    order by l.expires_at, l.inbox_id, l.provider_message_id
    limit least(greatest(coalesce(p_limit, 0), 0), 1000)
    for update of l skip locked
  ), deleted as (
    delete from private.whatsapp_deferred_receipt_ledger as l
    using candidate as c
    where l.inbox_id = c.inbox_id
      and l.provider_message_id = c.provider_message_id
    returning l.state
  )
  select overdue.amount, (select count(*)::integer from deleted)
  from overdue;
$function$;
revoke all on function private.cleanup_deferred_whatsapp_receipts(integer)
  from public, anon, authenticated;
grant execute on function private.cleanup_deferred_whatsapp_receipts(integer)
  to service_role;

comment on function private.defer_partial_v1_live_receipt_ids(
  uuid,uuid,uuid,jsonb,text,timestamptz,text[],text
) is
  'Worker-only live status-only receipt deferral. Full raw is audited indefinitely and each absent ID is reconciled independently after the matched statuses commit.';

commit;
