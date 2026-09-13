-- Durable, backend-only WhatsApp media queue.
--
-- Evolution Go must publish metadata-only webhooks (WEBHOOK_FILES=false). The
-- API persists the canonical message and this job in one transaction, then a
-- separately leased worker issues one recovery request globally while lease
-- ownership is intact. Evolution Go 0.7.2 may keep its internal WhatsApp
-- download alive after a cancelled HTTP request, so work whose provider call
-- started becomes terminal on lease expiry and is never replayed automatically.
--
-- Live databases must first run
-- supabase/cutovers/20260909_prepare_whatsapp_media_queue.sql with an
-- autocommit-capable client. The cutover preserves retryable legacy jobs and
-- builds the required indexes CONCURRENTLY. This migration only has a blocking
-- fallback for a locked, provably empty reset database.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '5s';

do $media_queue_foundation_preflight$
begin
  if to_regclass('public.media_jobs') is null
     or to_regclass('public.whatsapp_messages') is null then
    raise exception 'WhatsApp media queue foundation is not installed';
  end if;

  if to_regclass('public.media_jobs_org_dedupe_uidx') is null
     or to_regclass('public.media_jobs_one_global_processing_uidx') is null
     or to_regclass('public.media_jobs_hardened_claim_idx') is null
     or to_regclass('public.media_jobs_asset_ready_idx') is null
     or to_regclass('public.media_jobs_expired_lease_hardened_idx') is null then
    begin
      lock table public.media_jobs in share mode nowait;
    exception
      when lock_not_available then
        raise exception using
          message = 'WhatsApp media queue cutover was not prepared before migration',
          hint = 'Run supabase/cutovers/20260909_prepare_whatsapp_media_queue.sql with an autocommit-capable client.';
    end;

    if exists (select 1 from public.media_jobs limit 1)
       or pg_relation_size('public.media_jobs'::regclass) > 64 * 1024 * 1024 then
      raise exception using
        message = 'WhatsApp media queue indexes are missing on a non-pristine queue',
        hint = 'Run supabase/cutovers/20260909_prepare_whatsapp_media_queue.sql before this migration; it preserves pending and failed legacy jobs.';
    end if;
  end if;
end;
$media_queue_foundation_preflight$;

alter table public.media_jobs
  add column if not exists dedupe_key text,
  add column if not exists asset_key text,
  add column if not exists provider_message_id text,
  add column if not exists declared_size bigint,
  add column if not exists file_sha256 text,
  add column if not exists file_enc_sha256 text,
  add column if not exists priority smallint not null default 0,
  add column if not exists locked_at timestamptz,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists lease_duration interval,
  add column if not exists locked_by text,
  add column if not exists lease_token uuid,
  add column if not exists provider_started_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists failed_at timestamptz,
  add column if not exists error_code text,
  add column if not exists actual_size bigint,
  add column if not exists storage_path text,
  add column if not exists manual_requested boolean not null default false;

alter table public.media_jobs
  alter column dedupe_key set default ('legacy:' || gen_random_uuid()::text),
  alter column asset_key set default ('legacy:' || gen_random_uuid()::text),
  alter column attempts set default 0,
  alter column max_attempts set default 3,
  alter column next_retry_at set default now(),
  alter column status set default 'pending';

-- The live cutover performs the only legacy backfill. Do not normalize or
-- terminalize existing jobs here: if readiness is incomplete, fail closed and
-- leave every pending/failed row byte-for-byte retryable by an audited cutover.
do $verify_media_queue_legacy_rows_prepared$
begin
  if exists (
    select 1
    from public.media_jobs as job
    where nullif(btrim(job.dedupe_key), '') is null
       or nullif(btrim(job.asset_key), '') is null
       or job.attempts is null
       or job.max_attempts is null
       or job.next_retry_at is null
       or job.status is null
       or job.status not in ('pending', 'processing', 'completed', 'failed')
       or job.attempts < 0
       or job.max_attempts not between 1 and 10
       or job.declared_size < 0
       or (
         job.status <> 'processing'
         and (
           job.locked_at is not null
           or job.lease_expires_at is not null
           or job.lease_duration is not null
           or job.locked_by is not null
           or job.lease_token is not null
         )
       )
    limit 1
  ) then
    raise exception using
      message = 'WhatsApp media queue legacy rows were not prepared safely',
      hint = 'Run supabase/cutovers/20260909_prepare_whatsapp_media_queue.sql and resolve its non-destructive preflight findings.';
  end if;
end;
$verify_media_queue_legacy_rows_prepared$;

create table if not exists private.whatsapp_media_worker_state (
  singleton boolean primary key default true check (singleton),
  breaker_open boolean not null default false,
  breaker_opened_at timestamptz,
  breaker_reason text,
  breaker_job_id uuid,
  updated_at timestamptz not null default now(),
  constraint whatsapp_media_worker_state_breaker_check check (
    (breaker_open and breaker_opened_at is not null and nullif(btrim(breaker_reason), '') is not null)
    or
    (not breaker_open and breaker_opened_at is null and breaker_reason is null and breaker_job_id is null)
  )
);

insert into private.whatsapp_media_worker_state (singleton)
values (true)
on conflict (singleton) do nothing;

revoke all on table private.whatsapp_media_worker_state from public, anon, authenticated, service_role;

do $prepare_empty_media_queue_constraints$
declare
  constraints_missing boolean;
begin
  constraints_missing := not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.media_jobs'::regclass
      and conname = 'media_jobs_required_hardened_fields_check'
  ) or not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.media_jobs'::regclass
      and conname = 'media_jobs_dedupe_key_check'
  ) or not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.media_jobs'::regclass
      and conname = 'media_jobs_asset_key_check'
  ) or not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.media_jobs'::regclass
      and conname = 'media_jobs_status_hardened_check'
  ) or not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.media_jobs'::regclass
      and conname = 'media_jobs_attempts_hardened_check'
  ) or not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.media_jobs'::regclass
      and conname = 'media_jobs_declared_size_check'
  ) or not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.media_jobs'::regclass
      and conname = 'media_jobs_lock_hardened_check'
  );

  if constraints_missing then
    begin
      lock table public.media_jobs in share mode nowait;
    exception
      when lock_not_available then
        raise exception using
          message = 'WhatsApp media queue constraints were not prepared before migration',
          hint = 'Run supabase/cutovers/20260909_prepare_whatsapp_media_queue.sql with an autocommit-capable client.';
    end;

    if exists (select 1 from public.media_jobs limit 1)
       or pg_relation_size('public.media_jobs'::regclass) > 64 * 1024 * 1024 then
      raise exception using
        message = 'WhatsApp media queue constraints are missing on a non-pristine queue',
        hint = 'Run supabase/cutovers/20260909_prepare_whatsapp_media_queue.sql before this migration.';
    end if;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'media_jobs_required_hardened_fields_check'
      and conrelid = 'public.media_jobs'::regclass
  ) then
    alter table public.media_jobs
      add constraint media_jobs_required_hardened_fields_check
      check (
        dedupe_key is not null
        and asset_key is not null
        and attempts is not null
        and max_attempts is not null
        and next_retry_at is not null
        and status is not null
      );
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'media_jobs_dedupe_key_check'
      and conrelid = 'public.media_jobs'::regclass
  ) then
    alter table public.media_jobs
      add constraint media_jobs_dedupe_key_check
      check (char_length(btrim(dedupe_key)) between 1 and 200);
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'media_jobs_asset_key_check'
      and conrelid = 'public.media_jobs'::regclass
  ) then
    alter table public.media_jobs
      add constraint media_jobs_asset_key_check
      check (char_length(btrim(asset_key)) between 1 and 200);
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'media_jobs_status_hardened_check'
      and conrelid = 'public.media_jobs'::regclass
  ) then
    alter table public.media_jobs
      add constraint media_jobs_status_hardened_check
      check (status in ('pending', 'processing', 'completed', 'failed'));
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'media_jobs_attempts_hardened_check'
      and conrelid = 'public.media_jobs'::regclass
  ) then
    alter table public.media_jobs
      add constraint media_jobs_attempts_hardened_check
      check (attempts >= 0 and max_attempts between 1 and 10);
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'media_jobs_declared_size_check'
      and conrelid = 'public.media_jobs'::regclass
  ) then
    alter table public.media_jobs
      add constraint media_jobs_declared_size_check
      check (declared_size is null or declared_size >= 0);
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'media_jobs_lock_hardened_check'
      and conrelid = 'public.media_jobs'::regclass
  ) then
    alter table public.media_jobs
      add constraint media_jobs_lock_hardened_check
      check (
        (
          status = 'processing'
          and locked_at is not null
          and lease_expires_at is not null
          and lease_duration between interval '30 seconds' and interval '30 minutes'
          and nullif(btrim(locked_by), '') is not null
          and lease_token is not null
        )
        or (
          status <> 'processing'
          and locked_at is null
          and lease_expires_at is null
          and lease_duration is null
          and locked_by is null
          and lease_token is null
        )
      );
  end if;
end;
$prepare_empty_media_queue_constraints$;

create unique index if not exists media_jobs_org_dedupe_uidx
  on public.media_jobs (organization_id, dedupe_key);

-- This is the hard cross-replica semaphore. Even if multiple API replicas run
-- the media worker, the database permits exactly one active download lease.
create unique index if not exists media_jobs_one_global_processing_uidx
  on public.media_jobs ((1))
  where status = 'processing';

create index if not exists media_jobs_hardened_claim_idx
  on public.media_jobs (manual_requested desc, priority desc, next_retry_at, created_at, id)
  where status = 'pending';

create index if not exists media_jobs_asset_ready_idx
  on public.media_jobs (organization_id, asset_key, completed_at desc, id)
  where status = 'completed' and storage_path is not null;

create index if not exists media_jobs_expired_lease_hardened_idx
  on public.media_jobs (lease_expires_at, id)
  where status = 'processing';

do $verify_media_queue_release_artifacts$
declare
  index_definition text;
begin
  if exists (
    select 1
    from pg_catalog.pg_constraint constraint_state
    where constraint_state.conrelid = 'public.media_jobs'::regclass
      and constraint_state.conname in (
        'media_jobs_required_hardened_fields_check',
        'media_jobs_dedupe_key_check',
        'media_jobs_asset_key_check',
        'media_jobs_status_hardened_check',
        'media_jobs_attempts_hardened_check',
        'media_jobs_declared_size_check',
        'media_jobs_lock_hardened_check'
      )
      and (constraint_state.contype <> 'c' or not constraint_state.convalidated)
  ) or (
    select count(*)
    from pg_catalog.pg_constraint constraint_state
    where constraint_state.conrelid = 'public.media_jobs'::regclass
      and constraint_state.conname in (
        'media_jobs_required_hardened_fields_check',
        'media_jobs_dedupe_key_check',
        'media_jobs_asset_key_check',
        'media_jobs_status_hardened_check',
        'media_jobs_attempts_hardened_check',
        'media_jobs_declared_size_check',
        'media_jobs_lock_hardened_check'
      )
  ) <> 7 then
    raise exception using
      message = 'WhatsApp media queue constraints are missing or not validated',
      hint = 'Run supabase/cutovers/20260909_prepare_whatsapp_media_queue.sql before this migration.';
  end if;

  select regexp_replace(lower(pg_get_indexdef(index_state.indexrelid)), '\s+', ' ', 'g')
  into index_definition
  from pg_catalog.pg_index index_state
  where index_state.indexrelid = to_regclass('public.media_jobs_org_dedupe_uidx')
    and index_state.indrelid = 'public.media_jobs'::regclass
    and index_state.indisready
    and index_state.indisvalid
    and index_state.indisunique;
  if index_definition is null
     or index_definition not like '%using btree (organization_id, dedupe_key)%' then
    raise exception 'public.media_jobs_org_dedupe_uidx is missing, invalid, or unexpected';
  end if;

  select regexp_replace(lower(pg_get_indexdef(index_state.indexrelid)), '\s+', ' ', 'g')
  into index_definition
  from pg_catalog.pg_index index_state
  where index_state.indexrelid = to_regclass('public.media_jobs_one_global_processing_uidx')
    and index_state.indrelid = 'public.media_jobs'::regclass
    and index_state.indisready
    and index_state.indisvalid
    and index_state.indisunique;
  if index_definition is null
     or index_definition not like '%using btree ((1))%'
     or index_definition not like '%where (status = ''processing''%'
  then
    raise exception 'public.media_jobs_one_global_processing_uidx is missing, invalid, or unexpected';
  end if;

  select regexp_replace(lower(pg_get_indexdef(index_state.indexrelid)), '\s+', ' ', 'g')
  into index_definition
  from pg_catalog.pg_index index_state
  where index_state.indexrelid = to_regclass('public.media_jobs_hardened_claim_idx')
    and index_state.indrelid = 'public.media_jobs'::regclass
    and index_state.indisready
    and index_state.indisvalid
    and not index_state.indisunique;
  if index_definition is null
     or index_definition not like '%(manual_requested desc, priority desc, next_retry_at, created_at, id)%'
     or index_definition not like '%where (status = ''pending''%'
  then
    raise exception 'public.media_jobs_hardened_claim_idx is missing, invalid, or unexpected';
  end if;

  select regexp_replace(lower(pg_get_indexdef(index_state.indexrelid)), '\s+', ' ', 'g')
  into index_definition
  from pg_catalog.pg_index index_state
  where index_state.indexrelid = to_regclass('public.media_jobs_asset_ready_idx')
    and index_state.indrelid = 'public.media_jobs'::regclass
    and index_state.indisready
    and index_state.indisvalid
    and not index_state.indisunique;
  if index_definition is null
     or index_definition not like '%(organization_id, asset_key, completed_at desc, id)%'
     or index_definition not like '%status = ''completed''%'
     or index_definition not like '%storage_path is not null%'
  then
    raise exception 'public.media_jobs_asset_ready_idx is missing, invalid, or unexpected';
  end if;

  select regexp_replace(lower(pg_get_indexdef(index_state.indexrelid)), '\s+', ' ', 'g')
  into index_definition
  from pg_catalog.pg_index index_state
  where index_state.indexrelid = to_regclass('public.media_jobs_expired_lease_hardened_idx')
    and index_state.indrelid = 'public.media_jobs'::regclass
    and index_state.indisready
    and index_state.indisvalid
    and not index_state.indisunique;
  if index_definition is null
     or index_definition not like '%(lease_expires_at, id)%'
     or index_definition not like '%where (status = ''processing''%'
  then
    raise exception 'public.media_jobs_expired_lease_hardened_idx is missing, invalid, or unexpected';
  end if;
end;
$verify_media_queue_release_artifacts$;

-- The online cutover validates a required-fields check first, so PostgreSQL can
-- prove these NOT NULL changes without a long live-table scan. On a reset the
-- table is locked and empty.
alter table public.media_jobs
  alter column dedupe_key set not null,
  alter column asset_key set not null,
  alter column attempts set not null,
  alter column max_attempts set not null,
  alter column next_retry_at set not null,
  alter column status set not null;

create or replace function private.claim_whatsapp_media_job(
  p_worker_id text,
  p_lease interval default interval '5 minutes'
)
returns setof public.media_jobs
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_unknown_job_id uuid;
begin
  if nullif(btrim(p_worker_id), '') is null then
    raise exception 'worker id is required';
  end if;
  if p_lease is null or p_lease < interval '30 seconds' or p_lease > interval '30 minutes' then
    raise exception 'media worker lease must be between 30 seconds and 30 minutes';
  end if;

  -- Serialize the short claim transaction. The partial unique index remains a
  -- second, fail-closed guard against more than one processing row globally.
  if not pg_try_advisory_xact_lock(hashtextextended('vimob:whatsapp-media:global-claim', 0)) then
    return;
  end if;

  -- Re-check the durable breaker only while holding the same transaction lock
  -- used by the backend when it opens the breaker. This closes the cross-replica
  -- race between releasing a processing row and pausing future claims.
  if exists (
    select 1
    from private.whatsapp_media_worker_state
    where singleton = true and breaker_open = true
  ) then
    return;
  end if;

  select stale.id
  into v_unknown_job_id
  from public.media_jobs as stale
  where stale.status = 'processing'
    and stale.lease_expires_at < now()
    and stale.provider_started_at is not null
  order by stale.lease_expires_at, stale.id
  limit 1
  for update;

  if v_unknown_job_id is not null then
    update public.media_jobs as stale
    set status = 'failed',
        failed_at = coalesce(stale.failed_at, now()),
        error_code = 'media_provider_outcome_unknown',
        error_message = 'worker lease expired after provider recovery started; automatic replay disabled',
        locked_at = null,
        lease_expires_at = null,
        lease_duration = null,
        locked_by = null,
        lease_token = null,
        updated_at = now()
    where stale.id = v_unknown_job_id;

    update public.whatsapp_messages as message
    set media_status = 'failed',
        media_error = 'media_provider_outcome_unknown',
        updated_at = now()
    from public.media_jobs as stale
    where stale.id = v_unknown_job_id
      and message.organization_id = stale.organization_id
      and message.id = stale.message_id
      and message.media_storage_path is null;

    insert into private.whatsapp_media_worker_state (
      singleton, breaker_open, breaker_opened_at,
      breaker_reason, breaker_job_id, updated_at
    ) values (
      true, true, now(),
      'media_provider_outcome_unknown', v_unknown_job_id, now()
    )
    on conflict (singleton) do update
    set breaker_open = true,
        breaker_opened_at = coalesce(private.whatsapp_media_worker_state.breaker_opened_at, excluded.breaker_opened_at),
        breaker_reason = excluded.breaker_reason,
        breaker_job_id = excluded.breaker_job_id,
        updated_at = now();

    return;
  end if;

  update public.media_jobs as stale
  set status = 'pending',
      next_retry_at = now(),
      error_code = null,
      error_message = null,
      locked_at = null,
      lease_expires_at = null,
      lease_duration = null,
      locked_by = null,
      lease_token = null,
      updated_at = now()
  where stale.status = 'processing'
    and stale.lease_expires_at < now()
    and stale.provider_started_at is null;

  if exists (select 1 from public.media_jobs where status = 'processing') then
    return;
  end if;

  return query
  with candidate as materialized (
    select job.id
    from public.media_jobs as job
    where job.status = 'pending'
      and job.attempts < job.max_attempts
      and job.next_retry_at <= now()
    order by job.manual_requested desc, job.priority desc, job.next_retry_at, job.created_at, job.id
    limit 1
    for update skip locked
  )
  update public.media_jobs as claimed
  set status = 'processing',
      attempts = claimed.attempts + 1,
      locked_at = now(),
      lease_expires_at = now() + p_lease,
      lease_duration = p_lease,
      locked_by = btrim(p_worker_id),
      lease_token = gen_random_uuid(),
      error_code = null,
      error_message = null,
      updated_at = now()
  from candidate
  where claimed.id = candidate.id
  returning claimed.*;
end;
$$;

create or replace function private.renew_whatsapp_media_job(
  p_job_id uuid,
  p_worker_id text,
  p_lease_token uuid
)
returns boolean
language sql
security definer
set search_path = pg_catalog
as $$
  with renewed as (
    update public.media_jobs
    set locked_at = now(),
        lease_expires_at = now() + lease_duration,
        updated_at = now()
    where id = p_job_id
      and status = 'processing'
      and locked_by = btrim(p_worker_id)
      and lease_token = p_lease_token
    returning 1
  )
  select exists(select 1 from renewed);
$$;

alter table public.media_jobs enable row level security;

-- The legacy Edge webhook still needs INSERT during the zero-downtime cutover.
-- Restrict service_role to that one operation: the retired Edge media-worker
-- cannot SELECT or UPDATE a pending row, so it cannot race the Go lease owner.
revoke all on table public.media_jobs from public, anon, authenticated, service_role;
grant insert on table public.media_jobs to service_role;

revoke all on function private.claim_whatsapp_media_job(text, interval) from public, anon, authenticated, service_role;
revoke all on function private.renew_whatsapp_media_job(uuid, text, uuid) from public, anon, authenticated, service_role;

comment on table public.media_jobs is
  'Backend-only durable WhatsApp media queue. CRM recovery requests are globally serialized and fenced by leases; expired provider outcomes are terminal.';

comment on table private.whatsapp_media_worker_state is
  'Singleton durable circuit breaker. It must be cleared only after an operator confirms no detached Evolution Go download is still running.';

comment on function private.claim_whatsapp_media_job(text, interval) is
  'Atomically claims at most one WhatsApp media job across every API replica and terminalizes expired unknown outcomes without replay.';

commit;
