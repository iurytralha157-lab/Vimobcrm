begin;
set local lock_timeout = '5s';
set local statement_timeout = '2min';

-- A native not_found result only proves that the canonical target was not
-- present during that attempt. Preserve the receipt and its minimal replay
-- identity while allowing the ordered ingress lane to advance. This does not
-- assert that the target is absent from unprocessed or frozen ingress.
create table if not exists private.whatsapp_deferred_receipt_ledger (
  inbox_id uuid primary key,
  organization_id uuid not null,
  session_id uuid not null,
  provider_message_id text not null,
  receipt_status text not null,
  provider_occurred_at timestamptz not null,
  expires_at timestamptz not null,
  claim_token uuid,
  state text not null default 'deferred',
  deferred_at timestamptz not null default now(),
  next_reconcile_at timestamptz not null default (now() + interval '5 minutes'),
  reconcile_attempts integer not null default 0,
  last_reconcile_at timestamptz,
  resolved_at timestamptz,
  constraint whatsapp_deferred_receipt_ledger_state_check check (state in ('deferred', 'resolved')),
  constraint whatsapp_deferred_receipt_ledger_status_check check (receipt_status = 'read'),
  constraint whatsapp_deferred_receipt_ledger_provider_check check (btrim(provider_message_id) <> '' and octet_length(provider_message_id) <= 500),
  constraint whatsapp_deferred_receipt_ledger_attempts_check check (reconcile_attempts >= 0)
);
create index if not exists whatsapp_deferred_receipt_ledger_due_idx
  on private.whatsapp_deferred_receipt_ledger (next_reconcile_at, inbox_id)
  where state = 'deferred';
create index if not exists whatsapp_deferred_receipt_ledger_overdue_idx
  on private.whatsapp_deferred_receipt_ledger (expires_at, inbox_id)
  where state = 'deferred';
create index if not exists whatsapp_deferred_receipt_ledger_resolved_expiry_idx
  on private.whatsapp_deferred_receipt_ledger (expires_at, inbox_id)
  where state = 'resolved';
alter table private.whatsapp_deferred_receipt_ledger enable row level security;
revoke all on table private.whatsapp_deferred_receipt_ledger from public, anon, authenticated, service_role;

create or replace function private.defer_unmatched_whatsapp_receipt(
  p_inbox_id uuid, p_provider_message_id text, p_provider_occurred_at timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_inbox public.whatsapp_webhook_inbox%rowtype;
  v_provider_id text;
  v_updated integer;
begin
  select i.* into v_inbox
  from public.whatsapp_webhook_inbox as i
  where i.id = p_inbox_id
  for update skip locked;
  if not found then
    return 'not_available';
  end if;
  if pg_catalog.jsonb_typeof(v_inbox.payload) is distinct from 'object'
     or pg_catalog.jsonb_typeof(v_inbox.payload->'data') is distinct from 'object' then
    return 'not_eligible';
  end if;
  if v_inbox.status is distinct from 'retry'
     or v_inbox.processing_lane is distinct from 'backlog'
     or v_inbox.event_type is distinct from 'receipt'
     or v_inbox.attempts < 1
     or v_inbox.attempts >= v_inbox.max_attempts
     or v_inbox.locked_at is not null
     or v_inbox.locked_by is not null
     or v_inbox.created_at >= now() - interval '24 hours'
     or v_inbox.payload #>> '{__vimob_ingress,routing_snapshot,version}' is distinct from '1'
     or v_inbox.payload #>> '{__vimob_ingress,routing_key}' is distinct from '__session__'
     or lower(v_inbox.payload ->> 'event') is distinct from 'receipt'
     or v_inbox.payload #>> '{data,Type}' is distinct from 'read'
     or v_inbox.payload #> '{data,IsFromMe}' is distinct from 'true'::jsonb
     or (
       jsonb_typeof(v_inbox.payload #> '{data,Timestamp}') is distinct from 'string'
       and jsonb_typeof(v_inbox.payload #> '{data,Timestamp}') is distinct from 'number'
     )
     or jsonb_typeof(v_inbox.payload #> '{data,MessageIDs}') is distinct from 'array'
     or jsonb_typeof(v_inbox.payload #> '{data,MessageIDs,0}') is distinct from 'string'
     or jsonb_typeof(v_inbox.payload #> '{__vimob_ingress,routing_snapshot,messages}') is distinct from 'array'
     or v_inbox.payload ? 'message'
     or v_inbox.payload ? 'Message'
     or (v_inbox.payload #> '{data}') ? 'Message'
     or exists (
       select 1 from pg_catalog.jsonb_object_keys(v_inbox.payload) as key(name)
       where key.name not in ('__vimob_ingress','data','event','instanceId','instanceName','state')
     )
     or exists (
       select 1 from pg_catalog.jsonb_object_keys(
         case when pg_catalog.jsonb_typeof(v_inbox.payload->'data')='object'
              then v_inbox.payload->'data' else '{}'::jsonb end
       ) as key(name)
       where key.name not in (
         'AddressingMode','BroadcastListOwner','BroadcastRecipients','Chat',
         'IsFromMe','IsGroup','MessageIDs','MessageSender','RecipientAlt',
         'Sender','SenderAlt','Timestamp','Type'
       )
     ) then
    return 'not_eligible';
  end if;
  if jsonb_array_length(v_inbox.payload #> '{data,MessageIDs}') <> 1
     or jsonb_array_length(v_inbox.payload #> '{__vimob_ingress,routing_snapshot,messages}') <> 0 then
    return 'mixed_or_message';
  end if;
  v_provider_id := nullif(btrim(v_inbox.payload #>> '{data,MessageIDs,0}'), '');
  if v_provider_id is null or octet_length(v_provider_id) > 500
     or p_provider_message_id is distinct from v_provider_id
     or p_provider_occurred_at is null
     or v_inbox.provider_occurred_at is null
     or p_provider_occurred_at is distinct from v_inbox.provider_occurred_at
     or p_provider_occurred_at > now() + interval '5 minutes' then
    return 'invalid_provider_id';
  end if;
  if v_inbox.last_error is distinct from 'notification_receipt_target_not_found'
     and v_inbox.last_error is distinct from
       'notification WhatsApp receipt ' || v_provider_id || ': reconciliation rejected outcome "not_found"' then
    return 'not_eligible';
  end if;
  if exists (select 1 from private.whatsapp_deferred_receipt_ledger l where l.inbox_id=v_inbox.id) then
    return 'already_deferred';
  end if;
  if not exists (
       select 1 from public.whatsapp_sessions s
       where s.id=v_inbox.session_id and s.organization_id=v_inbox.organization_id
         and s.is_active=true and s.status='connected'
     )
     or exists (
       select 1 from private.whatsapp_webhook_legacy_routing_freeze f where f.inbox_id=v_inbox.id
     )
     or exists (
       select 1 from public.whatsapp_webhook_inbox active
       where active.session_id=v_inbox.session_id and active.id<>v_inbox.id and active.status='processing'
     )
     or exists (
       select 1 from public.whatsapp_webhook_inbox older
       where older.session_id=v_inbox.session_id and older.processing_lane='backlog'
         and older.status in ('pending','retry') and older.attempts<older.max_attempts
         and older.payload #>> '{__vimob_ingress,routing_snapshot,version}'='1'
         and (older.created_at,older.id)<(v_inbox.created_at,v_inbox.id)
     ) then
    return 'not_head';
  end if;
  if exists (
       select 1 from public.whatsapp_messages m
       where m.organization_id=v_inbox.organization_id and m.session_id=v_inbox.session_id
         and (m.message_id=v_provider_id or m.provider_message_id=v_provider_id or m.client_message_id=v_provider_id)
     )
     or exists (
       select 1 from public.whatsapp_outbox o
       where o.organization_id=v_inbox.organization_id and o.session_id=v_inbox.session_id
         and (o.provider_message_id=v_provider_id or o.client_message_id=v_provider_id)
     )
     or exists (
       select 1 from private.notification_deliveries nd
       where nd.organization_id=v_inbox.organization_id and nd.channel='whatsapp'
         and (nd.provider_message_id=v_provider_id or nd.metadata->>'expected_message_id'=v_provider_id)
     )
     or exists (
       select 1 from public.notifications n
       where n.organization_id=v_inbox.organization_id
         and n.metadata #>> '{dispatch,whatsapp,expected_message_id}'=v_provider_id
     )
     or exists (
       select 1 from public.whatsapp_webhook_routing_snapshots rs
       where rs.organization_id=v_inbox.organization_id and rs.session_id=v_inbox.session_id
         and rs.provider_message_id=v_provider_id
     ) then
    return 'target_present';
  end if;

  insert into private.whatsapp_deferred_receipt_ledger (
    inbox_id,organization_id,session_id,provider_message_id,receipt_status,
    provider_occurred_at,expires_at
  ) values (
    v_inbox.id,v_inbox.organization_id,v_inbox.session_id,v_provider_id,'read',
    p_provider_occurred_at,greatest(v_inbox.expires_at,now()+interval '30 days')
  );
  update public.whatsapp_webhook_inbox as i
  set status='dead', dead_lettered_at=now(), locked_at=null, locked_by=null,
      last_error='deferred_status_waiting_target:v1:pid_md5=' || md5(v_provider_id), updated_at=now()
  where i.id=v_inbox.id and i.status='retry' and i.attempts=v_inbox.attempts
    and i.updated_at=v_inbox.updated_at and i.payload=v_inbox.payload;
  get diagnostics v_updated = row_count;
  if v_updated<>1 then
    raise exception 'deferred_receipt_compare_and_swap_failed';
  end if;
  return 'deferred';
end;
$function$;

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
    select l.inbox_id
    from private.whatsapp_deferred_receipt_ledger l
    where l.state='deferred' and l.next_reconcile_at<=now()
    order by l.next_reconcile_at,l.inbox_id
    limit least(greatest(coalesce(p_limit,0),0),4)
    for update of l skip locked
  ), claimed as (
    update private.whatsapp_deferred_receipt_ledger l
    set claim_token=pg_catalog.gen_random_uuid(),
        next_reconcile_at=now()+interval '5 minutes',
        last_reconcile_at=now(), reconcile_attempts=l.reconcile_attempts+1
    from candidate c
    where l.inbox_id=c.inbox_id and l.state='deferred'
    returning l.inbox_id,l.organization_id,l.session_id,l.provider_message_id,
              l.receipt_status,l.provider_occurred_at,l.claim_token,l.reconcile_attempts
  )
  select c.inbox_id,c.organization_id,c.session_id,c.provider_message_id,
         c.receipt_status,c.provider_occurred_at,c.claim_token,c.reconcile_attempts
  from claimed c;
$function$;

create or replace function private.complete_deferred_whatsapp_receipt_reconciliation(
  p_inbox_id uuid, p_organization_id uuid, p_session_id uuid,
  p_provider_message_id text, p_claim_token uuid,
  p_reconcile_attempts integer, p_result text
)
returns boolean
language sql
security definer
set search_path = ''
as $function$
  with changed as (
    update private.whatsapp_deferred_receipt_ledger l
    set state='resolved',resolved_at=now(),claim_token=null
    where p_result='native_reconciled'
      and l.inbox_id=p_inbox_id
      and l.organization_id=p_organization_id
      and l.session_id=p_session_id
      and l.provider_message_id=p_provider_message_id
      and l.claim_token=p_claim_token
      and l.reconcile_attempts=p_reconcile_attempts
      and l.state='deferred'
    returning 1
  ) select count(*)=1 from changed;
$function$;

create or replace function private.cleanup_deferred_whatsapp_receipts(p_limit integer)
returns table (deferred_overdue integer, resolved_expired integer)
language sql
security definer
set search_path = ''
as $function$
  with overdue as (
    select count(*)::integer as amount from (
      select 1 from private.whatsapp_deferred_receipt_ledger l
      where l.state='deferred' and l.expires_at<=now()
      order by l.expires_at,l.inbox_id
      limit 1000
    ) bounded
  ), candidate as materialized (
    select l.inbox_id
    from private.whatsapp_deferred_receipt_ledger l
    where l.state='resolved' and l.expires_at<=now()
    order by l.expires_at,l.inbox_id
    limit least(greatest(coalesce(p_limit,0),0),1000)
    for update of l skip locked
  ), deleted as (
    delete from private.whatsapp_deferred_receipt_ledger l
    using candidate c
    where l.inbox_id=c.inbox_id
    returning l.state
  ) select overdue.amount,(select count(*)::integer from deleted)
    from overdue;
$function$;
revoke all on function private.defer_unmatched_whatsapp_receipt(uuid,text,timestamptz) from public,anon,authenticated,service_role;
revoke all on function private.claim_deferred_whatsapp_receipt_reconciliation(integer) from public,anon,authenticated,service_role;
revoke all on function private.complete_deferred_whatsapp_receipt_reconciliation(uuid,uuid,uuid,text,uuid,integer,text) from public,anon,authenticated,service_role;
revoke all on function private.cleanup_deferred_whatsapp_receipts(integer) from public,anon,authenticated,service_role;
grant usage on schema private to service_role;
grant execute on function private.defer_unmatched_whatsapp_receipt(uuid,text,timestamptz) to service_role;
grant execute on function private.claim_deferred_whatsapp_receipt_reconciliation(integer) to service_role;
grant execute on function private.complete_deferred_whatsapp_receipt_reconciliation(uuid,uuid,uuid,text,uuid,integer,text) to service_role;
grant execute on function private.cleanup_deferred_whatsapp_receipts(integer) to service_role;

comment on table private.whatsapp_deferred_receipt_ledger is
'Private reconciliation pointer retained at least thirty days for status-only receipts without a canonical target. A deferred receipt is dead in inbox but never implies message delivery.';
comment on function private.defer_unmatched_whatsapp_receipt(uuid,text,timestamptz) is
'Defers one old unleased v1 status-only receipt after a native not_found attempt; keeps raw inbox and a replay pointer without assuming raw target absence.';
comment on function private.claim_deferred_whatsapp_receipt_reconciliation(integer) is
'Bounded private replay of deferred receipt statuses. Native transport identity validation must run before completion.';
commit;
