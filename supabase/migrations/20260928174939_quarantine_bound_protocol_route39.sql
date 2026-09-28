-- Exact one-route wrapper: quarantine seven historical protocol controls,
-- then let the installed barrier validate and quarantine the 32 inherited
-- descendants. Every write is in one transaction; failure rolls all back.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

create or replace function private.barrier_invalidated_whatsapp_v1_protocol_route39(
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
       '61a3acc1-df91-4a95-8012-6e07a0eab6b5'::uuid
     or p_expected_active_count is distinct from 39
     or p_expected_bound_count is distinct from 7
     or p_expected_dead_count is distinct from 1
     or p_expected_cutoff is distinct from 88543 then
    raise exception using errcode = '22023',
      message = 'protocol_route39_expected_values_invalid';
  end if;
  select inbox.* into v_hint
  from public.whatsapp_webhook_inbox as inbox
  where inbox.id = p_root_inbox_id;
  if not found then
    raise exception using errcode = '23503', message = 'protocol_route39_root_missing';
  end if;
  v_routing_key := v_hint.payload #>> '{__vimob_ingress,routing_key}';
  if pg_catalog.btrim(coalesce(v_routing_key,'')) = ''
     or v_routing_key = '__session__' then
    raise exception using errcode = '23514', message = 'protocol_route39_key_invalid';
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
     or private.v1_opaque_lead_control_subtype(v_root.payload)
          is distinct from 'albumMessage'
     or private.canonical_jsonb_sha256(v_root.payload) is distinct from
       '00963e60dda3c6b647f2702fa88660d4b6f0761d15f0d427facc1376ba544dda' then
    raise exception using errcode = '23514', message = 'protocol_route39_root_changed';
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
    raise exception using errcode = '40001', message = 'protocol_route39_preflight_drifted';
  end if;
  perform route.provider_message_id
  from public.whatsapp_webhook_routing_snapshots as route
  where route.organization_id = v_root.organization_id
    and route.session_id = v_root.session_id
    and route.routing_key = v_routing_key
    and route.ingress_sequence <= v_cutoff
  order by route.ingress_sequence
  for key share of route;

  -- Only the seven exact original, inbound protocol controls may leave the
  -- active queue here. The installed barrier rechecks all remaining rows.
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
        ('2d1c9392-1adb-40a8-96f9-afa23918fdde'::uuid,
         '1b4c797712b87901987294cf1a8fe342e283d95469ade689d8077265ad14a164'::text),
        ('5130d51b-987e-49f2-841b-664326b5fa72'::uuid,
         '76d85baa9b85b4adfd803c42b203dd1f82983530470626d3b0f09bc61f6b92b3'::text),
        ('c9b911b5-ec58-4359-88be-82647f006d98'::uuid,
         '107ea2609d28017baaee2fd48970aa358df9fff035ccd7c4e679f8456b75fc6c'::text),
        ('df78771b-7a23-474f-b3e7-09dcae0c5cbd'::uuid,
         'a4ffe249921e80de47dd44a6adda1b89895eed713fcdaeb3456919fae265be8d'::text),
        ('1ed876a1-aa54-459a-a43c-016d14f857ec'::uuid,
         'f44d2cae4adb40bdc3268152d1b6380ac0525851c48f19f1bc9987b067c507c8'::text),
        ('5533d57c-726f-4dc5-8486-6f134561a3da'::uuid,
         '664e9a2e74e84119255535e50656734c4798b7eb25c75de5027cc9e0bdae629e'::text),
        ('2024efe2-8dbc-4328-bca8-2e308357b67a'::uuid,
         'eefce0b0f4ab71681b518ab4385e3fd6f94aecda5d8b565171b6b4446b7fb6dc'::text)
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
    raise exception using errcode = '23514', message = 'protocol_route39_bound_not_exact';
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
    raise exception using errcode = '23514', message = 'protocol_route39_raw_audit_incomplete';
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
    raise exception using errcode = '40001', message = 'protocol_route39_bound_terminal_mismatch';
  end if;

  v_barrier_result := private.barrier_invalidated_whatsapp_v1_route(
    p_root_inbox_id, p_expected_active_count - p_expected_bound_count,
    p_expected_cutoff
  );
  if (v_barrier_result ->> 'active_rows_quarantined')::integer
       is distinct from p_expected_active_count - p_expected_bound_count then
    raise exception using errcode = '23514', message = 'protocol_route39_barrier_mismatch';
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
revoke all on function private.barrier_invalidated_whatsapp_v1_protocol_route39(
  uuid,integer,integer,integer,bigint) from public, anon, authenticated, service_role;
comment on function private.barrier_invalidated_whatsapp_v1_protocol_route39(
  uuid,integer,integer,integer,bigint) is
  'One exact album-root route: seven pinned protocol-control inboxes are privately audited before the installed inherited-chain barrier runs in the same transaction.';

commit;
