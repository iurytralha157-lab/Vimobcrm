-- Structural preparation only. No session is activated and no old conversation
-- is backfilled or deleted by applying this migration. Activation is per
-- session, after the API, Edge, and Storage cleanup paths understand the rule.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

create table private.whatsapp_nonlead_retention_sessions (
  session_id uuid primary key references public.whatsapp_sessions(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  capture_from timestamptz not null,
  purge_enabled boolean not null default false
);

create table private.whatsapp_nonlead_retention_candidates (
  conversation_id uuid primary key
    references public.whatsapp_conversations(id) on delete cascade,
  organization_id uuid not null,
  session_id uuid not null,
  first_received_at timestamptz not null,
  expires_at timestamptz not null,
  state text not null default 'pending'
    check (state in ('pending', 'converted', 'purging')),
  converted_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  constraint whatsapp_nonlead_retention_deadline_check
    check (expires_at = first_received_at + interval '168 hours'),
  constraint whatsapp_nonlead_retention_converted_check
    check ((state = 'converted') = (converted_at is not null))
);

create index whatsapp_nonlead_retention_due_idx
  on private.whatsapp_nonlead_retention_candidates (expires_at, conversation_id)
  where state = 'pending';

-- The exact provider route key is versioned after each purge. New callbacks
-- for the same contact start a fresh predecessor chain; older callbacks keep
-- their original key and can be fenced by the inbox arrival time.
create table private.whatsapp_nonlead_retention_route_generations (
  organization_id uuid not null,
  session_id uuid not null,
  base_routing_key text not null,
  routing_key text not null,
  generation uuid not null default gen_random_uuid(),
  started_at timestamptz not null default clock_timestamp(),
  -- Set in the same transaction as the durable inbox ACK. A worker may run
  -- much later; its processing time must never extend the seven-day window.
  first_inbound_at timestamptz,
  -- Closing a route prevents old events from affecting the CRM. It is not
  -- evidence that the conversation or its media have already been deleted.
  closed_at timestamptz,
  purged_before timestamptz,
  primary key (organization_id, session_id, routing_key),
  constraint whatsapp_nonlead_route_generation_bounds check (
    btrim(base_routing_key) <> '' and octet_length(base_routing_key) <= 256
    and btrim(routing_key) <> '' and octet_length(routing_key) <= 256
    -- One physical conversation can acquire another proven contact alias
    -- after its first message. Every alias closes at that conversation's
    -- original deadline, which can be earlier than the alias's own 168h.
    and (closed_at is null or
      (first_inbound_at is not null
       and closed_at >= first_inbound_at
       and closed_at <= first_inbound_at + interval '168 hours'))
    and (purged_before is null or purged_before = closed_at)
  )
);

create unique index whatsapp_nonlead_route_active_idx
  on private.whatsapp_nonlead_retention_route_generations
    (organization_id, session_id, base_routing_key)
  where closed_at is null;

create table private.whatsapp_nonlead_retention_candidate_routes (
  conversation_id uuid not null
    references public.whatsapp_conversations(id) on delete cascade,
  organization_id uuid not null,
  session_id uuid not null,
  routing_key text not null,
  first_ingress_sequence bigint not null,
  primary key (conversation_id, routing_key)
);

create table private.whatsapp_nonlead_message_tombstones (
  organization_id uuid not null,
  session_id uuid not null,
  provider_message_id_hash text not null
    check (provider_message_id_hash ~ '^[0-9a-f]{64}$'),
  purged_at timestamptz not null default clock_timestamp(),
  primary key (organization_id, session_id, provider_message_id_hash)
);

create table private.whatsapp_nonlead_media_delete_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  conversation_id uuid not null,
  bucket_id text not null,
  storage_path text not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'retry', 'held_shared', 'done', 'dead')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default clock_timestamp(),
  locked_at timestamptz,
  locked_by text,
  lease_token uuid,
  last_error text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (conversation_id, bucket_id, storage_path)
);

create index whatsapp_nonlead_media_delete_due_idx
  on private.whatsapp_nonlead_media_delete_outbox
    (next_attempt_at, created_at, id)
  where status in ('pending', 'retry', 'held_shared');

-- An object path cannot be deleted while an upload for that path may still
-- finish. Uploaders reserve before the HTTP call and release only after their
-- durable database reference is written. Unknown HTTP outcomes remain held
-- until an operator reconciles them; an elapsed lease is not proof of safety.
create table private.whatsapp_media_path_operations (
  bucket_id text not null,
  storage_path text not null,
  organization_id uuid not null,
  conversation_id uuid,
  operation text not null check (operation in ('upload', 'delete')),
  owner_token uuid not null unique default gen_random_uuid(),
  started_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp() + interval '5 minutes'),
  outcome_unknown boolean not null default false,
  primary key (bucket_id, storage_path),
  constraint whatsapp_media_path_operation_scope_check check (
    bucket_id = 'whatsapp-media'
    and left(storage_path, length('orgs/' || organization_id::text || '/'))
      = 'orgs/' || organization_id::text || '/'
    and octet_length(storage_path) between 43 and 1024
    and position('..' in storage_path) = 0
    and position(E'\\' in storage_path) = 0
  )
);

create index whatsapp_media_path_operations_expired_upload_idx
  on private.whatsapp_media_path_operations (expires_at, started_at)
  where operation = 'upload';

-- Keep the reservation proof outside media_jobs.message_key. Its existing
-- runtime CHECK allows a fixed JSON key whitelist and the table can be large;
-- nullable columns avoid replacing/validating that CHECK during this rollout.
alter table public.media_jobs
  add column upload_path_reservation_token uuid,
  add column upload_http_confirmed boolean;

alter table private.whatsapp_nonlead_retention_sessions enable row level security;
alter table private.whatsapp_nonlead_retention_candidates enable row level security;
alter table private.whatsapp_nonlead_retention_route_generations enable row level security;
alter table private.whatsapp_nonlead_retention_candidate_routes enable row level security;
alter table private.whatsapp_nonlead_message_tombstones enable row level security;
alter table private.whatsapp_nonlead_media_delete_outbox enable row level security;
alter table private.whatsapp_media_path_operations enable row level security;
revoke all on private.whatsapp_nonlead_retention_sessions
  from public, anon, authenticated, service_role;
revoke all on private.whatsapp_nonlead_retention_candidates
  from public, anon, authenticated, service_role;
revoke all on private.whatsapp_nonlead_retention_route_generations
  from public, anon, authenticated, service_role;
revoke all on private.whatsapp_nonlead_retention_candidate_routes
  from public, anon, authenticated, service_role;
revoke all on private.whatsapp_nonlead_message_tombstones
  from public, anon, authenticated, service_role;
revoke all on private.whatsapp_nonlead_media_delete_outbox
  from public, anon, authenticated, service_role;
revoke all on private.whatsapp_media_path_operations
  from public, anon, authenticated, service_role;

-- Deliberately refuses delete reservations until the path reference triggers,
-- inbox scrub, and every Storage writer are ready. This migration alone must
-- never start deleting objects. Upload reservations are already usable by the
-- new Edge and Go writers and do not affect existing sessions' retention.
create function public.whatsapp_media_path_reserve(
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
      join private.whatsapp_nonlead_retention_sessions as policy
        on policy.organization_id = candidate.organization_id
       and policy.session_id = candidate.session_id
       and policy.purge_enabled = true
      where candidate.conversation_id = conversation.id
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

  -- No retention policy means no GC can run for this path. Keep normal media
  -- uploads free of durable reservations until a session is activated. The
  -- reserved UUID is a no-op token accepted by release(). A content-addressed
  -- assets/v2 path may be shared across sessions, so any active policy in the
  -- organization requires a real reservation for that namespace, even when
  -- this uploader's own session is still disabled. That cross-session fence
  -- prevents deleting a shared object while its upload is in flight.
  if (
    v_incoming_path and not exists (
      select 1 from private.whatsapp_nonlead_retention_sessions as policy
      where policy.organization_id = p_organization_id
        and policy.session_id = v_session_id
        and policy.purge_enabled = true
    )
  ) or (
    v_asset_path and not exists (
      select 1 from private.whatsapp_nonlead_retention_sessions as policy
      where policy.organization_id = p_organization_id
        and policy.purge_enabled = true
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

create function public.whatsapp_media_path_release(
  p_owner_token uuid, p_outcome text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_owner_token is null
     or p_outcome is null
     or p_outcome not in ('committed', 'not_started', 'unknown') then
    raise exception using errcode = '22023', message = 'whatsapp_media_path_release_invalid';
  end if;
  if p_owner_token = '00000000-0000-0000-0000-000000000001'::uuid then
    return true;
  end if;
  if p_outcome = 'unknown' then
    update private.whatsapp_media_path_operations as operation
    set outcome_unknown = true
    where operation.owner_token = p_owner_token;
    return true;
  else
    delete from private.whatsapp_media_path_operations as operation
    where operation.owner_token = p_owner_token;
    -- A repeated acknowledgement after a lost RPC response is successful:
    -- the path is already free, and its durable reference was written first.
    return true;
  end if;
end;
$$;

revoke all on function public.whatsapp_media_path_release(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.whatsapp_media_path_release(uuid, text)
  to service_role;

comment on table private.whatsapp_nonlead_retention_candidates is
  'Deadline evidence for direct nonlead conversations first received after per-session activation. No old row is backfilled.';
comment on column private.whatsapp_nonlead_retention_candidates.first_received_at is
  'Database arrival time of the first newly recorded inbound message; pre-existing conversations are excluded.';

create function private.current_whatsapp_nonlead_routing_key(
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
  v_routing_key text;
begin
  if p_organization_id is null or p_session_id is null
     or btrim(coalesce(p_base_routing_key, '')) = '' then
    raise exception using errcode = '22023', message = 'whatsapp_nonlead_route_invalid_identity';
  end if;
  if not exists (
    select 1 from private.whatsapp_nonlead_retention_sessions as policy
    where policy.organization_id = p_organization_id
      and policy.session_id = p_session_id
      and policy.purge_enabled = true
  ) then
    return p_base_routing_key;
  end if;
  -- Ingress and route advance share this transaction-scoped lock. The caller
  -- already holds the session KEY SHARE fence; purge takes session UPDATE
  -- before advancing, so it cannot move a route while an ingress is capturing
  -- its immutable snapshot.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_organization_id::text || ':' || p_session_id::text),
    pg_catalog.hashtext(p_base_routing_key)
  );
  select generation.routing_key into v_routing_key
  from private.whatsapp_nonlead_retention_route_generations as generation
  where generation.organization_id = p_organization_id
    and generation.session_id = p_session_id
    and generation.base_routing_key = p_base_routing_key
    and generation.closed_at is null;
  return coalesce(v_routing_key, p_base_routing_key);
end;
$$;

revoke all on function private.current_whatsapp_nonlead_routing_key(uuid, uuid, text)
  from public, anon, authenticated, service_role;

-- Called after the isolated inbox row is inserted, before the ingress ACK
-- transaction commits. The caller supplies the parsed message classification;
-- the database independently verifies the immutable snapshot, event and
-- active cutover. No leadless conversation row is required yet: a backlogged
-- first CTWA message still starts the fixed seven-day clock here.
create function private.record_whatsapp_nonlead_first_ingress(
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
begin
  if p_is_direct_inbound is not true then
    return;
  end if;
  if p_organization_id is null or p_session_id is null
     or btrim(coalesce(p_inbox_event_key, '')) = ''
     or btrim(coalesce(p_provider_message_id, '')) = '' then
    raise exception using errcode = '22023', message = 'whatsapp_nonlead_first_ingress_invalid_identity';
  end if;

  select policy.capture_from into v_capture_from
  from private.whatsapp_nonlead_retention_sessions as policy
  where policy.organization_id = p_organization_id
    and policy.session_id = p_session_id
    and policy.purge_enabled = true;
  if not found then
    return;
  end if;

  select inbox.created_at,
         inbox.payload #>> '{__vimob_ingress,cutover_epoch}',
         snapshot.routing_key, snapshot.snapshot
  into v_received_at, v_inbox_epoch, v_routing_key, v_snapshot
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
  if v_received_at < v_capture_from then
    return;
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

revoke all on function private.record_whatsapp_nonlead_first_ingress(uuid, uuid, text, text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function private.record_whatsapp_nonlead_first_ingress(uuid, uuid, text, text, boolean)
  to service_role;

-- Decide the provider's route before opening a new generation. Exact replays
-- retain their immutable route; they must never be recast as a new contact
-- after an expiry. The ingress writes an ignored/minimal receipt when the
-- reason is nonempty, without persisting the provider's message body/media.
create function private.whatsapp_nonlead_ingress_route_decision(
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

revoke all on function private.whatsapp_nonlead_ingress_route_decision(uuid, uuid, text, text, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function private.whatsapp_nonlead_ingress_route_decision(uuid, uuid, text, text, timestamptz)
  to service_role;

-- Only the service backend/Edge lease may ask this question. A known purged
-- provider ID always wins. The ACK anchor sets the seven-day deadline even
-- when its first CTWA event has never left the inbox. A closed route means
-- ignored/no effect; purged_before separately proves physical deletion.
create function public.whatsapp_nonlead_event_is_purged(
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

  if not exists (
    select 1 from private.whatsapp_nonlead_retention_sessions as policy
    where policy.organization_id = p_organization_id
      and policy.session_id = p_session_id
      and policy.purge_enabled = true
  ) then
    return false;
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

revoke all on function public.whatsapp_nonlead_event_is_purged(uuid, uuid, text, text, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.whatsapp_nonlead_event_is_purged(uuid, uuid, text, text, timestamptz)
  to service_role;

-- Activation is intentionally unavailable in this structural migration.
-- The deployed worker mode defaults to Edge in some stacks, and physical
-- purge/Storage cleanup still need a coordinated rollout. A later migration
-- must replace this function only after those paths are ready and verified.
create function private.activate_whatsapp_nonlead_retention(p_session_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'whatsapp_nonlead_retention_activation_not_ready';
end;
$$;

revoke all on function private.activate_whatsapp_nonlead_retention(uuid)
  from public, anon, authenticated, service_role;

create function private.set_whatsapp_nonlead_purge_enabled(
  p_session_id uuid, p_enabled boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_session_id is null or p_enabled is null then
    raise exception using errcode = '22023', message = 'whatsapp_nonlead_retention_policy_argument_invalid';
  end if;
  if p_enabled then
    raise exception using errcode = '55000', message = 'whatsapp_nonlead_retention_activation_not_ready';
  end if;
  update private.whatsapp_nonlead_retention_sessions as policy
  set purge_enabled = p_enabled
  where policy.session_id = p_session_id;
  return found;
end;
$$;

revoke all on function private.set_whatsapp_nonlead_purge_enabled(uuid, boolean)
  from public, anon, authenticated, service_role;

-- Physical deletion is asynchronous. Stop browser Data API reads at the
-- deadline itself, while preserving a conversation permanently once linked.
create function private.whatsapp_nonlead_retention_visible(
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
    join private.whatsapp_nonlead_retention_sessions as policy
      on policy.organization_id = candidate.organization_id
     and policy.session_id = candidate.session_id
     and policy.purge_enabled = true
    where candidate.organization_id = p_organization_id
      and candidate.conversation_id = p_conversation_id
      and candidate.state in ('pending', 'purging')
      and candidate.expires_at <= now()
  );
$$;

revoke all on function private.whatsapp_nonlead_retention_visible(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.whatsapp_nonlead_retention_visible(uuid, uuid)
  to authenticated;

create policy whatsapp_nonlead_retention_conversation_deadline
on public.whatsapp_conversations as restrictive for select to authenticated
using (private.whatsapp_nonlead_retention_visible(organization_id, id));

create policy whatsapp_nonlead_retention_message_deadline
on public.whatsapp_messages as restrictive for select to authenticated
using (private.whatsapp_nonlead_retention_visible(organization_id, conversation_id));

-- A new event must not be attached to an expired physical conversation while
-- the purge job is still pending. The caller retries after the old row has
-- been physically removed and the route generation advanced. This is a
-- defensive barrier, not a substitute for the disabled purge implementation.
create function private.guard_whatsapp_nonlead_expired_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from private.whatsapp_nonlead_retention_candidates as candidate
    join private.whatsapp_nonlead_retention_sessions as policy
      on policy.organization_id = candidate.organization_id
     and policy.session_id = candidate.session_id
     and policy.purge_enabled = true
    where candidate.conversation_id = new.conversation_id
      and candidate.organization_id = new.organization_id
      and candidate.state in ('pending', 'purging')
      and (candidate.state = 'purging' or candidate.expires_at <= clock_timestamp())
  ) then
    raise exception using errcode = '55000', message = 'whatsapp_nonlead_retention_deadline_passed';
  end if;
  return new;
end;
$$;

alter function private.guard_whatsapp_nonlead_expired_message() owner to postgres;
revoke all on function private.guard_whatsapp_nonlead_expired_message()
  from public, anon, authenticated, service_role;
create trigger aa_guard_whatsapp_nonlead_expired_message
before insert on public.whatsapp_messages
for each row execute function private.guard_whatsapp_nonlead_expired_message();

create function private.track_whatsapp_nonlead_first_received()
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

  if v_capture_from is null then
    return new;
  end if;

  -- An existing conversation is outside this future-only rollout. In
  -- particular, a pre-activation worker may still finish an old message after
  -- the policy is armed, without having a new routing snapshot to prove.
  perform 1
  from public.whatsapp_conversations as conversation
  where conversation.id = new.conversation_id
    and conversation.organization_id = new.organization_id
    and conversation.session_id = new.session_id
    and conversation.created_at >= v_capture_from;
  if not found then
    return new;
  end if;

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
    raise exception using errcode = '55000', message = 'whatsapp_nonlead_retention_missing_first_ingress';
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

create function private.mark_whatsapp_nonlead_converted(
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
    select 1 from private.whatsapp_nonlead_retention_sessions as policy
    join private.whatsapp_nonlead_retention_candidates as candidate
      on candidate.organization_id = policy.organization_id
     and candidate.session_id = policy.session_id
    where candidate.organization_id = p_organization_id
      and candidate.conversation_id = p_conversation_id
      and policy.purge_enabled = true
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
end;
$$;

create function private.cancel_whatsapp_nonlead_retention_on_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.lead_id is not null and old.lead_id is distinct from new.lead_id then
    perform private.mark_whatsapp_nonlead_converted(new.organization_id, new.id);
  end if;
  return new;
end;
$$;

create function private.cancel_whatsapp_nonlead_retention_on_binding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from private.whatsapp_nonlead_retention_sessions as policy
    where policy.organization_id = new.organization_id
      and policy.session_id = (
        select conversation.session_id
        from public.whatsapp_conversations as conversation
        where conversation.id = new.conversation_id
          and conversation.organization_id = new.organization_id
      )
      and policy.purge_enabled = true
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

create function private.cancel_whatsapp_nonlead_retention_on_message_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Older writers can attach a card to a message without creating a binding
  -- or changing the conversation row. Preserve the pre-lead history then too.
  if new.lead_id is not null and exists (
    select 1 from private.whatsapp_nonlead_retention_sessions as policy
    where policy.organization_id = new.organization_id
      and policy.session_id = new.session_id
      and policy.purge_enabled = true
  ) then
    perform 1 from public.whatsapp_conversations as conversation
    where conversation.id = new.conversation_id
      and conversation.organization_id = new.organization_id
    for no key update of conversation;
    perform private.mark_whatsapp_nonlead_converted(
      new.organization_id, new.conversation_id
    );
  end if;
  return new;
end;
$$;

alter function private.track_whatsapp_nonlead_first_received() owner to postgres;
alter function private.current_whatsapp_nonlead_routing_key(uuid, uuid, text) owner to postgres;
alter function public.whatsapp_nonlead_event_is_purged(uuid, uuid, text, text, timestamptz) owner to postgres;
alter function public.whatsapp_media_path_reserve(uuid, uuid, text, text, text) owner to postgres;
alter function public.whatsapp_media_path_release(uuid, text) owner to postgres;
alter function private.activate_whatsapp_nonlead_retention(uuid) owner to postgres;
alter function private.set_whatsapp_nonlead_purge_enabled(uuid, boolean) owner to postgres;
alter function private.whatsapp_nonlead_retention_visible(uuid, uuid) owner to postgres;
alter function private.mark_whatsapp_nonlead_converted(uuid, uuid) owner to postgres;
alter function private.cancel_whatsapp_nonlead_retention_on_lead() owner to postgres;
alter function private.cancel_whatsapp_nonlead_retention_on_binding() owner to postgres;
alter function private.cancel_whatsapp_nonlead_retention_on_message_lead() owner to postgres;

revoke all on function private.track_whatsapp_nonlead_first_received()
  from public, anon, authenticated, service_role;
revoke all on function private.mark_whatsapp_nonlead_converted(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.cancel_whatsapp_nonlead_retention_on_lead()
  from public, anon, authenticated, service_role;
revoke all on function private.cancel_whatsapp_nonlead_retention_on_binding()
  from public, anon, authenticated, service_role;
revoke all on function private.cancel_whatsapp_nonlead_retention_on_message_lead()
  from public, anon, authenticated, service_role;

create trigger zz_track_whatsapp_nonlead_first_received
after insert on public.whatsapp_messages
for each row
execute function private.track_whatsapp_nonlead_first_received();

create trigger zz_cancel_whatsapp_nonlead_retention_on_lead
after update of lead_id on public.whatsapp_conversations
for each row
execute function private.cancel_whatsapp_nonlead_retention_on_lead();

create trigger zz_cancel_whatsapp_nonlead_retention_on_binding
after insert on public.whatsapp_conversation_lead_bindings
for each row
execute function private.cancel_whatsapp_nonlead_retention_on_binding();

create trigger zz_cancel_whatsapp_nonlead_retention_on_message_lead
after insert or update of lead_id on public.whatsapp_messages
for each row
when (new.lead_id is not null)
execute function private.cancel_whatsapp_nonlead_retention_on_message_lead();

-- The Go media worker reserves its deterministic Storage path and records the
-- upload intent/token in one transaction. A process crash can never leave an
-- active path reservation with no durable token on the media job. The function
-- takes conversation, then job, then path locks; the later purge uses that
-- order. It does not perform Storage I/O or activate retention.
create function private.reserve_whatsapp_media_job_upload(
  p_job_id uuid,
  p_organization_id uuid,
  p_conversation_id uuid,
  p_locked_by text,
  p_job_lease_token uuid,
  p_storage_path text,
  p_content_type text,
  p_actual_size bigint
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_path_token uuid;
begin
  if p_job_id is null or p_organization_id is null or p_conversation_id is null
     or p_job_lease_token is null or btrim(coalesce(p_locked_by, '')) = ''
     or btrim(coalesce(p_content_type, '')) = ''
     or p_actual_size is null or p_actual_size <= 0 or p_actual_size > 26214400
     or left(coalesce(p_storage_path, ''), length('orgs/' || p_organization_id::text || '/assets/v2/'))
       <> 'orgs/' || p_organization_id::text || '/assets/v2/' then
    raise exception using errcode = '22023', message = 'whatsapp_media_job_upload_reservation_invalid';
  end if;

  perform 1
  from public.whatsapp_conversations as conversation
  where conversation.id = p_conversation_id
    and conversation.organization_id = p_organization_id
    and conversation.deleted_at is null
  for key share of conversation;
  if not found then
    return null;
  end if;

  perform 1
  from public.media_jobs as job
  where job.id = p_job_id
    and job.organization_id = p_organization_id
    and job.conversation_id = p_conversation_id
    and job.status = 'processing'
    and job.locked_by = p_locked_by
    and job.lease_token = p_job_lease_token
    and job.lease_expires_at > clock_timestamp()
  for update of job;
  if not found then
    return null;
  end if;

  v_path_token := public.whatsapp_media_path_reserve(
    p_organization_id, p_conversation_id, 'whatsapp-media',
    p_storage_path, 'upload'
  );
  if v_path_token is null then
    return null;
  end if;

  update public.media_jobs as job
  set message_key = coalesce(job.message_key, '{}'::jsonb) || jsonb_build_object(
        'upload_intent_path', p_storage_path,
        'upload_intent_content_type', p_content_type,
        'upload_intent_size', p_actual_size
      ),
      upload_path_reservation_token = v_path_token,
      upload_http_confirmed = null,
      updated_at = clock_timestamp()
  where job.id = p_job_id
    and job.organization_id = p_organization_id
    and job.conversation_id = p_conversation_id
    and job.status = 'processing'
    and job.locked_by = p_locked_by
    and job.lease_token = p_job_lease_token
    and job.lease_expires_at > clock_timestamp();
  if not found then
    raise exception using errcode = '55000', message = 'whatsapp_media_job_lease_changed_during_path_reservation';
  end if;
  return v_path_token;
end;
$$;

alter function private.reserve_whatsapp_media_job_upload(uuid, uuid, uuid, text, uuid, text, text, bigint)
  owner to postgres;
revoke all on function private.reserve_whatsapp_media_job_upload(uuid, uuid, uuid, text, uuid, text, text, bigint)
  from public, anon, authenticated, service_role;

commit;
