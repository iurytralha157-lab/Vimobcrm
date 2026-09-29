-- Exact production canary for a forwarded-album root, preserving raw lead
-- events without broadening the global opaque-message classifier.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

alter table private.whatsapp_invalidated_route_raw_audit
  drop constraint whatsapp_invalidated_route_raw_audit_reason_check;
alter table private.whatsapp_invalidated_route_raw_audit
  add constraint whatsapp_invalidated_route_raw_audit_reason_check
  check (reason in (
    'invalidated_v1_inherit_chain_raw_preserved:v1',
    'invalidated_v1_provider_replay_raw_preserved:v1',
    'invalidated_v1_bound_offchain_raw_preserved:v1'
  ));
create or replace function private.barrier_invalidated_whatsapp_v1_forwarded_album_route(
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
     or (
       private.v1_opaque_lead_control_subtype(v_root.payload) is null
       and not (
         v_root.id = '328ee742-42bb-43a6-9091-9f826266331f'::uuid
         and private.canonical_jsonb_sha256(v_root.payload) =
           '32b7301d20757128f748c0993247fe68b074875e4e6e7989675d284bf6af4bbd'
       )
     ) then
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
revoke all on function private.barrier_invalidated_whatsapp_v1_forwarded_album_route(uuid,integer,bigint)
  from public, anon, authenticated, service_role;
comment on function private.barrier_invalidated_whatsapp_v1_forwarded_album_route(uuid,integer,bigint) is
  'Exact root-ID and canonical-payload-hash exception for one forwarded-album route; all installed route-barrier guards remain intact.';
-- This wrapper quarantines later, fully proven bound events in the same
-- transaction, then delegates the inherited chain to the installed v1 route
-- barrier. Any exception rolls back both steps and preserves the old queue.
create or replace function private.barrier_invalidated_whatsapp_v1_mixed_route(
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
  v_route public.whatsapp_webhook_routing_snapshots%rowtype;
  v_conversation public.whatsapp_conversations%rowtype;
  v_binding public.whatsapp_conversation_lead_bindings%rowtype;
  v_routing_key text;
  v_snapshot jsonb;
  v_conversation_id uuid;
  v_lead_id uuid;
  v_binding_id uuid;
  v_active_count integer;
  v_bound_count integer;
  v_dead_count integer;
  v_bad_count integer;
  v_audit_count integer;
  v_update_count integer;
  v_cutoff bigint;
  v_at timestamptz;
  v_barrier_result jsonb;
begin
  if p_root_inbox_id is null
     or p_expected_active_count is null
     or p_expected_active_count < 2 or p_expected_active_count > 2000
     or p_expected_bound_count is null or p_expected_bound_count < 1
     or p_expected_bound_count >= p_expected_active_count
     or p_expected_dead_count is null or p_expected_dead_count <> 1
     or p_expected_cutoff is null or p_expected_cutoff < 1 then
    raise exception using errcode = '22023',
      message = 'mixed_route_expected_values_invalid';
  end if;
  select inbox.* into v_hint
  from public.whatsapp_webhook_inbox as inbox
  where inbox.id = p_root_inbox_id;
  if not found then
    raise exception using errcode = '23503', message = 'mixed_route_root_missing';
  end if;
  v_routing_key := v_hint.payload #>> '{__vimob_ingress,routing_key}';
  if pg_catalog.btrim(coalesce(v_routing_key,'')) = ''
     or v_routing_key = '__session__' then
    raise exception using errcode = '23514', message = 'mixed_route_key_invalid';
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
     or v_root.last_error is distinct from
       'native WhatsApp processor does not support this event'
     or v_root.locked_at is not null or v_root.locked_by is not null
     or v_root.attempts < v_root.max_attempts
     or v_root.dead_lettered_at is null
     or v_root.created_at >= pg_catalog.now() - interval '10 minutes'
     or v_root.id is distinct from
       '328ee742-42bb-43a6-9091-9f826266331f'::uuid
     or private.canonical_jsonb_sha256(v_root.payload) is distinct from
       '32b7301d20757128f748c0993247fe68b074875e4e6e7989675d284bf6af4bbd' then
    raise exception using errcode = '23514', message = 'mixed_route_root_not_exact';
  end if;
  v_snapshot := v_root.payload #> '{__vimob_ingress,routing_snapshot,messages,0}';
  v_conversation_id := (v_snapshot ->> 'conversation_id')::uuid;
  v_lead_id := (v_snapshot ->> 'current_lead_id')::uuid;
  v_binding_id := (v_snapshot ->> 'active_binding_id')::uuid;
  if v_conversation_id is null or v_lead_id is null or v_binding_id is null
     or v_snapshot ->> 'state' is distinct from 'predecessor_inherit'
     or v_snapshot ->> 'target_mode' is distinct from 'inherit_predecessor'
     or v_snapshot -> 'binding_eligible' is distinct from 'true'::jsonb
     or v_snapshot ->> 'context_kind' is distinct from 'organic'
     or v_snapshot ->> 'context_proof' is not null then
    raise exception using errcode = '23514', message = 'mixed_route_root_identity_missing';
  end if;
  select route.* into v_route
  from public.whatsapp_webhook_routing_snapshots as route
  where route.organization_id = v_root.organization_id
    and route.session_id = v_root.session_id
    and route.inbox_event_key = v_root.event_key
    and route.provider_message_id = v_root.payload #>> '{data,Info,ID}'
    and route.routing_key = v_routing_key
    and route.processing_lane = v_root.processing_lane
    and route.target_mode = 'inherit_predecessor'
    and route.binding_eligible = true
    and route.snapshot = v_snapshot
  for key share of route;
  if not found or v_root.processing_lane is distinct from 'backlog'
     or v_root.provider is distinct from 'evolution_go'
     or v_root.event_type is distinct from 'message'
     or v_root.payload #>> '{__vimob_ingress,routing_snapshot,version}' is distinct from '1'
     or pg_catalog.jsonb_typeof(v_root.payload #>
          '{__vimob_ingress,routing_snapshot,messages}') is distinct from 'array'
     or pg_catalog.jsonb_array_length(v_root.payload #>
          '{__vimob_ingress,routing_snapshot,messages}') <> 1 then
    raise exception using errcode = '23514', message = 'mixed_route_root_ledger_invalid';
  end if;

  -- Inbox-first lock order matches the worker and the installed barrier.
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
    raise exception using errcode = '40001', message = 'mixed_route_preflight_drifted';
  end if;
  perform route.provider_message_id
  from public.whatsapp_webhook_routing_snapshots as route
  where route.organization_id = v_root.organization_id
    and route.session_id = v_root.session_id
    and route.routing_key = v_routing_key
    and route.ingress_sequence <= v_cutoff
  order by route.ingress_sequence
  for key share of route;

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
      or inbox.provider is distinct from 'evolution_go'
      or inbox.event_type is distinct from 'message'
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
      or route.provider_message_id is distinct from inbox.payload #>> '{data,Info,ID}'
      or route.inbox_event_key is distinct from inbox.event_key
      or route.processing_lane is distinct from inbox.processing_lane
      or route.routing_key is distinct from v_routing_key
      or route.snapshot is distinct from inbox.payload #>
        '{__vimob_ingress,routing_snapshot,messages,0}'
      or route.snapshot ->> 'conversation_id' is distinct from v_conversation_id::text
      or route.snapshot ->> 'current_lead_id' is distinct from v_lead_id::text
      or route.snapshot ->> 'active_binding_id' is distinct from v_binding_id::text
      or route.snapshot ->> 'context_kind' is distinct from 'organic'
      or route.snapshot ->> 'context_proof' is not null
      or route.snapshot -> 'managed_message_distribution' is distinct from 'false'::jsonb
      or route.snapshot -> 'managed_event_pending' is distinct from 'false'::jsonb
      or route.snapshot -> 'managed_event_handled' is distinct from 'false'::jsonb
      or ((
        (route.target_mode = 'inherit_predecessor'
         and route.binding_eligible = true
         and route.snapshot ->> 'state' = 'predecessor_inherit'
         and route.snapshot ->> 'target_mode' = 'inherit_predecessor')
        or
        (route.target_mode = 'snapshot'
         and route.binding_eligible = false
         and route.snapshot ->> 'state' = 'bound'
         and route.snapshot ->> 'target_mode' = 'snapshot'
         and exists (
           select 1 from (values
             ('1eaacc4b-1ccc-4020-af86-f9dfaf45a940'::uuid,
              'e1752c0e5b21d2027ff7c2bb01efc1450e56b50350b4d2f80cfbdbec9a05049c'::text),
             ('717d7e9f-2345-4d7e-9226-3ba0131522e3'::uuid,
              '3fa720f41c5654b3616750f365e35a88447ff695193d34ad427cef8a039eba75'::text),
             ('f694acad-e1b0-4c5a-93c5-7f279fe18a8c'::uuid,
              'b4f2e25a30d6c931c1d7eb024b8244b27c8b83f5312eb5bc267889b34e9c5c1f'::text)
           ) as expected(inbox_id, payload_sha256)
           where expected.inbox_id = inbox.id
             and expected.payload_sha256 =
               private.canonical_jsonb_sha256(inbox.payload)
         ))
      ) is distinct from true)
    );
  if v_bad_count <> 0 then
    raise exception using errcode = '23514', message = 'mixed_route_contains_unproven_active';
  end if;
  select count(*)::integer into v_bound_count
  from public.whatsapp_webhook_inbox as inbox
  join public.whatsapp_webhook_routing_snapshots as route
    on route.organization_id = inbox.organization_id
   and route.session_id = inbox.session_id
   and route.provider_message_id = inbox.payload #>>
     '{__vimob_ingress,routing_snapshot,messages,0,provider_message_id}'
  where inbox.organization_id = v_root.organization_id
    and inbox.session_id = v_root.session_id
    and inbox.payload #>> '{__vimob_ingress,routing_key}' = v_routing_key
    and inbox.status in ('pending','retry')
    and route.target_mode = 'snapshot';
  if v_bound_count is distinct from p_expected_bound_count then
    raise exception using errcode = '40001', message = 'mixed_route_bound_count_drifted';
  end if;

  select conversation.* into v_conversation
  from public.whatsapp_conversations as conversation
  where conversation.id = v_conversation_id
    and conversation.organization_id = v_root.organization_id
    and conversation.session_id = v_root.session_id
    and conversation.lead_id = v_lead_id
    and conversation.deleted_at is null
  for no key update of conversation;
  select binding.* into v_binding
  from public.whatsapp_conversation_lead_bindings as binding
  where binding.id = v_binding_id
    and binding.organization_id = v_root.organization_id
    and binding.session_id = v_root.session_id
    and binding.conversation_id = v_conversation_id
    and binding.lead_id = v_lead_id
    and binding.active_to is null and binding.stale = false
  for update of binding;
  if v_conversation.id is null or v_binding.id is null
     or not exists (select 1 from public.leads as lead
       where lead.id = v_lead_id and lead.organization_id = v_root.organization_id)
     or not exists (select 1 from public.whatsapp_sessions as session
       where session.id = v_root.session_id
         and session.organization_id = v_root.organization_id
         and session.provider = 'evolution_go'
         and coalesce(session.is_active,true) = true
         and lower(pg_catalog.btrim(coalesce(session.status,'')))
             not in ('deleted','disabled'))
     or exists (select 1 from public.whatsapp_conversation_routing_heads as head
       where head.organization_id = v_root.organization_id
         and head.conversation_id = v_conversation_id)
     or exists (select 1 from public.whatsapp_attendance_entries as attendance
       where attendance.organization_id = v_root.organization_id
         and attendance.session_id = v_root.session_id
         and attendance.conversation_id = v_conversation_id
         and attendance.lead_id = v_lead_id)
     or exists (
       select 1 from public.whatsapp_webhook_routing_snapshots as route
       join public.whatsapp_webhook_inbox as inbox
         on inbox.organization_id = route.organization_id
        and inbox.session_id = route.session_id
        and inbox.event_key = route.inbox_event_key
        and inbox.status in ('pending','retry','processing','dead')
       join public.whatsapp_webhook_routing_outcomes as outcome
         on outcome.organization_id = route.organization_id
        and outcome.session_id = route.session_id
        and outcome.provider_message_id = route.provider_message_id
       where route.organization_id = v_root.organization_id
         and route.session_id = v_root.session_id
         and route.routing_key = v_routing_key
     )
     or exists (
       select 1 from public.whatsapp_webhook_routing_snapshots as route
       join public.whatsapp_webhook_inbox as inbox
         on inbox.organization_id = route.organization_id
        and inbox.session_id = route.session_id
        and inbox.event_key = route.inbox_event_key
        and inbox.status in ('pending','retry','processing','dead')
       join public.whatsapp_messages as message
         on message.organization_id = route.organization_id
        and message.session_id = route.session_id
        and (message.provider_message_id = route.provider_message_id
          or message.message_id = route.provider_message_id
          or message.client_message_id = route.provider_message_id)
       where route.organization_id = v_root.organization_id
         and route.session_id = v_root.session_id
         and route.routing_key = v_routing_key
     ) then
    raise exception using errcode = '23514', message = 'mixed_route_lead_or_projection_changed';
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
  if v_audit_count <> v_bound_count then
    raise exception using errcode = '23514', message = 'mixed_route_bound_audit_incomplete';
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
    and exists (
      select 1 from private.whatsapp_invalidated_route_raw_audit as audit
      join public.whatsapp_webhook_routing_snapshots as route
        on route.organization_id = audit.organization_id
       and route.session_id = audit.session_id
       and route.provider_message_id = audit.provider_message_id
      where audit.inbox_id = inbox.id
        and audit.quarantined_at = v_at
        and route.target_mode = 'snapshot'
    );
  get diagnostics v_update_count = row_count;
  if v_update_count <> v_bound_count then
    raise exception using errcode = '40001', message = 'mixed_route_bound_terminal_count_mismatch';
  end if;

  v_barrier_result := private.barrier_invalidated_whatsapp_v1_forwarded_album_route(
    p_root_inbox_id, p_expected_active_count - p_expected_bound_count,
    p_expected_cutoff
  );
  if (v_barrier_result ->> 'active_rows_quarantined')::integer
       is distinct from p_expected_active_count - p_expected_bound_count then
    raise exception using errcode = '23514', message = 'mixed_route_inherited_barrier_mismatch';
  end if;
  return pg_catalog.jsonb_build_object(
    'root_inbox_id', p_root_inbox_id,
    'active_rows_quarantined', p_expected_active_count,
    'bound_rows_quarantined', p_expected_bound_count,
    'inherit_rows_quarantined', p_expected_active_count - p_expected_bound_count,
    'dead_rows_preserved', p_expected_dead_count,
    'cutoff_ingress_sequence', p_expected_cutoff,
    'raw_rows_audited', v_audit_count +
      (v_barrier_result ->> 'raw_rows_audited')::integer
  );
end;
$function$;
revoke all on function private.barrier_invalidated_whatsapp_v1_mixed_route(
  uuid,integer,integer,integer,bigint) from public, anon, authenticated, service_role;
comment on function private.barrier_invalidated_whatsapp_v1_mixed_route(
  uuid,integer,integer,integer,bigint) is
  'Operator-only exact forwarded-album route quarantine. Preserves bound and inherited raw inbox records privately, then establishes a barrier without routing outcomes or visible messages.';

commit;

