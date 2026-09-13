-- Replace the global single-job WhatsApp media semaphore with bounded,
-- cross-replica processing slots. The claim transaction remains serialized for
-- a few milliseconds, while provider I/O runs concurrently across sessions.
--
-- A populated production queue must first run:
--   supabase/cutovers/20260912_scale_whatsapp_media_queue.sql
-- The cutover adds the nullable column and builds the new unique indexes with
-- CREATE INDEX CONCURRENTLY. This migration then installs the final contract.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $media_scale_foundation$
begin
  if to_regclass('public.media_jobs') is null
     or to_regprocedure('private.claim_whatsapp_media_job(text,interval)') is null
     or to_regclass('public.media_jobs_one_global_processing_uidx') is null then
    raise exception 'WhatsApp media queue foundation is not installed';
  end if;
end;
$media_scale_foundation$;

-- A populated queue must have been expanded by the online cutover. Avoid even
-- a no-op ALTER TABLE here: PostgreSQL would retain ACCESS EXCLUSIVE until this
-- activation commits. Only a pristine queue may be expanded transactionally.
do $media_scale_expand_preflight$
begin
  if not exists (
    select 1
    from pg_catalog.pg_attribute
    where attrelid = 'public.media_jobs'::regclass
      and attname = 'processing_slot'
      and not attisdropped
  ) then
    if exists (select 1 from public.media_jobs limit 1)
       or pg_relation_size('public.media_jobs'::regclass) > 64 * 1024 * 1024
    then
      raise exception using
        message = 'WhatsApp media processing_slot was not expanded on the live queue',
        hint = 'Run supabase/cutovers/20260912_scale_whatsapp_media_queue.sql first.';
    end if;
    alter table public.media_jobs add column processing_slot smallint;
  end if;
end;
$media_scale_expand_preflight$;

-- Fail before installing a trigger or touching a queue row when the online
-- preparation is incomplete.
do $media_scale_online_preflight$
begin
  if (
    to_regclass('public.media_jobs_processing_slot_uidx') is null
    or to_regclass('public.media_jobs_processing_session_uidx') is null
    or to_regclass('public.media_jobs_processing_asset_uidx') is null
    or to_regclass('public.media_jobs_processing_org_idx') is null
    or to_regclass('public.media_jobs_pending_session_claim_idx') is null
    or to_regclass('public.media_jobs_pending_local_session_claim_idx') is null
    or to_regclass('public.media_jobs_pending_exhausted_idx') is null
  ) and (
    exists (select 1 from public.media_jobs limit 1)
    or pg_relation_size('public.media_jobs'::regclass) > 64 * 1024 * 1024
  ) then
    raise exception using
      message = 'WhatsApp media scale indexes were not prepared on the live queue',
      hint = 'Run supabase/cutovers/20260912_scale_whatsapp_media_queue.sql with an autocommit-capable client.';
  end if;
end;
$media_scale_online_preflight$;

create table if not exists private.whatsapp_media_scale_cutover_state (
  singleton boolean primary key default true check (singleton),
  legacy_claim_disabled_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table private.whatsapp_media_scale_cutover_state enable row level security;
alter table private.whatsapp_media_scale_cutover_state force row level security;
revoke all on table private.whatsapp_media_scale_cutover_state
  from public, anon, authenticated, service_role;

-- A genuinely empty queue has no legacy request to drain, so disposable/fresh
-- installs can self-certify. A populated queue must carry the durable timestamp
-- written by the online cutover that disabled the two-argument claim first.
insert into private.whatsapp_media_scale_cutover_state (
  singleton,
  legacy_claim_disabled_at
)
select true, clock_timestamp() - interval '10 minutes'
where not exists (select 1 from public.media_jobs limit 1)
on conflict (singleton) do nothing;

-- Drain every claim transaction running either the previous or scaled claim
-- protocol before changing the writer contract. Both locks are held only for
-- this activation transaction; provider I/O never holds them.
select pg_advisory_xact_lock(hashtextextended('vimob:whatsapp-media:scale-cutover', 0));
select pg_advisory_xact_lock(hashtextextended('vimob:whatsapp-media:global-claim', 0));
select pg_advisory_xact_lock(hashtextextended('vimob:whatsapp-media:slot-claim', 0));

-- The legacy breaker means a detached provider request may still finish with an
-- unknown outcome. Never erase that evidence during activation. The operator
-- must first audit the recorded job and explicitly clear the breaker using the
-- existing incident procedure; both claim protocols are fenced by the locks
-- above while this check and the activation run.
do $media_scale_breaker_preflight$
declare
  v_breaker_open boolean;
  v_breaker_reason text;
  v_breaker_job_id uuid;
begin
  select breaker_open, breaker_reason, breaker_job_id
  into v_breaker_open, v_breaker_reason, v_breaker_job_id
  from private.whatsapp_media_worker_state
  where singleton = true
  for update;

  if not found then
    raise exception 'WhatsApp media breaker singleton is missing';
  end if;

  if coalesce(v_breaker_open, false) then
    raise exception using
      message = 'WhatsApp media scale activation is blocked by an open legacy breaker',
      detail = format('job_id=%s reason=%s', coalesce(v_breaker_job_id::text, '<unknown>'), coalesce(v_breaker_reason, '<unknown>')),
      hint = 'Confirm no detached Evolution Go download is still running, audit the recorded job, then clear the breaker explicitly before retrying activation.';
  end if;
end;
$media_scale_breaker_preflight$;

-- Install the durable per-session ambiguity fence before recovering any lease
-- left by the disabled legacy claimant. This table is backend-only even for
-- service_role; the direct database worker owns the lifecycle.
create table if not exists private.whatsapp_media_session_quarantine (
  session_id uuid primary key
    references public.whatsapp_sessions(id) on delete cascade,
  job_id uuid not null,
  quarantined_until timestamptz not null,
  reason text not null check (nullif(btrim(reason), '') is not null),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table private.whatsapp_media_session_quarantine enable row level security;
alter table private.whatsapp_media_session_quarantine force row level security;
revoke all on table private.whatsapp_media_session_quarantine
  from public, anon, authenticated, service_role;

comment on table private.whatsapp_media_session_quarantine is
  'Backend-only per-session fence for detached or otherwise ambiguous Evolution Go media recovery calls.';

do $media_scale_legacy_drain_preflight$
declare
  v_legacy_claim_disabled_at timestamptz;
  v_candidate record;
  v_session_id uuid;
  v_provider_started_at timestamptz;
  v_durable_storage boolean;
  v_upload_intent boolean;
  v_embedded_base64 boolean;
begin
  select legacy_claim_disabled_at
  into v_legacy_claim_disabled_at
  from private.whatsapp_media_scale_cutover_state
  where singleton = true
  for update;

  if not found then
    raise exception using
      message = 'WhatsApp media scale activation has no durable legacy-claim fence',
      hint = 'Run supabase/cutovers/20260912_scale_whatsapp_media_queue.sql first.';
  end if;
  if v_legacy_claim_disabled_at > clock_timestamp() - interval '10 minutes' then
    raise exception using
      message = 'WhatsApp media legacy provider cooldown is not complete',
      detail = format('legacy claim disabled at %s', v_legacy_claim_disabled_at),
      hint = 'Wait until the 10-minute provider ambiguity window has elapsed, keep old media workers disabled, then retry.';
  end if;

  -- The legacy worker can die after committing its claim. Expiry alone does not
  -- change status, and its now-fenced claim function can no longer recover the
  -- row. Lock message -> job, re-check the lease after both locks, then adopt it
  -- without ever overlapping a still-valid owner.
  for v_candidate in
    select job.id, job.message_id
    from public.media_jobs as job
    where job.status = 'processing'
      and job.lease_expires_at <= clock_timestamp()
    order by job.message_id, job.id
  loop
    perform 1
    from public.whatsapp_messages as message
    where message.id = v_candidate.message_id
    for update of message;

    v_session_id := null;
    v_provider_started_at := null;
    v_durable_storage := false;
    v_upload_intent := false;
    v_embedded_base64 := false;
    select
      job.session_id,
      job.provider_started_at,
      job.storage_path is not null
        and job.actual_size > 0
        and job.storage_path like 'orgs/' || job.organization_id::text || '/assets/v2/%'
        and (
          nullif(btrim(coalesce(job.message_key->>'repair_storage_path', '')), '') is null
          or job.storage_path <> nullif(btrim(job.message_key->>'repair_storage_path'), '')
        ),
      nullif(btrim(coalesce(job.message_key->>'upload_intent_path', '')), '') is not null,
      nullif(btrim(coalesce(job.message_key->>'media_base64', job.message_key->>'base64', '')), '') is not null
    into v_session_id, v_provider_started_at, v_durable_storage, v_upload_intent, v_embedded_base64
    from public.media_jobs as job
    where job.id = v_candidate.id
      and job.status = 'processing'
      and job.lease_expires_at <= clock_timestamp()
    for update of job;

    if not found then
      continue;
    end if;

    if v_provider_started_at is not null
       and not (v_durable_storage or v_upload_intent) then
      update public.whatsapp_messages as message
      set media_status = case
            when message.media_storage_path is null then 'pending'
            else message.media_status
          end,
          media_error = case
            when message.media_storage_path is null then 'media_download_retry_scheduled'
            else message.media_error
          end,
          updated_at = now()
      where message.id = v_candidate.message_id;

      insert into private.whatsapp_media_session_quarantine as quarantine (
        session_id, job_id, quarantined_until, reason, created_at, updated_at
      ) values (
        v_session_id,
        v_candidate.id,
        clock_timestamp() + interval '10 minutes',
        'legacy_media_provider_outcome_unknown',
        now(),
        now()
      )
      on conflict (session_id) do update
      set job_id = excluded.job_id,
          quarantined_until = greatest(quarantine.quarantined_until, excluded.quarantined_until),
          reason = excluded.reason,
          updated_at = now();
    end if;

    update public.media_jobs as job
    set status = 'pending',
        -- A crashed legacy recovery must not consume the final customer retry.
        -- Provider-started work is isolated by the session quarantine instead.
        attempts = greatest(job.attempts - 1, 0),
        next_retry_at = case
          when v_provider_started_at is not null
            and not (v_durable_storage or v_upload_intent)
            then clock_timestamp() + interval '10 minutes'
          else clock_timestamp()
        end,
        failed_at = null,
        error_code = case
          when v_provider_started_at is not null
            and not (v_durable_storage or v_upload_intent)
            then 'media_provider_outcome_unknown'
          when v_durable_storage then 'media_local_finalization_pending'
          when v_upload_intent or v_embedded_base64 then 'media_local_stage_pending'
          else null
        end,
        error_message = case
          when v_provider_started_at is not null
            and not (v_durable_storage or v_upload_intent)
            then 'expired legacy provider recovery was isolated before scale activation'
          when v_durable_storage
            then 'expired legacy lease has durable storage and will finalize without provider I/O'
          when v_upload_intent or v_embedded_base64
            then 'expired legacy lease has durable local state and will resume without provider I/O'
          else null
        end,
        message_key = case
          when v_durable_storage then jsonb_strip_nulls(jsonb_build_object(
            'repair_storage_path', job.message_key->'repair_storage_path'
          ))
          else job.message_key
        end,
        locked_at = null,
        lease_expires_at = null,
        lease_duration = null,
        locked_by = null,
        lease_token = null,
        processing_slot = null,
        provider_started_at = null,
        updated_at = now()
    where job.id = v_candidate.id
      and job.status = 'processing';
  end loop;

  if exists (
    select 1
    from public.media_jobs
    where status = 'processing'
    limit 1
  ) then
    raise exception using
      message = 'WhatsApp media scale activation is blocked by legacy processing work',
      hint = 'Keep the legacy claim fenced and wait for the exact lease to expire. The next activation attempt will recover it causally; never rewrite its status manually.';
  end if;
end;
$media_scale_legacy_drain_preflight$;

create or replace function private.enforce_whatsapp_media_processing_slot()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.status is distinct from 'processing' then
    -- Rolling replicas from the serialized worker do not know this column.
    -- Clear it on their completion/retry writes so they remain compatible.
    new.processing_slot := null;
  elsif new.processing_slot is null or new.processing_slot not between 1 and 16 then
    raise exception using
      errcode = '23514',
      constraint = 'media_jobs_processing_slot_check',
      message = 'processing WhatsApp media jobs require a slot between 1 and 16';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_whatsapp_media_processing_slot()
  from public, anon, authenticated, service_role;

drop trigger if exists enforce_whatsapp_media_processing_slot on public.media_jobs;
create trigger enforce_whatsapp_media_processing_slot
before insert or update of status, processing_slot on public.media_jobs
for each row execute function private.enforce_whatsapp_media_processing_slot();

-- The previous release allowed at most one processing row, so assigning slot 1
-- is deterministic and cannot collide. A drifted database fails closed below.
update public.media_jobs
set processing_slot = 1,
    updated_at = now()
where status = 'processing'
  and processing_slot is null;

create unique index if not exists media_jobs_processing_slot_uidx
  on public.media_jobs (processing_slot)
  where status = 'processing';

create unique index if not exists media_jobs_processing_session_uidx
  on public.media_jobs (session_id)
  where status = 'processing';

create unique index if not exists media_jobs_processing_asset_uidx
  on public.media_jobs (organization_id, asset_key)
  where status = 'processing';

create index if not exists media_jobs_processing_org_idx
  on public.media_jobs (organization_id)
  where status = 'processing';

create index if not exists media_jobs_pending_session_claim_idx
  on public.media_jobs (
    session_id,
    manual_requested desc,
    priority desc,
    next_retry_at,
    created_at,
    id
  )
  where status = 'pending';

create index if not exists media_jobs_pending_local_session_claim_idx
  on public.media_jobs (
    session_id,
    manual_requested desc,
    priority desc,
    next_retry_at,
    created_at,
    id
  )
  where status = 'pending'
    and (
      (storage_path is not null and actual_size > 0)
      or nullif(btrim(coalesce(message_key->>'media_base64', message_key->>'base64', '')), '') is not null
      or nullif(btrim(coalesce(message_key->>'upload_intent_path', '')), '') is not null
    );

create index if not exists media_jobs_pending_exhausted_idx
  on public.media_jobs (provider_started_at, id)
  where status = 'pending'
    and attempts >= max_attempts;

do $media_scale_index_verification$
declare
  index_definition text;
begin
  select regexp_replace(lower(pg_get_indexdef(index_state.indexrelid)), '\s+', ' ', 'g')
  into index_definition
  from pg_catalog.pg_index as index_state
  where index_state.indexrelid = to_regclass('public.media_jobs_processing_slot_uidx')
    and index_state.indrelid = 'public.media_jobs'::regclass
    and index_state.indisready
    and index_state.indisvalid
    and index_state.indisunique;
  if index_definition is distinct from
     'create unique index media_jobs_processing_slot_uidx on public.media_jobs using btree (processing_slot) where (status = ''processing''::text)'
  then
    raise exception 'public.media_jobs_processing_slot_uidx is missing, invalid, or unexpected';
  end if;

  select regexp_replace(lower(pg_get_indexdef(index_state.indexrelid)), '\s+', ' ', 'g')
  into index_definition
  from pg_catalog.pg_index as index_state
  where index_state.indexrelid = to_regclass('public.media_jobs_processing_session_uidx')
    and index_state.indrelid = 'public.media_jobs'::regclass
    and index_state.indisready
    and index_state.indisvalid
    and index_state.indisunique;
  if index_definition is distinct from
     'create unique index media_jobs_processing_session_uidx on public.media_jobs using btree (session_id) where (status = ''processing''::text)'
  then
    raise exception 'public.media_jobs_processing_session_uidx is missing, invalid, or unexpected';
  end if;

  select regexp_replace(lower(pg_get_indexdef(index_state.indexrelid)), '\s+', ' ', 'g')
  into index_definition
  from pg_catalog.pg_index as index_state
  where index_state.indexrelid = to_regclass('public.media_jobs_processing_asset_uidx')
    and index_state.indrelid = 'public.media_jobs'::regclass
    and index_state.indisready
    and index_state.indisvalid
    and index_state.indisunique;
  if index_definition is distinct from
     'create unique index media_jobs_processing_asset_uidx on public.media_jobs using btree (organization_id, asset_key) where (status = ''processing''::text)'
  then
    raise exception 'public.media_jobs_processing_asset_uidx is missing, invalid, or unexpected';
  end if;

  select regexp_replace(lower(pg_get_indexdef(index_state.indexrelid)), '\s+', ' ', 'g')
  into index_definition
  from pg_catalog.pg_index as index_state
  where index_state.indexrelid = to_regclass('public.media_jobs_processing_org_idx')
    and index_state.indrelid = 'public.media_jobs'::regclass
    and index_state.indisready
    and index_state.indisvalid
    and not index_state.indisunique;
  if index_definition is distinct from
     'create index media_jobs_processing_org_idx on public.media_jobs using btree (organization_id) where (status = ''processing''::text)'
  then
    raise exception 'public.media_jobs_processing_org_idx is missing, invalid, or unexpected';
  end if;

  select regexp_replace(lower(pg_get_indexdef(index_state.indexrelid)), '\s+', ' ', 'g')
  into index_definition
  from pg_catalog.pg_index as index_state
  where index_state.indexrelid = to_regclass('public.media_jobs_pending_session_claim_idx')
    and index_state.indrelid = 'public.media_jobs'::regclass
    and index_state.indisready
    and index_state.indisvalid
    and not index_state.indisunique;
  if index_definition is distinct from
     'create index media_jobs_pending_session_claim_idx on public.media_jobs using btree (session_id, manual_requested desc, priority desc, next_retry_at, created_at, id) where (status = ''pending''::text)'
  then
    raise exception 'public.media_jobs_pending_session_claim_idx is missing, invalid, or unexpected';
  end if;

  select regexp_replace(lower(pg_get_indexdef(index_state.indexrelid)), '\s+', ' ', 'g')
  into index_definition
  from pg_catalog.pg_index as index_state
  where index_state.indexrelid = to_regclass('public.media_jobs_pending_local_session_claim_idx')
    and index_state.indrelid = 'public.media_jobs'::regclass
    and index_state.indisready
    and index_state.indisvalid
    and not index_state.indisunique;
  if index_definition is distinct from
     'create index media_jobs_pending_local_session_claim_idx on public.media_jobs using btree (session_id, manual_requested desc, priority desc, next_retry_at, created_at, id) where ((status = ''pending''::text) and (((storage_path is not null) and (actual_size > 0)) or (nullif(btrim(coalesce((message_key ->> ''media_base64''::text), (message_key ->> ''base64''::text), ''''::text)), ''''::text) is not null) or (nullif(btrim(coalesce((message_key ->> ''upload_intent_path''::text), ''''::text)), ''''::text) is not null)))'
  then
    raise exception 'public.media_jobs_pending_local_session_claim_idx is missing, invalid, or unexpected';
  end if;

  select regexp_replace(lower(pg_get_indexdef(index_state.indexrelid)), '\s+', ' ', 'g')
  into index_definition
  from pg_catalog.pg_index as index_state
  where index_state.indexrelid = to_regclass('public.media_jobs_pending_exhausted_idx')
    and index_state.indrelid = 'public.media_jobs'::regclass
    and index_state.indisready
    and index_state.indisvalid
    and not index_state.indisunique;
  if index_definition is distinct from
     'create index media_jobs_pending_exhausted_idx on public.media_jobs using btree (provider_started_at, id) where ((status = ''pending''::text) and (attempts >= max_attempts))'
  then
    raise exception 'public.media_jobs_pending_exhausted_idx is missing, invalid, or unexpected';
  end if;
end;
$media_scale_index_verification$;

do $media_scale_ambiguous_pending_preflight$
begin
  if exists (
    select 1
    from public.media_jobs
    where status = 'pending'
      and attempts >= max_attempts
      and provider_started_at is not null
    limit 1
  ) then
    raise exception using
      message = 'pending WhatsApp media has an exhausted provider-started outcome',
      hint = 'Quarantine and audit those exact jobs before activation; they cannot be replayed automatically.';
  end if;
end;
$media_scale_ambiguous_pending_preflight$;

do $media_scale_constraint_contract$
declare
  constraint_definition text;
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.media_jobs'::regclass
      and conname = 'media_jobs_processing_slot_check'
  ) then
    alter table public.media_jobs
      add constraint media_jobs_processing_slot_check
      check (
        (
          status = 'processing'
          and processing_slot between 1 and 16
        )
        or (
          status <> 'processing'
          and processing_slot is null
        )
      ) not valid;
  end if;

  select regexp_replace(lower(pg_get_constraintdef(oid)), '\s+', ' ', 'g')
  into constraint_definition
  from pg_catalog.pg_constraint
  where conrelid = 'public.media_jobs'::regclass
    and conname = 'media_jobs_processing_slot_check'
    and contype = 'c';

  if constraint_definition is null
     or constraint_definition not like '%status = ''processing''%'
     or constraint_definition not like '%processing_slot%1%16%'
     or constraint_definition not like '%status <> ''processing''%'
     or constraint_definition not like '%processing_slot is null%'
  then
    raise exception 'public.media_jobs_processing_slot_check exists with an unexpected definition';
  end if;
end;
$media_scale_constraint_contract$;

create or replace function private.claim_whatsapp_media_job(
  p_worker_id text,
  p_lease interval,
  p_max_concurrency integer,
  p_session_ids uuid[],
  p_all_sessions boolean
)
returns setof public.media_jobs
language plpgsql
security definer
set search_path = pg_catalog
set plan_cache_mode = force_custom_plan
as $$
declare
  v_processing_slot smallint;
  v_provider_stale_ids uuid[] := array[]::uuid[];
  v_locked_provider_stale_ids uuid[] := array[]::uuid[];
begin
  if nullif(btrim(p_worker_id), '') is null then
    raise exception 'worker id is required';
  end if;
  if p_lease is null or p_lease < interval '30 seconds' or p_lease > interval '30 minutes' then
    raise exception 'media worker lease must be between 30 seconds and 30 minutes';
  end if;
  if p_max_concurrency is null or p_max_concurrency not between 1 and 16 then
    raise exception 'media worker concurrency must be between 1 and 16';
  end if;
  if not coalesce(p_all_sessions, false)
     and coalesce(cardinality(p_session_ids), 0) = 0 then
    return;
  end if;

  -- Serialize only the short claim/slot assignment. Woken workers wait behind
  -- this transaction for milliseconds and then each gets a chance to fill a
  -- free slot; provider calls never hold the database advisory lock.
  perform pg_advisory_xact_lock(hashtextextended('vimob:whatsapp-media:slot-claim', 0));

  -- A provider download is customer-visible read work. If its worker dies after
  -- starting the request, quarantine that attempt with a cooldown instead of
  -- stopping every tenant forever. Max-attempt fencing remains authoritative.
  -- Canonical cross-table lock order is whatsapp_messages -> media_jobs. First
  -- lock the bounded set of affected message rows, then lock and revalidate the
  -- corresponding expired leases. This avoids a completion/retry deadlock.
  select coalesce(array_agg(candidate.job_id order by candidate.job_id), array[]::uuid[])
  into v_provider_stale_ids
  from (
    select job.id as job_id
    from public.media_jobs as job
    join public.whatsapp_messages as message
      on message.organization_id = job.organization_id
     and message.id = job.message_id
    where job.status = 'processing'
      and job.lease_expires_at < now()
      and job.provider_started_at is not null
    order by message.id, job.lease_expires_at, job.id
    limit 100
    for update of message skip locked
  ) as candidate;

  select coalesce(array_agg(locked_job.id order by locked_job.id), array[]::uuid[])
  into v_locked_provider_stale_ids
  from (
    select job.id
    from public.media_jobs as job
    where job.id = any(v_provider_stale_ids)
      and job.status = 'processing'
      and job.lease_expires_at < now()
      and job.provider_started_at is not null
    order by job.id
    for update skip locked
  ) as locked_job;

  update public.media_jobs as job
  set status = case
        when recovery.durable_storage or recovery.upload_intent
        then 'pending'
        when job.attempts >= job.max_attempts then 'failed'
        else 'pending'
      end,
      attempts = case
        when recovery.durable_storage or recovery.upload_intent
        then greatest(job.attempts - 1, 0)
        else job.attempts
      end,
      next_retry_at = case
        when recovery.durable_storage or recovery.upload_intent
        then now()
        else now() + interval '10 minutes'
      end,
      failed_at = case
        when recovery.durable_storage or recovery.upload_intent
        then null
        when job.attempts >= job.max_attempts then now()
        else null
      end,
      error_code = case
        when recovery.durable_storage
        then 'media_local_finalization_pending'
        when recovery.upload_intent then 'media_local_stage_pending'
        else 'media_provider_outcome_unknown'
      end,
      error_message = case
        when recovery.durable_storage
        then 'durable media is waiting for database-only finalization'
        when recovery.upload_intent
        then 'provider recovery finished; deterministic local persistence will resume'
        else 'worker lease expired after provider recovery started; provider lane is quarantined'
      end,
      message_key = case
        when recovery.durable_storage then jsonb_strip_nulls(jsonb_build_object(
          'repair_storage_path', job.message_key->'repair_storage_path'
        ))
        else job.message_key
      end,
      locked_at = null,
      lease_expires_at = null,
      lease_duration = null,
      locked_by = null,
      lease_token = null,
      processing_slot = null,
      provider_started_at = null,
      updated_at = now()
  from (
    select
      candidate.id,
      candidate.storage_path is not null
        and candidate.actual_size > 0
        and candidate.storage_path like 'orgs/' || candidate.organization_id::text || '/assets/v2/%'
        and (
          nullif(btrim(coalesce(candidate.message_key->>'repair_storage_path', '')), '') is null
          or candidate.storage_path <> nullif(btrim(candidate.message_key->>'repair_storage_path'), '')
        )
        as durable_storage,
      nullif(btrim(coalesce(candidate.message_key->>'upload_intent_path', '')), '') is not null
        as upload_intent
    from public.media_jobs as candidate
    where candidate.id = any(v_locked_provider_stale_ids)
  ) as recovery
  where job.id = recovery.id;

  insert into private.whatsapp_media_session_quarantine as quarantine (
    session_id,
    job_id,
    quarantined_until,
    reason,
    created_at,
    updated_at
  )
  select
    job.session_id,
    job.id,
    job.next_retry_at,
    'media_provider_outcome_unknown',
    now(),
    now()
  from public.media_jobs as job
  where job.id = any(v_locked_provider_stale_ids)
    and job.error_code = 'media_provider_outcome_unknown'
  on conflict (session_id) do update
  set job_id = excluded.job_id,
      quarantined_until = greatest(quarantine.quarantined_until, excluded.quarantined_until),
      reason = excluded.reason,
      updated_at = now();

  update public.whatsapp_messages as message
  set media_status = case
        when exists (
          select 1 from public.media_jobs as failed_job
          where failed_job.id = any(v_locked_provider_stale_ids)
            and failed_job.organization_id = message.organization_id
            and failed_job.message_id = message.id
            and failed_job.status = 'failed'
        ) then 'failed'
        else 'pending'
      end,
      media_error = case
        when exists (
          select 1 from public.media_jobs as failed_job
          where failed_job.id = any(v_locked_provider_stale_ids)
            and failed_job.organization_id = message.organization_id
            and failed_job.message_id = message.id
            and failed_job.status = 'failed'
        ) then 'media_provider_outcome_unknown'
        when exists (
          select 1 from public.media_jobs as local_job
          where local_job.id = any(v_locked_provider_stale_ids)
            and local_job.organization_id = message.organization_id
            and local_job.message_id = message.id
            and local_job.error_code = 'media_local_finalization_pending'
        ) then 'media_download_retry_scheduled'
        else 'media_download_retry_scheduled'
      end,
      updated_at = now()
  where message.media_storage_path is null
    and exists (
      select 1 from public.media_jobs as released_job
      where released_job.id = any(v_locked_provider_stale_ids)
        and released_job.organization_id = message.organization_id
        and released_job.message_id = message.id
    );

  with stale_before_provider as materialized (
    select stale.id
    from public.media_jobs as stale
    where stale.status = 'processing'
      and stale.lease_expires_at < now()
      and stale.provider_started_at is null
    order by stale.id
    limit 100
    for update skip locked
  )
  update public.media_jobs as stale
  set status = 'pending',
      -- No provider I/O crossed the durable marker, so this abandoned lease
      -- must not consume a customer retry attempt or strand attempts=max rows.
      attempts = greatest(stale.attempts - 1, 0),
      next_retry_at = now(),
      error_code = null,
      error_message = null,
      locked_at = null,
      lease_expires_at = null,
      lease_duration = null,
      locked_by = null,
      lease_token = null,
      processing_slot = null,
      provider_started_at = null,
      updated_at = now()
  from stale_before_provider
  where stale.id = stale_before_provider.id
    and stale.status = 'processing'
    and stale.lease_expires_at < now()
    and stale.provider_started_at is null;

  -- Older claim implementations could release a last-attempt lease to pending
  -- without returning the attempt. Those rows are otherwise permanently
  -- invisible to attempts < max_attempts. Repair only jobs that provably never
  -- crossed the provider marker, in a bounded/indexed batch, before choosing a
  -- slot. Provider-started rows fail the activation preflight and are never
  -- replayed automatically because their external outcome is ambiguous.
  with poisoned_before_provider as materialized (
    select poisoned.id
    from public.media_jobs as poisoned
    where poisoned.status = 'pending'
      and poisoned.attempts >= poisoned.max_attempts
      and poisoned.provider_started_at is null
    order by poisoned.id
    limit 100
    for update skip locked
  )
  update public.media_jobs as poisoned
  set attempts = greatest(poisoned.attempts - 1, 0),
      next_retry_at = least(poisoned.next_retry_at, now()),
      error_code = null,
      error_message = null,
      updated_at = now()
  from poisoned_before_provider
  where poisoned.id = poisoned_before_provider.id
    and poisoned.status = 'pending'
    and poisoned.attempts >= poisoned.max_attempts
    and poisoned.provider_started_at is null;

  select slot.slot::smallint
  into v_processing_slot
  from generate_series(1, p_max_concurrency) as slot(slot)
  where not exists (
    select 1
    from public.media_jobs as active
    where active.status = 'processing'
      and active.processing_slot = slot.slot
  )
  order by slot.slot
  limit 1;

  if v_processing_slot is null then
    return;
  end if;

  return query
  with active_organizations as materialized (
    select active.organization_id, count(*)::integer as active_count
    from public.media_jobs as active
    where active.status = 'processing'
    group by active.organization_id
  ), active_capacity as materialized (
    -- Raw-media budget, intentionally lower than a process RSS budget. JSON,
    -- base64, decoding and HTTP buffers multiply these bytes in memory, so this
    -- admits at most two 25 MiB jobs while retaining high concurrency for small
    -- images and database-only finalization.
    select coalesce(sum(case
      when active.storage_path is not null
        and active.actual_size > 0
        and (
          nullif(btrim(coalesce(active.message_key->>'repair_storage_path', '')), '') is null
          or active.storage_path <> nullif(btrim(active.message_key->>'repair_storage_path'), '')
        )
      then 1048576
      -- declared_size is provider input and is not a memory reservation. A
      -- malicious/stale value of 1 byte must still reserve the maximum response
      -- the Go policy will accept before rejecting a mismatch.
      when active.manual_requested then 26214400
      when lower(btrim(active.media_type)) = 'image' then 10485760
      when lower(btrim(active.media_type)) in ('audio', 'video') then 26214400
      when lower(btrim(active.media_type)) = 'sticker' then 5242880
      else 26214400
    end), 0)::bigint as inflight_bytes
    from public.media_jobs as active
    where active.status = 'processing'
  ), scoped_sessions as materialized (
    select session.id, session.organization_id, session.status, session.provider, session.is_active
    from public.whatsapp_sessions as session
    where coalesce(p_all_sessions, false) or session.id = any(p_session_ids)
  ), connected_sessions as materialized (
    select session.id, session.organization_id
    from scoped_sessions as session
    where lower(btrim(coalesce(session.provider, ''))) = 'evolution_go'
      -- Legacy rows used NULL to mean active. Provider I/O remains forbidden
      -- after logical deletion/disable, while local finalization below may still
      -- commit bytes that were already recovered for an existing message.
      and coalesce(session.is_active, true) = true
      and lower(btrim(coalesce(session.status, ''))) = 'connected'
      and not exists (
        select 1
        from public.media_jobs as active_session
        where active_session.status = 'processing'
          and active_session.session_id = session.id
      )
      and not exists (
        select 1
        from private.whatsapp_media_session_quarantine as quarantine
        where quarantine.session_id = session.id
          and quarantine.quarantined_until > now()
      )
  ), local_sessions as materialized (
    select session.id, session.organization_id
    from scoped_sessions as session
    where not exists (
      select 1
      from public.media_jobs as active_session
      where active_session.status = 'processing'
        and active_session.session_id = session.id
    )
  ), provider_due_jobs as materialized (
    -- Take one provider-dependent indexed head per active session before
    -- comparing tenant fairness. Local work has its own lifecycle-independent
    -- lane and cannot be hidden behind remote backlog.
    select head.*
    from connected_sessions as session
    cross join lateral (
      select
        job.id,
        job.organization_id,
        job.session_id,
        job.asset_key,
        job.manual_requested,
        job.priority,
        job.next_retry_at,
        job.created_at,
        case
          when job.manual_requested then 26214400
          when lower(btrim(job.media_type)) = 'image' then 10485760
          when lower(btrim(job.media_type)) in ('audio', 'video') then 26214400
          when lower(btrim(job.media_type)) = 'sticker' then 5242880
          else 26214400
        end::bigint as estimated_bytes
      from public.media_jobs as job
      where job.session_id = session.id
        and job.organization_id = session.organization_id
        and job.status = 'pending'
        and job.attempts < job.max_attempts
        and job.next_retry_at <= now()
        and not (
          (
            job.storage_path is not null
            and job.actual_size > 0
            and (
              nullif(btrim(coalesce(job.message_key->>'repair_storage_path', '')), '') is null
              or job.storage_path <> nullif(btrim(job.message_key->>'repair_storage_path'), '')
            )
          )
          or nullif(btrim(coalesce(job.message_key->>'media_base64', job.message_key->>'base64', '')), '') is not null
          or nullif(btrim(coalesce(job.message_key->>'upload_intent_path', '')), '') is not null
        )
      order by
        job.manual_requested desc,
        job.priority desc,
        job.next_retry_at,
        job.created_at,
        job.id
      limit 1
    ) as head
    where not exists (
      select 1
      from public.media_jobs as active_asset
      where active_asset.organization_id = head.organization_id
        and active_asset.asset_key = head.asset_key
        and active_asset.status = 'processing'
    )
  ), local_due_jobs as materialized (
    -- Storage/base64 work never needs an active provider session. This lets a
    -- durable upload finish after disconnect, disable or soft-delete, without
    -- reopening Evolution access for that session.
    select head.*
    from local_sessions as session
    cross join lateral (
      select
        job.id,
        job.organization_id,
        job.session_id,
        job.asset_key,
        job.manual_requested,
        job.priority,
        job.next_retry_at,
        job.created_at,
        case
          when job.storage_path is not null
            and job.actual_size > 0
            and (
              nullif(btrim(coalesce(job.message_key->>'repair_storage_path', '')), '') is null
              or job.storage_path <> nullif(btrim(job.message_key->>'repair_storage_path'), '')
            )
          then 1048576
          when job.manual_requested then 26214400
          when lower(btrim(job.media_type)) = 'image' then 10485760
          when lower(btrim(job.media_type)) in ('audio', 'video') then 26214400
          when lower(btrim(job.media_type)) = 'sticker' then 5242880
          else 26214400
        end::bigint as estimated_bytes
      from public.media_jobs as job
      where job.session_id = session.id
        and job.organization_id = session.organization_id
        and job.status = 'pending'
        and job.attempts < job.max_attempts
        and job.next_retry_at <= now()
        and (
          (
            job.storage_path is not null
            and job.actual_size > 0
            and (
              nullif(btrim(coalesce(job.message_key->>'repair_storage_path', '')), '') is null
              or job.storage_path <> nullif(btrim(job.message_key->>'repair_storage_path'), '')
            )
          )
          or nullif(btrim(coalesce(job.message_key->>'media_base64', job.message_key->>'base64', '')), '') is not null
          or nullif(btrim(coalesce(job.message_key->>'upload_intent_path', '')), '') is not null
        )
      order by
        job.manual_requested desc,
        job.priority desc,
        job.next_retry_at,
        job.created_at,
        job.id
      limit 1
    ) as head
    where not exists (
      select 1
      from public.media_jobs as active_asset
      where active_asset.organization_id = head.organization_id
        and active_asset.asset_key = head.asset_key
        and active_asset.status = 'processing'
    )
  ), due_jobs as materialized (
    select provider_head.* from provider_due_jobs as provider_head
    union all
    select local_head.* from local_due_jobs as local_head
  ), candidate as materialized (
    select job.id
    from due_jobs as due
    join public.media_jobs as job on job.id = due.id
    left join active_organizations as active_org
      on active_org.organization_id = due.organization_id
    cross join active_capacity as capacity
    where job.status = 'pending'
      and job.attempts < job.max_attempts
      and job.next_retry_at <= now()
      and capacity.inflight_bytes + due.estimated_bytes <= 67108864
      and not exists (
        select 1
        from public.media_jobs as active_session
        where active_session.status = 'processing'
          and active_session.session_id = due.session_id
      )
      and not exists (
        select 1
        from public.media_jobs as active_asset
        where active_asset.organization_id = due.organization_id
          and active_asset.asset_key = due.asset_key
          and active_asset.status = 'processing'
      )
    order by
      coalesce(active_org.active_count, 0),
      due.manual_requested desc,
      due.priority desc,
      due.next_retry_at,
      due.created_at,
      due.id
    limit 1
    for update of job skip locked
  )
  update public.media_jobs as claimed
  set status = 'processing',
      attempts = claimed.attempts + 1,
      locked_at = now(),
      lease_expires_at = now() + p_lease,
      lease_duration = p_lease,
      locked_by = btrim(p_worker_id),
      lease_token = gen_random_uuid(),
      processing_slot = v_processing_slot,
      provider_started_at = null,
      error_code = null,
      error_message = null,
      updated_at = now()
  from candidate
  where claimed.id = candidate.id
  returning claimed.*;
end;
$$;

-- Compatibility for the first scaled binary. Canonical workers use uuid[] and
-- an explicit all-sessions flag so the indexed uuid column is never cast.
create or replace function private.claim_whatsapp_media_job(
  p_worker_id text,
  p_lease interval,
  p_max_concurrency integer,
  p_session_ids text[]
)
returns setof public.media_jobs
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_all_sessions boolean := '*' = any(coalesce(p_session_ids, array[]::text[]));
  v_session_ids uuid[] := array[]::uuid[];
begin
  if v_all_sessions and cardinality(p_session_ids) <> 1 then
    raise exception 'media worker scope must be either * or a UUID allowlist';
  end if;
  if not v_all_sessions then
    select coalesce(array_agg(scope_id::uuid), array[]::uuid[])
    into v_session_ids
    from unnest(coalesce(p_session_ids, array[]::text[])) as scope(scope_id);
  end if;

  return query
  select *
  from private.claim_whatsapp_media_job(
    p_worker_id,
    p_lease,
    p_max_concurrency,
    v_session_ids,
    v_all_sessions
  );
end;
$$;

-- A pre-scale binary has no canary ownership contract. Keep its signature as a
-- safe no-op during rolling deployment; the typed/scoped binaries own all new
-- media claims after activation. This can briefly pause media, but cannot let a
-- legacy global worker escape a canary allowlist.
create or replace function private.claim_whatsapp_media_job(
  p_worker_id text,
  p_lease interval default interval '5 minutes'
)
returns setof public.media_jobs
language sql
security definer
set search_path = pg_catalog
as $$
  select job.*
  from public.media_jobs as job
  where false;
$$;

revoke all on function private.claim_whatsapp_media_job(text, interval, integer, uuid[], boolean)
  from public, anon, authenticated, service_role;
revoke all on function private.claim_whatsapp_media_job(text, interval, integer, text[])
  from public, anon, authenticated, service_role;
revoke all on function private.claim_whatsapp_media_job(text, interval)
  from public, anon, authenticated, service_role;

do $verify_media_scale_activation$
declare
  wrapper_source text;
begin
  select lower(prosrc)
  into wrapper_source
  from pg_catalog.pg_proc
  where oid = to_regprocedure('private.claim_whatsapp_media_job(text,interval)');

  if wrapper_source is null
     or wrapper_source not like '%where false%'
  then
    raise exception 'legacy media claim signature is not safely disabled for scoped rolling deployment';
  end if;

  if to_regprocedure('private.claim_whatsapp_media_job(text,interval,integer,uuid[],boolean)') is null
     or to_regprocedure('private.claim_whatsapp_media_job(text,interval,integer,text[])') is null
  then
    raise exception 'scaled WhatsApp media claim compatibility signatures are incomplete';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger as trigger_state
    join pg_catalog.pg_proc as trigger_function
      on trigger_function.oid = trigger_state.tgfoid
    where trigger_state.tgrelid = 'public.media_jobs'::regclass
      and trigger_state.tgname = 'enforce_whatsapp_media_processing_slot'
      and not trigger_state.tgisinternal
      and trigger_state.tgenabled <> 'D'
      and trigger_function.oid = to_regprocedure('private.enforce_whatsapp_media_processing_slot()')
  ) then
    raise exception 'WhatsApp media processing-slot compatibility trigger is not enabled';
  end if;

  if exists (
    select 1
    from public.media_jobs
    where (status = 'processing' and processing_slot is null)
       or (status = 'processing' and processing_slot not between 1 and 16)
  ) then
    raise exception 'WhatsApp media processing-slot invariants are not satisfied';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.media_jobs'::regclass
      and conname = 'media_jobs_processing_slot_check'
      and contype = 'c'
  ) then
    raise exception 'WhatsApp media processing-slot check is missing';
  end if;
end;
$verify_media_scale_activation$;

-- This is the final activation step. Until this statement, the previous global
-- capacity=1 semaphore remains intact. All replacement indexes, functions,
-- rolling-writer trigger, and invariants have now been verified atomically.
drop index public.media_jobs_one_global_processing_uidx;

comment on function private.claim_whatsapp_media_job(text, interval, integer, uuid[], boolean) is
  'Claims WhatsApp media with globally bounded slots, one active job per session, tenant fairness, rollout scoping, lease fencing, and delayed isolated recovery.';
comment on column public.media_jobs.processing_slot is
  'Cross-replica media capacity slot. Present only while status=processing; globally unique among active jobs.';
comment on table private.whatsapp_media_worker_state is
  'Legacy media breaker state retained for rollback compatibility. Scaled workers isolate ambiguous read jobs and do not stop unrelated tenants.';

commit;
