-- Route 60 has one exact pre-v1 dead control with no provenance ledger.
-- Its tombstone is privately retained and prevents provider-ID replay. The
-- cloned barrier changes only that exact dead-row predicate.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

create or replace function private.barrier_invalidated_whatsapp_v1_legacy_route60(
  p_root_inbox_id uuid,
  p_expected_active_count integer,
  p_expected_cutoff bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_hint public.whatsapp_webhook_inbox%rowtype;
  v_root public.whatsapp_webhook_inbox%rowtype;
  v_route public.whatsapp_webhook_routing_snapshots%rowtype;
  v_conversation public.whatsapp_conversations%rowtype;
  v_binding public.whatsapp_conversation_lead_bindings%rowtype;
  v_snapshot jsonb;
  v_provider_id text;
  v_routing_key text;
  v_conversation_id uuid;
  v_lead_id uuid;
  v_binding_id uuid;
  v_message_count integer;
  v_chain text[];
  v_cutoff bigint;
  v_prior_cutoff bigint;
  v_active_count integer;
  v_bad_count integer;
  v_audit_count integer;
  v_update_count integer;
  v_at timestamptz;
begin
  if p_root_inbox_id is null
     or p_expected_active_count is null
     or p_expected_active_count < 1
     or p_expected_active_count > 2000
     or p_expected_cutoff is null
     or p_expected_cutoff < 1 then
    raise exception using errcode = '22023',
      message = 'invalidated_route_barrier_expected_values_required';
  end if;

  -- Read only to find the advisory key. Recheck under that key and row lock.
  select inbox.* into v_hint
  from public.whatsapp_webhook_inbox as inbox
  where inbox.id = p_root_inbox_id;
  if not found then
    raise exception using errcode = '23503', message = 'invalidated_route_root_missing';
  end if;
  v_routing_key := v_hint.payload #>> '{__vimob_ingress,routing_key}';
  if pg_catalog.btrim(coalesce(v_routing_key, '')) = ''
     or v_routing_key = '__session__' then
    raise exception using errcode = '22023', message = 'invalidated_route_key_invalid';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_hint.organization_id::text || ':' ||
      v_hint.session_id::text || ':' || v_routing_key, 0
    )
  );
  select inbox.* into v_root
  from public.whatsapp_webhook_inbox as inbox
  where inbox.id = p_root_inbox_id
  for update;
  if not found
     or v_root.organization_id is distinct from v_hint.organization_id
     or v_root.session_id is distinct from v_hint.session_id
     or v_root.payload #>> '{__vimob_ingress,routing_key}' is distinct from v_routing_key
     or v_root.provider is distinct from 'evolution_go'
     or v_root.processing_lane is distinct from 'backlog'
     or v_root.event_type is distinct from 'message'
     or v_root.status is distinct from 'dead'
     or v_root.attempts < v_root.max_attempts
     or v_root.last_error is distinct from
       'native WhatsApp processor does not support this event'
     or v_root.locked_at is not null or v_root.locked_by is not null
     or v_root.dead_lettered_at is null
     or v_root.created_at >= pg_catalog.now() - interval '10 minutes'
     or v_root.payload #>> '{__vimob_ingress,routing_snapshot,version}' is distinct from '1'
     or private.v1_opaque_lead_control_subtype(v_root.payload) is null then
    raise exception using errcode = '23514', message = 'invalidated_route_root_not_exact_opaque_dead';
  end if;
  v_provider_id := v_root.payload #>> '{data,Info,ID}';
  v_snapshot := v_root.payload #> '{__vimob_ingress,routing_snapshot,messages,0}';
  if pg_catalog.jsonb_typeof(v_root.payload #>
      '{__vimob_ingress,routing_snapshot,messages}') = 'array' then
    v_message_count := pg_catalog.jsonb_array_length(v_root.payload #>
      '{__vimob_ingress,routing_snapshot,messages}');
  else
    v_message_count := 0;
  end if;
  if v_message_count <> 1
     or v_snapshot ->> 'provider_message_id' is distinct from v_provider_id
     or v_snapshot ->> 'inbox_event_key' is distinct from v_root.event_key
     or v_snapshot ->> 'routing_key' is distinct from v_routing_key
     or v_snapshot ->> 'state' is distinct from 'predecessor_inherit'
     or v_snapshot ->> 'target_mode' is distinct from 'inherit_predecessor'
     or v_snapshot -> 'binding_eligible' is distinct from 'true'::jsonb
     or v_snapshot ->> 'context_kind' is distinct from 'organic'
     or v_snapshot ->> 'context_proof' is not null
     or v_snapshot -> 'managed_message_distribution' is distinct from 'false'::jsonb
     or v_snapshot -> 'managed_event_pending' is distinct from 'false'::jsonb
     or v_snapshot -> 'managed_event_handled' is distinct from 'false'::jsonb
     or v_snapshot ->> 'conversation_id' is null
     or v_snapshot ->> 'current_lead_id' is null
     or v_snapshot ->> 'active_binding_id' is null then
    raise exception using errcode = '23514', message = 'invalidated_route_root_snapshot_unsafe';
  end if;
  v_conversation_id := (v_snapshot ->> 'conversation_id')::uuid;
  v_lead_id := (v_snapshot ->> 'current_lead_id')::uuid;
  v_binding_id := (v_snapshot ->> 'active_binding_id')::uuid;

  select route.* into v_route
  from public.whatsapp_webhook_routing_snapshots as route
  where route.organization_id = v_root.organization_id
    and route.session_id = v_root.session_id
    and route.provider_message_id = v_provider_id
    and route.inbox_event_key = v_root.event_key
    and route.routing_key = v_routing_key
    and route.processing_lane = v_root.processing_lane
    and route.target_mode = 'inherit_predecessor'
    and route.binding_eligible = true
    and route.snapshot = v_snapshot
  for key share of route;
  if not found then
    raise exception using errcode = '23514', message = 'invalidated_route_root_ledger_mismatch';
  end if;
  if exists (
    select 1 from public.whatsapp_webhook_routing_outcomes as outcome
    where outcome.organization_id = v_route.organization_id
      and outcome.session_id = v_route.session_id
      and outcome.provider_message_id = v_route.provider_message_id
  ) then
    raise exception using errcode = '23514', message = 'invalidated_route_root_has_outcome';
  end if;

  -- Lock all active inbox rows before conversation/binding, matching the
  -- worker's inbox-first order. This also blocks a new claim until commit.
  perform inbox.id
  from public.whatsapp_webhook_inbox as inbox
  where inbox.organization_id = v_root.organization_id
    and inbox.session_id = v_root.session_id
    and inbox.payload #>> '{__vimob_ingress,routing_key}' = v_routing_key
    and inbox.status in ('pending','retry','processing')
  order by inbox.id
  for update of inbox;

  select coalesce(max(route.ingress_sequence), 0) into v_cutoff
  from public.whatsapp_webhook_routing_snapshots as route
  where route.organization_id = v_root.organization_id
    and route.session_id = v_root.session_id
    and route.routing_key = v_routing_key;
  select coalesce(max(barrier.cutoff_ingress_sequence), 0)
  into v_prior_cutoff
  from private.whatsapp_invalidated_route_barriers as barrier
  where barrier.organization_id = v_root.organization_id
    and barrier.session_id = v_root.session_id
    and barrier.routing_key = v_routing_key;
  if v_cutoff is distinct from p_expected_cutoff
     or v_route.ingress_sequence <= v_prior_cutoff then
    raise exception using errcode = '40001', message = 'invalidated_route_cutoff_changed';
  end if;
  perform route.provider_message_id
  from public.whatsapp_webhook_routing_snapshots as route
  where route.organization_id = v_root.organization_id
    and route.session_id = v_root.session_id
    and route.routing_key = v_routing_key
    and route.ingress_sequence <= v_cutoff
  order by route.ingress_sequence
  for key share of route;

  -- Sequence strictly increases along a predecessor edge, so recursion
  -- cannot cycle. A separate active branch is never swept into this barrier.
  with recursive chain as (
    select route.provider_message_id, route.ingress_sequence
    from public.whatsapp_webhook_routing_snapshots as route
    where route.organization_id = v_root.organization_id
      and route.session_id = v_root.session_id
      and route.provider_message_id = v_provider_id
    union all
    select child.provider_message_id, child.ingress_sequence
    from public.whatsapp_webhook_routing_snapshots as child
    join chain as parent
      on child.predecessor_provider_message_id = parent.provider_message_id
     and child.ingress_sequence > parent.ingress_sequence
    where child.organization_id = v_root.organization_id
      and child.session_id = v_root.session_id
      and child.routing_key = v_routing_key
  )
  select coalesce(array_agg(distinct provider_message_id), '{}'::text[])
  into v_chain from chain;

  select count(*)::integer into v_active_count
  from public.whatsapp_webhook_inbox as inbox
  where inbox.organization_id = v_root.organization_id
    and inbox.session_id = v_root.session_id
    and inbox.payload #>> '{__vimob_ingress,routing_key}' = v_routing_key
    and inbox.status in ('pending','retry','processing');
  if v_active_count is distinct from p_expected_active_count then
    raise exception using errcode = '40001', message = 'invalidated_route_active_count_changed';
  end if;

  select count(*)::integer into v_bad_count
  from public.whatsapp_webhook_inbox as inbox
  left join public.whatsapp_webhook_routing_snapshots as route
    on route.organization_id = inbox.organization_id
   and route.session_id = inbox.session_id
   and route.provider_message_id = inbox.payload #>>
     '{__vimob_ingress,routing_snapshot,messages,0,provider_message_id}'
  where inbox.organization_id = v_root.organization_id
    and inbox.session_id = v_root.session_id
    and inbox.payload #>> '{__vimob_ingress,routing_key}' = v_routing_key
    and inbox.status in ('pending','retry','processing')
    and (
      inbox.status = 'processing'
      or inbox.provider <> 'evolution_go'
      or inbox.event_type <> 'message'
      or inbox.locked_at is not null or inbox.locked_by is not null
      or inbox.payload #>> '{__vimob_ingress,routing_snapshot,version}' is distinct from '1'
      or pg_catalog.jsonb_typeof(inbox.payload #>
           '{__vimob_ingress,routing_snapshot,messages}') is distinct from 'array'
      or (case when pg_catalog.jsonb_typeof(inbox.payload #>
           '{__vimob_ingress,routing_snapshot,messages}') = 'array'
          then pg_catalog.jsonb_array_length(inbox.payload #>
           '{__vimob_ingress,routing_snapshot,messages}')
          else -1 end) <> 1
      or route.provider_message_id is null
      or route.provider_message_id <> all(v_chain)
      or route.provider_message_id is distinct from inbox.payload #>> '{data,Info,ID}'
      or route.inbox_event_key is distinct from inbox.event_key
      or route.processing_lane is distinct from inbox.processing_lane
      or route.routing_key is distinct from v_routing_key
      or inbox.payload #> '{__vimob_ingress,routing_snapshot,messages,0}'
           is distinct from route.snapshot
      or route.target_mode is distinct from 'inherit_predecessor'
      or route.binding_eligible is distinct from true
      or route.snapshot ->> 'conversation_id' is distinct from v_conversation_id::text
      or route.snapshot ->> 'current_lead_id' is distinct from v_lead_id::text
      or route.snapshot ->> 'active_binding_id' is distinct from v_binding_id::text
      or route.snapshot ->> 'state' is distinct from 'predecessor_inherit'
      or route.snapshot ->> 'context_kind' is distinct from 'organic'
      or route.snapshot ->> 'context_proof' is not null
      or route.snapshot -> 'managed_message_distribution' is distinct from 'false'::jsonb
      or route.snapshot -> 'managed_event_pending' is distinct from 'false'::jsonb
      or route.snapshot -> 'managed_event_handled' is distinct from 'false'::jsonb
    );
  if v_bad_count <> 0 then
    raise exception using errcode = '23514', message = 'invalidated_route_contains_unproven_active_event';
  end if;

  -- Older dead rows on this route are also retained if they have an exact
  -- ledger. This preserves earlier roots that the cutoff will bypass.
  perform inbox.id
  from public.whatsapp_webhook_inbox as inbox
  where inbox.organization_id = v_root.organization_id
    and inbox.session_id = v_root.session_id
    and inbox.payload #>> '{__vimob_ingress,routing_key}' = v_routing_key
    and inbox.status = 'dead'
  order by inbox.id
  for update of inbox;
  select count(*)::integer into v_bad_count
  from public.whatsapp_webhook_inbox as inbox
  left join public.whatsapp_webhook_routing_snapshots as route
    on route.organization_id = inbox.organization_id
   and route.session_id = inbox.session_id
   and route.provider_message_id = inbox.payload #>>
     '{__vimob_ingress,routing_snapshot,messages,0,provider_message_id}'
  where inbox.organization_id = v_root.organization_id
    and inbox.session_id = v_root.session_id
    and inbox.payload #>> '{__vimob_ingress,routing_key}' = v_routing_key
    and inbox.status = 'dead'
    -- The only pre-v1 dead control on this route has no v1 ledger. An exact
    -- private tombstone retains its full raw record and blocks future replay.
    and not (
      inbox.id = '7defb7b0-c497-4824-a5f2-aec79ea3be0d'::uuid
      and private.canonical_jsonb_sha256(inbox.payload) =
        '8e89adf2d4088916fc76b42165149d90f8cbd75148239c07ca54b9808e50b53b'
      and exists (
        select 1 from private.whatsapp_legacy_provider_tombstones as tombstone
        where tombstone.organization_id = inbox.organization_id
          and tombstone.session_id = inbox.session_id
          and tombstone.source_inbox_id = inbox.id
          and tombstone.provider_message_id = inbox.payload #>> '{data,Info,ID}'
          and tombstone.routing_key = v_routing_key
          and tombstone.payload_sha256 =
            private.canonical_jsonb_sha256(inbox.payload)
          and tombstone.original_inbox = pg_catalog.to_jsonb(inbox)
          and tombstone.retained_until = 'infinity'::timestamptz
      )
    )
    and not exists (
      select 1 from private.whatsapp_invalidated_route_raw_audit as prior_audit
      where prior_audit.inbox_id = inbox.id
        and prior_audit.reason =
          'invalidated_v1_provider_replay_raw_preserved:v1'
    )
    and (
      inbox.provider <> 'evolution_go'
      or inbox.event_type <> 'message'
      or inbox.payload #>> '{__vimob_ingress,routing_snapshot,version}' is distinct from '1'
      or pg_catalog.jsonb_typeof(inbox.payload #>
           '{__vimob_ingress,routing_snapshot,messages}') is distinct from 'array'
      or (case when pg_catalog.jsonb_typeof(inbox.payload #>
           '{__vimob_ingress,routing_snapshot,messages}') = 'array'
          then pg_catalog.jsonb_array_length(inbox.payload #>
           '{__vimob_ingress,routing_snapshot,messages}')
          else -1 end) <> 1
      or route.provider_message_id is null
      or route.provider_message_id is distinct from inbox.payload #>> '{data,Info,ID}'
      or route.inbox_event_key is distinct from inbox.event_key
      or route.processing_lane is distinct from inbox.processing_lane
      or route.routing_key is distinct from v_routing_key
      or inbox.payload #> '{__vimob_ingress,routing_snapshot,messages,0}'
           is distinct from route.snapshot
      or route.snapshot ->> 'context_proof' is not null
      or route.ingress_sequence > v_cutoff
    );
  if v_bad_count <> 0 then
    raise exception using errcode = '23514', message = 'invalidated_route_contains_unproven_dead_event';
  end if;

  select conversation.* into v_conversation
  from public.whatsapp_conversations as conversation
  where conversation.id = v_conversation_id
    and conversation.organization_id = v_root.organization_id
    and conversation.session_id = v_root.session_id
    and conversation.lead_id = v_lead_id
    and conversation.deleted_at is null
  for no key update of conversation;
  if not found then
    raise exception using errcode = '23514', message = 'invalidated_route_conversation_changed';
  end if;
  select binding.* into v_binding
  from public.whatsapp_conversation_lead_bindings as binding
  where binding.id = v_binding_id
    and binding.organization_id = v_root.organization_id
    and binding.session_id = v_root.session_id
    and binding.conversation_id = v_conversation_id
    and binding.lead_id = v_lead_id
    and binding.active_to is null
    and binding.stale = false
  for update of binding;
  if not found
     or not exists (
       select 1 from public.whatsapp_sessions as session
       where session.id = v_root.session_id
         and session.organization_id = v_root.organization_id
         and session.provider = 'evolution_go'
         and coalesce(session.is_active, true) = true
         and lower(pg_catalog.btrim(coalesce(session.status, '')))
           not in ('deleted','disabled')
     )
     or exists (
       select 1 from public.whatsapp_conversation_routing_heads as head
       where head.organization_id = v_root.organization_id
         and head.conversation_id = v_conversation_id
     )
     or not exists (
       select 1 from public.leads as lead
       where lead.id = v_lead_id
         and lead.organization_id = v_root.organization_id
     )
     or exists (
       select 1 from public.whatsapp_attendance_entries as attendance
       where attendance.organization_id = v_root.organization_id
         and attendance.session_id = v_root.session_id
         and attendance.conversation_id = v_conversation_id
         and attendance.lead_id = v_lead_id
     )
     or exists (
       select 1 from public.whatsapp_webhook_routing_outcomes as outcome
       where outcome.organization_id = v_root.organization_id
         and outcome.session_id = v_root.session_id
         and outcome.provider_message_id = any(v_chain)
     )
     or exists (
       select 1 from public.whatsapp_messages as message
       where message.organization_id = v_root.organization_id
         and message.session_id = v_root.session_id
         and (message.provider_message_id = any(v_chain)
           or message.message_id = any(v_chain)
           or message.client_message_id = any(v_chain))
     ) then
    raise exception using errcode = '23514', message = 'invalidated_route_lead_or_head_changed';
  end if;

  v_at := pg_catalog.clock_timestamp();
  insert into private.whatsapp_invalidated_route_raw_audit (
    inbox_id, organization_id, session_id, routing_key,
    provider_message_id, ingress_sequence, original_inbox,
    original_route_snapshot, payload_sha256, original_status,
    quarantined_at
  )
  select inbox.id, inbox.organization_id, inbox.session_id,
    v_routing_key, route.provider_message_id, route.ingress_sequence,
    pg_catalog.to_jsonb(inbox), pg_catalog.to_jsonb(route),
    private.canonical_jsonb_sha256(inbox.payload), inbox.status, v_at
  from public.whatsapp_webhook_inbox as inbox
  join public.whatsapp_webhook_routing_snapshots as route
    on route.organization_id = inbox.organization_id
   and route.session_id = inbox.session_id
   and route.provider_message_id = inbox.payload #>>
     '{__vimob_ingress,routing_snapshot,messages,0,provider_message_id}'
   and route.provider_message_id = inbox.payload #>> '{data,Info,ID}'
   and route.inbox_event_key = inbox.event_key
   and route.processing_lane = inbox.processing_lane
  where inbox.organization_id = v_root.organization_id
    and inbox.session_id = v_root.session_id
    and inbox.payload #>> '{__vimob_ingress,routing_key}' = v_routing_key
    and inbox.status in ('pending','retry','dead')
    and route.routing_key = v_routing_key
    and route.ingress_sequence <= v_cutoff
  on conflict (inbox_id) do nothing;
  get diagnostics v_audit_count = row_count;
  if v_audit_count < v_active_count + 1
     or not exists (
       select 1 from private.whatsapp_invalidated_route_raw_audit as audit
       where audit.inbox_id = v_root.id
         and audit.original_inbox ->> 'event_key' = v_root.event_key
         and audit.original_inbox -> 'payload' = v_root.payload
     ) then
    raise exception using errcode = '23514', message = 'invalidated_route_raw_audit_incomplete';
  end if;

  insert into private.whatsapp_invalidated_route_barriers (
    organization_id, session_id, routing_key, cutoff_ingress_sequence,
    root_inbox_id, root_provider_message_id, conversation_id,
    lead_id_at_barrier, active_binding_id_at_barrier,
    active_rows_quarantined, established_at
  ) values (
    v_root.organization_id, v_root.session_id, v_routing_key, v_cutoff,
    v_root.id, v_provider_id, v_conversation_id, v_lead_id, v_binding_id,
    v_active_count, v_at
  );
  update public.whatsapp_webhook_inbox as inbox
  set status = 'dead', attempts = inbox.max_attempts,
      last_error = 'invalidated_route_raw_preserved:v1',
      dead_lettered_at = v_at, expires_at = 'infinity'::timestamptz,
      locked_at = null, locked_by = null, updated_at = v_at
  where inbox.organization_id = v_root.organization_id
    and inbox.session_id = v_root.session_id
    and inbox.payload #>> '{__vimob_ingress,routing_key}' = v_routing_key
    and inbox.status in ('pending','retry')
    and exists (
      select 1 from private.whatsapp_invalidated_route_raw_audit as audit
      where audit.inbox_id = inbox.id
        and audit.quarantined_at = v_at
        and audit.provider_message_id = any(v_chain)
    );
  get diagnostics v_update_count = row_count;
  if v_update_count <> v_active_count then
    raise exception using errcode = '40001', message = 'invalidated_route_terminal_count_mismatch';
  end if;
  update public.whatsapp_webhook_inbox as inbox
  set expires_at = 'infinity'::timestamptz, updated_at = v_at
  where inbox.organization_id = v_root.organization_id
    and inbox.session_id = v_root.session_id
    and inbox.status = 'dead'
    and inbox.expires_at <> 'infinity'::timestamptz
    and exists (
      select 1 from private.whatsapp_invalidated_route_raw_audit as audit
      where audit.inbox_id = inbox.id and audit.quarantined_at = v_at
    );

  return pg_catalog.jsonb_build_object(
    'root_inbox_id', v_root.id,
    'cutoff_ingress_sequence', v_cutoff,
    'active_rows_quarantined', v_active_count,
    'raw_rows_audited', v_audit_count,
    'new_event_policy', 'resolve_current_binding'
  );
end;
$function$;
revoke all on function private.barrier_invalidated_whatsapp_v1_legacy_route60(uuid,integer,bigint)
  from public, anon, authenticated, service_role;
comment on function private.barrier_invalidated_whatsapp_v1_legacy_route60(uuid,integer,bigint) is
  'Route 60 only: inherited-chain barrier with one exact private tombstone for its pre-v1 dead control.';



-- One transaction: preserve the legacy control, two bound controls, then
-- quarantine the inherited descendants through the cloned barrier.
create or replace function private.barrier_invalidated_whatsapp_v1_legacy_mixed_route60(
  p_root_inbox_id uuid,
  p_expected_active_count integer,
  p_expected_bound_count integer,
  p_expected_dead_count integer,
  p_expected_cutoff bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_hint public.whatsapp_webhook_inbox%rowtype;
  v_root public.whatsapp_webhook_inbox%rowtype;
  v_legacy public.whatsapp_webhook_inbox%rowtype;
  v_legacy_provider_id text;
  v_routing_key text;
  v_active_count integer;
  v_dead_count integer;
  v_bound_count integer;
  v_bad_bound_count integer;
  v_audit_count integer;
  v_update_count integer;
  v_cutoff bigint;
  v_at timestamptz;
  v_barrier_result jsonb;
begin
  if p_root_inbox_id is distinct from
       '302f4d21-9c79-4fa1-8034-26db1f1a3494'::uuid
     or p_expected_active_count is distinct from 60
     or p_expected_bound_count is distinct from 2
     or p_expected_dead_count is distinct from 2
     or p_expected_cutoff is distinct from 84188 then
    raise exception using errcode = '22023',
      message = 'legacy_route60_expected_values_invalid';
  end if;
  select inbox.* into v_hint
  from public.whatsapp_webhook_inbox as inbox
  where inbox.id = p_root_inbox_id;
  if not found then
    raise exception using errcode = '23503', message = 'legacy_route60_root_missing';
  end if;
  v_routing_key := v_hint.payload #>> '{__vimob_ingress,routing_key}';
  if pg_catalog.btrim(coalesce(v_routing_key,'')) = ''
     or v_routing_key = '__session__' then
    raise exception using errcode = '23514', message = 'legacy_route60_key_invalid';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_hint.organization_id::text || ':' || v_hint.session_id::text || ':' || v_routing_key, 0
  ));
  select inbox.* into v_root
  from public.whatsapp_webhook_inbox as inbox
  where inbox.id = p_root_inbox_id
  for update;
  if not found
     or v_root.organization_id is distinct from v_hint.organization_id
     or v_root.session_id is distinct from v_hint.session_id
     or v_root.payload #>> '{__vimob_ingress,routing_key}' is distinct from v_routing_key
     or v_root.status is distinct from 'dead'
     or v_root.attempts < v_root.max_attempts
     or v_root.last_error is distinct from
       'native WhatsApp processor does not support this event'
     or v_root.locked_at is not null or v_root.locked_by is not null
     or v_root.dead_lettered_at is null
     or v_root.expires_at is distinct from 'infinity'::timestamptz
     or private.v1_opaque_lead_control_subtype(v_root.payload)
          is distinct from 'secretEncryptedMessage'
     or private.canonical_jsonb_sha256(v_root.payload) is distinct from
       '5bdd77d4abd5f13800c4d02a5630fefe93c3fb5197467b6f98c76469898323c3' then
    raise exception using errcode = '23514', message = 'legacy_route60_root_changed';
  end if;

  -- The second dead control predates v1 routing. It has no ledger or lead
  -- proof; preserve its full raw row and prevent provider-ID reuse.
  select inbox.* into v_legacy
  from public.whatsapp_webhook_inbox as inbox
  where inbox.id = '7defb7b0-c497-4824-a5f2-aec79ea3be0d'::uuid
  for update;
  v_legacy_provider_id := v_legacy.payload #>> '{data,Info,ID}';
  if not found
     or v_legacy.organization_id is distinct from v_root.organization_id
     or v_legacy.session_id is distinct from v_root.session_id
     or v_legacy.payload #>> '{__vimob_ingress,routing_key}' is distinct from v_routing_key
     or v_legacy.provider is distinct from 'evolution_go'
     or v_legacy.processing_lane is distinct from 'backlog'
     or v_legacy.event_type is distinct from 'message'
     or v_legacy.status is distinct from 'dead'
     or v_legacy.attempts < v_legacy.max_attempts
     or v_legacy.last_error is distinct from
       'native WhatsApp processor does not support this event'
     or v_legacy.locked_at is not null or v_legacy.locked_by is not null
     or v_legacy.dead_lettered_at is null
     or v_legacy.expires_at is distinct from 'infinity'::timestamptz
     or v_legacy.payload #>> '{__vimob_ingress,routing_snapshot,version}' is not null
     or private.v1_opaque_lead_control_subtype(v_legacy.payload)
          is distinct from 'secretEncryptedMessage'
     or private.canonical_jsonb_sha256(v_legacy.payload) is distinct from
       '8e89adf2d4088916fc76b42165149d90f8cbd75148239c07ca54b9808e50b53b'
     or pg_catalog.btrim(coalesce(v_legacy_provider_id,'')) = ''
     or exists (select 1 from public.whatsapp_webhook_routing_snapshots as route
       where route.organization_id = v_legacy.organization_id
         and route.session_id = v_legacy.session_id
         and route.provider_message_id = v_legacy_provider_id)
     or exists (select 1 from public.whatsapp_webhook_routing_outcomes as outcome
       where outcome.organization_id = v_legacy.organization_id
         and outcome.session_id = v_legacy.session_id
         and outcome.provider_message_id = v_legacy_provider_id)
     or exists (select 1 from public.whatsapp_conversation_lead_bindings as binding
       where binding.organization_id = v_legacy.organization_id
         and binding.session_id = v_legacy.session_id
         and binding.provider_message_id = v_legacy_provider_id)
     or exists (select 1 from public.whatsapp_messages as message
       where message.organization_id = v_legacy.organization_id
         and message.session_id = v_legacy.session_id
         and (message.provider_message_id = v_legacy_provider_id
           or message.message_id = v_legacy_provider_id
           or message.client_message_id = v_legacy_provider_id))
     or exists (select 1 from private.whatsapp_legacy_provider_tombstones as tombstone
       where tombstone.organization_id = v_legacy.organization_id
         and tombstone.session_id = v_legacy.session_id
         and tombstone.provider_message_id = v_legacy_provider_id) then
    raise exception using errcode = '23514', message = 'legacy_route60_old_control_not_exact';
  end if;

  -- Lock all relevant inbox rows before provenance and binding, as the
  -- installed route barrier does. A concurrent claim waits then rechecks.
  perform inbox.id
  from public.whatsapp_webhook_inbox as inbox
  where inbox.organization_id = v_root.organization_id
    and inbox.session_id = v_root.session_id
    and inbox.payload #>> '{__vimob_ingress,routing_key}' = v_routing_key
    and inbox.status in ('pending','retry','processing')
  order by inbox.id
  for update of inbox;
  perform inbox.id
  from public.whatsapp_webhook_inbox as inbox
  where inbox.organization_id = v_root.organization_id
    and inbox.session_id = v_root.session_id
    and inbox.payload #>> '{__vimob_ingress,routing_key}' = v_routing_key
    and inbox.status = 'dead'
  order by inbox.id
  for update of inbox;
  select count(*)::integer into v_active_count
  from public.whatsapp_webhook_inbox as inbox
  where inbox.organization_id = v_root.organization_id
    and inbox.session_id = v_root.session_id
    and inbox.payload #>> '{__vimob_ingress,routing_key}' = v_routing_key
    and inbox.status in ('pending','retry','processing');
  select count(*)::integer into v_dead_count
  from public.whatsapp_webhook_inbox as inbox
  where inbox.organization_id = v_root.organization_id
    and inbox.session_id = v_root.session_id
    and inbox.payload #>> '{__vimob_ingress,routing_key}' = v_routing_key
    and inbox.status = 'dead';
  select coalesce(max(route.ingress_sequence),0) into v_cutoff
  from public.whatsapp_webhook_routing_snapshots as route
  where route.organization_id = v_root.organization_id
    and route.session_id = v_root.session_id
    and route.routing_key = v_routing_key;
  if v_active_count is distinct from p_expected_active_count
     or v_dead_count is distinct from p_expected_dead_count
     or v_cutoff is distinct from p_expected_cutoff
     or exists (select 1 from private.whatsapp_invalidated_route_barriers as barrier
       where barrier.organization_id = v_root.organization_id
         and barrier.session_id = v_root.session_id
         and barrier.routing_key = v_routing_key) then
    raise exception using errcode = '40001', message = 'legacy_route60_preflight_drifted';
  end if;
  perform route.provider_message_id
  from public.whatsapp_webhook_routing_snapshots as route
  where route.organization_id = v_root.organization_id
    and route.session_id = v_root.session_id
    and route.routing_key = v_routing_key
    and route.ingress_sequence <= v_cutoff
  order by route.ingress_sequence
  for key share of route;

  -- Only the two pinned inbound protocol/reaction controls may leave the
  -- active queue here. The cloned barrier rechecks all remaining rows.
  select count(*)::integer,
    count(*) filter (where (
      inbox.provider = 'evolution_go'
      and inbox.event_type = 'message'
      and inbox.status in ('pending','retry')
      and inbox.locked_at is null and inbox.locked_by is null
      and inbox.payload #>> '{__vimob_ingress,routing_snapshot,version}' = '1'
      and pg_catalog.jsonb_typeof(inbox.payload #>
        '{__vimob_ingress,routing_snapshot,messages}') = 'array'
      and (case when pg_catalog.jsonb_typeof(inbox.payload #>
        '{__vimob_ingress,routing_snapshot,messages}') = 'array'
        then pg_catalog.jsonb_array_length(inbox.payload #>
          '{__vimob_ingress,routing_snapshot,messages}') else -1 end) = 1
      and inbox.payload #>> '{data,Info,IsFromMe}' = 'false'
      and inbox.payload #>> '{data,Info,IsGroup}' = 'false'
      and route.provider_message_id = inbox.payload #>> '{data,Info,ID}'
      and route.inbox_event_key = inbox.event_key
      and route.processing_lane = inbox.processing_lane
      and route.routing_key = v_routing_key
      and route.snapshot = inbox.payload #>
        '{__vimob_ingress,routing_snapshot,messages,0}'
      and route.target_mode = 'snapshot'
      and route.binding_eligible = false
      and route.snapshot ->> 'state' = 'bound'
      and route.snapshot ->> 'target_mode' = 'snapshot'
      and route.snapshot ->> 'conversation_id' =
        v_root.payload #>> '{__vimob_ingress,routing_snapshot,messages,0,conversation_id}'
      and route.snapshot ->> 'current_lead_id' =
        v_root.payload #>> '{__vimob_ingress,routing_snapshot,messages,0,current_lead_id}'
      and route.snapshot ->> 'active_binding_id' =
        v_root.payload #>> '{__vimob_ingress,routing_snapshot,messages,0,active_binding_id}'
      and route.snapshot ->> 'context_kind' = 'organic'
      and route.snapshot ->> 'context_proof' is null
      and route.snapshot -> 'managed_message_distribution' = 'false'::jsonb
      and route.snapshot -> 'managed_event_pending' = 'false'::jsonb
      and route.snapshot -> 'managed_event_handled' = 'false'::jsonb
      and exists (select 1 from (values
        ('70442bf2-8430-4b49-9559-5da4baf24fa9'::uuid,
         'f3b01d4e383d6efda0bbf33b8cd0546389adb285204f0d36004d29759d649006'::text),
        ('a4bdbc09-ff8f-44cf-b886-cfb93f592475'::uuid,
         '3032ef6381cabecfe1d0bf14a3409db1c8c1a1834ac172fca4581c256a94572e'::text)
      ) as expected(inbox_id, payload_sha256)
      where expected.inbox_id = inbox.id
        and expected.payload_sha256 =
          private.canonical_jsonb_sha256(inbox.payload))
      and not exists (
        select 1 from public.whatsapp_webhook_routing_outcomes as outcome
        where outcome.organization_id = route.organization_id
          and outcome.session_id = route.session_id
          and outcome.provider_message_id = route.provider_message_id)
      and not exists (
        select 1 from public.whatsapp_messages as message
        where message.organization_id = route.organization_id
          and message.session_id = route.session_id
          and (message.provider_message_id = route.provider_message_id
            or message.message_id = route.provider_message_id
            or message.client_message_id = route.provider_message_id))
    ) is distinct from true)::integer
  into v_bound_count, v_bad_bound_count
  from public.whatsapp_webhook_inbox as inbox
  left join public.whatsapp_webhook_routing_snapshots as route
    on route.organization_id = inbox.organization_id
   and route.session_id = inbox.session_id
   and route.provider_message_id = inbox.payload #>>
     '{__vimob_ingress,routing_snapshot,messages,0,provider_message_id}'
  where inbox.organization_id = v_root.organization_id
    and inbox.session_id = v_root.session_id
    and inbox.payload #>> '{__vimob_ingress,routing_key}' = v_routing_key
    and inbox.status in ('pending','retry','processing')
    and route.target_mode = 'snapshot';
  if v_bound_count is distinct from p_expected_bound_count
     or v_bad_bound_count <> 0 then
    raise exception using errcode = '23514', message = 'legacy_route60_bound_not_exact';
  end if;

  insert into private.whatsapp_legacy_provider_tombstones (
    organization_id, session_id, provider_message_id, routing_key,
    source_inbox_id, original_inbox, payload_sha256
  ) values (
    v_legacy.organization_id, v_legacy.session_id, v_legacy_provider_id,
    v_routing_key, v_legacy.id, pg_catalog.to_jsonb(v_legacy),
    private.canonical_jsonb_sha256(v_legacy.payload)
  );
  if not exists (
    select 1 from private.whatsapp_legacy_provider_tombstones as tombstone
    where tombstone.organization_id = v_legacy.organization_id
      and tombstone.session_id = v_legacy.session_id
      and tombstone.provider_message_id = v_legacy_provider_id
      and tombstone.source_inbox_id = v_legacy.id
      and tombstone.original_inbox = pg_catalog.to_jsonb(v_legacy)
      and tombstone.payload_sha256 =
        private.canonical_jsonb_sha256(v_legacy.payload)
      and tombstone.retained_until = 'infinity'::timestamptz
  ) then
    raise exception using errcode = '23514', message = 'legacy_route60_tombstone_readback_failed';
  end if;

  v_at := pg_catalog.clock_timestamp();
  insert into private.whatsapp_invalidated_route_raw_audit (
    inbox_id, organization_id, session_id, routing_key,
    provider_message_id, ingress_sequence, original_inbox,
    original_route_snapshot, payload_sha256, original_status,
    quarantined_at, reason
  )
  select inbox.id, inbox.organization_id, inbox.session_id,
    v_routing_key, route.provider_message_id, route.ingress_sequence,
    pg_catalog.to_jsonb(inbox), pg_catalog.to_jsonb(route),
    private.canonical_jsonb_sha256(inbox.payload), inbox.status, v_at,
    'invalidated_v1_bound_offchain_raw_preserved:v1'
  from public.whatsapp_webhook_inbox as inbox
  join public.whatsapp_webhook_routing_snapshots as route
    on route.organization_id = inbox.organization_id
   and route.session_id = inbox.session_id
   and route.provider_message_id = inbox.payload #>>
     '{__vimob_ingress,routing_snapshot,messages,0,provider_message_id}'
   and route.provider_message_id = inbox.payload #>> '{data,Info,ID}'
   and route.inbox_event_key = inbox.event_key
   and route.processing_lane = inbox.processing_lane
  where inbox.organization_id = v_root.organization_id
    and inbox.session_id = v_root.session_id
    and inbox.payload #>> '{__vimob_ingress,routing_key}' = v_routing_key
    and inbox.status in ('pending','retry')
    and route.routing_key = v_routing_key
    and route.target_mode = 'snapshot'
    and route.ingress_sequence <= v_cutoff
  on conflict (inbox_id) do nothing;
  get diagnostics v_audit_count = row_count;
  if v_audit_count <> p_expected_bound_count then
    raise exception using errcode = '23514', message = 'legacy_route60_raw_audit_incomplete';
  end if;
  update public.whatsapp_webhook_inbox as inbox
  set status = 'dead', attempts = inbox.max_attempts,
      last_error = 'invalidated_route_bound_raw_preserved:v1',
      dead_lettered_at = v_at, expires_at = 'infinity'::timestamptz,
      locked_at = null, locked_by = null, updated_at = v_at
  where inbox.organization_id = v_root.organization_id
    and inbox.session_id = v_root.session_id
    and inbox.payload #>> '{__vimob_ingress,routing_key}' = v_routing_key
    and inbox.status in ('pending','retry')
    and exists (select 1 from private.whatsapp_invalidated_route_raw_audit as audit
      where audit.inbox_id = inbox.id and audit.quarantined_at = v_at
        and audit.reason = 'invalidated_v1_bound_offchain_raw_preserved:v1');
  get diagnostics v_update_count = row_count;
  if v_update_count <> p_expected_bound_count then
    raise exception using errcode = '40001', message = 'legacy_route60_bound_terminal_mismatch';
  end if;

  v_barrier_result := private.barrier_invalidated_whatsapp_v1_legacy_route60(
    p_root_inbox_id, p_expected_active_count - p_expected_bound_count,
    p_expected_cutoff
  );
  if (v_barrier_result ->> 'active_rows_quarantined')::integer
       is distinct from p_expected_active_count - p_expected_bound_count
     or (v_barrier_result ->> 'raw_rows_audited')::integer
       is distinct from p_expected_active_count - p_expected_bound_count + 1 then
    raise exception using errcode = '23514', message = 'legacy_route60_barrier_mismatch';
  end if;
  return pg_catalog.jsonb_build_object(
    'root_inbox_id', p_root_inbox_id,
    'active_rows_quarantined', p_expected_active_count,
    'bound_rows_quarantined', p_expected_bound_count,
    'inherit_rows_quarantined', p_expected_active_count - p_expected_bound_count,
    'dead_rows_preserved', p_expected_dead_count,
    'cutoff_ingress_sequence', p_expected_cutoff,
    'route_raw_rows_audited', v_audit_count +
      (v_barrier_result ->> 'raw_rows_audited')::integer,
    'legacy_tombstones_created', 1
  );
end;
$function$;
revoke all on function private.barrier_invalidated_whatsapp_v1_legacy_mixed_route60(
  uuid,integer,integer,integer,bigint) from public, anon, authenticated, service_role;
comment on function private.barrier_invalidated_whatsapp_v1_legacy_mixed_route60(
  uuid,integer,integer,integer,bigint) is
  'Route 60 only: two pinned bound controls, one pinned pre-v1 tombstone, and 58 inherited descendants privately audited without routing outcome.';


commit;
