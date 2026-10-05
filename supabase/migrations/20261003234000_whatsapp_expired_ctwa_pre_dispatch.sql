-- A post-cutover CTWA first arrival that sat unprocessed for seven days must
-- never create a late card or trigger distribution. This narrow guard does
-- not activate the general nonlead retention policy or touch pre-cutover rows.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

-- The routing snapshot lists parsed messages, not every raw provider field.
-- An older unsplit callback may hide a second message outside that list. Only
-- the proven singleton Evolution Go envelope may be deleted.
create function private.is_isolated_expired_ctwa_direct_payload(
  p_payload jsonb,
  p_provider_message_id text
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_data jsonb;
  v_message jsonb;
begin
  if pg_catalog.jsonb_typeof(p_payload) <> 'object'
     or p_payload ?| array['messages', 'Messages', 'message', 'Message', 'Data']
     or pg_catalog.jsonb_typeof(p_payload->'data') <> 'object' then
    return false;
  end if;
  v_data := p_payload->'data';
  if v_data ?| array['messages', 'Messages', 'Message']
     or pg_catalog.jsonb_typeof(v_data->'message') <> 'object' then
    return false;
  end if;
  v_message := v_data->'message';
  if pg_catalog.jsonb_typeof(v_message->'Info') <> 'object'
     or pg_catalog.jsonb_typeof(v_message->'key') <> 'object'
     or pg_catalog.jsonb_typeof(v_message->'message') <> 'object'
     or v_message #>> '{Info,ID}' is distinct from p_provider_message_id
     or v_message #>> '{key,id}' is distinct from p_provider_message_id
     or v_message #>> '{Info,IsFromMe}' is distinct from 'false'
     or v_message #>> '{key,fromMe}' is distinct from 'false'
     or pg_catalog.lower(coalesce(v_message #>> '{key,remoteJid}', '')) like '%@g.us'
     or pg_catalog.lower(coalesce(v_message #>> '{Info,Chat}', '')) like '%@g.us' then
    return false;
  end if;
  return true;
end;
$$;

alter function private.is_isolated_expired_ctwa_direct_payload(jsonb, text)
  owner to postgres;
revoke all on function private.is_isolated_expired_ctwa_direct_payload(jsonb, text)
  from public, anon, authenticated, service_role;

create or replace function private.complete_expired_ctwa_webhook_route(
  p_inbox_id uuid,
  p_worker_id text,
  p_provider_message_id text,
  p_confirmation_method text
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_session_id uuid;
  v_inbox public.whatsapp_webhook_inbox%rowtype;
  v_first public.whatsapp_webhook_routing_snapshots%rowtype;
  v_routing_epoch text;
  v_cutover_at timestamptz;
  v_deadline timestamptz;
  v_event record;
  v_expired_ids text[] := '{}'::text[];
  v_payload_snapshot_count integer;
  v_old_count integer := 0;
  v_deleted_count integer;
begin
  if p_inbox_id is null or btrim(coalesce(p_worker_id, '')) = ''
     or btrim(coalesce(p_provider_message_id, '')) = ''
     or p_confirmation_method is null
     or p_confirmation_method not in ('entry_point_ctwa_ad', 'evolution_ctwa_clid_v1') then
    raise exception using errcode = '22023', message = 'expired_ctwa_invalid_identity';
  end if;

  select inbox.organization_id, inbox.session_id
  into v_organization_id, v_session_id
  from public.whatsapp_webhook_inbox as inbox
  where inbox.id = p_inbox_id;
  if not found then
    raise exception using errcode = '55000', message = 'expired_ctwa_inbox_missing';
  end if;
  -- Ingress holds this session KEY SHARE until snapshot + ACK commit. Taking
  -- UPDATE here gives the same set of route rows on both API replicas.
  perform 1
  from public.whatsapp_sessions as session
  where session.id = v_session_id
    and session.organization_id = v_organization_id
    and session.provider = 'evolution_go'
  for update of session;
  if not found then
    raise exception using errcode = '55000', message = 'expired_ctwa_session_missing';
  end if;

  select inbox.* into v_inbox
  from public.whatsapp_webhook_inbox as inbox
  where inbox.id = p_inbox_id
    and inbox.organization_id = v_organization_id
    and inbox.session_id = v_session_id
    and inbox.provider = 'evolution_go'
    and inbox.status = 'processing'
    and inbox.locked_by = p_worker_id
  for update of inbox;
  if not found then
    raise exception using errcode = '55000', message = 'expired_ctwa_lease_lost';
  end if;
  v_deadline := v_inbox.created_at + interval '168 hours';
  if v_deadline > clock_timestamp() then
    return 'not_due';
  end if;
  select cutover.routing_epoch::text, cutover.cutoff_at
  into v_routing_epoch, v_cutover_at
  from private.whatsapp_webhook_session_cutovers as cutover
  where cutover.session_id = v_session_id;
  if v_routing_epoch is null or v_inbox.created_at < v_cutover_at
     or v_inbox.payload #>> '{__vimob_ingress,cutover_epoch}' is distinct from v_routing_epoch then
    raise exception using errcode = '55000', message = 'expired_ctwa_cutover_unproven';
  end if;
  if exists (
    select 1 from private.whatsapp_nonlead_retention_sessions as policy
    where policy.organization_id = v_organization_id
      and policy.session_id = v_session_id
      and policy.purge_enabled = true
  ) then
    -- Native retention has its own per-message expiry fence and transaction.
    -- Do not send this row to the isolated preflight's narrower contract.
    return 'delegate_general_policy';
  end if;
  -- A previous attempt may have committed a lead before an Edge timeout.
  -- Only a first claim is provably free of prior dispatch side effects.
  if v_inbox.attempts <> 1 then
    raise exception using errcode = '55000', message = 'expired_ctwa_prior_attempt_unproven';
  end if;

  select snapshot.* into v_first
  from public.whatsapp_webhook_routing_snapshots as snapshot
  where snapshot.organization_id = v_organization_id
    and snapshot.session_id = v_session_id
    and snapshot.provider_message_id = p_provider_message_id
    and snapshot.inbox_event_key = v_inbox.event_key;
  if not found then
    raise exception using errcode = '55000', message = 'expired_ctwa_first_snapshot_missing';
  end if;
  select case
           when pg_catalog.jsonb_typeof(
             v_inbox.payload #> '{__vimob_ingress,routing_snapshot,messages}'
           ) = 'array' then pg_catalog.jsonb_array_length(
             v_inbox.payload #> '{__vimob_ingress,routing_snapshot,messages}'
           )
           else 0
         end
    into v_payload_snapshot_count;
  if v_first.binding_eligible is not true
     or v_first.predecessor_provider_message_id is not null
     or v_first.routing_key = '__session__'
     or left(v_first.routing_key, 6) <> 'epoch:'
     or v_first.processing_lane <> v_inbox.processing_lane
     or v_first.snapshot->>'context_kind' is distinct from 'contextual_intake'
     or coalesce(v_first.snapshot->>'context_proof', '') not in (
       'managed_rule', 'canonical_intake_v1:' || p_confirmation_method
     )
     or nullif(v_first.snapshot->>'current_lead_id', '') is not null
     or nullif(v_first.snapshot->>'event_lead_id', '') is not null
     or nullif(v_first.snapshot->>'active_binding_id', '') is not null
     or nullif(v_first.snapshot->>'conversation_id', '') is not null
     or v_inbox.payload #>> '{__vimob_ingress,routing_key}' is distinct from v_first.routing_key
     or v_inbox.payload #>> '{__vimob_ingress,routing_snapshot,version}' is distinct from '1'
     or v_payload_snapshot_count <> 1
     or v_inbox.payload #> '{__vimob_ingress,routing_snapshot,messages,0}'
          is distinct from v_first.snapshot then
    raise exception using errcode = '55000', message = 'expired_ctwa_first_snapshot_unproven';
  end if;
  if exists (
    select 1 from public.whatsapp_webhook_routing_snapshots as prior
    where prior.organization_id = v_organization_id
      and prior.session_id = v_session_id
      and prior.routing_key = v_first.routing_key
      and prior.ingress_sequence < v_first.ingress_sequence
  ) then
    raise exception using errcode = '55000', message = 'expired_ctwa_not_first_in_route';
  end if;
  if exists (
    select 1 from public.whatsapp_conversation_routing_heads as head
    where head.organization_id = v_organization_id
      and head.session_id = v_session_id
      and head.routing_key = v_first.routing_key
  ) or exists (
    select 1 from private.whatsapp_nonlead_retention_candidate_routes as route
    where route.organization_id = v_organization_id
      and route.session_id = v_session_id
      and route.routing_key = v_first.routing_key
  ) then
    raise exception using errcode = '55000', message = 'expired_ctwa_route_has_crm_effect';
  end if;

  -- A recent successor must keep its own seven-day lifetime. This narrow
  -- migration cannot prove physical retention for it while the session's
  -- general retention policy is off. Leave the entire route untouched until
  -- a scoped retention generation exists for those newer messages.
  if exists (
    select 1
    from public.whatsapp_webhook_routing_snapshots as snapshot
    left join public.whatsapp_webhook_inbox as inbox
      on inbox.organization_id = snapshot.organization_id
     and inbox.session_id = snapshot.session_id
     and inbox.event_key = snapshot.inbox_event_key
    where snapshot.organization_id = v_organization_id
      and snapshot.session_id = v_session_id
      and snapshot.routing_key = v_first.routing_key
      and (inbox.id is null or inbox.created_at > v_deadline)
  ) or exists (
    select 1
    from public.whatsapp_webhook_inbox as inbox
    where inbox.organization_id = v_organization_id
      and inbox.session_id = v_session_id
      and inbox.payload #>> '{__vimob_ingress,routing_key}' = v_first.routing_key
      and (inbox.created_at > v_deadline or not exists (
        select 1 from public.whatsapp_webhook_routing_snapshots as snapshot
        where snapshot.organization_id = inbox.organization_id
          and snapshot.session_id = inbox.session_id
          and snapshot.inbox_event_key = inbox.event_key
          and snapshot.routing_key = v_first.routing_key
      ))
  ) then
    raise exception using errcode = '55000', message = 'expired_ctwa_recent_successor_requires_retention';
  end if;

  -- Delete only this proven, entirely expired route. Uncertain rows abort
  -- before any tombstone or raw inbox deletion.
  for v_event in
    select snapshot.provider_message_id, snapshot.ingress_sequence,
           snapshot.snapshot, snapshot.processing_lane, snapshot.binding_eligible,
           inbox.id as inbox_id, inbox.event_key, inbox.created_at,
           inbox.status, inbox.attempts, inbox.locked_by, inbox.payload
    from public.whatsapp_webhook_routing_snapshots as snapshot
    left join public.whatsapp_webhook_inbox as inbox
      on inbox.organization_id = snapshot.organization_id
     and inbox.session_id = snapshot.session_id
     and inbox.event_key = snapshot.inbox_event_key
    where snapshot.organization_id = v_organization_id
      and snapshot.session_id = v_session_id
      and snapshot.routing_key = v_first.routing_key
    order by snapshot.ingress_sequence
  loop
    if v_event.inbox_id is null then
      raise exception using errcode = '55000', message = 'expired_ctwa_route_missing_inbox_proof';
    end if;
    select case
             when pg_catalog.jsonb_typeof(
               v_event.payload #> '{__vimob_ingress,routing_snapshot,messages}'
             ) = 'array' then pg_catalog.jsonb_array_length(
               v_event.payload #> '{__vimob_ingress,routing_snapshot,messages}'
             )
             else 0
           end
      into v_payload_snapshot_count;
    v_old_count := v_old_count + 1;
    if v_old_count > 256
       or v_event.binding_eligible is not true
       or v_event.processing_lane is null
       or (v_event.inbox_id = p_inbox_id and
           (v_event.status <> 'processing' or v_event.attempts <> 1
            or v_event.locked_by <> p_worker_id))
       or (v_event.inbox_id <> p_inbox_id and
           (v_event.status <> 'pending' or v_event.attempts <> 0))
       or v_event.created_at < v_cutover_at
       or v_event.payload #>> '{__vimob_ingress,cutover_epoch}' is distinct from v_routing_epoch
       or v_event.payload #>> '{__vimob_ingress,routing_key}' is distinct from v_first.routing_key
       or v_event.payload #>> '{__vimob_ingress,routing_snapshot,version}' is distinct from '1'
       or v_payload_snapshot_count <> 1
       or v_event.payload #> '{__vimob_ingress,routing_snapshot,messages,0}'
            is distinct from v_event.snapshot
       or not private.is_isolated_expired_ctwa_direct_payload(
         v_event.payload, v_event.provider_message_id
       )
       or nullif(v_event.snapshot->>'current_lead_id', '') is not null
       or nullif(v_event.snapshot->>'event_lead_id', '') is not null
       or nullif(v_event.snapshot->>'active_binding_id', '') is not null
       or nullif(v_event.snapshot->>'conversation_id', '') is not null
       or exists (
         select 1 from public.whatsapp_messages as message
         where message.organization_id = v_organization_id
           and message.session_id = v_session_id
           and coalesce(nullif(btrim(message.provider_message_id), ''), message.message_id)
             = v_event.provider_message_id
       )
       or exists (
         select 1 from public.whatsapp_webhook_routing_outcomes as outcome
         where outcome.organization_id = v_organization_id
           and outcome.session_id = v_session_id
           and outcome.provider_message_id = v_event.provider_message_id
       ) then
      raise exception using errcode = '55000', message = 'expired_ctwa_route_not_isolated';
    end if;
  end loop;
  if v_old_count < 1 then
    raise exception using errcode = '55000', message = 'expired_ctwa_route_empty';
  end if;

  select coalesce(pg_catalog.array_agg(snapshot.provider_message_id
           order by snapshot.ingress_sequence), '{}'::text[])
    into v_expired_ids
  from public.whatsapp_webhook_routing_snapshots as snapshot
  join public.whatsapp_webhook_inbox as inbox
    on inbox.organization_id = snapshot.organization_id
   and inbox.session_id = snapshot.session_id
   and inbox.event_key = snapshot.inbox_event_key
  where snapshot.organization_id = v_organization_id
    and snapshot.session_id = v_session_id
    and snapshot.routing_key = v_first.routing_key
    and inbox.created_at <= v_deadline;
  if pg_catalog.cardinality(v_expired_ids) <> v_old_count then
    raise exception using errcode = '55000', message = 'expired_ctwa_route_count_changed';
  end if;

  insert into private.whatsapp_nonlead_message_tombstones (
    organization_id, session_id, provider_message_id_hash
  )
  select v_organization_id, v_session_id,
         pg_catalog.encode(extensions.digest(snapshot.provider_message_id, 'sha256'), 'hex')
  from public.whatsapp_webhook_routing_snapshots as snapshot
  join public.whatsapp_webhook_inbox as inbox
    on inbox.organization_id = snapshot.organization_id
   and inbox.session_id = snapshot.session_id
   and inbox.event_key = snapshot.inbox_event_key
  where snapshot.organization_id = v_organization_id
    and snapshot.session_id = v_session_id
    and snapshot.routing_key = v_first.routing_key
    and inbox.created_at <= v_deadline
  on conflict do nothing;

  delete from public.whatsapp_webhook_inbox as inbox
  using public.whatsapp_webhook_routing_snapshots as snapshot
  where snapshot.organization_id = v_organization_id
    and snapshot.session_id = v_session_id
    and snapshot.routing_key = v_first.routing_key
    and snapshot.inbox_event_key = inbox.event_key
    and snapshot.organization_id = inbox.organization_id
    and snapshot.session_id = inbox.session_id
    and inbox.created_at <= v_deadline;
  get diagnostics v_deleted_count = row_count;
  if v_deleted_count <> v_old_count then
    raise exception using errcode = '55000', message = 'expired_ctwa_route_delete_count_mismatch';
  end if;

  -- The entire proven route is expired; a newer successor would have aborted
  -- before this deletion.
  delete from public.whatsapp_webhook_routing_snapshots as snapshot
  where snapshot.organization_id = v_organization_id
    and snapshot.session_id = v_session_id
    and snapshot.routing_key = v_first.routing_key
    and snapshot.provider_message_id = any(v_expired_ids);
  get diagnostics v_deleted_count = row_count;
  if v_deleted_count <> v_old_count then
    raise exception using errcode = '55000', message = 'expired_ctwa_route_snapshot_count_mismatch';
  end if;
  if exists (
    select 1
    from pg_catalog.unnest(v_expired_ids) as expired(provider_message_id)
    where exists (
      select 1 from public.whatsapp_webhook_routing_snapshots as remaining
      where remaining.organization_id = v_organization_id
        and remaining.session_id = v_session_id
        and (remaining.provider_message_id = expired.provider_message_id
          or remaining.predecessor_provider_message_id = expired.provider_message_id
          or pg_catalog.strpos(remaining.snapshot::text, expired.provider_message_id) > 0)
    ) or exists (
      select 1 from public.whatsapp_webhook_inbox as remaining
      where remaining.organization_id = v_organization_id
        and remaining.session_id = v_session_id
        and pg_catalog.strpos(remaining.payload::text, expired.provider_message_id) > 0
    ) or exists (
      select 1 from public.whatsapp_webhook_routing_outcomes as remaining
      where remaining.organization_id = v_organization_id
        and remaining.session_id = v_session_id
        and remaining.provider_message_id = expired.provider_message_id
    )
  ) then
    raise exception using errcode = '55000', message = 'expired_ctwa_raw_provider_id_retained';
  end if;
  return 'completed';
end;
$$;

alter function private.complete_expired_ctwa_webhook_route(uuid, text, text, text)
  owner to postgres;
revoke all on function private.complete_expired_ctwa_webhook_route(uuid, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function private.complete_expired_ctwa_webhook_route(uuid, text, text, text)
  to service_role;

commit;
