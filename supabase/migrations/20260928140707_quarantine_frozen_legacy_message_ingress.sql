begin;
set local lock_timeout = '5s';
set local statement_timeout = '2min';

do $preflight$
begin
  if pg_catalog.to_regclass('private.whatsapp_webhook_legacy_routing_freeze') is null
     or pg_catalog.to_regclass('private.whatsapp_legacy_receipt_terminalizations') is null
     or pg_catalog.to_regprocedure('private.canonical_jsonb_sha256(jsonb)') is null
     or pg_catalog.to_regprocedure('private.is_frozen_legacy_status_only_receipt(jsonb)') is null then
    raise exception 'legacy_whatsapp_message_quarantine_prerequisites_missing';
  end if;
end;
$preflight$;

-- Quarantine is a queue decision, not a lead assignment or message deletion.
-- The raw event and the original frozen identity remain in the database.
create table private.whatsapp_legacy_message_quarantine (
  inbox_id uuid primary key
    references private.whatsapp_webhook_legacy_routing_freeze (inbox_id) on delete restrict,
  organization_id uuid not null,
  session_id uuid not null,
  event_key text not null,
  processing_lane text not null,
  original_status text not null,
  provider_message_id text not null,
  payload_sha256 text not null,
  canonical_message_id uuid,
  canonical_lead_id uuid,
  canonical_match_count integer not null,
  classification text not null,
  quarantined_at timestamptz not null,
  constraint whatsapp_legacy_message_quarantine_lane_check
    check (processing_lane in ('live', 'backlog')),
  constraint whatsapp_legacy_message_quarantine_status_check
    check (original_status in ('pending', 'retry')),
  constraint whatsapp_legacy_message_quarantine_provider_id_check
    check (pg_catalog.btrim(provider_message_id) <> '' and pg_catalog.octet_length(provider_message_id) <= 500),
  constraint whatsapp_legacy_message_quarantine_hash_check
    check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  constraint whatsapp_legacy_message_quarantine_match_count_check
    check (canonical_match_count >= 0),
  constraint whatsapp_legacy_message_quarantine_classification_check
    check (
      (classification = 'unresolved_raw_preserved'
       and canonical_match_count = 0
       and canonical_message_id is null and canonical_lead_id is null)
      or (classification = 'canonical_nonlead_id_match'
       and canonical_match_count = 1
       and canonical_message_id is not null and canonical_lead_id is null)
      or (classification = 'canonical_lead_id_match'
       and canonical_match_count = 1
       and canonical_message_id is not null and canonical_lead_id is not null)
      or (classification = 'ambiguous_raw_preserved'
       and canonical_match_count > 1
       and canonical_message_id is null and canonical_lead_id is null)
    ),
  constraint whatsapp_legacy_message_quarantine_identity_key
    unique (organization_id, session_id, event_key)
);
alter table private.whatsapp_legacy_message_quarantine enable row level security;
revoke all on table private.whatsapp_legacy_message_quarantine
  from public, anon, authenticated, service_role;
comment on table private.whatsapp_legacy_message_quarantine is
  'Private queue quarantine of frozen pre-v1 message ingress. Unresolved raw payloads remain available for later exact-ID recovery; canonical matches are observations, not inferred lead assignments.';

create or replace function private.is_frozen_legacy_message_payload(p_payload jsonb)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $function$
declare
  v_data jsonb;
  v_info jsonb;
  v_ingress jsonb;
  v_provider_id text;
begin
  if pg_catalog.jsonb_typeof(p_payload) is distinct from 'object'
     or not (p_payload ?& array['__vimob_ingress','event','data','instanceId','instanceName'])
     or (select count(*) from pg_catalog.jsonb_object_keys(p_payload)) <> 5
     or p_payload ->> 'event' is distinct from 'Message'
     or pg_catalog.jsonb_typeof(p_payload -> 'instanceId') is distinct from 'string'
     or pg_catalog.jsonb_typeof(p_payload -> 'instanceName') is distinct from 'string' then
    return false;
  end if;
  v_data := p_payload -> 'data';
  v_info := v_data -> 'Info';
  v_ingress := p_payload -> '__vimob_ingress';
  if pg_catalog.jsonb_typeof(v_data) is distinct from 'object'
     or pg_catalog.jsonb_typeof(v_info) is distinct from 'object'
     or pg_catalog.jsonb_typeof(v_ingress) is distinct from 'object'
     or not (v_ingress ? 'routing_key')
     or (select count(*) from pg_catalog.jsonb_object_keys(v_ingress)) <> 1
     or pg_catalog.jsonb_typeof(v_ingress -> 'routing_key') is distinct from 'string'
     or pg_catalog.jsonb_typeof(v_info -> 'ID') is distinct from 'string' then
    return false;
  end if;
  v_provider_id := v_info ->> 'ID';
  return pg_catalog.btrim(v_provider_id) <> ''
     and pg_catalog.octet_length(v_provider_id) <= 500;
end;
$function$;
revoke all on function private.is_frozen_legacy_message_payload(jsonb)
  from public, anon, authenticated, service_role;

create or replace function private.is_authorized_frozen_legacy_message_quarantine(
  p_old public.whatsapp_webhook_inbox,
  p_new public.whatsapp_webhook_inbox
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  select p_old.event_type = 'message'
    and p_old.provider = 'evolution_go'
    and p_old.status in ('pending', 'retry')
    and p_old.created_at < pg_catalog.now() - interval '7 days'
    and p_old.locked_at is null and p_old.locked_by is null
    and p_old.payload #>> '{__vimob_ingress,routing_snapshot,version}' is distinct from '1'
    and p_new.status = 'dead'
    and p_new.dead_lettered_at is not null
    and p_new.updated_at = p_new.dead_lettered_at
    and (pg_catalog.to_jsonb(p_new) - array['status','dead_lettered_at','updated_at'])
      = (pg_catalog.to_jsonb(p_old) - array['status','dead_lettered_at','updated_at'])
    and private.is_frozen_legacy_message_payload(p_old.payload)
    and exists (
      select 1
      from private.whatsapp_legacy_message_quarantine as audit
      join private.whatsapp_webhook_legacy_routing_freeze as frozen
        on frozen.inbox_id = audit.inbox_id
       and frozen.organization_id = audit.organization_id
       and frozen.session_id = audit.session_id
       and frozen.event_key = audit.event_key
       and frozen.processing_lane = audit.processing_lane
       and frozen.original_status = audit.original_status
      where audit.inbox_id = p_old.id
        and audit.organization_id = p_old.organization_id
        and audit.session_id = p_old.session_id
        and audit.event_key = p_old.event_key
        and audit.processing_lane = p_old.processing_lane
        and audit.original_status = p_old.status
        and audit.provider_message_id = p_old.payload #>> '{data,Info,ID}'
        and audit.payload_sha256 = private.canonical_jsonb_sha256(p_old.payload)
        and audit.quarantined_at = p_new.dead_lettered_at
    );
$function$;
revoke all on function private.is_authorized_frozen_legacy_message_quarantine(
  public.whatsapp_webhook_inbox, public.whatsapp_webhook_inbox
) from public, anon, authenticated, service_role;

-- Keep the receipt-only exception from the preceding migration and add the
-- exact, audit-backed message quarantine exception. The freeze still blocks
-- all deletes and any replay, route or payload rewrite.
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
        hint = 'The preserved raw ingress cannot be deleted by queue quarantine.';
    end if;
    return old;
  end if;

  if v_old_frozen then
    if private.is_authorized_frozen_legacy_message_quarantine(old, new) then
      return new;
    end if;
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
        hint = 'Use only an audited procedure for preserved pre-v1 ingress.';
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
  'Preserves frozen pre-v1 ingress; only exact receipt and message audit-ledger-backed terminal transitions may leave the active queue.';

create or replace function private.quarantine_frozen_legacy_messages(p_limit integer)
returns table (
  canonical_lead_id_match integer,
  canonical_nonlead_id_match integer,
  unresolved_raw_preserved integer,
  ambiguous_raw_preserved integer
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_inbox public.whatsapp_webhook_inbox%rowtype;
  v_provider_id text;
  v_message_ids uuid[];
  v_lead_ids uuid[];
  v_classification text;
  v_match_count integer;
  v_message_id uuid;
  v_lead_id uuid;
  v_at timestamptz;
  v_updated integer;
begin
  canonical_lead_id_match := 0;
  canonical_nonlead_id_match := 0;
  unresolved_raw_preserved := 0;
  ambiguous_raw_preserved := 0;
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
      message = 'legacy_whatsapp_message_guard_not_active';
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
      and inbox.event_type = 'message'
      and inbox.status in ('pending', 'retry')
      and inbox.created_at < pg_catalog.now() - interval '7 days'
      and inbox.locked_at is null and inbox.locked_by is null
      and inbox.payload #>> '{__vimob_ingress,routing_snapshot,version}' is distinct from '1'
      and private.is_frozen_legacy_message_payload(inbox.payload)
      and not exists (
        select 1
        from private.whatsapp_legacy_message_quarantine as audit
        where audit.inbox_id = inbox.id
      )
    order by inbox.created_at, inbox.id
    limit least(greatest(coalesce(p_limit, 0), 0), 500)
    for update of inbox skip locked
  loop
    v_provider_id := v_inbox.payload #>> '{data,Info,ID}';
    select pg_catalog.array_agg(message.id order by message.id),
           pg_catalog.array_agg(message.lead_id order by message.id)
      into v_message_ids, v_lead_ids
    from public.whatsapp_messages as message
    where message.organization_id = v_inbox.organization_id
      and message.session_id = v_inbox.session_id
      and (
        message.provider_message_id = v_provider_id
        or (message.provider_message_id is null and message.message_id = v_provider_id)
      );

    v_match_count := coalesce(pg_catalog.cardinality(v_message_ids), 0);
    v_message_id := case when v_match_count = 1 then v_message_ids[1] else null end;
    v_lead_id := case when v_match_count = 1 then v_lead_ids[1] else null end;
    v_classification := case
      when v_match_count > 1 then 'ambiguous_raw_preserved'
      when v_message_id is null then 'unresolved_raw_preserved'
      when v_lead_id is null then 'canonical_nonlead_id_match'
      else 'canonical_lead_id_match'
    end;
    v_at := pg_catalog.clock_timestamp();
    insert into private.whatsapp_legacy_message_quarantine (
      inbox_id, organization_id, session_id, event_key, processing_lane,
      original_status, provider_message_id, payload_sha256,
      canonical_message_id, canonical_lead_id, canonical_match_count,
      classification, quarantined_at
    ) values (
      v_inbox.id, v_inbox.organization_id, v_inbox.session_id, v_inbox.event_key,
      v_inbox.processing_lane, v_inbox.status, v_provider_id,
      private.canonical_jsonb_sha256(v_inbox.payload),
      v_message_id, v_lead_id, v_match_count, v_classification, v_at
    );
    update public.whatsapp_webhook_inbox as inbox
    set status = 'dead', dead_lettered_at = v_at, updated_at = v_at
    where inbox.id = v_inbox.id
      and inbox.status = v_inbox.status
      and inbox.payload = v_inbox.payload;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception using
        errcode = '40001',
        message = 'legacy_whatsapp_message_compare_and_swap_failed';
    end if;
    if v_classification = 'canonical_lead_id_match' then
      canonical_lead_id_match := canonical_lead_id_match + 1;
    elsif v_classification = 'canonical_nonlead_id_match' then
      canonical_nonlead_id_match := canonical_nonlead_id_match + 1;
    elsif v_classification = 'unresolved_raw_preserved' then
      unresolved_raw_preserved := unresolved_raw_preserved + 1;
    else
      ambiguous_raw_preserved := ambiguous_raw_preserved + 1;
    end if;
  end loop;
  return next;
end;
$function$;
revoke all on function private.quarantine_frozen_legacy_messages(integer)
  from public, anon, authenticated, service_role;
grant usage on schema private to service_role;
grant execute on function private.quarantine_frozen_legacy_messages(integer)
  to service_role;
comment on function private.quarantine_frozen_legacy_messages(integer) is
  'Batched status-only quarantine of seven-day-old frozen message ingress. Every raw payload remains; canonical ID matches are observed at execution time and no lead is inferred or created.';

commit;
