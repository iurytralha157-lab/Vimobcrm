-- Follow-up implementation scaffold. The preceding structural migration keeps
-- activation disabled; this migration does not schedule or invoke purge.
-- No existing conversation is backfilled by applying it.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

-- The Go ingress already holds whatsapp_sessions FOR KEY SHARE before calling
-- this function. If a known nonlead contact has reached its deadline, its next
-- snapshot starts a fresh route generation *before* the durable ACK. The old
-- physical conversation remains until the transactional purge succeeds, so
-- aa_guard_whatsapp_nonlead_expired_message makes its worker retry meanwhile.
-- Conversion and purge lock conversation before candidate/route; do the same.
create or replace function private.current_whatsapp_nonlead_routing_key(
  p_organization_id uuid,
  p_session_id uuid,
  p_base_routing_key text
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_route text;
  v_conversation_id uuid;
  v_expires_at timestamptz;
  v_first_inbound_at timestamptz;
  v_next_route text;
  v_now timestamptz;
begin
  if p_organization_id is null or p_session_id is null
     or btrim(coalesce(p_base_routing_key, '')) = '' then
    raise exception using errcode = '22023', message = 'whatsapp_nonlead_route_invalid_identity';
  end if;

  -- A prepared policy is inert until the explicit retention activation.
  -- Preserve an existing route if an operator disables retention later, but
  -- never close or advance a generation while purge_enabled is false.
  if not exists (
    select 1 from private.whatsapp_nonlead_retention_sessions as policy
    where policy.organization_id = p_organization_id
      and policy.session_id = p_session_id
      and policy.purge_enabled = true
  ) then
    select active.routing_key into v_route
    from private.whatsapp_nonlead_retention_route_generations as active
    where active.organization_id = p_organization_id
      and active.session_id = p_session_id
      and active.base_routing_key = p_base_routing_key
      and active.closed_at is null;
    return coalesce(v_route, p_base_routing_key);
  end if;

  -- Find the pending conversation even before its deadline. The deadline may
  -- pass while this call waits for the lock; taking its conversation lock now
  -- preserves the conversation -> route lock order used by purge/conversion.
  -- The due predicate is evaluated again only after both locks are held.
  select coalesce(active.routing_key, p_base_routing_key)
  into v_route
  from (select 1) as seed
  left join private.whatsapp_nonlead_retention_route_generations as active
    on active.organization_id = p_organization_id
   and active.session_id = p_session_id
   and active.base_routing_key = p_base_routing_key
   and active.closed_at is null;

  select candidate.conversation_id into v_conversation_id
  from private.whatsapp_nonlead_retention_candidate_routes as contact_route
  join private.whatsapp_nonlead_retention_candidates as candidate
    on candidate.conversation_id = contact_route.conversation_id
   and candidate.organization_id = contact_route.organization_id
  where contact_route.organization_id = p_organization_id
    and contact_route.session_id = p_session_id
    and contact_route.routing_key = v_route
    and candidate.state = 'pending'
  order by candidate.expires_at, candidate.conversation_id
  limit 1;

  if v_conversation_id is not null then
    perform 1
    from public.whatsapp_conversations as conversation
    where conversation.id = v_conversation_id
      and conversation.organization_id = p_organization_id
      and conversation.session_id = p_session_id
    for no key update of conversation;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_organization_id::text || ':' || p_session_id::text),
    pg_catalog.hashtext(p_base_routing_key)
  );

  select active.routing_key, active.first_inbound_at
  into v_route, v_first_inbound_at
  from private.whatsapp_nonlead_retention_route_generations as active
  where active.organization_id = p_organization_id
    and active.session_id = p_session_id
    and active.base_routing_key = p_base_routing_key
    and active.closed_at is null;
  v_route := coalesce(v_route, p_base_routing_key);

  v_now := clock_timestamp();
  if v_conversation_id is not null then
    select candidate.expires_at into v_expires_at
    from private.whatsapp_nonlead_retention_candidates as candidate
    join private.whatsapp_nonlead_retention_candidate_routes as contact_route
      on contact_route.conversation_id = candidate.conversation_id
     and contact_route.organization_id = candidate.organization_id
    where candidate.conversation_id = v_conversation_id
      and candidate.organization_id = p_organization_id
      and candidate.session_id = p_session_id
      and candidate.state = 'pending'
      and candidate.expires_at <= v_now
      and contact_route.routing_key = v_route;
    if v_expires_at is null then
      return v_route;
    end if;
  else
    -- The first ACK can still be waiting in the inbox after seven days. No
    -- conversation candidate exists yet; close the proven old route anyway
    -- so a genuinely new callback is not queued behind that predecessor.
    if v_first_inbound_at is null
       or v_first_inbound_at + interval '168 hours' > v_now then
      return v_route;
    end if;
    -- If a processor has already produced a message/lead or is in flight,
    -- absence of a candidate is ambiguous. Keep the route rather than
    -- classify a lead's history as disposable.
    if exists (
      select 1
      from public.whatsapp_webhook_routing_snapshots as snapshot
      where snapshot.organization_id = p_organization_id
        and snapshot.session_id = p_session_id
        and snapshot.routing_key = v_route
        and (
          nullif(snapshot.snapshot->>'current_lead_id', '') is not null
          or nullif(snapshot.snapshot->>'event_lead_id', '') is not null
          or exists (
            select 1 from public.whatsapp_webhook_routing_outcomes as outcome
            where outcome.organization_id = snapshot.organization_id
              and outcome.session_id = snapshot.session_id
              and outcome.provider_message_id = snapshot.provider_message_id
              and not exists (
                select 1 from private.whatsapp_nonlead_message_tombstones as tombstone
                where tombstone.organization_id = outcome.organization_id
                  and tombstone.session_id = outcome.session_id
                  and tombstone.provider_message_id_hash =
                    pg_catalog.encode(
                      extensions.digest(outcome.provider_message_id, 'sha256'), 'hex'
                    )
              )
          )
          or exists (
            select 1 from public.whatsapp_messages as message
            where message.organization_id = snapshot.organization_id
              and message.session_id = snapshot.session_id
              and coalesce(nullif(btrim(message.provider_message_id), ''), message.message_id)
                = snapshot.provider_message_id
          )
          or exists (
            select 1 from public.whatsapp_webhook_inbox as inbox
            where inbox.organization_id = snapshot.organization_id
              and inbox.session_id = snapshot.session_id
              and inbox.event_key = snapshot.inbox_event_key
              and inbox.status = 'processing'
          )
        )
    ) then
      return v_route;
    end if;
    v_expires_at := v_first_inbound_at + interval '168 hours';
  end if;

  -- The cutoff is the seven-day deadline, not the later purge time. Events
  -- genuinely received after the deadline belong to the new generation.
  update private.whatsapp_nonlead_retention_route_generations as active
  set closed_at = v_expires_at
  where active.organization_id = p_organization_id
    and active.session_id = p_session_id
    and active.base_routing_key = p_base_routing_key
    and active.routing_key = v_route
    and active.closed_at is null;
  if not found then
    insert into private.whatsapp_nonlead_retention_route_generations (
      organization_id, session_id, base_routing_key, routing_key,
      first_inbound_at, closed_at
    ) values (
      p_organization_id, p_session_id, p_base_routing_key, v_route,
      v_expires_at - interval '168 hours', v_expires_at
    );
  end if;

  v_next_route := 'nonlead:' || pg_catalog.md5(
    p_base_routing_key || ':' || v_now::text || ':' || gen_random_uuid()::text
  );
  insert into private.whatsapp_nonlead_retention_route_generations (
    organization_id, session_id, base_routing_key, routing_key,
    started_at
  ) values (
    p_organization_id, p_session_id, p_base_routing_key, v_next_route,
    v_now
  );
  return v_next_route;
end;
$$;

alter function private.current_whatsapp_nonlead_routing_key(uuid, uuid, text) owner to postgres;
revoke all on function private.current_whatsapp_nonlead_routing_key(uuid, uuid, text)
  from public, anon, authenticated, service_role;

-- An unprocessed first CTWA callback may reach the native worker after its
-- seven-day ACK deadline. It must finish without creating a lead, assigning a
-- broker, notifying, sending, or retaining its raw inbox body for another TTL.
-- This special completion is atomic with native processing. It applies only
-- when no conversation candidate, message or routing outcome was created.
create function private.complete_whatsapp_nonlead_expired_inbox(
  p_inbox_id uuid,
  p_organization_id uuid,
  p_session_id uuid,
  p_provider_message_id text,
  p_worker_id text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_inbox public.whatsapp_webhook_inbox%rowtype;
  v_snapshot public.whatsapp_webhook_routing_snapshots%rowtype;
  v_base_routing_key text;
  v_first_inbound_at timestamptz;
  v_closed_at timestamptz;
  v_snapshot_count bigint;
begin
  if p_inbox_id is null or p_organization_id is null or p_session_id is null
     or btrim(coalesce(p_provider_message_id, '')) = ''
     or btrim(coalesce(p_worker_id, '')) = '' then
    raise exception using errcode = '22023', message = 'whatsapp_nonlead_expired_completion_invalid_identity';
  end if;
  select inbox.* into v_inbox
  from public.whatsapp_webhook_inbox as inbox
  where inbox.id = p_inbox_id
    and inbox.organization_id = p_organization_id
    and inbox.session_id = p_session_id
    and inbox.status = 'processing'
    and inbox.locked_by = p_worker_id
  for update;
  if not found then
    return false;
  end if;
  select snapshot.* into v_snapshot
  from public.whatsapp_webhook_routing_snapshots as snapshot
  where snapshot.organization_id = p_organization_id
    and snapshot.session_id = p_session_id
    and snapshot.provider_message_id = p_provider_message_id
    and snapshot.inbox_event_key = v_inbox.event_key;
  if not found then
    return false;
  end if;
  select count(*) into v_snapshot_count
  from public.whatsapp_webhook_routing_snapshots as snapshot
  where snapshot.organization_id = p_organization_id
    and snapshot.session_id = p_session_id
    and snapshot.inbox_event_key = v_inbox.event_key;
  if v_snapshot_count <> 1
     or v_inbox.payload #>> '{__vimob_ingress,routing_snapshot,version}' <> '1'
     or nullif(v_snapshot.snapshot->>'current_lead_id', '') is not null
     or nullif(v_snapshot.snapshot->>'event_lead_id', '') is not null
     or nullif(v_snapshot.snapshot->>'active_binding_id', '') is not null
     or not exists (
       select 1 from private.whatsapp_nonlead_retention_sessions as policy
       where policy.organization_id = p_organization_id
         and policy.session_id = p_session_id
         and policy.purge_enabled = true
         and v_inbox.created_at >= policy.capture_from
     ) then
    return false;
  end if;
  select generation.base_routing_key, generation.first_inbound_at,
         generation.closed_at
  into v_base_routing_key, v_first_inbound_at, v_closed_at
  from private.whatsapp_nonlead_retention_route_generations as generation
  where generation.organization_id = p_organization_id
    and generation.session_id = p_session_id
    and generation.routing_key = v_snapshot.routing_key;
  if v_base_routing_key is null then
    return false;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_organization_id::text || ':' || p_session_id::text),
    pg_catalog.hashtext(v_base_routing_key)
  );
  -- A concurrent ingress may have advanced this route while we waited.
  select generation.first_inbound_at, generation.closed_at
  into v_first_inbound_at, v_closed_at
  from private.whatsapp_nonlead_retention_route_generations as generation
  where generation.organization_id = p_organization_id
    and generation.session_id = p_session_id
    and generation.routing_key = v_snapshot.routing_key;
  if not found then
    return false;
  end if;
  if v_first_inbound_at is null
     or v_first_inbound_at + interval '168 hours' > clock_timestamp()
     or (v_closed_at is not null and v_inbox.created_at > v_closed_at)
     or exists (
       select 1 from private.whatsapp_nonlead_retention_candidate_routes as route
       where route.organization_id = p_organization_id
         and route.session_id = p_session_id
         and route.routing_key = v_snapshot.routing_key
     )
     or exists (
       select 1 from public.whatsapp_messages as message
       where message.organization_id = p_organization_id
         and message.session_id = p_session_id
         and coalesce(nullif(btrim(message.provider_message_id), ''), message.message_id)
           = p_provider_message_id
     )
     or exists (
       select 1 from public.whatsapp_webhook_routing_outcomes as outcome
       where outcome.organization_id = p_organization_id
         and outcome.session_id = p_session_id
         and outcome.provider_message_id = p_provider_message_id
     ) then
    return false;
  end if;

  insert into private.whatsapp_nonlead_message_tombstones (
    organization_id, session_id, provider_message_id_hash
  ) values (
    p_organization_id, p_session_id,
    pg_catalog.encode(extensions.digest(p_provider_message_id, 'sha256'), 'hex')
  ) on conflict do nothing;
  if v_snapshot.binding_eligible then
    insert into public.whatsapp_webhook_routing_outcomes (
      organization_id, session_id, provider_message_id, ingress_sequence,
      completed_inbox_event_key
    ) values (
      p_organization_id, p_session_id, p_provider_message_id,
      v_snapshot.ingress_sequence, v_inbox.event_key
    );
  end if;
  -- The immutable-snapshot UPDATE guard remains intact. Deletion is safe now
  -- because the provider tombstone and causal completion were committed in
  -- this same transaction, and the event carried exactly one direct message.
  delete from public.whatsapp_webhook_inbox as inbox
  where inbox.id = p_inbox_id
    and inbox.status = 'processing'
    and inbox.locked_by = p_worker_id;
  if not found then
    raise exception using errcode = '55000', message = 'whatsapp_nonlead_expired_completion_lost_lease';
  end if;

  -- The first expired CTWA may be the only event in its generation. Close
  -- that generation now even if no fresh callback has arrived, so its raw
  -- routing snapshot can be retired after the final old event finishes.
  perform private.current_whatsapp_nonlead_routing_key(
    p_organization_id, p_session_id, v_base_routing_key
  );
  select generation.closed_at into v_closed_at
  from private.whatsapp_nonlead_retention_route_generations as generation
  where generation.organization_id = p_organization_id
    and generation.session_id = p_session_id
    and generation.routing_key = v_snapshot.routing_key;

  -- Keep predecessor outcomes while another old inbox event may need them.
  -- Once every provider in this closed, unmaterialized generation has its
  -- hashed tombstone and no raw inbox row remains, remove the snapshots and
  -- their cascading outcomes. An uncertain chain stays intact for review.
  if v_closed_at is not null
     and not exists (
       select 1
       from private.whatsapp_nonlead_retention_candidate_routes as route
       where route.organization_id = p_organization_id
         and route.session_id = p_session_id
         and route.routing_key = v_snapshot.routing_key
     )
     and not exists (
       select 1
       from public.whatsapp_conversation_routing_heads as head
       where head.organization_id = p_organization_id
         and head.session_id = p_session_id
         and head.routing_key = v_snapshot.routing_key
     )
     and not exists (
       select 1
       from public.whatsapp_webhook_routing_snapshots as snapshot
       left join public.whatsapp_webhook_inbox as inbox
         on inbox.organization_id = snapshot.organization_id
        and inbox.session_id = snapshot.session_id
        and inbox.event_key = snapshot.inbox_event_key
       where snapshot.organization_id = p_organization_id
         and snapshot.session_id = p_session_id
         and snapshot.routing_key = v_snapshot.routing_key
         and (
           inbox.id is not null
           or nullif(snapshot.snapshot->>'current_lead_id', '') is not null
           or nullif(snapshot.snapshot->>'event_lead_id', '') is not null
           or nullif(snapshot.snapshot->>'active_binding_id', '') is not null
           or not exists (
             select 1 from private.whatsapp_nonlead_message_tombstones as tombstone
             where tombstone.organization_id = snapshot.organization_id
               and tombstone.session_id = snapshot.session_id
               and tombstone.provider_message_id_hash = pg_catalog.encode(
                 extensions.digest(snapshot.provider_message_id, 'sha256'), 'hex'
               )
           )
           or exists (
             select 1 from public.whatsapp_messages as message
             where message.organization_id = snapshot.organization_id
               and message.session_id = snapshot.session_id
               and coalesce(nullif(btrim(message.provider_message_id), ''), message.message_id)
                 = snapshot.provider_message_id
           )
         )
     ) then
    delete from public.whatsapp_webhook_routing_snapshots as snapshot
    where snapshot.organization_id = p_organization_id
      and snapshot.session_id = p_session_id
      and snapshot.routing_key = v_snapshot.routing_key;
  end if;
  return true;
end;
$$;

alter function private.complete_whatsapp_nonlead_expired_inbox(uuid, uuid, uuid, text, text)
  owner to postgres;
revoke all on function private.complete_whatsapp_nonlead_expired_inbox(uuid, uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function private.complete_whatsapp_nonlead_expired_inbox(uuid, uuid, uuid, text, text)
  to service_role;

-- Only snapshots in the candidate's recorded route generation and seven-day
-- window can be retired. An inbox row may already have been cleaned by normal
-- retention; the immutable snapshot still proves its route/provider identity.
create function private.whatsapp_nonlead_purge_events(p_conversation_id uuid)
returns table (
  provider_message_id text,
  routing_key text,
  ingress_sequence bigint,
  inbox_id uuid,
  inbox_event_key text,
  inbox_created_at timestamptz,
  inbox_status text,
  inbox_event_type text,
  inbox_processing_lane text,
  inbox_snapshot_version text
)
language sql
stable
security definer
set search_path = ''
as $$
  select snapshot.provider_message_id,
         snapshot.routing_key,
         snapshot.ingress_sequence,
         inbox.id,
         snapshot.inbox_event_key,
         inbox.created_at,
         inbox.status,
         inbox.event_type,
         inbox.processing_lane,
         inbox.payload #>> '{__vimob_ingress,routing_snapshot,version}'
  from private.whatsapp_nonlead_retention_candidates as candidate
  join public.whatsapp_webhook_routing_snapshots as snapshot
    on snapshot.organization_id = candidate.organization_id
   and snapshot.session_id = candidate.session_id
  left join public.whatsapp_webhook_inbox as inbox
    on inbox.organization_id = snapshot.organization_id
   and inbox.session_id = snapshot.session_id
   and inbox.event_key = snapshot.inbox_event_key
  where candidate.conversation_id = p_conversation_id
    and (
      exists (
        select 1
        from private.whatsapp_nonlead_retention_candidate_routes as route
        where route.conversation_id = candidate.conversation_id
          and route.organization_id = candidate.organization_id
          and route.session_id = candidate.session_id
          and route.routing_key = snapshot.routing_key
          and snapshot.ingress_sequence >= route.first_ingress_sequence
          and (snapshot.snapshot->>'conversation_id' is null
               or snapshot.snapshot->>'conversation_id' = candidate.conversation_id::text)
          and coalesce(inbox.created_at, snapshot.created_at) >= candidate.first_received_at
          and coalesce(inbox.created_at, snapshot.created_at) < candidate.expires_at
      )
      or (
        snapshot.snapshot->>'conversation_id' = candidate.conversation_id::text
        and coalesce(inbox.created_at, snapshot.created_at) < candidate.expires_at
      )
      -- A recorded outbound echo/reaction can predate the first inbound. Its
      -- exact provider ID, rather than a broad route/time window, proves the
      -- row belongs to this physical conversation.
      or exists (
        select 1 from public.whatsapp_messages as message
        where message.conversation_id = candidate.conversation_id
          and coalesce(nullif(btrim(message.provider_message_id), ''), message.message_id)
            = snapshot.provider_message_id
      )
      or exists (
        select 1 from public.whatsapp_outbox as outbox
        where outbox.conversation_id = candidate.conversation_id
          and outbox.provider_message_id = snapshot.provider_message_id
      )
      or exists (
        select 1 from public.whatsapp_message_reactions as reaction
        where reaction.conversation_id = candidate.conversation_id
          and reaction.provider_reaction_message_id = snapshot.provider_message_id
      )
    );
$$;

alter function private.whatsapp_nonlead_purge_events(uuid) owner to postgres;
revoke all on function private.whatsapp_nonlead_purge_events(uuid)
  from public, anon, authenticated, service_role;

-- Follow the exact LID/PN alias graph for this contact. Keeping only the
-- conversation's remote_jid would leave linked aliases with phone numbers.
-- The purge checks this full graph for lead or other-conversation references
-- before deleting any alias row.
create function private.whatsapp_nonlead_purge_contact_jids(p_conversation_id uuid)
returns table (jid text)
language sql
stable
security definer
set search_path = ''
as $$
  with recursive seeds(jid) as (
    select conversation.remote_jid
    from public.whatsapp_conversations as conversation
    where conversation.id = p_conversation_id
    union
    select message.remote_jid
    from public.whatsapp_messages as message
    where message.conversation_id = p_conversation_id
      and message.remote_jid is not null
    union
    select alias.alias_jid
    from public.whatsapp_conversations as conversation
    join public.whatsapp_contact_identity_aliases as alias
      on alias.organization_id = conversation.organization_id
     and alias.session_id = conversation.session_id
     and nullif(pg_catalog.regexp_replace(coalesce(alias.contact_phone, ''), '[^0-9]', '', 'g'), '')
       = nullif(pg_catalog.regexp_replace(coalesce(conversation.contact_phone, ''), '[^0-9]', '', 'g'), '')
    where conversation.id = p_conversation_id
    union
    select alias.canonical_jid
    from public.whatsapp_conversations as conversation
    join public.whatsapp_contact_identity_aliases as alias
      on alias.organization_id = conversation.organization_id
     and alias.session_id = conversation.session_id
     and nullif(pg_catalog.regexp_replace(coalesce(alias.contact_phone, ''), '[^0-9]', '', 'g'), '')
       = nullif(pg_catalog.regexp_replace(coalesce(conversation.contact_phone, ''), '[^0-9]', '', 'g'), '')
    where conversation.id = p_conversation_id
  ), identities(jid) as (
    select seeds.jid from seeds
    union
    select linked.jid
    from identities as known
    join public.whatsapp_conversations as conversation
      on conversation.id = p_conversation_id
    join public.whatsapp_contact_identity_aliases as alias
      on alias.organization_id = conversation.organization_id
     and alias.session_id = conversation.session_id
     and (alias.alias_jid = known.jid or alias.canonical_jid = known.jid)
    cross join lateral (values (alias.alias_jid), (alias.canonical_jid)) as linked(jid)
  )
  select distinct identities.jid
  from identities
  where nullif(btrim(identities.jid), '') is not null;
$$;

alter function private.whatsapp_nonlead_purge_contact_jids(uuid) owner to postgres;
revoke all on function private.whatsapp_nonlead_purge_contact_jids(uuid)
  from public, anon, authenticated, service_role;

-- A single call is the claim and the physical database purge. Two replicas
-- can attempt the same ID: a transaction-scoped advisory lock chooses one,
-- and the loser returns busy. All checks/deletes happen in one transaction;
-- an exception rolls everything back, including tombstones and route changes.
-- Deliberately private/operator-only and never scheduled by this migration.
create function private.try_purge_whatsapp_nonlead_conversation(
  p_conversation_id uuid
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
  v_first_received_at timestamptz;
  v_expires_at timestamptz;
  v_capture_from timestamptz;
  v_purge_enabled boolean;
  v_state text;
  v_base_routing_key text;
  v_routing_key text;
  v_route record;
  v_next_route text;
  v_purged_at timestamptz;
  v_alias_shared boolean;
begin
  if p_conversation_id is null then
    raise exception using errcode = '22023', message = 'whatsapp_nonlead_purge_conversation_required';
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtext('whatsapp_nonlead_purge'),
    pg_catalog.hashtext(p_conversation_id::text)
  ) then
    return 'busy';
  end if;

  select candidate.organization_id, candidate.session_id
  into v_organization_id, v_session_id
  from private.whatsapp_nonlead_retention_candidates as candidate
  where candidate.conversation_id = p_conversation_id;
  if not found then
    return 'already_absent';
  end if;

  -- Lock ordering shared with conversion and ingress: session, conversation,
  -- route, candidate. Go ingress holds session KEY SHARE while storing the
  -- immutable snapshot; FOR UPDATE waits for those transactions to finish.
  perform 1
  from public.whatsapp_sessions as session
  where session.id = v_session_id
    and session.organization_id = v_organization_id
    and session.provider = 'evolution_go'
  for update of session;
  if not found then
    raise exception using errcode = '55000', message = 'whatsapp_nonlead_purge_session_unproven';
  end if;

  perform 1
  from public.whatsapp_conversations as conversation
  where conversation.id = p_conversation_id
    and conversation.organization_id = v_organization_id
    and conversation.session_id = v_session_id
    and conversation.lead_id is null
    and conversation.deleted_at is null
    and conversation.is_group is not true
  for update of conversation;
  if not found then
    raise exception using errcode = '55000', message = 'whatsapp_nonlead_purge_conversation_changed';
  end if;

  -- A conversation can have several proven contact aliases. Acquire base-key
  -- locks in a deterministic order before locking the candidate row.
  if not exists (
    select 1 from private.whatsapp_nonlead_retention_candidate_routes as route
    where route.conversation_id = p_conversation_id
      and route.organization_id = v_organization_id
      and route.session_id = v_session_id
  ) then
    raise exception using errcode = '55000', message = 'whatsapp_nonlead_purge_route_unproven';
  end if;
  for v_base_routing_key in
    select distinct coalesce(generation.base_routing_key, route.routing_key)
    from private.whatsapp_nonlead_retention_candidate_routes as route
    left join private.whatsapp_nonlead_retention_route_generations as generation
      on generation.organization_id = route.organization_id
     and generation.session_id = route.session_id
     and generation.routing_key = route.routing_key
    where route.conversation_id = p_conversation_id
      and route.organization_id = v_organization_id
      and route.session_id = v_session_id
    order by 1
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext(v_organization_id::text || ':' || v_session_id::text),
      pg_catalog.hashtext(v_base_routing_key)
    );
  end loop;

  select candidate.state, candidate.first_received_at, candidate.expires_at
  into v_state, v_first_received_at, v_expires_at
  from private.whatsapp_nonlead_retention_candidates as candidate
  where candidate.conversation_id = p_conversation_id
    and candidate.organization_id = v_organization_id
    and candidate.session_id = v_session_id
  for update of candidate;
  if not found then
    return 'already_absent';
  end if;
  if v_state = 'converted' then
    return 'converted';
  end if;
  if v_state <> 'pending' or v_expires_at > clock_timestamp() then
    return 'not_due';
  end if;

  select policy.capture_from, policy.purge_enabled
  into v_capture_from, v_purge_enabled
  from private.whatsapp_nonlead_retention_sessions as policy
  where policy.session_id = v_session_id
    and policy.organization_id = v_organization_id;
  if not found or v_purge_enabled is not true
     or v_first_received_at < v_capture_from
     or v_expires_at <> v_first_received_at + interval '168 hours' then
    raise exception using errcode = '55000', message = 'whatsapp_nonlead_purge_policy_not_ready';
  end if;

  -- Never delete any conversation that has acquired a lead, even if a stale
  -- nullable lead_id or an older writer missed the candidate conversion hook.
  if exists (
    select 1 from public.whatsapp_conversation_lead_bindings as binding
    where binding.conversation_id = p_conversation_id
  ) or exists (
    select 1 from public.whatsapp_messages as message
    where message.conversation_id = p_conversation_id
      and message.lead_id is not null
  ) or exists (
    select 1 from public.whatsapp_attendance_entries as attendance
    where attendance.conversation_id = p_conversation_id
  ) or exists (
    select 1 from public.lead_attachments as attachment
    join public.whatsapp_messages as message on message.id = attachment.message_id
    where message.conversation_id = p_conversation_id
  ) or exists (
    select 1 from public.ai_agent_conversations as agent_conversation
    where agent_conversation.conversation_id = p_conversation_id
      and agent_conversation.lead_id is not null
  ) or exists (
    select 1 from public.whatsapp_inbound_logs as inbound_log
    where inbound_log.conversation_id = p_conversation_id
      and inbound_log.lead_id is not null
  ) or exists (
    select 1 from public.automation_event_outbox as event
    where event.conversation_id = p_conversation_id
      and event.lead_id is not null
  ) or exists (
    select 1 from public.automation_executions as execution
    where execution.conversation_id = p_conversation_id
      and execution.lead_id is not null
  ) then
    raise exception using errcode = '55000', message = 'whatsapp_nonlead_purge_lead_history_present';
  end if;

  -- Every current uploader reserves its path. Never collect/delete a
  -- conversation while an HTTP upload has started or has unknown outcome.
  if exists (
    select 1 from private.whatsapp_media_path_operations as operation
    where operation.organization_id = v_organization_id
      and operation.conversation_id = p_conversation_id
  ) or exists (
    select 1 from public.media_jobs as job
    where job.conversation_id = p_conversation_id and job.status = 'processing'
  ) or exists (
    select 1 from public.whatsapp_outbox as outbox
    where outbox.conversation_id = p_conversation_id and outbox.status = 'processing'
  ) or exists (
    select 1 from public.outbox_messages as outbox
    where outbox.conversation_id = p_conversation_id and outbox.status = 'processing'
  ) or exists (
    select 1 from public.ai_jobs as job
    where job.conversation_id = p_conversation_id and job.status = 'processing'
  ) or exists (
    select 1 from public.ai_outbox_messages as outbox
    where outbox.conversation_id = p_conversation_id and outbox.status = 'sending'
  ) or exists (
    select 1 from public.automation_event_outbox as event
    where event.conversation_id = p_conversation_id and event.status = 'processing'
  ) or exists (
    select 1 from public.automation_executions as execution
    where execution.conversation_id = p_conversation_id and execution.status = 'running'
  ) then
    raise exception using errcode = '55000', message = 'whatsapp_nonlead_purge_effect_in_flight';
  end if;

  -- Keep a bounded, proven LID/PN graph. A graph is a unit: deleting only
  -- some links would break identity resolution for a surviving contact.
  if (
    select count(*)
    from private.whatsapp_nonlead_purge_contact_jids(p_conversation_id)
  ) > 100 then
    raise exception using errcode = '55000', message = 'whatsapp_nonlead_purge_alias_graph_ambiguous';
  end if;
  v_alias_shared := exists (
    select 1 from public.whatsapp_contact_identity_aliases as alias
    where alias.organization_id = v_organization_id
      and alias.session_id = v_session_id
      and alias.lead_id is not null
      and (alias.alias_jid in (
        select jid from private.whatsapp_nonlead_purge_contact_jids(p_conversation_id)
      ) or alias.canonical_jid in (
        select jid from private.whatsapp_nonlead_purge_contact_jids(p_conversation_id)
      ))
  ) or exists (
    select 1 from public.whatsapp_conversations as other
    where other.organization_id = v_organization_id
      and other.session_id = v_session_id
      and other.id <> p_conversation_id
      and other.deleted_at is null
      and (
        other.remote_jid in (
          select jid from private.whatsapp_nonlead_purge_contact_jids(p_conversation_id)
        )
        or exists (
          select 1 from public.whatsapp_conversations as target
          where target.id = p_conversation_id
            and nullif(btrim(target.contact_phone), '') is not null
            and pg_catalog.regexp_replace(coalesce(other.contact_phone, ''), '[^0-9]', '', 'g')
              = pg_catalog.regexp_replace(target.contact_phone, '[^0-9]', '', 'g')
        )
      )
  ) or exists (
    select 1 from public.leads as lead
    join public.whatsapp_conversations as target
      on target.id = p_conversation_id
    where lead.organization_id = v_organization_id
      and nullif(btrim(target.contact_phone), '') is not null
      and pg_catalog.regexp_replace(coalesce(lead.phone, ''), '[^0-9]', '', 'g')
        = pg_catalog.regexp_replace(target.contact_phone, '[^0-9]', '', 'g')
  );
  -- Shared aliases belong to the surviving lead/conversation, but their
  -- arbitrary metadata cannot retain a pointer to this expired conversation.
  if v_alias_shared and exists (
    select 1 from public.whatsapp_contact_identity_aliases as alias
    where alias.organization_id = v_organization_id
      and alias.session_id = v_session_id
      and (alias.alias_jid in (
        select jid from private.whatsapp_nonlead_purge_contact_jids(p_conversation_id)
      ) or alias.canonical_jid in (
        select jid from private.whatsapp_nonlead_purge_contact_jids(p_conversation_id)
      ))
      and position(p_conversation_id::text in alias.metadata::text) > 0
  ) then
    raise exception using errcode = '55000', message = 'whatsapp_nonlead_purge_shared_alias_metadata';
  end if;

  if not exists (
    select 1 from public.whatsapp_messages as message
    where message.conversation_id = p_conversation_id
      and message.organization_id = v_organization_id
      and message.from_me = false
      and message.direction = 'inbound'
  ) then
    raise exception using errcode = '55000', message = 'whatsapp_nonlead_purge_first_message_missing';
  end if;
  -- A received message without immutable provider/snapshot proof must not be
  -- silently omitted from the raw-inbox scrub or from replay tombstones.
  if exists (
    select 1 from public.whatsapp_messages as message
    where message.conversation_id = p_conversation_id
      and message.organization_id = v_organization_id
      and message.from_me = false
      and message.direction = 'inbound'
      and not exists (
        select 1 from private.whatsapp_nonlead_purge_events(p_conversation_id) as event
        where event.provider_message_id = coalesce(
          nullif(btrim(message.provider_message_id), ''), message.message_id
        )
      )
  ) then
    raise exception using errcode = '55000', message = 'whatsapp_nonlead_purge_message_proof_missing';
  end if;

  -- A post-deadline event in an old route belongs to the next seven-day
  -- cycle. It must be moved/processed on the new generation, not scrubbed.
  if exists (
    select 1
    from private.whatsapp_nonlead_retention_candidate_routes as route
    join public.whatsapp_webhook_routing_snapshots as snapshot
      on snapshot.organization_id = route.organization_id
     and snapshot.session_id = route.session_id
     and snapshot.routing_key = route.routing_key
     and snapshot.ingress_sequence >= route.first_ingress_sequence
    left join public.whatsapp_webhook_inbox as inbox
      on inbox.organization_id = snapshot.organization_id
     and inbox.session_id = snapshot.session_id
     and inbox.event_key = snapshot.inbox_event_key
    where route.conversation_id = p_conversation_id
      and coalesce(inbox.created_at, snapshot.created_at) >= v_expires_at
  ) then
    raise exception using errcode = '55000', message = 'whatsapp_nonlead_purge_new_event_on_old_route';
  end if;

  -- Every inbox row retired here must be a single isolated message, never a
  -- session-wide batch shared with another contact. Missing inbox is allowed:
  -- normal 24h cleanup may already have removed a processed raw row, leaving
  -- its immutable routing snapshot as the provider proof.
  if exists (
    select 1 from private.whatsapp_nonlead_purge_events(p_conversation_id) as event
    where event.inbox_id is not null
      and (
        event.inbox_status = 'processing'
        -- The provider's event_type is not a fixed literal: a real inbound
        -- message can be MessagesUpsert or ButtonClick. The isolated routing
        -- snapshot and exact provider ID are the durable message proof.
        or event.inbox_snapshot_version is distinct from '1'
        or private.is_frozen_legacy_whatsapp_ingress(
          event.inbox_id, v_organization_id, v_session_id,
          event.inbox_event_key, event.inbox_processing_lane
        )
        or (
          select count(*)
          from public.whatsapp_webhook_routing_snapshots as other_snapshot
          where other_snapshot.organization_id = v_organization_id
            and other_snapshot.session_id = v_session_id
            and other_snapshot.inbox_event_key = event.inbox_event_key
        ) <> 1
      )
  ) or exists (
    select 1
    from private.whatsapp_nonlead_purge_events(p_conversation_id) as event
    join public.whatsapp_messages as other_message
      on other_message.organization_id = v_organization_id
     and other_message.session_id = v_session_id
     and coalesce(nullif(btrim(other_message.provider_message_id), ''), other_message.message_id)
       = event.provider_message_id
    where other_message.conversation_id <> p_conversation_id
  ) then
    raise exception using errcode = '55000', message = 'whatsapp_nonlead_purge_inbox_not_isolated';
  end if;

  if exists (
    select 1 from public.whatsapp_messages as message
    where message.conversation_id = p_conversation_id
      and position('/storage/v1/object/' in coalesce(message.media_url, '')) > 0
      and position('/whatsapp-media/' in coalesce(message.media_url, '')) > 0
      and (
        nullif(btrim(message.media_storage_path), '') is null
        or pg_catalog.right(
          pg_catalog.split_part(pg_catalog.split_part(message.media_url, '?', 1), '#', 1),
          pg_catalog.length('/whatsapp-media/' || message.media_storage_path)
        ) <> '/whatsapp-media/' || message.media_storage_path
      )
  ) or exists (
    select 1 from public.whatsapp_conversations as conversation
    where conversation.id = p_conversation_id
      and position('/storage/v1/object/' in coalesce(conversation.contact_picture, '')) > 0
      and position('/whatsapp-media/' in coalesce(conversation.contact_picture, '')) > 0
  ) then
    raise exception using errcode = '55000', message = 'whatsapp_nonlead_purge_storage_url_path_unproven';
  end if;

  -- A path outside the two fenced inbound namespaces might be a legacy
  -- upload or another lead's object. Stop instead of deleting an unknown
  -- bucket/object or leaving an untracked CRM media copy behind.
  if exists (
    select 1
    from (
      select nullif(btrim(message.media_storage_path), '') as path
      from public.whatsapp_messages as message
      where message.conversation_id = p_conversation_id
      union all
      select nullif(btrim(job.storage_path), '')
      from public.media_jobs as job
      where job.conversation_id = p_conversation_id
      union all
      select nullif(btrim(job.message_key->>'upload_intent_path'), '')
      from public.media_jobs as job
      where job.conversation_id = p_conversation_id
      union all
      select nullif(btrim(job.message_key->>'repair_storage_path'), '')
      from public.media_jobs as job
      where job.conversation_id = p_conversation_id
      union all
      select source.storage_path
      from private.whatsapp_media_repair_source_paths as source
      where source.conversation_id = p_conversation_id
        and source.organization_id = v_organization_id
      union all
      select nullif(btrim(coalesce(
        outbox.payload #>> '{body,mediaStoragePath}',
        outbox.payload->>'mediaStoragePath'
      )), '')
      from public.whatsapp_outbox as outbox
      where outbox.conversation_id = p_conversation_id
    ) as media_path
    where media_path.path is not null
      and not (media_path.path ~ (
        '^orgs/' || v_organization_id::text ||
        '/sessions/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/incoming/[^/]+$'
      ))
      and left(media_path.path, length('orgs/' || v_organization_id::text || '/assets/v2/'))
        <> 'orgs/' || v_organization_id::text || '/assets/v2/'
  ) then
    raise exception using errcode = '55000', message = 'whatsapp_nonlead_purge_media_namespace_unproven';
  end if;

  if exists (
    select 1 from public.outbox_messages as outbox
    where outbox.conversation_id = p_conversation_id
      and nullif(btrim(outbox.media_url), '') is not null
  ) then
    raise exception using errcode = '55000', message = 'whatsapp_nonlead_purge_legacy_media_url_unproven';
  end if;

  v_purged_at := clock_timestamp();
  update private.whatsapp_nonlead_retention_candidates as candidate
  set state = 'purging'
  where candidate.conversation_id = p_conversation_id
    and candidate.state = 'pending';
  if not found then
    raise exception using errcode = '55000', message = 'whatsapp_nonlead_purge_candidate_changed';
  end if;

  -- Object deletion is deliberately out of this database transaction. The
  -- durable outbox survives the conversation's CASCADE and can be retried by
  -- a separate Storage worker after checking every surviving reference.
  insert into private.whatsapp_nonlead_media_delete_outbox (
    organization_id, conversation_id, bucket_id, storage_path
  )
  select v_organization_id, p_conversation_id, 'whatsapp-media', path
  from (
    select nullif(btrim(message.media_storage_path), '') as path
    from public.whatsapp_messages as message
    where message.conversation_id = p_conversation_id
    union
    select nullif(btrim(job.storage_path), '')
    from public.media_jobs as job
    where job.conversation_id = p_conversation_id
    union
    select nullif(btrim(job.message_key->>'upload_intent_path'), '')
    from public.media_jobs as job
    where job.conversation_id = p_conversation_id
    union
    select nullif(btrim(job.message_key->>'repair_storage_path'), '')
    from public.media_jobs as job
    where job.conversation_id = p_conversation_id
    union
    select source.storage_path
    from private.whatsapp_media_repair_source_paths as source
    where source.conversation_id = p_conversation_id
      and source.organization_id = v_organization_id
    union
    select nullif(btrim(coalesce(
      outbox.payload #>> '{body,mediaStoragePath}',
      outbox.payload->>'mediaStoragePath'
    )), '')
    from public.whatsapp_outbox as outbox
    where outbox.conversation_id = p_conversation_id
  ) as media_path
  where path is not null
  on conflict (conversation_id, bucket_id, storage_path) do nothing;

  -- Minimal replay proof only: store SHA-256 of provider IDs, not the ID or
  -- message payload. Include every direct message, outbound echo, reaction,
  -- outbox outcome, and routed-but-not-yet-recorded old event in this cycle.
  insert into private.whatsapp_nonlead_message_tombstones (
    organization_id, session_id, provider_message_id_hash, purged_at
  )
  select v_organization_id, v_session_id,
         pg_catalog.encode(extensions.digest(provider_id, 'sha256'), 'hex'),
         v_purged_at
  from (
    select coalesce(nullif(btrim(message.provider_message_id), ''),
                    nullif(btrim(message.message_id), '')) as provider_id
    from public.whatsapp_messages as message
    where message.conversation_id = p_conversation_id
    union
    select nullif(btrim(reaction.provider_reaction_message_id), '')
    from public.whatsapp_message_reactions as reaction
    where reaction.conversation_id = p_conversation_id
    union
    select nullif(btrim(reaction.target_provider_message_id), '')
    from public.whatsapp_message_reactions as reaction
    where reaction.conversation_id = p_conversation_id
    union
    select nullif(btrim(outbox.provider_message_id), '')
    from public.whatsapp_outbox as outbox
    where outbox.conversation_id = p_conversation_id
    union
    select nullif(btrim(outbox.sent_message_id), '')
    from public.outbox_messages as outbox
    where outbox.conversation_id = p_conversation_id
    union
    select event.provider_message_id
    from private.whatsapp_nonlead_purge_events(p_conversation_id) as event
  ) as ids
  where provider_id is not null
  on conflict (organization_id, session_id, provider_message_id_hash) do nothing;

  -- Close only generations belonging to the expired physical conversation.
  -- Ingress may already have opened the next generation at expires_at; leave
  -- that active route untouched. The session lock excludes fresh ACKs here.
  for v_route in
    select route.routing_key,
           coalesce(generation.base_routing_key, route.routing_key) as base_routing_key,
           generation.first_inbound_at,
           generation.closed_at,
           generation.purged_before
    from private.whatsapp_nonlead_retention_candidate_routes as route
    left join private.whatsapp_nonlead_retention_route_generations as generation
      on generation.organization_id = route.organization_id
     and generation.session_id = route.session_id
     and generation.routing_key = route.routing_key
    where route.conversation_id = p_conversation_id
      and route.organization_id = v_organization_id
      and route.session_id = v_session_id
    order by coalesce(generation.base_routing_key, route.routing_key), route.routing_key
  loop
    v_base_routing_key := v_route.base_routing_key;
    v_routing_key := v_route.routing_key;
    if v_route.purged_before is not null then
      if v_route.purged_before <> v_expires_at then
        raise exception using errcode = '55000', message = 'whatsapp_nonlead_purge_route_cutoff_mismatch';
      end if;
      continue;
    end if;
    if v_route.first_inbound_at is null
       or (v_route.closed_at is not null and v_route.closed_at <> v_expires_at) then
      raise exception using errcode = '55000', message = 'whatsapp_nonlead_purge_route_ack_unproven';
    end if;
    update private.whatsapp_nonlead_retention_route_generations as generation
    set closed_at = v_expires_at,
        purged_before = v_expires_at
    where generation.organization_id = v_organization_id
      and generation.session_id = v_session_id
      and generation.base_routing_key = v_base_routing_key
      and generation.routing_key = v_routing_key
      and generation.purged_before is null;
    if not found then
      raise exception using errcode = '55000', message = 'whatsapp_nonlead_purge_route_ack_unproven';
    end if;
    if not exists (
      select 1 from private.whatsapp_nonlead_retention_route_generations as active
      where active.organization_id = v_organization_id
        and active.session_id = v_session_id
        and active.base_routing_key = v_base_routing_key
        and active.closed_at is null
    ) then
      v_next_route := 'nonlead:' || pg_catalog.md5(
        v_base_routing_key || ':' || v_purged_at::text || ':' || gen_random_uuid()::text
      );
      insert into private.whatsapp_nonlead_retention_route_generations (
        organization_id, session_id, base_routing_key, routing_key, started_at
      ) values (
        v_organization_id, v_session_id, v_base_routing_key,
        v_next_route, v_purged_at
      );
    end if;
  end loop;

  -- Delete only the isolated raw inbox rows after their hashed tombstones
  -- exist. The baseline immutability trigger correctly forbids replacing a
  -- routing snapshot in payload, even with a minimal JSON receipt; deleting
  -- the whole row also satisfies complete CRM-copy removal.
  delete from public.whatsapp_webhook_inbox as inbox
  where inbox.id in (
    select event.inbox_id
    from private.whatsapp_nonlead_purge_events(p_conversation_id) as event
    where event.inbox_id is not null
  );

  -- A tombstone was written first for every provider ID. Removing these
  -- snapshots cascades their outcomes and predecessor pointers inside the
  -- expired generation; the next generation has a different routing key.
  delete from public.whatsapp_webhook_routing_snapshots as snapshot
  where snapshot.organization_id = v_organization_id
    and snapshot.session_id = v_session_id
    and snapshot.provider_message_id in (
      select event.provider_message_id
      from private.whatsapp_nonlead_purge_events(p_conversation_id) as event
    );

  -- Tables with ON DELETE SET NULL must be cleared explicitly or they would
  -- retain message previews/JSON while losing the conversation foreign key.
  delete from public.ai_interaction_logs as interaction
  where interaction.conversation_id = p_conversation_id;
  delete from public.automation_executions as execution
  where execution.conversation_id = p_conversation_id;
  delete from public.automation_event_outbox as event
  where event.conversation_id = p_conversation_id;
  delete from public.whatsapp_inbound_logs as inbound_log
  where inbound_log.conversation_id = p_conversation_id;
  delete from public.whatsapp_contact_identity_aliases as alias
  where alias.organization_id = v_organization_id
    and alias.session_id = v_session_id
    and alias.lead_id is null
    and not v_alias_shared
    and (alias.alias_jid in (
      select jid from private.whatsapp_nonlead_purge_contact_jids(p_conversation_id)
    ) or alias.canonical_jid in (
      select jid from private.whatsapp_nonlead_purge_contact_jids(p_conversation_id)
    ));

  -- CASCADE clears messages, media jobs, AI state/jobs, outboxes, reactions,
  -- labels and bindings. Lead/attendance references were rejected above.
  delete from public.whatsapp_conversations as conversation
  where conversation.id = p_conversation_id
    and conversation.organization_id = v_organization_id
    and conversation.session_id = v_session_id
    and conversation.lead_id is null;
  if not found then
    raise exception using errcode = '55000', message = 'whatsapp_nonlead_purge_final_delete_failed';
  end if;
  return 'purged';
end;
$$;

alter function private.try_purge_whatsapp_nonlead_conversation(uuid) owner to postgres;
revoke all on function private.try_purge_whatsapp_nonlead_conversation(uuid)
  from public, anon, authenticated, service_role;

commit;
