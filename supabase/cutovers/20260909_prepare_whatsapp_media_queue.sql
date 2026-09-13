-- Protected production pre-step for
-- 20260904225214_harden_whatsapp_media_queue.sql.
--
-- Run with an autocommit-capable SQL client after disabling the legacy Edge
-- media-worker and verifying that no media job is processing. Do not wrap this
-- file in one transaction: the indexes are intentionally built CONCURRENTLY.
-- Pending and failed jobs keep their status, retry counters, provider payload,
-- and errors. No legacy job is terminalized by this cutover.

set lock_timeout = '5s';
set statement_timeout = '0';

do $preflight_whatsapp_media_queue_foundation$
begin
  if to_regclass('public.media_jobs') is null
     or to_regclass('public.whatsapp_messages') is null then
    raise exception 'WhatsApp media queue foundation is not installed';
  end if;

  if exists (
    select 1
    from public.media_jobs as job
    where job.status is not null
      and lower(btrim(job.status)) = 'processing'
    limit 1
  ) then
    raise exception using
      message = 'WhatsApp media queue cutover blocked by a processing legacy job',
      hint = 'Disable the legacy Edge media-worker, let in-flight work finish, and retry. Do not rewrite the job status.';
  end if;

  if exists (
    select 1
    from public.media_jobs as job
    where job.status is null
       or job.status not in ('pending', 'failed', 'completed', 'done')
    limit 1
  ) then
    raise exception using
      message = 'WhatsApp media queue contains an unsupported legacy status',
      hint = 'Audit and reconcile the exact rows explicitly; this cutover never maps unknown work to failed.';
  end if;
end;
$preflight_whatsapp_media_queue_foundation$;

-- Keep old webhook INSERTs valid between this preparation and the migration.
-- New legacy rows receive non-empty keys immediately; existing rows are
-- backfilled below without changing pending/failed state.
begin;
set local lock_timeout = '5s';

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

commit;

-- Hydrate metadata that the native worker can safely recover from the canonical
-- message. The WHERE clause avoids touching already-prepared jobs.
update public.media_jobs as job
set provider_message_id = coalesce(
      nullif(btrim(job.provider_message_id), ''),
      nullif(btrim(message.provider_message_id), ''),
      nullif(btrim(message.message_id), '')
    ),
    declared_size = coalesce(job.declared_size, message.media_size),
    actual_size = coalesce(
      job.actual_size,
      case
        when lower(btrim(job.status)) in ('completed', 'done') then message.media_size
      end
    ),
    storage_path = coalesce(
      nullif(btrim(job.storage_path), ''),
      nullif(btrim(message.media_storage_path), '')
    )
from public.whatsapp_messages as message
where message.id = job.message_id
  and (
    nullif(btrim(job.provider_message_id), '') is null
    or job.declared_size is null
    or (
      lower(btrim(job.status)) in ('completed', 'done')
      and job.actual_size is null
      and message.media_size is not null
    )
    or (
      nullif(btrim(job.storage_path), '') is null
      and nullif(btrim(message.media_storage_path), '') is not null
    )
  );

-- Deterministic row-local keys retain every legacy job independently. Existing
-- retry counters and errors win; only nullable foundation fields are filled.
update public.media_jobs as job
set dedupe_key = coalesce(nullif(btrim(job.dedupe_key), ''), 'legacy:' || job.id::text),
    asset_key = coalesce(nullif(btrim(job.asset_key), ''), 'legacy:' || job.id::text),
    attempts = coalesce(job.attempts, 0),
    max_attempts = coalesce(job.max_attempts, 3),
    next_retry_at = coalesce(job.next_retry_at, now())
where nullif(btrim(job.dedupe_key), '') is null
   or nullif(btrim(job.asset_key), '') is null
   or job.attempts is null
   or job.max_attempts is null
   or job.next_retry_at is null;

-- `done` was the legacy spelling of a successful job. This is the only status
-- normalization; pending and failed are deliberately unchanged.
update public.media_jobs as job
set status = 'completed'
where job.status = 'done';

do $verify_whatsapp_media_queue_backfill$
begin
  if exists (
    select 1
    from public.media_jobs as job
    where job.status is not null
      and lower(btrim(job.status)) = 'processing'
    limit 1
  ) then
    raise exception using
      message = 'WhatsApp media queue became active during cutover',
      hint = 'Keep the legacy Edge media-worker disabled, let in-flight work finish, then retry without rewriting status.';
  end if;

  if exists (
    select 1
    from public.media_jobs as job
    where nullif(btrim(job.dedupe_key), '') is null
       or char_length(btrim(job.dedupe_key)) > 200
       or nullif(btrim(job.asset_key), '') is null
       or char_length(btrim(job.asset_key)) > 200
       or job.status is null
       or job.status not in ('pending', 'completed', 'failed')
       or job.attempts is null
       or job.attempts < 0
       or job.max_attempts is null
       or job.max_attempts not between 1 and 10
       or job.next_retry_at is null
       or job.declared_size < 0
       or job.locked_at is not null
       or job.lease_expires_at is not null
       or job.lease_duration is not null
       or job.locked_by is not null
       or job.lease_token is not null
    limit 1
  ) then
    raise exception using
      message = 'WhatsApp media queue contains rows that cannot be hardened losslessly',
      hint = 'Audit the exact rows and correct metadata explicitly. This cutover does not terminalize or discard them.';
  end if;

  if exists (
    select 1
    from public.media_jobs as job
    group by job.organization_id, job.dedupe_key
    having count(*) > 1
    limit 1
  ) then
    raise exception using
      message = 'WhatsApp media queue contains duplicate prepared dedupe keys',
      hint = 'Resolve the duplicate identity explicitly before building the unique index.';
  end if;
end;
$verify_whatsapp_media_queue_backfill$;

-- NOT VALID keeps each ADD short; VALIDATE scans without taking the stronger
-- lock used by an immediate validated CHECK. New writes are constrained as soon
-- as each CHECK exists.
do $prepare_whatsapp_media_queue_constraints$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.media_jobs'::regclass
      and conname = 'media_jobs_required_hardened_fields_check'
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
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.media_jobs'::regclass
      and conname = 'media_jobs_dedupe_key_check'
  ) then
    alter table public.media_jobs
      add constraint media_jobs_dedupe_key_check
      check (char_length(btrim(dedupe_key)) between 1 and 200) not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.media_jobs'::regclass
      and conname = 'media_jobs_asset_key_check'
  ) then
    alter table public.media_jobs
      add constraint media_jobs_asset_key_check
      check (char_length(btrim(asset_key)) between 1 and 200) not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.media_jobs'::regclass
      and conname = 'media_jobs_status_hardened_check'
  ) then
    alter table public.media_jobs
      add constraint media_jobs_status_hardened_check
      check (status in ('pending', 'processing', 'completed', 'failed')) not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.media_jobs'::regclass
      and conname = 'media_jobs_attempts_hardened_check'
  ) then
    alter table public.media_jobs
      add constraint media_jobs_attempts_hardened_check
      check (attempts >= 0 and max_attempts between 1 and 10) not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.media_jobs'::regclass
      and conname = 'media_jobs_declared_size_check'
  ) then
    alter table public.media_jobs
      add constraint media_jobs_declared_size_check
      check (declared_size is null or declared_size >= 0) not valid;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.media_jobs'::regclass
      and conname = 'media_jobs_lock_hardened_check'
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
      ) not valid;
  end if;
end;
$prepare_whatsapp_media_queue_constraints$;

alter table public.media_jobs
  validate constraint media_jobs_required_hardened_fields_check;
alter table public.media_jobs
  validate constraint media_jobs_dedupe_key_check;
alter table public.media_jobs
  validate constraint media_jobs_asset_key_check;
alter table public.media_jobs
  validate constraint media_jobs_status_hardened_check;
alter table public.media_jobs
  validate constraint media_jobs_attempts_hardened_check;
alter table public.media_jobs
  validate constraint media_jobs_declared_size_check;
alter table public.media_jobs
  validate constraint media_jobs_lock_hardened_check;

do $preflight_whatsapp_media_queue_online_indexes$
declare
  index_name text;
begin
  foreach index_name in array array[
    'media_jobs_org_dedupe_uidx',
    'media_jobs_one_global_processing_uidx',
    'media_jobs_hardened_claim_idx',
    'media_jobs_asset_ready_idx',
    'media_jobs_expired_lease_hardened_idx'
  ]
  loop
    if exists (
      select 1
      from pg_catalog.pg_class index_relation
      join pg_catalog.pg_index index_state
        on index_state.indexrelid = index_relation.oid
      join pg_catalog.pg_namespace index_namespace
        on index_namespace.oid = index_relation.relnamespace
      where index_namespace.nspname = 'public'
        and index_relation.relname = index_name
        and (not index_state.indisready or not index_state.indisvalid)
    ) then
      raise exception using
        message = format('index public.%I exists but is not ready and valid', index_name),
        hint = 'Inspect it, then use DROP INDEX CONCURRENTLY before retrying this cutover.';
    end if;
  end loop;
end;
$preflight_whatsapp_media_queue_online_indexes$;

create unique index concurrently if not exists media_jobs_org_dedupe_uidx
  on public.media_jobs (organization_id, dedupe_key);

-- Hard cross-replica semaphore: never increase media concurrency by changing
-- this index without a separately reviewed global capacity design.
create unique index concurrently if not exists media_jobs_one_global_processing_uidx
  on public.media_jobs ((1))
  where status = 'processing';

create index concurrently if not exists media_jobs_hardened_claim_idx
  on public.media_jobs (manual_requested desc, priority desc, next_retry_at, created_at, id)
  where status = 'pending';

create index concurrently if not exists media_jobs_asset_ready_idx
  on public.media_jobs (organization_id, asset_key, completed_at desc, id)
  where status = 'completed' and storage_path is not null;

create index concurrently if not exists media_jobs_expired_lease_hardened_idx
  on public.media_jobs (lease_expires_at, id)
  where status = 'processing';

do $verify_whatsapp_media_queue_online_artifacts$
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
    raise exception 'WhatsApp media queue constraints are missing or not validated';
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
    raise exception 'public.media_jobs_org_dedupe_uidx is not ready, valid, and exact';
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
    raise exception 'public.media_jobs_one_global_processing_uidx is not ready, valid, and exact';
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
    raise exception 'public.media_jobs_hardened_claim_idx is not ready, valid, and exact';
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
    raise exception 'public.media_jobs_asset_ready_idx is not ready, valid, and exact';
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
    raise exception 'public.media_jobs_expired_lease_hardened_idx is not ready, valid, and exact';
  end if;
end;
$verify_whatsapp_media_queue_online_artifacts$;

reset statement_timeout;
reset lock_timeout;
