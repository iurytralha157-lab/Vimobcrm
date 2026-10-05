-- Exact, post-expired-CTWA retention scope for newer messages on the same
-- provider route. The older 234000 migration remains fail-closed on recent
-- successors until every gate in this migration and the new API are ready.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

-- This packet is inert until an operator activates one proven session. The
-- heartbeat proves that both expected API replicas are running the cohort GC
-- worker; the inbox trigger then fences older ingress and claim binaries.
create table private.whatsapp_ctwa_cohort_worker_heartbeats (
  worker_id text primary key,
  observed_at timestamptz not null default clock_timestamp(),
  check (worker_id like 'vimob-api-whatsapp-nonlead-ctwa2-%')
);
alter table private.whatsapp_ctwa_cohort_worker_heartbeats owner to postgres;
alter table private.whatsapp_ctwa_cohort_worker_heartbeats enable row level security;
revoke all on private.whatsapp_ctwa_cohort_worker_heartbeats
  from public, anon, authenticated, service_role;

create function private.heartbeat_whatsapp_ctwa_cohort_worker(p_worker_id text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_worker_id is null
     or p_worker_id not like 'vimob-api-whatsapp-nonlead-ctwa2-%'
     or octet_length(p_worker_id) > 128 then
    raise exception using errcode = '22023', message = 'whatsapp_ctwa_worker_identity_invalid';
  end if;
  insert into private.whatsapp_ctwa_cohort_worker_heartbeats (worker_id, observed_at)
  values (p_worker_id, clock_timestamp())
  on conflict (worker_id) do update set observed_at = excluded.observed_at;
end;
$$;
alter function private.heartbeat_whatsapp_ctwa_cohort_worker(text) owner to postgres;
revoke all on function private.heartbeat_whatsapp_ctwa_cohort_worker(text)
  from public, anon, authenticated, service_role;
grant execute on function private.heartbeat_whatsapp_ctwa_cohort_worker(text)
  to service_role;

create table private.whatsapp_ctwa_recent_successor_rollouts (
  session_id uuid primary key references public.whatsapp_sessions(id) on delete cascade,
  organization_id uuid not null,
  activated_at timestamptz not null default clock_timestamp()
);
alter table private.whatsapp_ctwa_recent_successor_rollouts owner to postgres;
alter table private.whatsapp_ctwa_recent_successor_rollouts enable row level security;
revoke all on private.whatsapp_ctwa_recent_successor_rollouts
  from public, anon, authenticated, service_role;

create function private.activate_whatsapp_ctwa_recent_successor_session(p_session_id uuid)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_activated_at timestamptz;
begin
  if p_session_id is null then
    raise exception using errcode = '22023', message = 'whatsapp_ctwa_rollout_session_required';
  end if;
  select session.organization_id into v_organization_id
  from public.whatsapp_sessions as session
  where session.id = p_session_id
    and session.provider = 'evolution_go'
    and coalesce(session.is_active, true) = true
  for update of session;
  if not found then
    raise exception using errcode = '55000', message = 'whatsapp_ctwa_rollout_session_missing';
  end if;
  select rollout.activated_at into v_activated_at
  from private.whatsapp_ctwa_recent_successor_rollouts as rollout
  where rollout.session_id = p_session_id
    and rollout.organization_id = v_organization_id;
  if found then
    return v_activated_at;
  end if;
  if not exists (
    select 1 from private.whatsapp_webhook_session_cutovers as cutover
    where cutover.session_id = p_session_id
      and cutover.cutoff_at <= clock_timestamp()
  ) or exists (
    select 1 from private.whatsapp_nonlead_retention_sessions as policy
    where policy.organization_id = v_organization_id
      and policy.session_id = p_session_id
      and policy.purge_enabled is true
  ) or exists (
    select 1 from public.whatsapp_webhook_inbox as inbox
    where inbox.organization_id = v_organization_id
      and inbox.session_id = p_session_id
      and inbox.status = 'processing'
  ) then
    raise exception using errcode = '55000', message = 'whatsapp_ctwa_rollout_session_not_quiescent';
  end if;
  if (select count(*) from private.whatsapp_ctwa_cohort_worker_heartbeats as heartbeat
      where heartbeat.observed_at >= clock_timestamp() - interval '90 seconds') < 2 then
    raise exception using errcode = '55000', message = 'whatsapp_ctwa_rollout_workers_not_ready';
  end if;
  insert into private.whatsapp_ctwa_recent_successor_rollouts (
    organization_id, session_id, activated_at
  ) values (v_organization_id, p_session_id, clock_timestamp())
  returning activated_at into v_activated_at;
  return v_activated_at;
end;
$$;
alter function private.activate_whatsapp_ctwa_recent_successor_session(uuid)
  owner to postgres;
revoke all on function private.activate_whatsapp_ctwa_recent_successor_session(uuid)
  from public, anon, authenticated, service_role;

create function private.fence_whatsapp_ctwa_recent_successor_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Trigger order is alphabetical. Take the lock here independently of the
  -- older cutover trigger; activation takes UPDATE on the same session row.
  perform 1 from public.whatsapp_sessions as session
  where session.id = new.session_id
    and session.organization_id = new.organization_id
  for key share of session;
  if not found then
    raise exception using errcode = '23503', message = 'whatsapp_ctwa_cohort_session_missing';
  end if;
  if not exists (
    select 1 from private.whatsapp_ctwa_recent_successor_rollouts as rollout
    where rollout.organization_id = new.organization_id
      and rollout.session_id = new.session_id
  ) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if pg_catalog.current_setting('vimob.ctwa_cohort_ingress_v2', true) is distinct from '1' then
      raise exception using errcode = '55000', message = 'whatsapp_ctwa_cohort_ingress_version_required';
    end if;
  elsif new.status = 'processing' and old.status is distinct from 'processing'
        and coalesce(new.locked_by, '') not like
          'vimob-api-evolution-webhook-cutover1-ctwa2-%' then
    raise exception using errcode = '55000', message = 'whatsapp_ctwa_cohort_worker_version_required';
  end if;
  return new;
end;
$$;
alter function private.fence_whatsapp_ctwa_recent_successor_write() owner to postgres;
revoke all on function private.fence_whatsapp_ctwa_recent_successor_write()
  from public, anon, authenticated, service_role;
create trigger fence_whatsapp_ctwa_recent_successor_write
before insert or update of status, attempts on public.whatsapp_webhook_inbox
for each row when (new.provider = 'evolution_go')
execute function private.fence_whatsapp_ctwa_recent_successor_write();

create table private.whatsapp_ctwa_recent_successor_cohorts (
  organization_id uuid not null,
  session_id uuid not null references public.whatsapp_sessions(id) on delete cascade,
  base_routing_key text not null,
  routing_key text not null,
  first_ingress_sequence bigint not null,
  first_received_at timestamptz not null,
  expires_at timestamptz not null,
  expired_parent_hash text not null check (expired_parent_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  settled_at timestamptz,
  purge_next_attempt_at timestamptz not null default clock_timestamp(),
  purge_attempts integer not null default 0 check (purge_attempts >= 0),
  purge_last_error_code text check (purge_last_error_code ~ '^[0-9A-Z]{5}$'),
  primary key (organization_id, session_id, routing_key),
  unique (organization_id, session_id, base_routing_key, first_ingress_sequence),
  check (btrim(base_routing_key) <> '' and octet_length(base_routing_key) <= 256),
  check (btrim(routing_key) <> '' and octet_length(routing_key) <= 256),
  check (expires_at = first_received_at + interval '168 hours')
);
alter table private.whatsapp_ctwa_recent_successor_cohorts owner to postgres;
create index whatsapp_ctwa_recent_successor_cohorts_base_idx
  on private.whatsapp_ctwa_recent_successor_cohorts
    (organization_id, session_id, base_routing_key);
create index whatsapp_ctwa_recent_successor_cohorts_due_idx
  on private.whatsapp_ctwa_recent_successor_cohorts
    (purge_next_attempt_at, expires_at, session_id, routing_key)
  where settled_at is null;
alter table private.whatsapp_ctwa_recent_successor_cohorts enable row level security;
revoke all on private.whatsapp_ctwa_recent_successor_cohorts
  from public, anon, authenticated, service_role;

create function private.defer_whatsapp_ctwa_cohort_purge(
  p_organization_id uuid, p_session_id uuid, p_routing_key text,
  p_error_code text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_organization_id is null or p_session_id is null
     or btrim(coalesce(p_routing_key, '')) = ''
     or p_error_code !~ '^[0-9A-Z]{5}$' then
    raise exception using errcode = '22023',
      message = 'whatsapp_ctwa_cohort_defer_invalid_identity';
  end if;
  update private.whatsapp_ctwa_recent_successor_cohorts as cohort
  set purge_attempts = least(cohort.purge_attempts + 1, 1000000),
      purge_next_attempt_at = clock_timestamp() +
        pg_catalog.make_interval(secs => least(
          900, 5 * pg_catalog.power(2, least(cohort.purge_attempts, 8))::integer
        )),
      purge_last_error_code = p_error_code
  where cohort.organization_id = p_organization_id
    and cohort.session_id = p_session_id
    and cohort.routing_key = p_routing_key
    and cohort.settled_at is null
    and cohort.expires_at <= clock_timestamp();
  return found;
end;
$$;
alter function private.defer_whatsapp_ctwa_cohort_purge(uuid, uuid, text, text)
  owner to postgres;
revoke all on function private.defer_whatsapp_ctwa_cohort_purge(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function private.defer_whatsapp_ctwa_cohort_purge(uuid, uuid, text, text)
  to service_role;

create function private.whatsapp_ctwa_retention_route_active(
  p_organization_id uuid, p_session_id uuid, p_routing_key text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.whatsapp_ctwa_recent_successor_cohorts as cohort
    where cohort.organization_id = p_organization_id
      and cohort.session_id = p_session_id
      and cohort.routing_key = p_routing_key
  );
$$;
alter function private.whatsapp_ctwa_retention_route_active(uuid, uuid, text)
  owner to postgres;
revoke all on function private.whatsapp_ctwa_retention_route_active(uuid, uuid, text)
  from public, anon, authenticated, service_role;

create function private.whatsapp_ctwa_recent_successor_claimable(
  p_organization_id uuid, p_session_id uuid, p_routing_key text
)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select not exists (
    select 1 from private.whatsapp_ctwa_recent_successor_cohorts as cohort
    where cohort.organization_id = p_organization_id
      and cohort.session_id = p_session_id
      and cohort.routing_key = p_routing_key
      and cohort.settled_at is null
      and cohort.expires_at <= clock_timestamp()
  );
$$;
alter function private.whatsapp_ctwa_recent_successor_claimable(uuid, uuid, text)
  owner to postgres;
revoke all on function private.whatsapp_ctwa_recent_successor_claimable(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function private.whatsapp_ctwa_recent_successor_claimable(uuid, uuid, text)
  to service_role;

-- Keep the exact cohort in ingress order across live and backlog lanes.
-- A later event is invisible to claim until an earlier event is processed
-- or has a durable outcome/tombstone after its inbox row was removed.
create function private.whatsapp_ctwa_recent_successor_claimable(
  p_organization_id uuid, p_session_id uuid, p_routing_key text,
  p_inbox_event_key text
)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select private.whatsapp_ctwa_recent_successor_claimable(
    p_organization_id, p_session_id, p_routing_key
  ) and not exists (
    select 1
    from private.whatsapp_ctwa_recent_successor_cohorts as cohort
    where cohort.organization_id = p_organization_id
      and cohort.session_id = p_session_id
      and cohort.routing_key = p_routing_key
      and not exists (
        select 1
        from public.whatsapp_webhook_routing_snapshots as current_snapshot
        where current_snapshot.organization_id = cohort.organization_id
          and current_snapshot.session_id = cohort.session_id
          and current_snapshot.routing_key = cohort.routing_key
          and current_snapshot.inbox_event_key = p_inbox_event_key
          and current_snapshot.ingress_sequence >= cohort.first_ingress_sequence
          and not exists (
            select 1
            from public.whatsapp_webhook_routing_snapshots as prior
            where prior.organization_id = cohort.organization_id
              and prior.session_id = cohort.session_id
              and prior.routing_key = cohort.routing_key
              and prior.ingress_sequence >= cohort.first_ingress_sequence
              and prior.ingress_sequence < current_snapshot.ingress_sequence
              and not (
                exists (
                  select 1 from public.whatsapp_webhook_inbox as prior_inbox
                  where prior_inbox.organization_id = prior.organization_id
                    and prior_inbox.session_id = prior.session_id
                    and prior_inbox.event_key = prior.inbox_event_key
                    and prior_inbox.status = 'processed'
                ) or (
                  not exists (
                    select 1 from public.whatsapp_webhook_inbox as prior_inbox
                    where prior_inbox.organization_id = prior.organization_id
                      and prior_inbox.session_id = prior.session_id
                      and prior_inbox.event_key = prior.inbox_event_key
                  ) and (
                    exists (
                      select 1 from public.whatsapp_webhook_routing_outcomes as outcome
                      where outcome.organization_id = prior.organization_id
                        and outcome.session_id = prior.session_id
                        and outcome.provider_message_id = prior.provider_message_id
                        and outcome.ingress_sequence = prior.ingress_sequence
                    ) or exists (
                      select 1 from private.whatsapp_nonlead_message_tombstones as tombstone
                      where tombstone.organization_id = prior.organization_id
                        and tombstone.session_id = prior.session_id
                        and tombstone.provider_message_id_hash = pg_catalog.encode(
                          extensions.digest(prior.provider_message_id, 'sha256'), 'hex'
                        )
                    )
                  )
                )
              )
          )
      )
  );
$$;
alter function private.whatsapp_ctwa_recent_successor_claimable(uuid, uuid, text, text)
  owner to postgres;
revoke all on function private.whatsapp_ctwa_recent_successor_claimable(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function private.whatsapp_ctwa_recent_successor_claimable(uuid, uuid, text, text)
  to service_role;

create function private.whatsapp_nonlead_retention_candidate_active(
  p_organization_id uuid, p_session_id uuid, p_conversation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.whatsapp_nonlead_retention_sessions as policy
    where policy.organization_id = p_organization_id
      and policy.session_id = p_session_id
      and policy.purge_enabled is true
  ) or exists (
    select 1
    from private.whatsapp_nonlead_retention_candidate_routes as route
    join private.whatsapp_ctwa_recent_successor_cohorts as cohort
      on cohort.organization_id = route.organization_id
     and cohort.session_id = route.session_id
     and cohort.routing_key = route.routing_key
    where route.organization_id = p_organization_id
      and route.session_id = p_session_id
      and route.conversation_id = p_conversation_id
      and route.first_ingress_sequence >= cohort.first_ingress_sequence
  );
$$;
alter function private.whatsapp_nonlead_retention_candidate_active(uuid, uuid, uuid)
  owner to postgres;
revoke all on function private.whatsapp_nonlead_retention_candidate_active(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.whatsapp_nonlead_retention_candidate_active(uuid, uuid, uuid)
  to service_role;

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
  ) and not exists (
    select 1 from private.whatsapp_ctwa_recent_successor_cohorts as cohort
    where cohort.organization_id = p_organization_id
      and cohort.session_id = p_session_id
      and cohort.base_routing_key = p_base_routing_key
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


create or replace function private.record_whatsapp_nonlead_first_ingress(
  p_organization_id uuid,
  p_session_id uuid,
  p_inbox_event_key text,
  p_provider_message_id text,
  p_is_direct_inbound boolean
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_capture_from timestamptz;
  v_received_at timestamptz;
  v_routing_key text;
  v_base_routing_key text;
  v_snapshot jsonb;
  v_cutover_epoch text;
  v_inbox_epoch text;
  v_ingress_sequence bigint;
  v_parent_hash text;
begin
  if p_is_direct_inbound is not true then
    return;
  end if;
  if p_organization_id is null or p_session_id is null
     or btrim(coalesce(p_inbox_event_key, '')) = ''
     or btrim(coalesce(p_provider_message_id, '')) = '' then
    raise exception using errcode = '22023', message = 'whatsapp_nonlead_first_ingress_invalid_identity';
  end if;

  -- A prepared retention policy remains inert before activation. Once the
  -- CTWA cohort rollout is active (or a cohort already exists), keep the
  -- immutable inbox/snapshot proof mandatory for its successor messages.
  if not exists (
    select 1 from private.whatsapp_nonlead_retention_sessions as policy
    where policy.organization_id = p_organization_id
      and policy.session_id = p_session_id
      and policy.purge_enabled is true
  ) and not exists (
    select 1 from private.whatsapp_ctwa_recent_successor_rollouts as rollout
    where rollout.organization_id = p_organization_id
      and rollout.session_id = p_session_id
  ) and not exists (
    select 1 from private.whatsapp_ctwa_recent_successor_cohorts as cohort
    where cohort.organization_id = p_organization_id
      and cohort.session_id = p_session_id
  ) then
    return;
  end if;

  select inbox.created_at,
         inbox.payload #>> '{__vimob_ingress,cutover_epoch}',
         snapshot.routing_key, snapshot.snapshot, snapshot.ingress_sequence
  into v_received_at, v_inbox_epoch, v_routing_key, v_snapshot,
       v_ingress_sequence
  from public.whatsapp_webhook_inbox as inbox
  join public.whatsapp_webhook_routing_snapshots as snapshot
    on snapshot.organization_id = inbox.organization_id
   and snapshot.session_id = inbox.session_id
   and snapshot.inbox_event_key = inbox.event_key
  where inbox.organization_id = p_organization_id
    and inbox.session_id = p_session_id
    and inbox.event_key = p_inbox_event_key
    and snapshot.provider_message_id = p_provider_message_id
    and snapshot.processing_lane = inbox.processing_lane;
  if not found then
    raise exception using errcode = '55000', message = 'whatsapp_nonlead_first_ingress_proof_missing';
  end if;
  if v_routing_key = '__session__' then
    raise exception using errcode = '55000', message = 'whatsapp_nonlead_first_ingress_route_unproven';
  end if;
  select cutover.routing_epoch::text into v_cutover_epoch
  from private.whatsapp_webhook_session_cutovers as cutover
  where cutover.session_id = p_session_id
    and v_received_at >= cutover.cutoff_at;
  if not found or v_cutover_epoch is distinct from v_inbox_epoch then
    raise exception using errcode = '55000', message = 'whatsapp_nonlead_first_ingress_cutover_unproven';
  end if;

  -- Existing lead/binding proof keeps the history. A CTWA intake with no
  -- card yet is intentionally anchored, then either converts or expires.
  if nullif(v_snapshot->>'current_lead_id', '') is not null
     or nullif(v_snapshot->>'event_lead_id', '') is not null
     or nullif(v_snapshot->>'active_binding_id', '') is not null then
    return;
  end if;

  select generation.base_routing_key into v_base_routing_key
  from private.whatsapp_nonlead_retention_route_generations as generation
  where generation.organization_id = p_organization_id
    and generation.session_id = p_session_id
    and generation.routing_key = v_routing_key;
  v_base_routing_key := coalesce(v_base_routing_key, v_routing_key);
  if left(v_base_routing_key, 6) <> 'epoch:' then
    raise exception using errcode = '55000', message = 'whatsapp_nonlead_first_ingress_route_unproven';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_organization_id::text || ':' || p_session_id::text),
    pg_catalog.hashtext(v_base_routing_key)
  );
  select policy.capture_from into v_capture_from
  from private.whatsapp_nonlead_retention_sessions as policy
  where policy.organization_id = p_organization_id
    and policy.session_id = p_session_id
    and policy.purge_enabled = true;
  if not found then
    select cohort.expired_parent_hash into v_parent_hash
    from private.whatsapp_ctwa_recent_successor_cohorts as cohort
    where cohort.organization_id = p_organization_id
      and cohort.session_id = p_session_id
      and cohort.base_routing_key = v_base_routing_key
    order by cohort.first_ingress_sequence
    limit 1;
    if not found then
      return;
    end if;
    insert into private.whatsapp_ctwa_recent_successor_cohorts (
      organization_id, session_id, base_routing_key, routing_key,
      first_ingress_sequence, first_received_at, expires_at,
      expired_parent_hash
    ) values (
      p_organization_id, p_session_id, v_base_routing_key, v_routing_key,
      v_ingress_sequence, v_received_at,
      v_received_at + interval '168 hours', v_parent_hash
    ) on conflict (organization_id, session_id, routing_key) do nothing;
    select cohort.first_received_at into v_capture_from
    from private.whatsapp_ctwa_recent_successor_cohorts as cohort
    where cohort.organization_id = p_organization_id
      and cohort.session_id = p_session_id
      and cohort.routing_key = v_routing_key;
    if v_capture_from is null then
      raise exception using errcode = '55000', message = 'whatsapp_ctwa_cohort_first_ack_missing';
    end if;
  end if;
  if v_received_at < v_capture_from then
    return;
  end if;
  insert into private.whatsapp_nonlead_retention_route_generations (
    organization_id, session_id, base_routing_key, routing_key,
    first_inbound_at
  ) values (
    p_organization_id, p_session_id, v_base_routing_key, v_routing_key,
    v_received_at
  )
  on conflict (organization_id, session_id, routing_key) do update
    set first_inbound_at = least(
      coalesce(private.whatsapp_nonlead_retention_route_generations.first_inbound_at,
               excluded.first_inbound_at),
      excluded.first_inbound_at
    )
  where private.whatsapp_nonlead_retention_route_generations.closed_at is null;
end;
$$;


create or replace function private.whatsapp_nonlead_ingress_route_decision(
  p_organization_id uuid,
  p_session_id uuid,
  p_base_routing_key text,
  p_provider_message_id text,
  p_provider_occurred_at timestamptz
)
returns table (routing_key text, ignored_reason text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_existing public.whatsapp_webhook_routing_snapshots%rowtype;
  v_existing_ack_at timestamptz;
  v_cutoff_at timestamptz;
  v_base_key text;
  v_first_inbound_at timestamptz;
  v_closed_at timestamptz;
  v_latest_closed_at timestamptz;
  v_route text;
  v_reason text;
begin
  if p_organization_id is null or p_session_id is null
     or btrim(coalesce(p_base_routing_key, '')) = ''
     or octet_length(p_base_routing_key) > 256
     or btrim(coalesce(p_provider_message_id, '')) = ''
     or octet_length(p_provider_message_id) > 512 then
    raise exception using errcode = '22023', message = 'whatsapp_nonlead_ingress_route_invalid_identity';
  end if;
  if left(p_base_routing_key, 6) <> 'epoch:' then
    raise exception using errcode = '55000', message = 'whatsapp_nonlead_ingress_route_cutover_required';
  end if;
  v_route := p_base_routing_key;

  if exists (
    select 1 from private.whatsapp_nonlead_message_tombstones as tombstone
    where tombstone.organization_id = p_organization_id
      and tombstone.session_id = p_session_id
      and tombstone.provider_message_id_hash =
        pg_catalog.encode(extensions.digest(p_provider_message_id, 'sha256'), 'hex')
  ) then
    return query select v_route, 'expired_nonlead_replay'::text;
    return;
  end if;

  select cutover.cutoff_at into v_cutoff_at
  from private.whatsapp_webhook_session_cutovers as cutover
  where cutover.session_id = p_session_id;
  if not found then
    raise exception using errcode = '55000', message = 'whatsapp_nonlead_ingress_route_cutover_required';
  end if;

  select snapshot.* into v_existing
  from public.whatsapp_webhook_routing_snapshots as snapshot
  where snapshot.organization_id = p_organization_id
    and snapshot.session_id = p_session_id
    and snapshot.provider_message_id = p_provider_message_id;
  if v_existing.provider_message_id is not null then
    select coalesce(inbox.created_at, v_existing.created_at)
    into v_existing_ack_at
    from (select 1) as seed
    left join public.whatsapp_webhook_inbox as inbox
      on inbox.organization_id = p_organization_id
     and inbox.session_id = p_session_id
     and inbox.event_key = v_existing.inbox_event_key;
  end if;
  if v_existing.provider_message_id is not null
     and v_existing_ack_at < v_cutoff_at then
    return query select v_existing.routing_key, 'pre_cutover_provider_replay'::text;
    return;
  end if;
  -- A provider ID first seen after cutover can still be a delayed callback
  -- from before it. Its provider clock is stronger proof than the new ACK.
  -- Existing post-cutover snapshots keep their immutable route.
  if v_existing.provider_message_id is null
     and p_provider_occurred_at is not null
     and p_provider_occurred_at <= v_cutoff_at then
    return query select v_route, 'pre_cutover_provider_replay'::text;
    return;
  end if;
  if not exists (
    select 1 from private.whatsapp_nonlead_retention_sessions as policy
    where policy.organization_id = p_organization_id
      and policy.session_id = p_session_id
      and policy.purge_enabled = true
  ) and not exists (
    select 1 from private.whatsapp_ctwa_recent_successor_cohorts as cohort
    where cohort.organization_id = p_organization_id
      and cohort.session_id = p_session_id
      and cohort.base_routing_key = p_base_routing_key
  ) then
    return query select coalesce(v_existing.routing_key, v_route), null::text;
    return;
  end if;
  if v_existing.provider_message_id is not null then
    select generation.base_routing_key,
           generation.first_inbound_at,
           generation.closed_at
    into v_base_key, v_first_inbound_at, v_closed_at
    from private.whatsapp_nonlead_retention_route_generations as generation
    where generation.organization_id = p_organization_id
      and generation.session_id = p_session_id
      and generation.routing_key = v_existing.routing_key;
    if v_base_key is not null then
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext(p_organization_id::text || ':' || p_session_id::text),
        pg_catalog.hashtext(v_base_key)
      );
      if v_closed_at is not null then
        if v_existing_ack_at <= v_closed_at then
          return query select v_existing.routing_key, 'expired_nonlead_event'::text;
          return;
        end if;
        raise exception using errcode = '55000', message = 'whatsapp_nonlead_ingress_stale_route_generation';
      end if;
      if v_first_inbound_at is not null
         and v_first_inbound_at + interval '168 hours' <= clock_timestamp()
         and nullif(v_existing.snapshot->>'current_lead_id', '') is null
         and nullif(v_existing.snapshot->>'event_lead_id', '') is null
         and not exists (
           select 1
           from private.whatsapp_nonlead_retention_candidate_routes as route
           join private.whatsapp_nonlead_retention_candidates as candidate
             on candidate.conversation_id = route.conversation_id
           where route.organization_id = p_organization_id
             and route.session_id = p_session_id
             and route.routing_key = v_existing.routing_key
             and candidate.state = 'converted'
         )
         and not exists (
           select 1 from public.whatsapp_messages as message
           where message.organization_id = p_organization_id
             and message.session_id = p_session_id
             and coalesce(nullif(btrim(message.provider_message_id), ''), message.message_id)
               = p_provider_message_id
         )
         and not exists (
           select 1 from public.whatsapp_webhook_routing_outcomes as outcome
           where outcome.organization_id = p_organization_id
             and outcome.session_id = p_session_id
             and outcome.provider_message_id = p_provider_message_id
         ) then
        return query select v_existing.routing_key, 'expired_nonlead_event'::text;
        return;
      end if;
    end if;
    return query select v_existing.routing_key, null::text;
    return;
  end if;

  v_route := private.current_whatsapp_nonlead_routing_key(
    p_organization_id, p_session_id, p_base_routing_key
  );
  select max(generation.closed_at) into v_latest_closed_at
  from private.whatsapp_nonlead_retention_route_generations as generation
  where generation.organization_id = p_organization_id
    and generation.session_id = p_session_id
    and generation.base_routing_key = p_base_routing_key;
  if v_latest_closed_at is not null then
    if p_provider_occurred_at is null then
      -- A real ButtonClick can lack a provider clock. Arrival time does not
      -- prove it belongs to the new generation. Keep a minimal durable ACK
      -- with no CRM effect instead of retrying forever or fabricating proof.
      return query select v_route, 'ambiguous_nonlead_generation'::text;
      return;
    end if;
    if p_provider_occurred_at <= v_latest_closed_at then
      v_reason := 'expired_nonlead_replay';
    end if;
  end if;
  return query select v_route, v_reason;
end;
$$;


create or replace function public.whatsapp_nonlead_event_is_purged(
  p_organization_id uuid,
  p_session_id uuid,
  p_provider_message_id text,
  p_inbox_event_key text default null,
  p_provider_occurred_at timestamptz default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_routing_key text;
  v_snapshot_event_key text;
  v_snapshot_created_at timestamptz;
  v_snapshot jsonb;
  v_first_inbound_at timestamptz;
  v_closed_at timestamptz;
  v_latest_closed_at timestamptz;
  v_base_routing_key text;
  v_candidate_state text;
  v_candidate_expires_at timestamptz;
  v_cutover_at timestamptz;
begin
  if p_organization_id is null or p_session_id is null
     or btrim(coalesce(p_provider_message_id, '')) = '' then
    raise exception using errcode = '22023', message = 'whatsapp_nonlead_retention_invalid_identity';
  end if;

  if exists (
    select 1 from private.whatsapp_nonlead_message_tombstones as tombstone
    where tombstone.organization_id = p_organization_id
      and tombstone.session_id = p_session_id
      and tombstone.provider_message_id_hash =
        pg_catalog.encode(extensions.digest(p_provider_message_id, 'sha256'), 'hex')
  ) then
    return true;
  end if;

  select snapshot.routing_key, snapshot.inbox_event_key,
         coalesce(inbox.created_at, snapshot.created_at), snapshot.snapshot
  into v_routing_key, v_snapshot_event_key,
       v_snapshot_created_at, v_snapshot
  from public.whatsapp_webhook_routing_snapshots as snapshot
  left join public.whatsapp_webhook_inbox as inbox
    on inbox.organization_id = snapshot.organization_id
   and inbox.session_id = snapshot.session_id
   and inbox.event_key = snapshot.inbox_event_key
  where snapshot.organization_id = p_organization_id
    and snapshot.session_id = p_session_id
    and snapshot.provider_message_id = p_provider_message_id;

  if v_routing_key is null then
    if exists (
      select 1
      from private.whatsapp_nonlead_retention_route_generations as generation
      where generation.organization_id = p_organization_id
        and generation.session_id = p_session_id
        and generation.closed_at is not null
    ) then
      raise exception using errcode = '55000', message = 'whatsapp_nonlead_retention_missing_routing_proof';
    end if;
    return false;
  end if;

  if not exists (
    select 1 from private.whatsapp_nonlead_retention_sessions as policy
    where policy.organization_id = p_organization_id
      and policy.session_id = p_session_id
      and policy.purge_enabled = true
  ) and not private.whatsapp_ctwa_retention_route_active(
    p_organization_id, p_session_id, v_routing_key
  ) then
    return false;
  end if;

  if p_inbox_event_key is not null
     and p_inbox_event_key <> v_snapshot_event_key then
    raise exception using errcode = '55000', message = 'whatsapp_nonlead_retention_inbox_mismatch';
  end if;

  select cutover.cutoff_at into v_cutover_at
  from private.whatsapp_webhook_session_cutovers as cutover
  where cutover.session_id = p_session_id;
  if v_cutover_at is not null and v_snapshot_created_at < v_cutover_at then
    return true;
  end if;

  select generation.closed_at, generation.base_routing_key,
         generation.first_inbound_at
  into v_closed_at, v_base_routing_key, v_first_inbound_at
  from private.whatsapp_nonlead_retention_route_generations as generation
  where generation.organization_id = p_organization_id
    and generation.session_id = p_session_id
    and generation.routing_key = v_routing_key;

  if v_base_routing_key is null then
    if nullif(v_snapshot->>'current_lead_id', '') is null
       and nullif(v_snapshot->>'event_lead_id', '') is null
       and v_snapshot->>'context_kind' = 'contextual_intake' then
      raise exception using errcode = '55000', message = 'whatsapp_nonlead_retention_first_ack_missing';
    end if;
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_organization_id::text || ':' || p_session_id::text),
    pg_catalog.hashtext(v_base_routing_key)
  );
  -- Re-read after the route lock: ingress may have closed this generation
  -- while the processor was waiting.
  select generation.closed_at, generation.first_inbound_at
  into v_closed_at, v_first_inbound_at
  from private.whatsapp_nonlead_retention_route_generations as generation
  where generation.organization_id = p_organization_id
    and generation.session_id = p_session_id
    and generation.routing_key = v_routing_key;

  select max(generation.closed_at) into v_latest_closed_at
  from private.whatsapp_nonlead_retention_route_generations as generation
  where generation.organization_id = p_organization_id
    and generation.session_id = p_session_id
    and generation.base_routing_key = v_base_routing_key;

  if v_closed_at is not null then
    if v_snapshot_created_at <= v_closed_at then
      return true;
    end if;
    raise exception using errcode = '55000', message = 'whatsapp_nonlead_retention_stale_route_generation';
  end if;

  if v_latest_closed_at is not null then
    if p_provider_occurred_at is null then
      raise exception using errcode = '55000', message = 'whatsapp_nonlead_retention_provider_time_required';
    end if;
    if p_provider_occurred_at <= v_latest_closed_at then
      return true;
    end if;
  end if;

  select candidate.state, candidate.expires_at
  into v_candidate_state, v_candidate_expires_at
  from private.whatsapp_nonlead_retention_candidate_routes as route
  join private.whatsapp_nonlead_retention_candidates as candidate
    on candidate.conversation_id = route.conversation_id
  where route.organization_id = p_organization_id
    and route.session_id = p_session_id
    and route.routing_key = v_routing_key
  order by candidate.expires_at, candidate.conversation_id
  limit 1;
  if v_candidate_state = 'converted' then
    return false;
  end if;
  if v_candidate_state = 'pending'
     and v_candidate_expires_at <= clock_timestamp() then
    return true;
  end if;
  if v_first_inbound_at is not null
     and v_first_inbound_at + interval '168 hours' <= clock_timestamp()
     and nullif(v_snapshot->>'current_lead_id', '') is null
     and nullif(v_snapshot->>'event_lead_id', '') is null
     and not exists (
       select 1 from public.whatsapp_messages as message
       where message.organization_id = p_organization_id
         and message.session_id = p_session_id
         and coalesce(nullif(btrim(message.provider_message_id), ''), message.message_id)
           = p_provider_message_id
     )
     and not exists (
       select 1 from public.whatsapp_webhook_routing_outcomes as outcome
       where outcome.organization_id = p_organization_id
         and outcome.session_id = p_session_id
         and outcome.provider_message_id = p_provider_message_id
     ) then
    return true;
  end if;
  return false;
end;
$$;


create or replace function private.track_whatsapp_nonlead_first_received()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_capture_from timestamptz;
  v_first_received_at timestamptz;
  v_route_first_inbound_at timestamptz;
  v_routing_key text;
  v_ingress_sequence bigint;
begin
  if new.from_me
     or lower(new.direction) = 'outbound'
     or new.lead_id is not null
     or new.session_id is null then
    return new;
  end if;

  select policy.capture_from
    into v_capture_from
  from private.whatsapp_nonlead_retention_sessions as policy
  where policy.session_id = new.session_id
    and policy.organization_id = new.organization_id
    and policy.purge_enabled = true;

  -- The deadline starts at the durable CRM ingress, not at a delayed worker
  -- INSERT and not at the provider-supplied timestamp.
  select inbox.created_at, snapshot.routing_key, snapshot.ingress_sequence
  into v_first_received_at, v_routing_key, v_ingress_sequence
  from public.whatsapp_webhook_routing_snapshots as snapshot
  join public.whatsapp_webhook_inbox as inbox
    on inbox.organization_id = snapshot.organization_id
   and inbox.session_id = snapshot.session_id
   and inbox.event_key = snapshot.inbox_event_key
  where snapshot.organization_id = new.organization_id
    and snapshot.session_id = new.session_id
    and snapshot.provider_message_id = coalesce(nullif(btrim(new.provider_message_id), ''), new.message_id);

  if v_first_received_at is null then
    if v_capture_from is null then
      return new;
    end if;
    raise exception using errcode = '55000', message = 'whatsapp_nonlead_retention_missing_first_ingress';
  end if;
  if v_capture_from is null then
    select cohort.first_received_at into v_capture_from
    from private.whatsapp_ctwa_recent_successor_cohorts as cohort
    where cohort.organization_id = new.organization_id
      and cohort.session_id = new.session_id
      and cohort.routing_key = v_routing_key
      and v_ingress_sequence >= cohort.first_ingress_sequence;
    if not found then
      return new;
    end if;
  end if;
  -- Older conversations remain outside this exact coorte, as in the general
  -- future-only policy. The first newly recorded message starts the clock.
  perform 1
  from public.whatsapp_conversations as conversation
  where conversation.id = new.conversation_id
    and conversation.organization_id = new.organization_id
    and conversation.session_id = new.session_id
    and conversation.created_at >= v_capture_from;
  if not found then
    return new;
  end if;
  if v_first_received_at < v_capture_from then
    return new;
  end if;
  select generation.first_inbound_at into v_route_first_inbound_at
  from private.whatsapp_nonlead_retention_route_generations as generation
  where generation.organization_id = new.organization_id
    and generation.session_id = new.session_id
    and generation.routing_key = v_routing_key;
  if v_route_first_inbound_at is null then
    raise exception using errcode = '55000', message = 'whatsapp_nonlead_retention_first_ack_missing';
  end if;
  v_first_received_at := least(v_first_received_at, v_route_first_inbound_at);

  -- The same conversation row serializes a new lead binding with this insert.
  -- A recorded pre-lead history is never deleted just because a later binding
  -- temporarily leaves the mutable conversation.lead_id null.
  perform 1
  from public.whatsapp_conversations as conversation
  where conversation.id = new.conversation_id
    and conversation.organization_id = new.organization_id
    and conversation.session_id = new.session_id
    and conversation.created_at >= v_capture_from
    and conversation.lead_id is null
    and conversation.deleted_at is null
    and conversation.is_group is not true
    -- Any lead-binding history is enough to preserve the whole conversation,
    -- including an inactive/stale binding or a card deleted later. An older
    -- writer may have set message.lead_id without creating a binding.
    and not exists (
      select 1
      from public.whatsapp_conversation_lead_bindings as binding
      where binding.organization_id = conversation.organization_id
        and binding.conversation_id = conversation.id
    )
    and not exists (
      select 1
      from public.whatsapp_messages as historical_message
      where historical_message.organization_id = conversation.organization_id
        and historical_message.conversation_id = conversation.id
        and historical_message.lead_id is not null
    )
  -- The message INSERT already holds the parent's FK KEY SHARE lock. NO KEY
  -- UPDATE still serializes lead changes and sibling inserts but is compatible
  -- with another transaction's FK check, avoiding a two-message deadlock.
  for no key update of conversation;

  if not found then
    return new;
  end if;

  insert into private.whatsapp_nonlead_retention_candidates as candidate (
    conversation_id, organization_id, session_id,
    first_received_at, expires_at
  ) values (
    new.conversation_id, new.organization_id, new.session_id,
    v_first_received_at, v_first_received_at + interval '168 hours'
  )
  on conflict (conversation_id) do update
    set first_received_at = excluded.first_received_at,
        expires_at = excluded.expires_at
  where candidate.state = 'pending'
    and excluded.first_received_at < candidate.first_received_at;

  -- Capture every proven contact route used by this physical conversation.
  -- A due conversation cannot be safely purged without at least one route.
  if v_routing_key <> '__session__' then
    insert into private.whatsapp_nonlead_retention_candidate_routes (
      conversation_id, organization_id, session_id,
      routing_key, first_ingress_sequence
    ) values (
      new.conversation_id, new.organization_id, new.session_id,
      v_routing_key, v_ingress_sequence
    )
    on conflict (conversation_id, routing_key) do update
      set first_ingress_sequence = least(
        private.whatsapp_nonlead_retention_candidate_routes.first_ingress_sequence,
        excluded.first_ingress_sequence
      );
  end if;

  return new;
end;
$$;


create or replace function private.whatsapp_nonlead_retention_visible(
  p_organization_id uuid, p_conversation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from private.whatsapp_nonlead_retention_candidates as candidate
    where candidate.organization_id = p_organization_id
      and candidate.conversation_id = p_conversation_id
      and private.whatsapp_nonlead_retention_candidate_active(
        candidate.organization_id, candidate.session_id, candidate.conversation_id
      )
      and candidate.state in ('pending', 'purging')
      and candidate.expires_at <= now()
  );
$$;

create or replace function private.guard_whatsapp_nonlead_expired_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from private.whatsapp_nonlead_retention_candidates as candidate
    where candidate.conversation_id = new.conversation_id
      and candidate.organization_id = new.organization_id
      and private.whatsapp_nonlead_retention_candidate_active(
        candidate.organization_id, candidate.session_id, candidate.conversation_id
      )
      and candidate.state in ('pending', 'purging')
      and (candidate.state = 'purging' or candidate.expires_at <= clock_timestamp())
  ) then
    raise exception using errcode = '55000', message = 'whatsapp_nonlead_retention_deadline_passed';
  end if;
  return new;
end;
$$;

create or replace function private.mark_whatsapp_nonlead_converted(
  p_organization_id uuid, p_conversation_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state text;
  v_expires_at timestamptz;
begin
  if not exists (
    select 1 from private.whatsapp_nonlead_retention_candidates as candidate
    where candidate.organization_id = p_organization_id
      and candidate.conversation_id = p_conversation_id
      and private.whatsapp_nonlead_retention_candidate_active(
        candidate.organization_id, candidate.session_id, candidate.conversation_id
      )
  ) then
    return;
  end if;
  select candidate.state, candidate.expires_at
  into v_state, v_expires_at
  from private.whatsapp_nonlead_retention_candidates as candidate
  where candidate.organization_id = p_organization_id
    and candidate.conversation_id = p_conversation_id
  for update;
  if not found or v_state = 'converted' then
    return;
  end if;
  if v_state = 'purging' or v_expires_at <= clock_timestamp() then
    raise exception using errcode = '55000', message = 'whatsapp_nonlead_retention_deadline_passed';
  end if;
  update private.whatsapp_nonlead_retention_candidates as candidate
  set state = 'converted', converted_at = clock_timestamp()
  where candidate.organization_id = p_organization_id
    and candidate.conversation_id = p_conversation_id;
  update private.whatsapp_ctwa_recent_successor_cohorts as cohort
  set settled_at = clock_timestamp()
  where cohort.organization_id = p_organization_id
    and cohort.settled_at is null
    and exists (
      select 1 from private.whatsapp_nonlead_retention_candidate_routes as route
      where route.organization_id = cohort.organization_id
        and route.session_id = cohort.session_id
        and route.routing_key = cohort.routing_key
        and route.conversation_id = p_conversation_id
        and route.first_ingress_sequence >= cohort.first_ingress_sequence
    );
end;
$$;

create or replace function private.cancel_whatsapp_nonlead_retention_on_binding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from private.whatsapp_nonlead_retention_candidates as candidate
    where candidate.organization_id = new.organization_id
      and candidate.conversation_id = new.conversation_id
      and private.whatsapp_nonlead_retention_candidate_active(
        candidate.organization_id, candidate.session_id, candidate.conversation_id
      )
  ) then
    return new;
  end if;
  -- A stale/closed binding can still be evidence of a lead's history. The
  -- retention policy conservatively keeps it instead of risking deletion.
  perform 1 from public.whatsapp_conversations as conversation
  where conversation.id = new.conversation_id
    and conversation.organization_id = new.organization_id
  for no key update of conversation;
  perform private.mark_whatsapp_nonlead_converted(
    new.organization_id, new.conversation_id
  );
  return new;
end;
$$;

create or replace function private.cancel_whatsapp_nonlead_retention_on_message_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Older writers can attach a card to a message without creating a binding
  -- or changing the conversation row. Preserve the pre-lead history then too.
  if new.lead_id is not null and exists (
    select 1 from private.whatsapp_nonlead_retention_candidates as candidate
    where candidate.organization_id = new.organization_id
      and candidate.session_id = new.session_id
      and candidate.conversation_id = new.conversation_id
      and private.whatsapp_nonlead_retention_candidate_active(
        candidate.organization_id, candidate.session_id, candidate.conversation_id
      )
  ) then
    perform 1 from public.whatsapp_conversations as conversation
    where conversation.id = new.conversation_id
      and conversation.organization_id = new.organization_id
    for no key update of conversation;
    perform private.mark_whatsapp_nonlead_converted(
      new.organization_id, new.conversation_id
    );
  end if;
  -- A newer, independently proven CTWA can create its lead on the very first
  -- message, so it never had a non-lead candidate. The same transaction may
  -- settle only the exact cohort proven by this message's durable snapshot,
  -- routing head and bound conversation; no sibling route is affected.
  if new.lead_id is not null then
    update private.whatsapp_ctwa_recent_successor_cohorts as cohort
    set settled_at = clock_timestamp()
    where cohort.organization_id = new.organization_id
      and cohort.session_id = new.session_id
      and cohort.settled_at is null
      and exists (
        select 1
        from public.whatsapp_webhook_routing_snapshots as snapshot
        join public.whatsapp_webhook_inbox as inbox
          on inbox.organization_id = snapshot.organization_id
         and inbox.session_id = snapshot.session_id
         and inbox.event_key = snapshot.inbox_event_key
        join public.whatsapp_conversation_routing_heads as head
          on head.organization_id = snapshot.organization_id
         and head.session_id = snapshot.session_id
         and head.routing_key = snapshot.routing_key
        join public.whatsapp_conversations as conversation
          on conversation.id = head.conversation_id
         and conversation.organization_id = head.organization_id
         and conversation.session_id = head.session_id
        where snapshot.organization_id = cohort.organization_id
          and snapshot.session_id = cohort.session_id
          and snapshot.routing_key = cohort.routing_key
          and snapshot.ingress_sequence >= cohort.first_ingress_sequence
          and snapshot.provider_message_id =
            coalesce(nullif(btrim(new.provider_message_id), ''), new.message_id)
          and inbox.payload #>> '{__vimob_ingress,routing_key}' = cohort.routing_key
          and head.conversation_id = new.conversation_id
          and conversation.lead_id = new.lead_id
      );
  end if;
  return new;
end;
$$;

-- Function and worker gates are appended only as one reviewed unit. No partial

create table private.whatsapp_expired_ctwa_snapshot_rebases (
  inbox_id uuid primary key,
  transaction_id bigint not null,
  old_snapshot_hash text not null check (old_snapshot_hash ~ '^[0-9a-f]{64}$'),
  new_snapshot_hash text not null check (new_snapshot_hash ~ '^[0-9a-f]{64}$')
);
alter table private.whatsapp_expired_ctwa_snapshot_rebases owner to postgres;
alter table private.whatsapp_expired_ctwa_snapshot_rebases enable row level security;
revoke all on private.whatsapp_expired_ctwa_snapshot_rebases
  from public, anon, authenticated, service_role;

create or replace function private.preserve_whatsapp_webhook_routing_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_hash text;
  v_new_hash text;
  v_message jsonb;
  v_authorized boolean;
begin
  if new.payload #> '{__vimob_ingress,routing_snapshot}'
     is not distinct from old.payload #> '{__vimob_ingress,routing_snapshot}' then
    return new;
  end if;
  v_old_hash := pg_catalog.encode(extensions.digest(
    (old.payload #> '{__vimob_ingress,routing_snapshot}')::text, 'sha256'
  ), 'hex');
  v_new_hash := pg_catalog.encode(extensions.digest(
    (new.payload #> '{__vimob_ingress,routing_snapshot}')::text, 'sha256'
  ), 'hex');
  v_message := new.payload #> '{__vimob_ingress,routing_snapshot,messages,0}';
  if old.status <> 'pending' or old.attempts <> 0
     or new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.session_id is distinct from old.session_id
     or new.event_key is distinct from old.event_key
     or new.status is distinct from old.status
     or new.attempts is distinct from old.attempts
     or pg_catalog.jsonb_typeof(new.payload #> '{__vimob_ingress,routing_snapshot,messages}') <> 'array'
     or pg_catalog.jsonb_array_length(new.payload #> '{__vimob_ingress,routing_snapshot,messages}') <> 1
     or new.payload #- '{__vimob_ingress,routing_snapshot,messages,0}'
        is distinct from old.payload #- '{__vimob_ingress,routing_snapshot,messages,0}'
     or not exists (
       select 1 from public.whatsapp_webhook_routing_snapshots as snapshot
       where snapshot.organization_id = old.organization_id
         and snapshot.session_id = old.session_id
         and snapshot.inbox_event_key = old.event_key
         and snapshot.provider_message_id = v_message->>'provider_message_id'
         and snapshot.snapshot = v_message
     ) then
    raise exception using errcode = '23514', message = 'whatsapp_webhook_routing_snapshot_immutable';
  end if;
  delete from private.whatsapp_expired_ctwa_snapshot_rebases as rebase_auth
  where rebase_auth.inbox_id = old.id
    and rebase_auth.transaction_id = pg_catalog.txid_current()
    and rebase_auth.old_snapshot_hash = v_old_hash
    and rebase_auth.new_snapshot_hash = v_new_hash
  returning true into v_authorized;
  if v_authorized is not true then
    raise exception using errcode = '23514', message = 'whatsapp_webhook_routing_snapshot_immutable';
  end if;
  return new;
end;
$$;
alter function private.preserve_whatsapp_webhook_routing_snapshot() owner to postgres;
revoke all on function private.preserve_whatsapp_webhook_routing_snapshot()
  from public, anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION private.complete_expired_ctwa_webhook_route(p_inbox_id uuid, p_worker_id text, p_provider_message_id text, p_confirmation_method text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_organization_id uuid;
  v_session_id uuid;
  v_inbox public.whatsapp_webhook_inbox%rowtype;
  v_first public.whatsapp_webhook_routing_snapshots%rowtype;
  v_routing_epoch text;
  v_cutover_at timestamptz;
  v_deadline timestamptz;
  v_discard_before timestamptz;
  v_rollout_active boolean;
  v_recent_first_at timestamptz;
  v_recent_first_sequence bigint;
  v_event record;
  v_successor record;
  v_expired_ids text[] := '{}'::text[];
  v_unlinked_ids text[] := '{}'::text[];
  v_new_snapshot jsonb;
  v_new_payload jsonb;
  v_payload_snapshot_count integer;
  v_old_count integer := 0;
  v_successor_count integer := 0;
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
  select exists (
    select 1 from private.whatsapp_ctwa_recent_successor_rollouts as rollout
    where rollout.organization_id = v_organization_id
      and rollout.session_id = v_session_id
  ) into v_rollout_active;
  if v_rollout_active and p_worker_id not like
    'vimob-api-evolution-webhook-cutover1-ctwa2-%' then
    raise exception using errcode = '55000', message = 'expired_ctwa_cohort_worker_version_required';
  end if;
  -- Each inbox row has its own seven-day deadline. Keep the original
  -- fail-closed boundary until explicit per-session activation.
  v_discard_before := case when v_rollout_active
    then clock_timestamp() - interval '168 hours' else v_deadline end;
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
  if exists (
    select 1 from private.whatsapp_nonlead_retention_route_generations as generation
    where generation.organization_id = v_organization_id
      and generation.session_id = v_session_id
      and generation.routing_key = v_first.routing_key
  ) or exists (
    select 1 from private.whatsapp_ctwa_recent_successor_cohorts as cohort
    where cohort.organization_id = v_organization_id
      and cohort.session_id = v_session_id
      and cohort.routing_key = v_first.routing_key
  ) then
    raise exception using errcode = '55000', message = 'expired_ctwa_route_retention_state_present';
  end if;

  -- The snapshot ledger must cover every inbox row on this route. A mixed or
  -- unproved callback cannot be rewritten, deleted, or bypassed by FIFO.
  if exists (
    select 1 from public.whatsapp_webhook_inbox as inbox
    where inbox.organization_id = v_organization_id
      and inbox.session_id = v_session_id
      and inbox.payload #>> '{__vimob_ingress,routing_key}' = v_first.routing_key
      and not exists (
        select 1 from public.whatsapp_webhook_routing_snapshots as snapshot
        where snapshot.organization_id = inbox.organization_id
          and snapshot.session_id = inbox.session_id
          and snapshot.inbox_event_key = inbox.event_key
          and snapshot.routing_key = v_first.routing_key
      )
  ) then
    raise exception using errcode = '55000', message = 'expired_ctwa_route_snapshot_incomplete';
  end if;
  if not v_rollout_active and exists (
    select 1 from public.whatsapp_webhook_routing_snapshots as snapshot
    join public.whatsapp_webhook_inbox as inbox
      on inbox.organization_id = snapshot.organization_id
     and inbox.session_id = snapshot.session_id
     and inbox.event_key = snapshot.inbox_event_key
    where snapshot.organization_id = v_organization_id
      and snapshot.session_id = v_session_id
      and snapshot.routing_key = v_first.routing_key
      and inbox.created_at > v_deadline
  ) then
    raise exception using errcode = '55000', message = 'expired_ctwa_recent_successor_requires_retention';
  end if;

  -- The seven-day generation is every not-yet-applied event on this exact
  -- route whose durable arrival is no later than the first CTWA deadline.
  -- Newer inbox rows are checked and rebased below before any old proof is
  -- removed; uncertain rows abort the entire transaction.
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
    if v_event.created_at > v_discard_before then
      continue;
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
    and inbox.created_at <= v_discard_before;
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
    and inbox.created_at <= v_discard_before
  on conflict do nothing;

  -- Only the first organic successor can inherit the expired ad. Once it is
  -- rebased to an unlinked, non-binding snapshot, later organic successors
  -- which inherited it are rebased in ingress order. A newer independently
  -- confirmed CTWA keeps its own intake proof and starts a fresh binding
  -- chain; no old ad proof is copied into it.
  for v_successor in
    select snapshot.provider_message_id, snapshot.ingress_sequence,
           snapshot.snapshot, snapshot.predecessor_provider_message_id,
           snapshot.processing_lane, snapshot.binding_eligible,
           snapshot.target_mode, inbox.id as inbox_id,
           inbox.event_key, inbox.payload, inbox.status,
           inbox.attempts, inbox.created_at
    from public.whatsapp_webhook_routing_snapshots as snapshot
    join public.whatsapp_webhook_inbox as inbox
      on inbox.organization_id = snapshot.organization_id
     and inbox.session_id = snapshot.session_id
     and inbox.event_key = snapshot.inbox_event_key
    where snapshot.organization_id = v_organization_id
      and snapshot.session_id = v_session_id
      and snapshot.routing_key = v_first.routing_key
      and inbox.created_at > v_discard_before
    order by snapshot.ingress_sequence
  loop
    v_successor_count := v_successor_count + 1;
    if v_successor_count > 256 then
      raise exception using errcode = '55000', message = 'expired_ctwa_successor_limit_exceeded';
    end if;
    v_recent_first_at := least(coalesce(v_recent_first_at, v_successor.created_at),
                               v_successor.created_at);
    v_recent_first_sequence := least(coalesce(v_recent_first_sequence,
                                              v_successor.ingress_sequence),
                                     v_successor.ingress_sequence);
    select case when pg_catalog.jsonb_typeof(
             v_successor.payload #> '{__vimob_ingress,routing_snapshot,messages}'
           ) = 'array' then pg_catalog.jsonb_array_length(
             v_successor.payload #> '{__vimob_ingress,routing_snapshot,messages}'
           ) else 0 end
      into v_payload_snapshot_count;
    if v_successor.status <> 'pending' or v_successor.attempts <> 0
       or v_successor.processing_lane is null
       or v_successor.created_at < v_cutover_at
       or v_successor.payload #>> '{__vimob_ingress,cutover_epoch}' is distinct from v_routing_epoch
       or v_successor.payload #>> '{__vimob_ingress,routing_key}' is distinct from v_first.routing_key
       or v_successor.payload #>> '{__vimob_ingress,routing_snapshot,version}' is distinct from '1'
       or v_payload_snapshot_count <> 1
       or v_successor.payload #> '{__vimob_ingress,routing_snapshot,messages,0}'
            is distinct from v_successor.snapshot
       or not private.is_isolated_expired_ctwa_direct_payload(
         v_successor.payload, v_successor.provider_message_id
       )
       or nullif(v_successor.snapshot->>'current_lead_id', '') is not null
       or nullif(v_successor.snapshot->>'event_lead_id', '') is not null
       or nullif(v_successor.snapshot->>'active_binding_id', '') is not null
       or nullif(v_successor.snapshot->>'conversation_id', '') is not null
       or exists (
         select 1 from public.whatsapp_messages as message
         where message.organization_id = v_organization_id
           and message.session_id = v_session_id
           and coalesce(nullif(btrim(message.provider_message_id), ''), message.message_id)
             = v_successor.provider_message_id
       )
       or exists (
         select 1 from public.whatsapp_webhook_routing_outcomes as outcome
         where outcome.organization_id = v_organization_id
           and outcome.session_id = v_session_id
           and outcome.provider_message_id = v_successor.provider_message_id
       ) then
      raise exception using errcode = '55000', message = 'expired_ctwa_successor_not_isolated';
    end if;

    if v_successor.predecessor_provider_message_id = any(v_expired_ids)
       or v_successor.predecessor_provider_message_id = any(v_unlinked_ids) then
      if v_successor.snapshot->>'context_kind' = 'organic'
         and v_successor.snapshot->>'state' = 'predecessor_inherit'
         and v_successor.target_mode = 'inherit_predecessor'
         and v_successor.binding_eligible = true then
        v_new_snapshot := v_successor.snapshot || pg_catalog.jsonb_build_object(
          'state', 'unlinked', 'target_mode', 'snapshot', 'binding_eligible', false,
          'predecessor_provider_message_id', null,
          'predecessor_inbox_event_key', null,
          'predecessor_processing_lane', null
        );
        v_unlinked_ids := pg_catalog.array_append(v_unlinked_ids,
          v_successor.provider_message_id);
      elsif v_successor.snapshot->>'context_kind' = 'contextual_intake'
            and v_successor.target_mode = 'snapshot'
            and v_successor.binding_eligible = true
            and v_successor.snapshot->>'context_proof' in (
              'canonical_intake_v1:entry_point_ctwa_ad',
              'canonical_intake_v1:evolution_ctwa_clid_v1'
            ) then
        v_new_snapshot := v_successor.snapshot || pg_catalog.jsonb_build_object(
          'predecessor_provider_message_id', null,
          'predecessor_inbox_event_key', null,
          'predecessor_processing_lane', null
        );
      else
        raise exception using errcode = '55000', message = 'expired_ctwa_successor_target_unproven';
      end if;

      update public.whatsapp_webhook_routing_snapshots as snapshot
      set snapshot = v_new_snapshot,
          predecessor_provider_message_id = null,
          binding_eligible = (v_new_snapshot->>'binding_eligible')::boolean,
          target_mode = v_new_snapshot->>'target_mode'
      where snapshot.organization_id = v_organization_id
        and snapshot.session_id = v_session_id
        and snapshot.provider_message_id = v_successor.provider_message_id
        and snapshot.ingress_sequence = v_successor.ingress_sequence
        and snapshot.snapshot = v_successor.snapshot;
      if not found then
        raise exception using errcode = '55000', message = 'expired_ctwa_successor_snapshot_changed';
      end if;
      v_new_payload := pg_catalog.jsonb_set(
        v_successor.payload, '{__vimob_ingress,routing_snapshot,messages,0}',
        v_new_snapshot, false
      );
      insert into private.whatsapp_expired_ctwa_snapshot_rebases (
        inbox_id, transaction_id, old_snapshot_hash, new_snapshot_hash
      ) values (
        v_successor.inbox_id, pg_catalog.txid_current(),
        pg_catalog.encode(extensions.digest(
          (v_successor.payload #> '{__vimob_ingress,routing_snapshot}')::text,
          'sha256'
        ), 'hex'),
        pg_catalog.encode(extensions.digest(
          (v_new_payload #> '{__vimob_ingress,routing_snapshot}')::text,
          'sha256'
        ), 'hex')
      );
      update public.whatsapp_webhook_inbox as inbox
      set payload = v_new_payload
      where inbox.id = v_successor.inbox_id
        and inbox.organization_id = v_organization_id
        and inbox.session_id = v_session_id
        and inbox.status = 'pending'
        and inbox.attempts = 0
        and inbox.payload = v_successor.payload;
      if not found or exists (
        select 1 from private.whatsapp_expired_ctwa_snapshot_rebases as rebase_auth
        where rebase_auth.inbox_id = v_successor.inbox_id
      ) then
        raise exception using errcode = '55000', message = 'expired_ctwa_successor_rebase_not_consumed';
      end if;
    end if;
  end loop;

  if v_successor_count > 0 then
    if not v_rollout_active or v_recent_first_at is null
       or v_recent_first_sequence is null
       or v_recent_first_at + interval '168 hours' <= clock_timestamp() then
      raise exception using errcode = '55000', message = 'expired_ctwa_successor_retention_unproven';
    end if;
    insert into private.whatsapp_ctwa_recent_successor_cohorts (
      organization_id, session_id, base_routing_key, routing_key,
      first_ingress_sequence, first_received_at, expires_at, expired_parent_hash
    ) values (
      v_organization_id, v_session_id, v_first.routing_key, v_first.routing_key,
      v_recent_first_sequence, v_recent_first_at,
      v_recent_first_at + interval '168 hours',
      pg_catalog.encode(extensions.digest(v_first.provider_message_id, 'sha256'), 'hex')
    );
    insert into private.whatsapp_nonlead_retention_route_generations (
      organization_id, session_id, base_routing_key, routing_key, first_inbound_at
    ) values (
      v_organization_id, v_session_id, v_first.routing_key,
      v_first.routing_key, v_recent_first_at
    );
  end if;

  delete from public.whatsapp_webhook_inbox as inbox
  using public.whatsapp_webhook_routing_snapshots as snapshot
  where snapshot.organization_id = v_organization_id
    and snapshot.session_id = v_session_id
    and snapshot.routing_key = v_first.routing_key
    and snapshot.inbox_event_key = inbox.event_key
    and snapshot.organization_id = inbox.organization_id
    and snapshot.session_id = inbox.session_id
    and inbox.created_at <= v_discard_before;
  get diagnostics v_deleted_count = row_count;
  if v_deleted_count <> v_old_count then
    raise exception using errcode = '55000', message = 'expired_ctwa_route_delete_count_mismatch';
  end if;

  -- Retire only the expired generation. The newer snapshots were rebased in
  -- this same transaction and their inbox rows keep their original arrival
  -- times and provider payloads.
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
$function$;
alter function private.complete_expired_ctwa_webhook_route(uuid, text, text, text)
  owner to postgres;
revoke all on function private.complete_expired_ctwa_webhook_route(uuid, text, text, text)
  from public, anon, authenticated, service_role;


create or replace function public.whatsapp_media_path_reserve(
  p_organization_id uuid,
  p_conversation_id uuid,
  p_bucket_id text,
  p_storage_path text,
  p_operation text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_token uuid := gen_random_uuid();
  v_session_id uuid;
  v_incoming_path boolean;
  v_asset_path boolean;
begin
  if p_organization_id is null
     or p_conversation_id is null
     or p_bucket_id is distinct from 'whatsapp-media'
     or p_operation is null
     or p_operation not in ('upload', 'delete')
     or p_storage_path is null
     or left(p_storage_path, length('orgs/' || p_organization_id::text || '/'))
       <> 'orgs/' || p_organization_id::text || '/'
     or octet_length(p_storage_path) not between 43 and 1024
     or position('..' in p_storage_path) > 0
     or position(E'\\' in p_storage_path) > 0 then
    raise exception using errcode = '22023', message = 'whatsapp_media_path_reservation_invalid';
  end if;

  if p_operation = 'delete' then
    return null;
  end if;

  -- The physical conversation must still exist. A candidate already in
  -- purging state, or past its deadline, must not create a new Storage object.
  select conversation.session_id into v_session_id
  from public.whatsapp_conversations as conversation
  where conversation.id = p_conversation_id
    and conversation.organization_id = p_organization_id
    and conversation.deleted_at is null
    and not exists (
      select 1
      from private.whatsapp_nonlead_retention_candidates as candidate
      where candidate.conversation_id = conversation.id
        and candidate.organization_id = conversation.organization_id
        and candidate.session_id = conversation.session_id
        and private.whatsapp_nonlead_retention_candidate_active(
          candidate.organization_id, candidate.session_id, candidate.conversation_id
        )
        and candidate.state in ('pending', 'purging')
        and (candidate.state = 'purging' or candidate.expires_at <= clock_timestamp())
    )
  -- Purge must lock this row before collecting paths, then recheck active
  -- operations. The shared key lock prevents deleting a conversation between
  -- this check and the durable reservation INSERT.
  for key share of conversation;
  if not found then
    return null;
  end if;

  v_incoming_path := left(p_storage_path, length(
    'orgs/' || p_organization_id::text || '/sessions/' || v_session_id::text || '/incoming/'
  )) = 'orgs/' || p_organization_id::text || '/sessions/' || v_session_id::text || '/incoming/';
  v_asset_path := left(p_storage_path, length('orgs/' || p_organization_id::text || '/assets/v2/'))
    = 'orgs/' || p_organization_id::text || '/assets/v2/';
  if not (v_incoming_path or v_asset_path) then
    raise exception using errcode = '22023', message = 'whatsapp_media_path_reservation_namespace_invalid';
  end if;

  -- Reserve paths when the conversation has the general retention policy or
  -- an exact CTWA successor cohort. A content-addressed assets/v2 object may
  -- be shared across sessions, so any active policy or cohort in the
  -- organization requires a real reservation for that namespace. Other
  -- uploads keep the established no-op token accepted by release().
  if (
    v_incoming_path and not private.whatsapp_nonlead_retention_candidate_active(
      p_organization_id, v_session_id, p_conversation_id
    )
  ) or (
    v_asset_path and not exists (
      select 1 from private.whatsapp_nonlead_retention_sessions as policy
      where policy.organization_id = p_organization_id
        and policy.purge_enabled = true
    ) and not exists (
      select 1 from private.whatsapp_ctwa_recent_successor_cohorts as cohort
      where cohort.organization_id = p_organization_id
    )
  ) then
    return '00000000-0000-0000-0000-000000000001'::uuid;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_bucket_id), pg_catalog.hashtext(p_storage_path)
  );

  insert into private.whatsapp_media_path_operations (
    bucket_id, storage_path, organization_id, conversation_id,
    operation, owner_token
  ) values (
    p_bucket_id, p_storage_path, p_organization_id, p_conversation_id,
    p_operation, v_token
  ) on conflict (bucket_id, storage_path) do nothing;
  if not found then
    return null;
  end if;
  return v_token;
end;
$$;

revoke all on function public.whatsapp_media_path_reserve(uuid, uuid, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.whatsapp_media_path_reserve(uuid, uuid, text, text, text)
  to service_role;

create or replace function private.try_purge_whatsapp_nonlead_conversation(
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
  -- The general policy keeps capture_from. A CTWA successor is eligible
  -- only when its candidate route, first durable ACK and deadline agree.
  if v_expires_at <> v_first_received_at + interval '168 hours'
     or not (
       (v_purge_enabled is true and v_capture_from is not null
        and v_first_received_at >= v_capture_from)
       or (
         private.whatsapp_nonlead_retention_candidate_active(
           v_organization_id, v_session_id, p_conversation_id
         )
         and exists (
           select 1
           from private.whatsapp_nonlead_retention_candidate_routes as route
           join private.whatsapp_ctwa_recent_successor_cohorts as cohort
             on cohort.organization_id = route.organization_id
            and cohort.session_id = route.session_id
            and cohort.routing_key = route.routing_key
           where route.conversation_id = p_conversation_id
             and route.organization_id = v_organization_id
             and route.session_id = v_session_id
             and route.first_ingress_sequence >= cohort.first_ingress_sequence
             and cohort.first_received_at = v_first_received_at
             and cohort.expires_at = v_expires_at
         )
       )
     ) then
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

  -- Mark only the exact successor cohort represented by this candidate.
  -- The candidate route is removed with the conversation below, so the
  -- provenance check must happen before that DELETE.
  update private.whatsapp_ctwa_recent_successor_cohorts as cohort
  set settled_at = clock_timestamp()
  where cohort.organization_id = v_organization_id
    and cohort.session_id = v_session_id
    and cohort.settled_at is null
    and exists (
      select 1 from private.whatsapp_nonlead_retention_candidate_routes as route
      where route.organization_id = cohort.organization_id
        and route.session_id = cohort.session_id
        and route.routing_key = cohort.routing_key
        and route.conversation_id = p_conversation_id
        and route.first_ingress_sequence >= cohort.first_ingress_sequence
    );

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

-- A cohort whose first durable arrival is 168 hours old may still consist
-- only of raw, never-dispatched inbox rows. Delete that exact generation in
-- one transaction, retaining only SHA-256 tombstones against provider replay.

create function private.try_purge_whatsapp_ctwa_unmaterialized_cohort(
  p_organization_id uuid,
  p_session_id uuid,
  p_routing_key text,
  p_inbox_id uuid,
  p_worker_id text
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cohort private.whatsapp_ctwa_recent_successor_cohorts%rowtype;
  v_generation private.whatsapp_nonlead_retention_route_generations%rowtype;
  v_epoch text;
  v_cutoff_at timestamptz;
  v_inbox public.whatsapp_webhook_inbox%rowtype;
  v_snapshot public.whatsapp_webhook_routing_snapshots%rowtype;
  v_snapshot_count integer;
  v_payload_count integer;
  v_count integer := 0;
  v_deleted integer;
  v_first_at timestamptz;
  v_first_sequence bigint;
  v_saw_claimed boolean := false;
  v_inbox_ids uuid[] := '{}'::uuid[];
  v_provider_ids text[] := '{}'::text[];
  v_event_keys text[] := '{}'::text[];
  v_provider_event_ids text[] := '{}'::text[];
begin
  if p_organization_id is null or p_session_id is null
     or btrim(coalesce(p_routing_key, '')) = ''
     or octet_length(p_routing_key) > 256
     or (p_inbox_id is null) <> (p_worker_id is null)
     or (p_worker_id is not null and
         p_worker_id not like 'vimob-api-evolution-webhook-cutover1-ctwa2-%') then
    raise exception using errcode = '22023',
      message = 'whatsapp_ctwa_unmaterialized_gc_invalid_identity';
  end if;

  -- The ingress transaction holds a session KEY SHARE through its durable
  -- ACK. UPDATE waits for it and prevents a new arrival during this proof.
  perform 1
  from public.whatsapp_sessions as session
  where session.id = p_session_id
    and session.organization_id = p_organization_id
    and session.provider = 'evolution_go'
  for update of session;
  if not found then
    return 'busy';
  end if;

  select cohort.* into v_cohort
  from private.whatsapp_ctwa_recent_successor_cohorts as cohort
  where cohort.organization_id = p_organization_id
    and cohort.session_id = p_session_id
    and cohort.routing_key = p_routing_key
  for update of cohort;
  if not found or v_cohort.settled_at is not null then
    return 'not_due';
  end if;
  if v_cohort.expires_at > clock_timestamp() then
    return 'not_due';
  end if;
  if not exists (
    select 1 from private.whatsapp_ctwa_recent_successor_rollouts as rollout
    where rollout.organization_id = p_organization_id
      and rollout.session_id = p_session_id
  ) then
    return 'busy';
  end if;
  select cutover.routing_epoch::text, cutover.cutoff_at
  into v_epoch, v_cutoff_at
  from private.whatsapp_webhook_session_cutovers as cutover
  where cutover.session_id = p_session_id;
  if v_epoch is null or v_cutoff_at is null then
    return 'busy';
  end if;

  -- A converted candidate already preserved this exact route before its
  -- deadline. Settle the cohort so it cannot occupy every GC batch forever.
  if exists (
    select 1
    from private.whatsapp_nonlead_retention_candidate_routes as route
    join private.whatsapp_nonlead_retention_candidates as candidate
      on candidate.organization_id = route.organization_id
     and candidate.session_id = route.session_id
     and candidate.conversation_id = route.conversation_id
    where route.organization_id = p_organization_id
      and route.session_id = p_session_id
      and route.routing_key = p_routing_key
      and route.first_ingress_sequence >= v_cohort.first_ingress_sequence
      and candidate.state = 'converted'
      and candidate.converted_at < v_cohort.expires_at
  ) then
    update private.whatsapp_ctwa_recent_successor_cohorts as cohort
    set settled_at = clock_timestamp()
    where cohort.organization_id = p_organization_id
      and cohort.session_id = p_session_id
      and cohort.routing_key = p_routing_key
      and cohort.settled_at is null;
    return 'converted';
  end if;
  -- A first message from an independent newer CTWA can have a lead without
  -- ever creating a non-lead candidate. Require the exact route, head,
  -- conversation and materialized lead-bearing message before settling.
  if exists (
    select 1
    from public.whatsapp_conversation_routing_heads as head
    join public.whatsapp_conversations as conversation
      on conversation.id = head.conversation_id
     and conversation.organization_id = head.organization_id
     and conversation.session_id = head.session_id
     and conversation.lead_id = head.lead_id
    join public.whatsapp_webhook_routing_snapshots as snapshot
      on snapshot.organization_id = head.organization_id
     and snapshot.session_id = head.session_id
     and snapshot.routing_key = head.routing_key
     and snapshot.provider_message_id = head.provider_message_id
     and snapshot.ingress_sequence >= v_cohort.first_ingress_sequence
    join public.whatsapp_messages as message
      on message.organization_id = head.organization_id
     and message.session_id = head.session_id
     and message.conversation_id = head.conversation_id
     and message.lead_id = head.lead_id
     and coalesce(nullif(btrim(message.provider_message_id), ''), message.message_id)
         = snapshot.provider_message_id
     and message.created_at < v_cohort.expires_at
    where head.organization_id = p_organization_id
      and head.session_id = p_session_id
      and head.routing_key = p_routing_key
  ) then
    update private.whatsapp_ctwa_recent_successor_cohorts as cohort
    set settled_at = clock_timestamp()
    where cohort.organization_id = p_organization_id
      and cohort.session_id = p_session_id
      and cohort.routing_key = p_routing_key
      and cohort.settled_at is null;
    return 'converted';
  end if;
  -- Any other materialized conversation or lead remains fail-closed.
  if exists (
    select 1 from private.whatsapp_nonlead_retention_candidate_routes as route
    where route.organization_id = p_organization_id
      and route.session_id = p_session_id
      and route.routing_key = p_routing_key
  ) or exists (
    select 1 from public.whatsapp_conversation_routing_heads as head
    where head.organization_id = p_organization_id
      and head.session_id = p_session_id
      and head.routing_key = p_routing_key
  ) then
    return 'busy';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_organization_id::text || ':' || p_session_id::text),
    pg_catalog.hashtext(v_cohort.base_routing_key)
  );
  select generation.* into v_generation
  from private.whatsapp_nonlead_retention_route_generations as generation
  where generation.organization_id = p_organization_id
    and generation.session_id = p_session_id
    and generation.routing_key = p_routing_key
  for update of generation;
  if not found
     or v_generation.base_routing_key is distinct from v_cohort.base_routing_key
     or v_generation.first_inbound_at is distinct from v_cohort.first_received_at
     or v_generation.purged_before is not null
     or (v_generation.closed_at is not null and
         v_generation.closed_at is distinct from v_cohort.expires_at) then
    return 'busy';
  end if;

  -- Lock every inbox row that either claims this route or is linked to one
  -- of its snapshots. A missing, extra or mixed event fails the whole proof.
  for v_inbox in
    select inbox.*
    from public.whatsapp_webhook_inbox as inbox
    where inbox.organization_id = p_organization_id
      and inbox.session_id = p_session_id
      and (
        inbox.payload #>> '{__vimob_ingress,routing_key}' = p_routing_key
        or exists (
          select 1 from public.whatsapp_webhook_routing_snapshots as snapshot
          where snapshot.organization_id = inbox.organization_id
            and snapshot.session_id = inbox.session_id
            and snapshot.inbox_event_key = inbox.event_key
            and snapshot.routing_key = p_routing_key
        )
      )
    order by inbox.created_at, inbox.id
    for update of inbox
  loop
    v_count := v_count + 1;
    if v_count > 256 then
      return 'busy';
    end if;
    select count(*) into v_snapshot_count
    from public.whatsapp_webhook_routing_snapshots as snapshot
    where snapshot.organization_id = p_organization_id
      and snapshot.session_id = p_session_id
      and snapshot.inbox_event_key = v_inbox.event_key;
    if v_snapshot_count <> 1 then
      return 'busy';
    end if;
    select snapshot.* into v_snapshot
    from public.whatsapp_webhook_routing_snapshots as snapshot
    where snapshot.organization_id = p_organization_id
      and snapshot.session_id = p_session_id
      and snapshot.inbox_event_key = v_inbox.event_key;
    select case
      when pg_catalog.jsonb_typeof(
        v_inbox.payload #> '{__vimob_ingress,routing_snapshot,messages}'
      ) = 'array' then pg_catalog.jsonb_array_length(
        v_inbox.payload #> '{__vimob_ingress,routing_snapshot,messages}'
      ) else 0 end into v_payload_count;

    if v_inbox.provider is distinct from 'evolution_go'
       or v_inbox.created_at < v_cohort.first_received_at
       or v_inbox.created_at > v_cohort.expires_at
       or v_inbox.created_at < v_cutoff_at
       or v_inbox.payload #>> '{__vimob_ingress,cutover_epoch}'
            is distinct from v_epoch
       or v_inbox.payload #>> '{__vimob_ingress,routing_key}'
            is distinct from p_routing_key
       or v_inbox.payload #>> '{__vimob_ingress,routing_snapshot,version}'
            is distinct from '1'
       or v_payload_count <> 1
       or v_inbox.payload #> '{__vimob_ingress,routing_snapshot,messages,0}'
            is distinct from v_snapshot.snapshot
       or not private.is_isolated_expired_ctwa_direct_payload(
         v_inbox.payload, v_snapshot.provider_message_id
       )
       or v_snapshot.routing_key is distinct from p_routing_key
       or v_snapshot.processing_lane is null
       or v_snapshot.processing_lane is distinct from v_inbox.processing_lane
       or v_snapshot.binding_eligible is null
       or v_snapshot.target_mode is null
       or v_snapshot.ingress_sequence < v_cohort.first_ingress_sequence
       or v_snapshot.snapshot->>'provider_message_id'
            is distinct from v_snapshot.provider_message_id
       or coalesce(v_snapshot.snapshot->>'context_kind', '')
            not in ('organic', 'contextual_intake')
       or nullif(v_snapshot.snapshot->>'current_lead_id', '') is not null
       or nullif(v_snapshot.snapshot->>'event_lead_id', '') is not null
       or nullif(v_snapshot.snapshot->>'active_binding_id', '') is not null
       or nullif(v_snapshot.snapshot->>'conversation_id', '') is not null
       or exists (
         select 1 from public.whatsapp_messages as message
         where message.organization_id = p_organization_id
           and message.session_id = p_session_id
           and coalesce(nullif(btrim(message.provider_message_id), ''),
                        message.message_id) = v_snapshot.provider_message_id
       )
       or exists (
         select 1 from public.whatsapp_webhook_routing_outcomes as outcome
         where outcome.organization_id = p_organization_id
           and outcome.session_id = p_session_id
           and (outcome.provider_message_id = v_snapshot.provider_message_id
                or outcome.completed_inbox_event_key = v_inbox.event_key)
       )
       or exists (
         select 1 from private.whatsapp_ctwa_auto_origins as origin
         where origin.organization_id = p_organization_id
           and origin.session_id = p_session_id
           and (origin.provider_message_id = v_snapshot.provider_message_id
                or origin.provider_event_id = v_inbox.event_key)
       )
       or exists (
         select 1 from private.whatsapp_managed_message_proofs as proof
         where proof.organization_id = p_organization_id
           and proof.session_id = p_session_id
           and (proof.provider_message_id = v_snapshot.provider_message_id
                or proof.provider_event_id = v_inbox.event_key)
       )
       or exists (
         select 1 from private.whatsapp_meta_creative_event_ledger as ledger
         where ledger.organization_id = p_organization_id
           and ledger.whatsapp_session_id = p_session_id
           and ledger.provider_message_id = v_snapshot.provider_message_id
       )
       or exists (
         select 1 from public.whatsapp_conversation_lead_bindings as binding
         where binding.organization_id = p_organization_id
           and binding.session_id = p_session_id
           and binding.provider_message_id = v_snapshot.provider_message_id
       )
       or exists (
         select 1 from public.media_jobs as job
         where job.organization_id = p_organization_id
           and job.session_id = p_session_id
           and job.provider_message_id = v_snapshot.provider_message_id
       ) then
      return 'busy';
    end if;

    if v_inbox.status = 'processing' and v_inbox.attempts = 1
       and p_inbox_id = v_inbox.id
       and v_inbox.locked_by = p_worker_id then
      v_saw_claimed := true;
    elsif v_inbox.status is distinct from 'pending'
          or v_inbox.attempts is distinct from 0 then
      return 'busy';
    end if;
    v_first_at := least(coalesce(v_first_at, v_inbox.created_at),
                        v_inbox.created_at);
    v_first_sequence := least(coalesce(v_first_sequence,
                                      v_snapshot.ingress_sequence),
                              v_snapshot.ingress_sequence);
    v_inbox_ids := pg_catalog.array_append(v_inbox_ids, v_inbox.id);
    v_provider_ids := pg_catalog.array_append(
      v_provider_ids, v_snapshot.provider_message_id
    );
    v_event_keys := pg_catalog.array_append(v_event_keys, v_inbox.event_key);
    v_provider_event_ids := pg_catalog.array_append(
      v_provider_event_ids,
      p_session_id::text || ':' || v_snapshot.provider_message_id
    );
  end loop;

  if v_count = 0 or v_first_at is distinct from v_cohort.first_received_at
     or v_first_sequence is distinct from v_cohort.first_ingress_sequence
     or (p_inbox_id is not null and not v_saw_claimed)
     or (p_inbox_id is null and v_saw_claimed)
     or (select count(*) from public.whatsapp_webhook_routing_snapshots as snapshot
         where snapshot.organization_id = p_organization_id
           and snapshot.session_id = p_session_id
           and snapshot.routing_key = p_routing_key) <> v_count
     or exists (
       select 1 from public.whatsapp_webhook_routing_snapshots as snapshot
       where snapshot.organization_id = p_organization_id
         and snapshot.session_id = p_session_id
         and snapshot.provider_message_id = any(v_provider_ids)
         and snapshot.routing_key is distinct from p_routing_key
     ) or exists (
       -- One organization scan, not up to 256 scans in the row loop. Check
       -- countable and non-countable entries; either is a prior CRM effect.
       select 1 from public.lead_entry_events as entry
       where entry.organization_id = p_organization_id
         and entry.provider = 'whatsapp'
         and entry.provider_event_id = any(
           pg_catalog.array_cat(
             pg_catalog.array_cat(v_provider_ids, v_event_keys),
             v_provider_event_ids
           )
         )
     ) then
    return 'busy';
  end if;

  insert into private.whatsapp_nonlead_message_tombstones (
    organization_id, session_id, provider_message_id_hash
  )
  select p_organization_id, p_session_id,
         pg_catalog.encode(extensions.digest(id.provider_message_id, 'sha256'),
                           'hex')
  from pg_catalog.unnest(v_provider_ids) as id(provider_message_id)
  on conflict do nothing;

  delete from public.whatsapp_webhook_inbox as inbox
  where inbox.organization_id = p_organization_id
    and inbox.session_id = p_session_id
    and inbox.id = any(v_inbox_ids);
  get diagnostics v_deleted = row_count;
  if v_deleted <> v_count then
    raise exception using errcode = '55000',
      message = 'whatsapp_ctwa_unmaterialized_gc_inbox_changed';
  end if;
  delete from public.whatsapp_webhook_routing_snapshots as snapshot
  where snapshot.organization_id = p_organization_id
    and snapshot.session_id = p_session_id
    and snapshot.routing_key = p_routing_key
    and snapshot.provider_message_id = any(v_provider_ids);
  get diagnostics v_deleted = row_count;
  if v_deleted <> v_count then
    raise exception using errcode = '55000',
      message = 'whatsapp_ctwa_unmaterialized_gc_snapshot_changed';
  end if;

  -- Keep the tombstones; neither inbox nor another provenance record may
  -- retain a raw provider ID after the transaction commits.
  if exists (
    select 1
    from pg_catalog.unnest(v_provider_ids) as old_id(provider_message_id)
    where exists (
      select 1 from public.whatsapp_webhook_inbox as inbox
      where inbox.organization_id = p_organization_id
        and inbox.session_id = p_session_id
        and pg_catalog.strpos(inbox.payload::text, old_id.provider_message_id) > 0
    ) or exists (
      select 1 from public.whatsapp_webhook_routing_snapshots as snapshot
      where snapshot.organization_id = p_organization_id
        and snapshot.session_id = p_session_id
        and (snapshot.provider_message_id = old_id.provider_message_id
             or snapshot.predecessor_provider_message_id = old_id.provider_message_id
             or pg_catalog.strpos(snapshot.snapshot::text,
                                  old_id.provider_message_id) > 0)
    ) or exists (
      select 1 from public.whatsapp_webhook_routing_outcomes as outcome
      where outcome.organization_id = p_organization_id
        and outcome.session_id = p_session_id
        and outcome.provider_message_id = old_id.provider_message_id
    )
  ) then
    raise exception using errcode = '55000',
      message = 'whatsapp_ctwa_unmaterialized_gc_raw_id_retained';
  end if;

  update private.whatsapp_nonlead_retention_route_generations as generation
  set closed_at = v_cohort.expires_at,
      purged_before = v_cohort.expires_at
  where generation.organization_id = p_organization_id
    and generation.session_id = p_session_id
    and generation.routing_key = p_routing_key
    and generation.first_inbound_at = v_cohort.first_received_at
    and (generation.closed_at is null
         or generation.closed_at = v_cohort.expires_at)
    and generation.purged_before is null;
  if not found then
    raise exception using errcode = '55000',
      message = 'whatsapp_ctwa_unmaterialized_gc_generation_changed';
  end if;
  update private.whatsapp_ctwa_recent_successor_cohorts as cohort
  set settled_at = clock_timestamp()
  where cohort.organization_id = p_organization_id
    and cohort.session_id = p_session_id
    and cohort.routing_key = p_routing_key
    and cohort.settled_at is null;
  if not found then
    raise exception using errcode = '55000',
      message = 'whatsapp_ctwa_unmaterialized_gc_cohort_changed';
  end if;
  return 'purged';
end;
$$;
alter function private.try_purge_whatsapp_ctwa_unmaterialized_cohort(
  uuid, uuid, text, uuid, text
) owner to postgres;
revoke all on function private.try_purge_whatsapp_ctwa_unmaterialized_cohort(
  uuid, uuid, text, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function private.try_purge_whatsapp_ctwa_unmaterialized_cohort(
  uuid, uuid, text, uuid, text
) to service_role;

create function private.try_purge_whatsapp_ctwa_unmaterialized_cohort(
  p_organization_id uuid, p_session_id uuid, p_routing_key text
)
returns text
language sql
volatile
security definer
set search_path = ''
as $$
  select private.try_purge_whatsapp_ctwa_unmaterialized_cohort(
    p_organization_id, p_session_id, p_routing_key, null::uuid, null::text
  );
$$;
alter function private.try_purge_whatsapp_ctwa_unmaterialized_cohort(
  uuid, uuid, text
) owner to postgres;
revoke all on function private.try_purge_whatsapp_ctwa_unmaterialized_cohort(
  uuid, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function private.try_purge_whatsapp_ctwa_unmaterialized_cohort(
  uuid, uuid, text
) to service_role;

create or replace function private.complete_whatsapp_nonlead_expired_inbox(
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
  v_cohort_route text;
  v_cohort_disposition text;
begin
  if p_inbox_id is null or p_organization_id is null or p_session_id is null
     or btrim(coalesce(p_provider_message_id, '')) = ''
     or btrim(coalesce(p_worker_id, '')) = '' then
    raise exception using errcode = '22023', message = 'whatsapp_nonlead_expired_completion_invalid_identity';
  end if;
  -- The cohort GC locks session before inbox. Keep that order: the legacy
  -- path below takes inbox FOR UPDATE and would invert a concurrent ingress.
  select snapshot.routing_key into v_cohort_route
  from public.whatsapp_webhook_inbox as inbox
  join public.whatsapp_webhook_routing_snapshots as snapshot
    on snapshot.organization_id = inbox.organization_id
   and snapshot.session_id = inbox.session_id
   and snapshot.inbox_event_key = inbox.event_key
  where inbox.id = p_inbox_id
    and inbox.organization_id = p_organization_id
    and inbox.session_id = p_session_id
    and snapshot.provider_message_id = p_provider_message_id;
  if v_cohort_route is not null
     and not private.whatsapp_ctwa_recent_successor_claimable(
       p_organization_id, p_session_id, v_cohort_route
     ) then
    select private.try_purge_whatsapp_ctwa_unmaterialized_cohort(
      p_organization_id, p_session_id, v_cohort_route,
      p_inbox_id, p_worker_id
    ) into v_cohort_disposition;
    if v_cohort_disposition = 'purged' then
      return true;
    end if;
    raise exception using errcode = '55000',
      message = 'whatsapp_ctwa_cohort_due_not_purgeable';
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


alter function private.complete_whatsapp_nonlead_expired_inbox(uuid, uuid, uuid, text, text) owner to postgres;

commit;
