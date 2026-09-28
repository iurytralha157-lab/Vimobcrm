begin;
set local lock_timeout = '5s';
set local statement_timeout = '2min';

do $preflight$
begin
  if pg_catalog.to_regclass('public.whatsapp_webhook_inbox') is null
     or pg_catalog.to_regclass('public.whatsapp_webhook_routing_snapshots') is null
     or pg_catalog.to_regclass('public.whatsapp_webhook_routing_outcomes') is null
     or pg_catalog.to_regclass('public.whatsapp_messages') is null
     or pg_catalog.to_regclass('public.whatsapp_outbox') is null
     or pg_catalog.to_regprocedure('private.canonical_jsonb_sha256(jsonb)') is null
     or not exists (
       select 1 from pg_catalog.pg_trigger
       where tgrelid = 'public.whatsapp_webhook_inbox'::regclass
         and tgname = 'guard_whatsapp_webhook_legacy_routing_freeze'
         and tgenabled in ('O', 'A') and not tgisinternal
     ) then
    raise exception 'v1_contact_root_requeue_prerequisites_missing';
  end if;
end;
$preflight$;

-- The current Go parser records the provider's valid vCard in canonical
-- metadata. This ledger retains the original raw ingress independently of
-- normal processed-inbox retention; no lead or outcome is written here.
create table if not exists private.whatsapp_v1_contact_root_requeues (
  inbox_id uuid primary key,
  organization_id uuid not null,
  session_id uuid not null,
  event_key text not null,
  routing_key text not null,
  provider_message_id text not null,
  original_status text not null check (original_status = 'dead'),
  original_attempts integer not null,
  original_max_attempts integer not null,
  original_last_error text not null check (
    original_last_error = 'native WhatsApp processor does not support this event'
  ),
  original_payload jsonb not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  original_created_at timestamptz not null,
  original_updated_at timestamptz not null,
  original_next_attempt_at timestamptz not null,
  original_expires_at timestamptz not null,
  original_dead_lettered_at timestamptz not null,
  target_check_at timestamptz not null,
  requeued_at timestamptz not null,
  new_max_attempts integer not null,
  deployed_api_sha text not null check (
    deployed_api_sha in (
      'a231c82eb6f92b87c6ad0f900348feece22903dc',
      'cb77d61fdfb99db0d4dfbdc29c76cdfcfe815455'
    )
  ),
  reason text not null default 'v1_valid_contact_card_root_requeue:v1',
  constraint whatsapp_v1_contact_root_requeues_attempts_check
    check (original_attempts >= original_max_attempts
           and new_max_attempts = original_attempts + 3),
  constraint whatsapp_v1_contact_root_requeues_reason_check
    check (reason = 'v1_valid_contact_card_root_requeue:v1'),
  constraint whatsapp_v1_contact_root_requeues_identity_key
    unique (organization_id, session_id, event_key)
);
alter table private.whatsapp_v1_contact_root_requeues enable row level security;
revoke all on table private.whatsapp_v1_contact_root_requeues
  from public, anon, authenticated, service_role;
comment on table private.whatsapp_v1_contact_root_requeues is
  'One-time replay audit of valid inbound contact cards, previously dead as unsupported. Records the operator-attested API SHA, raw payload, error, attempt history and hash.';

create or replace function private.requeue_v1_contact_card_roots(
  p_limit integer, p_deployed_api_sha text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_candidate record;
  v_root public.whatsapp_webhook_inbox%rowtype;
  v_snapshot_messages jsonb;
  v_route jsonb;
  v_message jsonb;
  v_contact jsonb;
  v_name text;
  v_vcard text;
  v_provider_id text;
  v_routing_key text;
  v_checked_at timestamptz;
  v_requeued_at timestamptz;
  v_updated integer;
  v_count integer := 0;
begin
  if p_limit is null or p_limit < 0 then
    raise exception using errcode = '22023', message = 'v1_contact_root_limit_invalid';
  end if;
  if p_deployed_api_sha is distinct from
       'a231c82eb6f92b87c6ad0f900348feece22903dc'
     and p_deployed_api_sha is distinct from
       'cb77d61fdfb99db0d4dfbdc29c76cdfcfe815455' then
    raise exception using errcode = '22023', message = 'v1_contact_root_api_sha_mismatch';
  end if;
  if p_limit = 0 then
    return 0;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.whatsapp_webhook_inbox'::regclass
      and tgname = 'guard_whatsapp_webhook_legacy_routing_freeze'
      and tgenabled in ('O', 'A') and not tgisinternal
  ) then
    raise exception using errcode = '55000', message = 'whatsapp_legacy_routing_guard_not_active';
  end if;

  -- A dead backlog root must currently block the oldest live message on
  -- its route. Re-run for the next root; the audit prevents a second replay.
  for v_candidate in
    with route_heads as materialized (
      select distinct on (
        head.session_id,
        coalesce(nullif(head.payload #>> '{__vimob_ingress,routing_key}', ''), '__session__')
      ) head.organization_id, head.session_id, head.payload
      from public.whatsapp_webhook_inbox head
      join public.whatsapp_sessions session on session.id = head.session_id
      where head.processing_lane = 'live'
        and head.event_type = 'message'
        and head.status in ('pending', 'retry')
        and head.attempts < head.max_attempts
        and head.payload #>> '{__vimob_ingress,routing_snapshot,version}' = '1'
        and coalesce(session.is_active, true) = true
        and coalesce(session.status, '') not in ('deleted', 'disabled')
      order by head.session_id,
        coalesce(nullif(head.payload #>> '{__vimob_ingress,routing_key}', ''), '__session__'),
        head.created_at, head.id
    )
    select distinct root.id, root.created_at
    from route_heads head
    cross join lateral pg_catalog.jsonb_array_elements(
      case when pg_catalog.jsonb_typeof(
        head.payload #> '{__vimob_ingress,routing_snapshot,messages}'
      ) = 'array'
      then head.payload #> '{__vimob_ingress,routing_snapshot,messages}'
      else '[]'::jsonb end
    ) successor(snapshot)
    join public.whatsapp_webhook_inbox root
      on root.organization_id = head.organization_id
     and root.session_id = head.session_id
     and root.event_key = successor.snapshot ->> 'predecessor_inbox_event_key'
    where successor.snapshot ->> 'binding_eligible' = 'true'
      and root.provider = 'evolution_go'
      and root.processing_lane = 'backlog'
      and root.event_type = 'message'
      and root.status = 'dead'
      and root.attempts >= root.max_attempts
      and root.locked_at is null and root.locked_by is null
      and root.last_error = 'native WhatsApp processor does not support this event'
      and pg_catalog.jsonb_typeof(
        root.payload #> '{data,Message,contactMessage}'
      ) = 'object'
    order by root.created_at, root.id
    limit least(p_limit, 10)
  loop
    select root.* into v_root
    from public.whatsapp_webhook_inbox root
    where root.id = v_candidate.id
    for update of root skip locked;
    if not found then
      continue;
    end if;
    if v_root.provider is distinct from 'evolution_go'
       or v_root.processing_lane is distinct from 'backlog'
       or v_root.event_type is distinct from 'message'
       or v_root.status is distinct from 'dead'
       or v_root.attempts < v_root.max_attempts
       or v_root.locked_at is not null or v_root.locked_by is not null
       or v_root.created_at >= pg_catalog.now() - interval '10 minutes'
       or v_root.dead_lettered_at is null
       or v_root.last_error is distinct from
         'native WhatsApp processor does not support this event'
       or v_root.payload #>> '{__vimob_ingress,routing_snapshot,version}' is distinct from '1'
       or v_root.payload #>> '{data,Info,IsFromMe}' is distinct from 'false'
       or exists (
         select 1 from private.whatsapp_webhook_legacy_routing_freeze frozen
         where frozen.inbox_id = v_root.id
       )
       or exists (
         select 1 from private.whatsapp_v1_contact_root_requeues audit
         where audit.inbox_id = v_root.id
       ) then
      continue;
    end if;

    v_message := v_root.payload #> '{data,Message}';
    v_contact := v_message -> 'contactMessage';
    if pg_catalog.jsonb_typeof(v_message) is distinct from 'object'
       or pg_catalog.jsonb_typeof(v_contact) is distinct from 'object' then
      continue;
    end if;
    if (select count(*) from pg_catalog.jsonb_object_keys(v_message)) <> 2
       or not (v_message ?& array['contactMessage', 'messageContextInfo'])
       or (select count(*) from pg_catalog.jsonb_object_keys(v_contact)) not in (2, 3)
       or not (v_contact ?& array['displayName', 'vcard'])
       or ((select count(*) from pg_catalog.jsonb_object_keys(v_contact)) = 3
           and not (v_contact ? 'contextInfo'))
       or pg_catalog.jsonb_typeof(v_contact -> 'displayName') is distinct from 'string'
       or pg_catalog.jsonb_typeof(v_contact -> 'vcard') is distinct from 'string' then
      continue;
    end if;
    v_name := v_contact ->> 'displayName';
    v_vcard := v_contact ->> 'vcard';
    if pg_catalog.octet_length(v_name) < 1
       or pg_catalog.octet_length(v_name) > 512
       or pg_catalog.octet_length(v_vcard) < 20
       or pg_catalog.octet_length(v_vcard) > 262144
       or pg_catalog.left(pg_catalog.btrim(v_vcard), 11) <> 'BEGIN:VCARD'
       or pg_catalog.right(pg_catalog.btrim(v_vcard), 9) <> 'END:VCARD' then
      continue;
    end if;

    v_snapshot_messages := v_root.payload #> '{__vimob_ingress,routing_snapshot,messages}';
    if pg_catalog.jsonb_typeof(v_snapshot_messages) is distinct from 'array' then
      continue;
    end if;
    if pg_catalog.jsonb_array_length(v_snapshot_messages) <> 1 then
      continue;
    end if;
    v_route := v_snapshot_messages -> 0;
    v_provider_id := v_route ->> 'provider_message_id';
    v_routing_key := v_root.payload #>> '{__vimob_ingress,routing_key}';
    if v_route -> 'binding_eligible' is distinct from 'true'::jsonb
       or pg_catalog.btrim(coalesce(v_provider_id, '')) = ''
       or v_provider_id is distinct from v_root.payload #>> '{data,Info,ID}'
       or pg_catalog.btrim(coalesce(v_routing_key, '')) = ''
       or not exists (
         select 1 from public.whatsapp_sessions session
         where session.id = v_root.session_id
           and session.organization_id = v_root.organization_id
           and session.provider = 'evolution_go'
           and coalesce(session.is_active, true) = true
           and coalesce(session.status, '') not in ('deleted', 'disabled')
       )
       or not exists (
         select 1 from public.whatsapp_webhook_routing_snapshots route
         where route.organization_id = v_root.organization_id
           and route.session_id = v_root.session_id
           and route.provider_message_id = v_provider_id
           and route.inbox_event_key = v_root.event_key
           and route.processing_lane = 'backlog'
           and route.routing_key = v_routing_key
           and route.binding_eligible = true
           and route.snapshot = v_route
       ) then
      continue;
    end if;

    if nullif(v_route ->> 'predecessor_inbox_event_key', '') is not null
       and not exists (
         select 1 from public.whatsapp_webhook_inbox previous
         where previous.organization_id = v_root.organization_id
           and previous.session_id = v_root.session_id
           and previous.event_key = v_route ->> 'predecessor_inbox_event_key'
           and previous.status = 'processed'
       )
       and not exists (
         select 1 from public.whatsapp_webhook_routing_outcomes outcome
         where outcome.organization_id = v_root.organization_id
           and outcome.session_id = v_root.session_id
           and outcome.provider_message_id = v_route ->> 'predecessor_provider_message_id'
       ) then
      continue;
    end if;

    if not exists (
      select 1 from public.whatsapp_webhook_inbox head
      where head.organization_id = v_root.organization_id
        and head.session_id = v_root.session_id
        and head.processing_lane = 'live'
        and head.event_type = 'message'
        and head.status in ('pending', 'retry')
        and head.attempts < head.max_attempts
        and head.payload #>> '{__vimob_ingress,routing_snapshot,version}' = '1'
        and head.payload #>> '{__vimob_ingress,routing_key}' = v_routing_key
        and exists (
          select 1 from pg_catalog.jsonb_array_elements(
            case when pg_catalog.jsonb_typeof(
              head.payload #> '{__vimob_ingress,routing_snapshot,messages}'
            ) = 'array'
            then head.payload #> '{__vimob_ingress,routing_snapshot,messages}'
            else '[]'::jsonb end
          ) successor(snapshot)
          where successor.snapshot ->> 'binding_eligible' = 'true'
            and successor.snapshot ->> 'predecessor_inbox_event_key' = v_root.event_key
        )
        and not exists (
          select 1 from public.whatsapp_webhook_inbox older
          where older.session_id = head.session_id
            and older.processing_lane = 'live'
            and older.event_type = 'message'
            and older.status in ('pending', 'retry')
            and older.attempts < older.max_attempts
            and older.payload #>> '{__vimob_ingress,routing_snapshot,version}' = '1'
            and older.payload #>> '{__vimob_ingress,routing_key}' = v_routing_key
            and (older.created_at, older.id) < (head.created_at, head.id)
        )
    ) then
      continue;
    end if;

    v_checked_at := pg_catalog.clock_timestamp();
    if exists (
      select 1 from public.whatsapp_messages message
      where message.session_id = v_root.session_id
        and message.organization_id = v_root.organization_id
        and message.message_id = v_provider_id
    ) or exists (
      select 1 from public.whatsapp_messages message
      where message.organization_id = v_root.organization_id
        and message.session_id = v_root.session_id
        and message.provider_message_id = v_provider_id
    ) or exists (
      select 1 from public.whatsapp_messages message
      where message.organization_id = v_root.organization_id
        and message.session_id = v_root.session_id
        and message.client_message_id = v_provider_id
    ) or exists (
      select 1 from public.whatsapp_outbox outbox
      where outbox.organization_id = v_root.organization_id
        and outbox.session_id = v_root.session_id
        and (outbox.provider_message_id = v_provider_id
             or outbox.client_message_id = v_provider_id)
    ) or exists (
      select 1 from public.whatsapp_webhook_routing_outcomes outcome
      where outcome.organization_id = v_root.organization_id
        and outcome.session_id = v_root.session_id
        and outcome.provider_message_id = v_provider_id
    ) then
      continue;
    end if;

    v_requeued_at := pg_catalog.clock_timestamp();
    insert into private.whatsapp_v1_contact_root_requeues (
      inbox_id, organization_id, session_id, event_key, routing_key,
      provider_message_id, original_status, original_attempts,
      original_max_attempts, original_last_error, original_payload,
      payload_sha256, original_created_at, original_updated_at,
      original_next_attempt_at, original_expires_at,
      original_dead_lettered_at, target_check_at, requeued_at,
      new_max_attempts, deployed_api_sha
    ) values (
      v_root.id, v_root.organization_id, v_root.session_id, v_root.event_key,
      v_routing_key, v_provider_id, v_root.status, v_root.attempts,
      v_root.max_attempts, v_root.last_error, v_root.payload,
      private.canonical_jsonb_sha256(v_root.payload),
      v_root.created_at, v_root.updated_at, v_root.next_attempt_at,
      v_root.expires_at, v_root.dead_lettered_at,
      v_checked_at, v_requeued_at, v_root.attempts + 3,
      p_deployed_api_sha
    );
    update public.whatsapp_webhook_inbox root
    set status = 'retry', max_attempts = v_root.attempts + 3,
        next_attempt_at = v_requeued_at, dead_lettered_at = null,
        expires_at = greatest(v_root.expires_at, v_requeued_at + interval '7 days'),
        last_error = null, updated_at = v_requeued_at
    where root.id = v_root.id
      and root.status = 'dead'
      and root.attempts = v_root.attempts
      and root.max_attempts = v_root.max_attempts
      and root.updated_at = v_root.updated_at
      and root.payload = v_root.payload
      and root.last_error = v_root.last_error
      and root.locked_at is null and root.locked_by is null;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception using errcode = '40001', message = 'v1_contact_root_requeue_compare_and_swap_failed';
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;
revoke all on function private.requeue_v1_contact_card_roots(integer,text)
  from public, anon, authenticated, service_role;
grant usage on schema private to service_role;
grant execute on function private.requeue_v1_contact_card_roots(integer,text)
  to service_role;
comment on function private.requeue_v1_contact_card_roots(integer,text) is
  'At most ten audited, one-time requeues of exact valid contact cards that were unsupported before deployed API a231. The worker alone projects content, attendance and routing outcomes.';

do $readback$
begin
  if not exists (
    select 1 from pg_catalog.pg_class
    where oid = 'private.whatsapp_v1_contact_root_requeues'::regclass
      and relrowsecurity
  )
     or pg_catalog.has_table_privilege(
       'service_role', 'private.whatsapp_v1_contact_root_requeues', 'SELECT'
     )
     or pg_catalog.has_function_privilege(
       'anon', 'private.requeue_v1_contact_card_roots(integer,text)', 'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated', 'private.requeue_v1_contact_card_roots(integer,text)', 'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role', 'private.requeue_v1_contact_card_roots(integer,text)', 'EXECUTE'
     )
     or private.requeue_v1_contact_card_roots(
       0, 'cb77d61fdfb99db0d4dfbdc29c76cdfcfe815455'
     ) <> 0 then
    raise exception 'v1_contact_root_requeue_readback_failed';
  end if;
end;
$readback$;

commit;
