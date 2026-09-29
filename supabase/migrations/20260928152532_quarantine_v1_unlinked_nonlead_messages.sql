begin;
set local lock_timeout = '5s';
set local statement_timeout = '2min';

do $preflight$
begin
  if pg_catalog.to_regclass('public.whatsapp_webhook_routing_snapshots') is null
     or pg_catalog.to_regclass('public.whatsapp_attendance_entries') is null
     or pg_catalog.to_regprocedure(
       'private.is_frozen_legacy_whatsapp_ingress(uuid,uuid,uuid,text,text)'
     ) is null
     or pg_catalog.to_regprocedure('private.canonical_jsonb_sha256(jsonb)') is null then
    raise exception 'v1_nonlead_quarantine_prerequisites_missing';
  end if;
end;
$preflight$;

-- This migration installs an operator-invoked, bounded procedure only. It
-- deliberately does not change an inbox row while the migration is applied.
create table private.whatsapp_v1_nonlead_message_quarantine (
  inbox_id uuid primary key,
  organization_id uuid not null,
  session_id uuid not null,
  event_key text not null,
  processing_lane text not null,
  provider_message_id text not null,
  ingress_sequence bigint not null,
  original_status text not null,
  payload_sha256 text not null,
  quarantined_at timestamptz not null,
  raw_retained_until timestamptz not null,
  reason text not null default 'v1_unlinked_organic_nonlead',
  constraint whatsapp_v1_nonlead_quarantine_lane_check
    check (processing_lane in ('live', 'backlog')),
  constraint whatsapp_v1_nonlead_quarantine_status_check
    check (original_status in ('pending', 'retry')),
  constraint whatsapp_v1_nonlead_quarantine_sha_check
    check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  constraint whatsapp_v1_nonlead_quarantine_reason_check
    check (reason = 'v1_unlinked_organic_nonlead'),
  constraint whatsapp_v1_nonlead_quarantine_event_key
    unique (organization_id, session_id, event_key)
);
alter table private.whatsapp_v1_nonlead_message_quarantine enable row level security;
revoke all on table private.whatsapp_v1_nonlead_message_quarantine
  from public, anon, authenticated, service_role;
comment on table private.whatsapp_v1_nonlead_message_quarantine is
  'Private audit of status-only v1 nonlead quarantine. The raw inbox payload and immutable routing snapshot remain for reconciliation. Existing dead-message protection sets inbox expires_at to infinity; seven-day deletion needs a separate audited policy.';

create or replace function private.is_unlinked_v1_nonlead_whatsapp_inbox(
  p_inbox public.whatsapp_webhook_inbox
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select (p_inbox).provider = 'evolution_go'
    and (p_inbox).event_type = 'message'
    and (p_inbox).processing_lane in ('live', 'backlog')
    and (p_inbox).status in ('pending', 'retry')
    and (p_inbox).created_at < pg_catalog.now() - interval '1 hour'
    and (p_inbox).locked_at is null and (p_inbox).locked_by is null
    and (p_inbox).dead_lettered_at is null
    and (p_inbox).payload #>> '{__vimob_ingress,routing_snapshot,version}' = '1'
    and case
      when pg_catalog.jsonb_typeof(
        (p_inbox).payload #> '{__vimob_ingress,routing_snapshot,messages}'
      ) = 'array' then pg_catalog.jsonb_array_length(
        (p_inbox).payload #> '{__vimob_ingress,routing_snapshot,messages}'
      ) = 1
      else false
    end
    and not private.is_frozen_legacy_whatsapp_ingress(
      (p_inbox).id, (p_inbox).organization_id, (p_inbox).session_id,
      (p_inbox).event_key, (p_inbox).processing_lane
    )
    and not exists (
      select 1
      from private.whatsapp_v1_nonlead_message_quarantine as audit
      where audit.inbox_id = (p_inbox).id
    )
    and exists (
      select 1
      from pg_catalog.jsonb_array_elements(
        case
          when pg_catalog.jsonb_typeof(
            (p_inbox).payload #> '{__vimob_ingress,routing_snapshot,messages}'
          ) = 'array' then
            (p_inbox).payload #> '{__vimob_ingress,routing_snapshot,messages}'
          else '[]'::jsonb
        end
      ) as item(route)
      join public.whatsapp_webhook_routing_snapshots as route_ledger
        on route_ledger.organization_id = (p_inbox).organization_id
       and route_ledger.session_id = (p_inbox).session_id
       and route_ledger.provider_message_id = item.route->>'provider_message_id'
       and route_ledger.inbox_event_key = (p_inbox).event_key
       and route_ledger.processing_lane = (p_inbox).processing_lane
       and route_ledger.routing_key = item.route->>'routing_key'
       and route_ledger.ingress_sequence::text = item.route->>'ingress_sequence'
       and route_ledger.snapshot = item.route
       and route_ledger.binding_eligible = false
       and route_ledger.target_mode = 'snapshot'
       and route_ledger.predecessor_provider_message_id is null
      left join public.whatsapp_conversations as conversation
        on conversation.id::text = item.route->>'conversation_id'
       and conversation.organization_id = (p_inbox).organization_id
       and conversation.session_id = (p_inbox).session_id
      where item.route ?& array[
        'version', 'organization_id', 'session_id', 'provider_message_id',
        'inbox_event_key', 'processing_lane', 'state', 'conversation_id',
        'event_lead_id', 'current_lead_id', 'active_binding_id',
        'quarantine_reason', 'context_kind', 'context_proof', 'rule_id',
        'origin_round_robin_id', 'managed_message_distribution',
        'managed_event_pending', 'managed_event_handled', 'routing_key',
        'binding_eligible', 'target_mode', 'ingress_sequence',
        'predecessor_provider_message_id', 'predecessor_inbox_event_key',
        'predecessor_processing_lane'
      ]
        and item.route->>'version' = '1'
        and item.route->>'organization_id' = (p_inbox).organization_id::text
        and item.route->>'session_id' = (p_inbox).session_id::text
        and item.route->>'inbox_event_key' = (p_inbox).event_key
        and item.route->>'processing_lane' = (p_inbox).processing_lane
        and item.route->>'state' = 'unlinked'
        and item.route->>'context_kind' = 'organic'
        and item.route->>'binding_eligible' = 'false'
        and item.route->>'target_mode' = 'snapshot'
        and item.route->>'managed_message_distribution' = 'false'
        and item.route->>'managed_event_pending' = 'false'
        and item.route->>'managed_event_handled' = 'false'
        and (p_inbox).payload #>> '{data,Info,ID}' = route_ledger.provider_message_id
        and (p_inbox).payload #>> '{__vimob_ingress,routing_key}' = route_ledger.routing_key
        and item.route->>'event_lead_id' is null
        and item.route->>'current_lead_id' is null
        and item.route->>'active_binding_id' is null
        and item.route->>'quarantine_reason' is null
        and item.route->>'context_proof' is null
        and item.route->>'rule_id' is null
        and item.route->>'origin_round_robin_id' is null
        and item.route->>'predecessor_provider_message_id' is null
        and item.route->>'predecessor_inbox_event_key' is null
        and item.route->>'predecessor_processing_lane' is null
        and (
          item.route->>'conversation_id' is null
          or (conversation.id is not null
              and conversation.lead_id is null
              and conversation.deleted_at is null)
        )
        and not exists (
          select 1 from public.whatsapp_webhook_routing_snapshots as other_route
          where other_route.organization_id = (p_inbox).organization_id
            and other_route.session_id = (p_inbox).session_id
            and other_route.inbox_event_key = (p_inbox).event_key
            and other_route.provider_message_id <> route_ledger.provider_message_id
        )
        and not exists (
          select 1 from public.whatsapp_webhook_routing_outcomes as outcome
          where outcome.organization_id = (p_inbox).organization_id
            and outcome.session_id = (p_inbox).session_id
            and outcome.provider_message_id = route_ledger.provider_message_id
        )
        and not exists (
          select 1 from public.whatsapp_webhook_routing_snapshots as successor
          where successor.organization_id = (p_inbox).organization_id
            and successor.session_id = (p_inbox).session_id
            and successor.routing_key = route_ledger.routing_key
            and successor.predecessor_provider_message_id = route_ledger.provider_message_id
        )
        and not exists (
          select 1 from public.whatsapp_conversation_routing_heads as head
          where head.organization_id = (p_inbox).organization_id
            and head.session_id = (p_inbox).session_id
            and (head.routing_key = route_ledger.routing_key
                 or head.provider_message_id = route_ledger.provider_message_id
                 or head.conversation_id = conversation.id)
        )
        and not exists (
          select 1 from public.whatsapp_conversation_lead_bindings as binding
          where binding.organization_id = (p_inbox).organization_id
            and (
              (binding.session_id = (p_inbox).session_id
               and binding.provider_message_id = route_ledger.provider_message_id)
              or binding.conversation_id = conversation.id
            )
        )
        and not exists (
          select 1 from public.whatsapp_attendance_entries as attendance
          where attendance.organization_id = (p_inbox).organization_id
            and (attendance.conversation_id = conversation.id
                 or (attendance.session_id = (p_inbox).session_id
                     and attendance.bootstrap_provider_message_id =
                       route_ledger.provider_message_id))
        )
        and not exists (
          select 1 from public.whatsapp_messages as message
          where message.organization_id = (p_inbox).organization_id
            and (
              (message.session_id = (p_inbox).session_id
               and (message.provider_message_id = route_ledger.provider_message_id
                    or (message.provider_message_id is null
                        and message.message_id = route_ledger.provider_message_id)))
              or (message.conversation_id = conversation.id and message.lead_id is not null)
            )
        )
        and not exists (
          select 1 from public.lead_entry_events as entry
          where entry.organization_id = (p_inbox).organization_id
            and entry.provider = 'whatsapp'
            and entry.provider_event_id = (p_inbox).session_id::text || ':' ||
              route_ledger.provider_message_id
        )
        and not exists (
          select 1 from private.whatsapp_meta_creative_event_ledger as creative
          where creative.organization_id = (p_inbox).organization_id
            and creative.whatsapp_session_id = (p_inbox).session_id
            and creative.provider_message_id = route_ledger.provider_message_id
        )
    );
$function$;
revoke all on function private.is_unlinked_v1_nonlead_whatsapp_inbox(
  public.whatsapp_webhook_inbox
) from public, anon, authenticated, service_role;

create or replace function private.quarantine_unlinked_v1_nonlead_messages(
  p_limit integer default 1,
  p_processing_lane text default 'backlog'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_candidate record;
  v_inbox public.whatsapp_webhook_inbox%rowtype;
  v_at timestamptz;
  v_retained_until timestamptz;
  v_updated integer;
  v_quarantined integer := 0;
begin
  if p_limit is null or p_limit < 0 or p_limit > 100
     or p_processing_lane not in ('live', 'backlog')
     or p_processing_lane is null then
    raise exception using errcode = '22023',
      message = 'invalid_v1_nonlead_quarantine_arguments';
  end if;
  if p_limit = 0 then
    return 0;
  end if;

  for v_candidate in
    select inbox.id, inbox.organization_id, inbox.session_id,
           route_ledger.provider_message_id, route_ledger.routing_key,
           route_ledger.ingress_sequence,
           conversation.id as conversation_id
    from public.whatsapp_webhook_inbox as inbox
    cross join lateral pg_catalog.jsonb_array_elements(
      case when pg_catalog.jsonb_typeof(
        inbox.payload #> '{__vimob_ingress,routing_snapshot,messages}'
      ) = 'array' then inbox.payload #> '{__vimob_ingress,routing_snapshot,messages}'
      else '[]'::jsonb end
    ) as item(route)
    join public.whatsapp_webhook_routing_snapshots as route_ledger
      on route_ledger.organization_id = inbox.organization_id
     and route_ledger.session_id = inbox.session_id
     and route_ledger.inbox_event_key = inbox.event_key
     and route_ledger.provider_message_id = item.route->>'provider_message_id'
     and route_ledger.processing_lane = inbox.processing_lane
     and route_ledger.routing_key = item.route->>'routing_key'
     and route_ledger.binding_eligible = false
     and route_ledger.target_mode = 'snapshot'
     and route_ledger.snapshot = item.route
    left join public.whatsapp_conversations as conversation
      on conversation.id::text = item.route->>'conversation_id'
     and conversation.organization_id = inbox.organization_id
     and conversation.session_id = inbox.session_id
    -- This bounded page uses only cheap shape checks. The complete SECURITY
    -- DEFINER classifier runs after locks and again in the UPDATE CAS; running
    -- it while searching the large inbox made a one-row canary take 32 seconds.
    where inbox.processing_lane = p_processing_lane
      and inbox.provider = 'evolution_go'
      and inbox.event_type = 'message'
      and inbox.status in ('pending', 'retry')
      and inbox.created_at < pg_catalog.now() - interval '1 hour'
      and inbox.locked_at is null and inbox.locked_by is null
      and coalesce(
        inbox.payload #>> '{__vimob_ingress,routing_snapshot,version}', ''
      ) = '1'
      and case when pg_catalog.jsonb_typeof(
        inbox.payload #> '{__vimob_ingress,routing_snapshot,messages}'
      ) = 'array' then pg_catalog.jsonb_array_length(
        inbox.payload #> '{__vimob_ingress,routing_snapshot,messages}'
      ) = 1 else false end
      and item.route->>'state' = 'unlinked'
      and item.route->>'context_kind' = 'organic'
      and item.route->>'binding_eligible' = 'false'
      and item.route->>'target_mode' = 'snapshot'
      and item.route->>'event_lead_id' is null
      and item.route->>'current_lead_id' is null
      and item.route->>'active_binding_id' is null
      and item.route->>'predecessor_provider_message_id' is null
    order by inbox.created_at, inbox.id
    limit least(1000, p_limit + 500)
  loop
    -- Same route lock and key as immutable ingress capture and provenance
    -- cleanup. A later captured successor cannot appear between the veto and
    -- status transition. Row locks below serialize the worker and relinking.
    if not pg_catalog.pg_try_advisory_xact_lock(
      pg_catalog.hashtextextended(
        v_candidate.organization_id::text || ':' ||
        v_candidate.session_id::text || ':' || v_candidate.routing_key, 0
      )
    ) then
      continue;
    end if;

    -- The FK lock for a concurrent route outcome conflicts with this lock.
    perform 1 from public.whatsapp_webhook_routing_snapshots as route_ledger
    where route_ledger.organization_id = v_candidate.organization_id
      and route_ledger.session_id = v_candidate.session_id
      and route_ledger.provider_message_id = v_candidate.provider_message_id
      and route_ledger.ingress_sequence = v_candidate.ingress_sequence
    for update skip locked;
    if not found then continue; end if;

    if v_candidate.conversation_id is not null then
      perform 1 from public.whatsapp_conversations as conversation
      where conversation.id = v_candidate.conversation_id
        and conversation.organization_id = v_candidate.organization_id
        and conversation.session_id = v_candidate.session_id
      for update skip locked;
      if not found then continue; end if;
    end if;

    select inbox.* into v_inbox
    from public.whatsapp_webhook_inbox as inbox
    where inbox.id = v_candidate.id
      and inbox.organization_id = v_candidate.organization_id
      and inbox.session_id = v_candidate.session_id
    for update skip locked;
    if not found then
      continue;
    end if;
    if not private.is_unlinked_v1_nonlead_whatsapp_inbox(v_inbox) then
      continue;
    end if;

    v_at := pg_catalog.clock_timestamp();
    v_retained_until := greatest(v_inbox.expires_at, v_at + interval '7 days');
    update public.whatsapp_webhook_inbox as inbox
    set status = 'dead', dead_lettered_at = v_at, updated_at = v_at,
        expires_at = v_retained_until
    where inbox.id = v_inbox.id
      and inbox.status = v_inbox.status
      and inbox.payload = v_inbox.payload
      and inbox.locked_at is null and inbox.locked_by is null
      and private.is_unlinked_v1_nonlead_whatsapp_inbox(inbox)
    returning inbox.expires_at into v_retained_until;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception using errcode = '40001',
        message = 'v1_nonlead_quarantine_compare_and_swap_failed';
    end if;
    -- The existing dead-message trigger may extend this to infinity. Record
    -- the value actually persisted, while enforcing at least seven days.
    if v_retained_until < v_at + interval '7 days' then
      raise exception using errcode = '23514',
        message = 'v1_nonlead_raw_retention_too_short';
    end if;

    insert into private.whatsapp_v1_nonlead_message_quarantine (
      inbox_id, organization_id, session_id, event_key, processing_lane,
      provider_message_id, ingress_sequence, original_status, payload_sha256,
      quarantined_at, raw_retained_until
    ) values (
      v_inbox.id, v_inbox.organization_id, v_inbox.session_id, v_inbox.event_key,
      v_inbox.processing_lane, v_candidate.provider_message_id,
      v_candidate.ingress_sequence, v_inbox.status,
      private.canonical_jsonb_sha256(v_inbox.payload), v_at, v_retained_until
    );
    v_quarantined := v_quarantined + 1;
    exit when v_quarantined >= p_limit;
  end loop;
  return v_quarantined;
end;
$function$;
revoke all on function private.quarantine_unlinked_v1_nonlead_messages(integer,text)
  from public, anon, authenticated, service_role;
grant usage on schema private to service_role;
grant execute on function private.quarantine_unlinked_v1_nonlead_messages(integer,text)
  to service_role;
comment on function private.quarantine_unlinked_v1_nonlead_messages(integer,text) is
  'Operator-invoked v1 organic nonlead quarantine. Run limit 1 first, then bounded batches up to 100. Each row gets an audit record. Existing dead-message protection retains the raw payload indefinitely; seven-day deletion needs a separate audited policy.';

commit;
