begin;
set local lock_timeout = '5s';
set local statement_timeout = '2min';

do $preflight$
begin
  if pg_catalog.to_regclass('private.whatsapp_webhook_legacy_routing_freeze') is null
     or pg_catalog.to_regprocedure('private.canonical_jsonb_sha256(jsonb)') is null
     or pg_catalog.to_regprocedure('private.guard_whatsapp_webhook_legacy_routing_freeze()') is null then
    raise exception 'legacy_whatsapp_receipt_prerequisites_missing';
  end if;
end;
$preflight$;

-- This ledger records the exact frozen event before its queue status changes.
-- The raw inbox payload and the original freeze record remain in place.
create table private.whatsapp_legacy_receipt_terminalizations (
  inbox_id uuid primary key
    references private.whatsapp_webhook_legacy_routing_freeze (inbox_id) on delete restrict,
  organization_id uuid not null,
  session_id uuid not null,
  event_key text not null,
  processing_lane text not null,
  original_status text not null,
  payload_sha256 text not null,
  provider_message_ids jsonb not null,
  receipt_type text not null,
  terminalized_at timestamptz not null,
  reason text not null default 'frozen_legacy_status_only_receipt_after_7_days:v1',
  constraint whatsapp_legacy_receipt_terminalizations_lane_check
    check (processing_lane in ('live', 'backlog')),
  constraint whatsapp_legacy_receipt_terminalizations_status_check
    check (original_status in ('pending', 'retry')),
  constraint whatsapp_legacy_receipt_terminalizations_hash_check
    check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  constraint whatsapp_legacy_receipt_terminalizations_ids_check
    check (pg_catalog.jsonb_typeof(provider_message_ids) = 'array'),
  constraint whatsapp_legacy_receipt_terminalizations_type_check
    check (receipt_type in ('read', 'read-self', '')),
  constraint whatsapp_legacy_receipt_terminalizations_reason_check
    check (reason = 'frozen_legacy_status_only_receipt_after_7_days:v1'),
  constraint whatsapp_legacy_receipt_terminalizations_identity_key
    unique (organization_id, session_id, event_key)
);
alter table private.whatsapp_legacy_receipt_terminalizations enable row level security;
revoke all on table private.whatsapp_legacy_receipt_terminalizations
  from public, anon, authenticated, service_role;
comment on table private.whatsapp_legacy_receipt_terminalizations is
  'Private immutable audit of old status-only receipts removed from the active ingress queue; raw payload, provider IDs and exact freeze identity remain for later reconciliation.';

-- Match only the historical Receipt envelope observed in the frozen cohort.
-- New or mixed provider shapes are deliberately left for manual review.
create or replace function private.is_frozen_legacy_status_only_receipt(p_payload jsonb)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $function$
declare
  v_data jsonb;
  v_ingress jsonb;
  v_ids jsonb;
  v_id jsonb;
begin
  if pg_catalog.jsonb_typeof(p_payload) is distinct from 'object'
     or not (p_payload ?& array['__vimob_ingress','event','data','state','instanceId','instanceName'])
     or (select count(*) from pg_catalog.jsonb_object_keys(p_payload)) <> 6
     or p_payload ->> 'event' is distinct from 'Receipt'
     or pg_catalog.jsonb_typeof(p_payload -> 'state') is distinct from 'string'
     or pg_catalog.jsonb_typeof(p_payload -> 'instanceId') is distinct from 'string'
     or pg_catalog.jsonb_typeof(p_payload -> 'instanceName') is distinct from 'string' then
    return false;
  end if;

  v_data := p_payload -> 'data';
  v_ingress := p_payload -> '__vimob_ingress';
  if pg_catalog.jsonb_typeof(v_data) is distinct from 'object'
     or not (v_data ?& array[
       'AddressingMode','MessageSender','Type','Sender','MessageIDs','Chat',
       'Timestamp','SenderAlt','RecipientAlt','BroadcastListOwner','IsFromMe',
       'IsGroup','BroadcastRecipients'
     ])
     or (select count(*) from pg_catalog.jsonb_object_keys(v_data)) <> 13
     or pg_catalog.jsonb_typeof(v_ingress) is distinct from 'object'
     or not (v_ingress ? 'routing_key')
     or (select count(*) from pg_catalog.jsonb_object_keys(v_ingress)) <> 1
     or pg_catalog.jsonb_typeof(v_ingress -> 'routing_key') is distinct from 'string'
     or pg_catalog.jsonb_typeof(v_data -> 'Type') is distinct from 'string'
     or (v_data ->> 'Type', p_payload ->> 'state') not in (
       ('read', 'Read'), ('read-self', 'ReadSelf'), ('', 'Delivered')
     )
     or pg_catalog.jsonb_typeof(v_data -> 'IsFromMe') is distinct from 'boolean'
     or pg_catalog.jsonb_typeof(v_data -> 'IsGroup') is distinct from 'boolean'
     or pg_catalog.jsonb_typeof(v_data -> 'Timestamp') is distinct from 'string' then
    return false;
  end if;

  v_ids := v_data -> 'MessageIDs';
  if pg_catalog.jsonb_typeof(v_ids) is distinct from 'array' then
    return false;
  end if;
  if pg_catalog.jsonb_array_length(v_ids) < 1
     or pg_catalog.jsonb_array_length(v_ids) > 512 then
    return false;
  end if;
  for v_id in select value from pg_catalog.jsonb_array_elements(v_ids) as member(value) loop
    if pg_catalog.jsonb_typeof(v_id) is distinct from 'string'
       or pg_catalog.octet_length(v_id #>> '{}') > 64 then
      return false;
    end if;
  end loop;
  return true;
end;
$function$;
revoke all on function private.is_frozen_legacy_status_only_receipt(jsonb)
  from public, anon, authenticated, service_role;

-- The original freeze remains active. Its only exception is this audited,
-- status-only transition on the exact frozen receipt; DELETE remains blocked.
create or replace function private.guard_whatsapp_webhook_legacy_routing_freeze()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_old_frozen boolean := false;
  v_new_snapshot_version text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_old_frozen := private.is_frozen_legacy_whatsapp_ingress(
      old.id, old.organization_id, old.session_id, old.event_key, old.processing_lane
    );
  end if;

  if tg_op = 'DELETE' then
    if v_old_frozen then
      raise exception using
        errcode = '55000',
        message = 'frozen_legacy_whatsapp_ingress_delete_forbidden',
        hint = 'The preserved raw ingress cannot be deleted by receipt queue cleanup.';
    end if;
    return old;
  end if;

  if v_old_frozen then
    if tg_op = 'UPDATE'
       and old.event_type = 'receipt'
       and old.provider = 'evolution_go'
       and old.status in ('pending', 'retry')
       and old.created_at < pg_catalog.now() - interval '7 days'
       and old.locked_at is null and old.locked_by is null
       and new.status = 'dead'
       and new.dead_lettered_at is not null
       and new.updated_at = new.dead_lettered_at
       and new.expires_at = 'infinity'::timestamptz
       and (pg_catalog.to_jsonb(new) - array['status','dead_lettered_at','updated_at','expires_at'])
         = (pg_catalog.to_jsonb(old) - array['status','dead_lettered_at','updated_at','expires_at'])
       and private.is_frozen_legacy_status_only_receipt(old.payload)
       and exists (
         select 1
         from private.whatsapp_legacy_receipt_terminalizations as audit
         join private.whatsapp_webhook_legacy_routing_freeze as frozen
           on frozen.inbox_id = audit.inbox_id
          and frozen.organization_id = audit.organization_id
          and frozen.session_id = audit.session_id
          and frozen.event_key = audit.event_key
          and frozen.processing_lane = audit.processing_lane
          and frozen.original_status = audit.original_status
         where audit.inbox_id = old.id
           and audit.organization_id = old.organization_id
           and audit.session_id = old.session_id
           and audit.event_key = old.event_key
           and audit.processing_lane = old.processing_lane
           and audit.original_status = old.status
           and audit.payload_sha256 = private.canonical_jsonb_sha256(old.payload)
           and audit.provider_message_ids = old.payload #> '{data,MessageIDs}'
           and audit.receipt_type = old.payload #>> '{data,Type}'
           and audit.terminalized_at = new.dead_lettered_at
           and audit.reason = 'frozen_legacy_status_only_receipt_after_7_days:v1'
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
        hint = 'Use only an audited recovery procedure for preserved pre-v1 ingress.';
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
$function$;
revoke all on function private.guard_whatsapp_webhook_legacy_routing_freeze()
  from public, anon, authenticated, service_role;
comment on function private.guard_whatsapp_webhook_legacy_routing_freeze() is
  'Preserves frozen pre-v1 ingress; permits only exact audit-ledger-backed old status-only receipts to transition to dead, without deleting raw data.';

-- One invocation is one short transaction, so the caller can stop between
-- batches and inspect queue/lock pressure. This never returns provider IDs.
create or replace function private.terminalize_frozen_legacy_receipts(p_limit integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_inbox public.whatsapp_webhook_inbox%rowtype;
  v_at timestamptz;
  v_count integer := 0;
  v_updated integer;
begin
  if not exists (
    select 1
    from pg_catalog.pg_trigger as trigger_state
    where trigger_state.tgrelid = 'public.whatsapp_webhook_inbox'::regclass
      and trigger_state.tgname = 'guard_whatsapp_webhook_legacy_routing_freeze'
      and trigger_state.tgenabled in ('O', 'A')
      and not trigger_state.tgisinternal
  ) then
    raise exception using
      errcode = '55000',
      message = 'legacy_whatsapp_receipt_guard_not_active';
  end if;

  for v_inbox in
    select inbox.*
    from private.whatsapp_webhook_legacy_routing_freeze as frozen
    join public.whatsapp_webhook_inbox as inbox
      on inbox.id = frozen.inbox_id
     and inbox.organization_id = frozen.organization_id
     and inbox.session_id = frozen.session_id
     and inbox.event_key = frozen.event_key
     and inbox.processing_lane = frozen.processing_lane
     and inbox.status = frozen.original_status
    where inbox.provider = 'evolution_go'
      and inbox.event_type = 'receipt'
      and inbox.status in ('pending', 'retry')
      and inbox.created_at < pg_catalog.now() - interval '7 days'
      and inbox.locked_at is null
      and inbox.locked_by is null
      and inbox.payload #>> '{__vimob_ingress,routing_snapshot,version}' is distinct from '1'
      and private.is_frozen_legacy_status_only_receipt(inbox.payload)
      and not exists (
        select 1
        from private.whatsapp_legacy_receipt_terminalizations as audit
        where audit.inbox_id = inbox.id
      )
    order by inbox.created_at, inbox.id
    limit least(greatest(coalesce(p_limit, 0), 0), 500)
    for update of inbox skip locked
  loop
    v_at := pg_catalog.clock_timestamp();
    insert into private.whatsapp_legacy_receipt_terminalizations (
      inbox_id, organization_id, session_id, event_key, processing_lane,
      original_status, payload_sha256, provider_message_ids, receipt_type,
      terminalized_at
    ) values (
      v_inbox.id, v_inbox.organization_id, v_inbox.session_id,
      v_inbox.event_key, v_inbox.processing_lane, v_inbox.status,
      private.canonical_jsonb_sha256(v_inbox.payload),
      v_inbox.payload #> '{data,MessageIDs}',
      v_inbox.payload #>> '{data,Type}', v_at
    );

    update public.whatsapp_webhook_inbox as inbox
    set status = 'dead', dead_lettered_at = v_at,
        expires_at = 'infinity'::timestamptz, updated_at = v_at
    where inbox.id = v_inbox.id
      and inbox.status = v_inbox.status
      and inbox.payload = v_inbox.payload;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception using
        errcode = '40001',
        message = 'legacy_whatsapp_receipt_compare_and_swap_failed';
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;
revoke all on function private.terminalize_frozen_legacy_receipts(integer)
  from public, anon, authenticated, service_role;
grant usage on schema private to service_role;
grant execute on function private.terminalize_frozen_legacy_receipts(integer)
  to service_role;
comment on function private.terminalize_frozen_legacy_receipts(integer) is
  'Bounded status-only queue cleanup for exact frozen pre-v1 Receipt envelopes at least seven days old. Keeps raw inbox payload, freeze identity and private audit with every provider message ID.';

commit;
