-- Durable, backend-only WhatsApp media queue.
--
-- Evolution Go must publish metadata-only webhooks (WEBHOOK_FILES=false). The
-- API persists the canonical message and this job in one transaction, then a
-- separately leased worker issues one recovery request globally while lease
-- ownership is intact. Evolution Go 0.7.2 may keep its internal WhatsApp
-- download alive after a cancelled HTTP request, so work whose provider call
-- started becomes terminal on lease expiry and is never replayed automatically.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

select pg_advisory_xact_lock(hashtextextended('vimob:whatsapp-media:global-claim', 0));
select pg_advisory_xact_lock(hashtextextended('vimob:whatsapp-media:mutation', 0));

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
  add column if not exists manual_requested boolean not null default false,
  add column if not exists media_queue_hardening_legacy_v1 boolean;

-- This transient marker makes the manually applied migration safely rerunnable.
-- On the first/partial run, only rows that still lack the hardened identity are
-- legacy. A successful run drops the marker; a later rerun adds it back as NULL
-- and therefore cannot retire jobs created by the hardened Go queue.
update public.media_jobs
set media_queue_hardening_legacy_v1 = true
where media_queue_hardening_legacy_v1 is not true
  and (
    nullif(btrim(dedupe_key), '') is null
    or nullif(btrim(asset_key), '') is null
  );

update public.media_jobs as job
set dedupe_key = coalesce(nullif(btrim(job.dedupe_key), ''), 'legacy:' || job.id::text),
    asset_key = coalesce(nullif(btrim(job.asset_key), ''), 'legacy:' || job.id::text),
    provider_message_id = coalesce(
      nullif(btrim(job.provider_message_id), ''),
      nullif(btrim(message.provider_message_id), ''),
      nullif(btrim(message.message_id), '')
    ),
    declared_size = coalesce(job.declared_size, message.media_size),
    actual_size = coalesce(job.actual_size, case when job.status = 'completed' then message.media_size end),
    storage_path = coalesce(nullif(btrim(job.storage_path), ''), message.media_storage_path),
	status = case
	  when lower(btrim(coalesce(job.status, ''))) in ('completed', 'done') then 'completed'
	  else 'failed'
	end,
    attempts = greatest(0, coalesce(job.attempts, 0)),
    max_attempts = greatest(1, least(10, coalesce(job.max_attempts, 3))),
    next_retry_at = coalesce(job.next_retry_at, now()),
    locked_at = null,
    lease_expires_at = null,
    lease_duration = null,
    locked_by = null,
    lease_token = null,
	provider_started_at = null,
	completed_at = case
	  when lower(btrim(coalesce(job.status, ''))) in ('completed', 'done') then coalesce(job.completed_at, job.updated_at, now())
	  else job.completed_at
	end,
	failed_at = case
	  when lower(btrim(coalesce(job.status, ''))) in ('completed', 'done') then job.failed_at
	  else coalesce(job.failed_at, job.updated_at, now())
	end,
	error_code = case
	  when lower(btrim(coalesce(job.status, ''))) in ('completed', 'done') then job.error_code
	  else 'media_legacy_job_retired'
	end,
	error_message = case
	  when lower(btrim(coalesce(job.status, ''))) in ('completed', 'done') then job.error_message
	  else coalesce(nullif(btrim(job.error_message), ''), 'pre-migration media job retired without provider download')
	end
from public.whatsapp_messages as message
where message.id = job.message_id
  and job.media_queue_hardening_legacy_v1 is true;

update public.media_jobs as job
set dedupe_key = coalesce(nullif(btrim(job.dedupe_key), ''), 'legacy:' || job.id::text),
    asset_key = coalesce(nullif(btrim(job.asset_key), ''), 'legacy:' || job.id::text),
	status = case
	  when lower(btrim(coalesce(job.status, ''))) in ('completed', 'done') then 'completed'
	  else 'failed'
	end,
    attempts = greatest(0, coalesce(job.attempts, 0)),
    max_attempts = greatest(1, least(10, coalesce(job.max_attempts, 3))),
    next_retry_at = coalesce(job.next_retry_at, now()),
	locked_at = null,
	lease_expires_at = null,
	lease_duration = null,
	locked_by = null,
	lease_token = null,
	provider_started_at = null,
	completed_at = case
	  when lower(btrim(coalesce(job.status, ''))) in ('completed', 'done') then coalesce(job.completed_at, job.updated_at, now())
	  else job.completed_at
	end,
	failed_at = case
	  when lower(btrim(coalesce(job.status, ''))) in ('completed', 'done') then job.failed_at
	  else coalesce(job.failed_at, job.updated_at, now())
	end,
	error_code = case
	  when lower(btrim(coalesce(job.status, ''))) in ('completed', 'done') then job.error_code
	  else 'media_legacy_job_retired'
	end,
	error_message = case
	  when lower(btrim(coalesce(job.status, ''))) in ('completed', 'done') then job.error_message
	  else coalesce(nullif(btrim(job.error_message), ''), 'pre-migration media job retired without provider download')
	end
where job.media_queue_hardening_legacy_v1 is true
  and (
    nullif(btrim(job.dedupe_key), '') is null
    or nullif(btrim(job.asset_key), '') is null
    or job.status is null
    or job.attempts is null
    or job.max_attempts is null
    or job.next_retry_at is null
    or job.locked_at is not null
    or job.lease_expires_at is not null
    or job.lease_duration is not null
    or job.locked_by is not null
    or job.lease_token is not null
  );

-- Zero and negative declarations are both unknown. Normalize before enforcing
-- the positive-size contract so legacy rows cannot abort the migration.
update public.media_jobs
set declared_size = null
where declared_size is not null and declared_size <= 0;

update public.media_jobs
set actual_size = null
where actual_size is not null and actual_size <= 0;

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

update public.whatsapp_messages as message
set media_status = 'failed',
    media_error = 'media_legacy_job_retired',
    updated_at = now()
from public.media_jobs as job
where job.message_id = message.id
  and job.organization_id = message.organization_id
  and job.media_queue_hardening_legacy_v1 is true
  and job.error_code = 'media_legacy_job_retired'
  and message.media_storage_path is null;

alter table public.media_jobs
  alter column dedupe_key set default ('legacy:' || gen_random_uuid()::text),
  alter column dedupe_key set not null,
  alter column asset_key set default ('legacy:' || gen_random_uuid()::text),
  alter column asset_key set not null,
  alter column attempts set default 0,
  alter column attempts set not null,
  alter column max_attempts set default 3,
  alter column max_attempts set not null,
  alter column next_retry_at set default now(),
  alter column next_retry_at set not null,
  alter column status set default 'pending',
  alter column status set not null;

-- Exactly one non-retired job is canonical for an organization/message pair.
-- Prefer a usable completion, then live queue state, and retire every loser
-- without ever making a pre-migration job downloadable again.
with ranked as (
  select job.id,
         row_number() over (
           partition by job.organization_id, job.message_id
           order by
             case
               when job.status = 'completed' and job.storage_path is not null then 0
               when job.status = 'processing' then 1
               when job.status = 'pending' then 2
               else 3
             end,
             job.created_at,
             job.id
         ) as canonical_rank
  from public.media_jobs as job
  where job.error_code is distinct from 'media_legacy_job_retired'
)
update public.media_jobs as job
set status = 'failed',
    failed_at = coalesce(job.failed_at, now()),
    error_code = 'media_legacy_job_retired',
    error_message = 'duplicate pre-migration media job retired',
    locked_at = null,
    lease_expires_at = null,
    lease_duration = null,
    locked_by = null,
    lease_token = null,
    provider_started_at = null,
    updated_at = now()
from ranked
where ranked.id = job.id
  and ranked.canonical_rank > 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'media_jobs_dedupe_key_check'
      and conrelid = 'public.media_jobs'::regclass
  ) then
    alter table public.media_jobs
      add constraint media_jobs_dedupe_key_check
      check (char_length(btrim(dedupe_key)) between 1 and 200) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'media_jobs_asset_key_check'
      and conrelid = 'public.media_jobs'::regclass
  ) then
    alter table public.media_jobs
      add constraint media_jobs_asset_key_check
      check (char_length(btrim(asset_key)) between 1 and 200) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'media_jobs_status_hardened_check'
      and conrelid = 'public.media_jobs'::regclass
  ) then
    alter table public.media_jobs
      add constraint media_jobs_status_hardened_check
      check (status in ('pending', 'processing', 'completed', 'failed')) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'media_jobs_attempts_hardened_check'
      and conrelid = 'public.media_jobs'::regclass
  ) then
    alter table public.media_jobs
      add constraint media_jobs_attempts_hardened_check
      check (attempts >= 0 and max_attempts between 1 and 10) not valid;
  end if;

end;
$$;

alter table public.media_jobs
  drop constraint if exists media_jobs_declared_size_check;

alter table public.media_jobs
  add constraint media_jobs_declared_size_check
  check (declared_size is null or declared_size > 0) not valid;

alter table public.media_jobs validate constraint media_jobs_dedupe_key_check;
alter table public.media_jobs validate constraint media_jobs_asset_key_check;
alter table public.media_jobs validate constraint media_jobs_status_hardened_check;
alter table public.media_jobs validate constraint media_jobs_attempts_hardened_check;
alter table public.media_jobs validate constraint media_jobs_declared_size_check;

alter table public.media_jobs
  drop constraint if exists media_jobs_lock_hardened_check;

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
  ) not valid;

alter table public.media_jobs validate constraint media_jobs_lock_hardened_check;

create unique index if not exists media_jobs_org_dedupe_uidx
  on public.media_jobs (organization_id, dedupe_key);

create unique index if not exists media_jobs_org_message_canonical_uidx
  on public.media_jobs (organization_id, message_id)
  where error_code is distinct from 'media_legacy_job_retired';

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

create index if not exists media_jobs_asset_active_idx
  on public.media_jobs (organization_id, asset_key)
  where status in ('pending', 'processing', 'failed');

-- PostgreSQL does not create indexes for foreign-key columns automatically.
-- These two indexes keep session-scoped claims and parent cascades bounded.
create index if not exists media_jobs_session_id_idx
  on public.media_jobs (session_id);

create index if not exists media_jobs_conversation_id_idx
  on public.media_jobs (conversation_id);

drop index if exists public.media_jobs_expired_lease_hardened_idx;

create index media_jobs_expired_lease_hardened_idx
  on public.media_jobs (lease_expires_at, id)
  where status = 'processing';

drop function if exists private.claim_whatsapp_media_job(text, interval);

create or replace function private.claim_whatsapp_media_job(
  p_worker_id text,
  p_lease interval,
  p_session_ids uuid[]
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
  if p_session_ids is not null and cardinality(p_session_ids) = 0 then
    return;
  end if;

  -- Serialize the short claim transaction. The partial unique index remains a
  -- second, fail-closed guard against more than one processing row globally.
  if not pg_try_advisory_xact_lock(hashtextextended('vimob:whatsapp-media:global-claim', 0)) then
    return;
  end if;

  -- Every transaction that can touch both the queue row and its CRM message
  -- takes this lock before either row lock. Keep the global-claim -> mutation
  -- order aligned with the Go outcome-unknown path to avoid advisory cycles.
  perform pg_advisory_xact_lock(hashtextextended('vimob:whatsapp-media:mutation', 0));

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
    and (p_session_ids is null or stale.session_id = any(p_session_ids))
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
    and stale.provider_started_at is null
    and (p_session_ids is null or stale.session_id = any(p_session_ids));

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
      and (p_session_ids is null or job.session_id = any(p_session_ids))
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

-- Evolution and the legacy Edge writer are stopped before this migration. Keep
-- the queue backend-only from the first hardened schema transaction onward.
revoke all on table public.media_jobs from public, anon, authenticated, service_role;

revoke all on function private.claim_whatsapp_media_job(text, interval, uuid[]) from public, anon, authenticated, service_role;
revoke all on function private.renew_whatsapp_media_job(uuid, text, uuid) from public, anon, authenticated, service_role;

comment on table public.media_jobs is
  'Backend-only durable WhatsApp media queue. CRM recovery requests are globally serialized and fenced by leases; expired provider outcomes are terminal.';

comment on table private.whatsapp_media_worker_state is
  'Singleton durable circuit breaker. It must be cleared only after an operator confirms no detached Evolution Go download is still running.';

comment on function private.claim_whatsapp_media_job(text, interval, uuid[]) is
  'Atomically claims at most one WhatsApp media job across every API replica and terminalizes expired unknown outcomes without replay.';

alter table public.media_jobs
  drop column if exists media_queue_hardening_legacy_v1;

commit;
