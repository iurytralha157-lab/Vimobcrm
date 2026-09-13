-- ONLINE PREPARATION ONLY. Run with an autocommit-capable psql client before
-- 20260912152432_scale_whatsapp_media_queue_safely.sql on a populated queue.
-- CREATE INDEX CONCURRENTLY must not run inside an explicit transaction.
-- Execute this file in a dedicated psql invocation. ON_ERROR_STOP makes that
-- invocation disconnect on any post-lock failure, releasing the session lock.
\set ON_ERROR_STOP on

begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $media_scale_cutover_preflight$
declare
  index_name text;
begin
  if to_regclass('public.media_jobs') is null
     or to_regclass('public.media_jobs_one_global_processing_uidx') is null then
    raise exception 'serialized WhatsApp media queue foundation is not ready';
  end if;
  if (
    select count(*)
    from public.media_jobs
    where status = 'processing'
  ) > 1 then
    raise exception 'media queue drift: more than one processing job exists before scale cutover';
  end if;

  foreach index_name in array array[
    'media_jobs_processing_slot_uidx',
    'media_jobs_processing_session_uidx',
    'media_jobs_processing_asset_uidx',
    'media_jobs_processing_org_idx',
    'media_jobs_pending_session_claim_idx',
    'media_jobs_pending_local_session_claim_idx',
    'media_jobs_pending_exhausted_idx'
  ]
  loop
    if exists (
      select 1
      from pg_catalog.pg_index
      where indexrelid = to_regclass('public.' || index_name)
        and (not indisready or not indisvalid)
    ) then
      raise exception using
        message = format('index public.%I exists but is invalid', index_name),
        hint = 'Inspect it, then DROP INDEX CONCURRENTLY before retrying this cutover.';
    end if;
  end loop;
end;
$media_scale_cutover_preflight$;

alter table public.media_jobs
  add column if not exists processing_slot smallint;

create schema if not exists private;

-- Wait for every invocation that already entered the legacy claim transaction
-- before replacing its body.  The timestamp below is therefore a causal fence:
-- after it is committed, no old two-argument claimant can publish a new lease.
select pg_advisory_xact_lock(hashtextextended('vimob:whatsapp-media:scale-cutover', 0));
select pg_advisory_xact_lock(hashtextextended('vimob:whatsapp-media:global-claim', 0));

create table if not exists private.whatsapp_media_scale_cutover_state (
  singleton boolean primary key default true check (singleton),
  legacy_claim_disabled_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table private.whatsapp_media_scale_cutover_state enable row level security;
alter table private.whatsapp_media_scale_cutover_state force row level security;
revoke all on table private.whatsapp_media_scale_cutover_state
  from public, anon, authenticated, service_role;

-- Fence the deployed pre-scale worker before waiting for provider I/O to drain.
-- This transaction commits independently, so a failed drain check leaves the
-- safe no-op in place and a later retry cannot start fresh legacy work.
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

revoke all on function private.claim_whatsapp_media_job(text, interval)
  from public, anon, authenticated, service_role;

insert into private.whatsapp_media_scale_cutover_state (
  singleton,
  legacy_claim_disabled_at
)
values (true, clock_timestamp())
on conflict (singleton) do nothing;

-- Expand only. Keep processing_slot NULL and retain the previous global unique
-- semaphore until the activation migration atomically installs slot semantics.

commit;

-- Session-level lock spans the autocommit-only concurrent index statements.
-- Acquire it only after the transactional fence/expand succeeds. An existing
-- processing row is safe while these nullable/partial indexes are built. The
-- activation migration takes the same key, waits out the ambiguity window and
-- causally recovers an expired legacy lease before enabling slot semantics.
select pg_advisory_lock(hashtextextended('vimob:whatsapp-media:scale-cutover', 0));

create unique index concurrently if not exists media_jobs_processing_slot_uidx
  on public.media_jobs (processing_slot)
  where status = 'processing';

create unique index concurrently if not exists media_jobs_processing_session_uidx
  on public.media_jobs (session_id)
  where status = 'processing';

create unique index concurrently if not exists media_jobs_processing_asset_uidx
  on public.media_jobs (organization_id, asset_key)
  where status = 'processing';

create index concurrently if not exists media_jobs_processing_org_idx
  on public.media_jobs (organization_id)
  where status = 'processing';

create index concurrently if not exists media_jobs_pending_session_claim_idx
  on public.media_jobs (
    session_id,
    manual_requested desc,
    priority desc,
    next_retry_at,
    created_at,
    id
  )
  where status = 'pending';

-- Offline sessions must never make the normal head seek scan through remote
-- media. This narrow index gives already-uploaded/base64 jobs their own local
-- finalization lane without provider I/O.
create index concurrently if not exists media_jobs_pending_local_session_claim_idx
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

-- Finds legacy leases that crashed before provider I/O on their last counted
-- attempt. The scaled claim repairs these rows in bounded batches.
create index concurrently if not exists media_jobs_pending_exhausted_idx
  on public.media_jobs (provider_started_at, id)
  where status = 'pending'
    and attempts >= max_attempts;

do $verify_whatsapp_media_scale_online_artifacts$
declare
  index_definition text;
begin
  select regexp_replace(lower(pg_get_indexdef(indexrelid)), '\s+', ' ', 'g')
  into index_definition
  from pg_catalog.pg_index
  where indexrelid = to_regclass('public.media_jobs_processing_slot_uidx')
    and indrelid = 'public.media_jobs'::regclass
    and indisready and indisvalid and indisunique;
  if index_definition is distinct from
     'create unique index media_jobs_processing_slot_uidx on public.media_jobs using btree (processing_slot) where (status = ''processing''::text)'
  then
    raise exception 'public.media_jobs_processing_slot_uidx is missing, invalid, or unexpected';
  end if;

  select regexp_replace(lower(pg_get_indexdef(indexrelid)), '\s+', ' ', 'g')
  into index_definition
  from pg_catalog.pg_index
  where indexrelid = to_regclass('public.media_jobs_processing_session_uidx')
    and indrelid = 'public.media_jobs'::regclass
    and indisready and indisvalid and indisunique;
  if index_definition is distinct from
     'create unique index media_jobs_processing_session_uidx on public.media_jobs using btree (session_id) where (status = ''processing''::text)'
  then
    raise exception 'public.media_jobs_processing_session_uidx is missing, invalid, or unexpected';
  end if;

  select regexp_replace(lower(pg_get_indexdef(indexrelid)), '\s+', ' ', 'g')
  into index_definition
  from pg_catalog.pg_index
  where indexrelid = to_regclass('public.media_jobs_processing_asset_uidx')
    and indrelid = 'public.media_jobs'::regclass
    and indisready and indisvalid and indisunique;
  if index_definition is distinct from
     'create unique index media_jobs_processing_asset_uidx on public.media_jobs using btree (organization_id, asset_key) where (status = ''processing''::text)'
  then
    raise exception 'public.media_jobs_processing_asset_uidx is missing, invalid, or unexpected';
  end if;

  select regexp_replace(lower(pg_get_indexdef(indexrelid)), '\s+', ' ', 'g')
  into index_definition
  from pg_catalog.pg_index
  where indexrelid = to_regclass('public.media_jobs_processing_org_idx')
    and indrelid = 'public.media_jobs'::regclass
    and indisready and indisvalid and not indisunique;
  if index_definition is distinct from
     'create index media_jobs_processing_org_idx on public.media_jobs using btree (organization_id) where (status = ''processing''::text)'
  then
    raise exception 'public.media_jobs_processing_org_idx is missing, invalid, or unexpected';
  end if;

  select regexp_replace(lower(pg_get_indexdef(indexrelid)), '\s+', ' ', 'g')
  into index_definition
  from pg_catalog.pg_index
  where indexrelid = to_regclass('public.media_jobs_pending_session_claim_idx')
    and indrelid = 'public.media_jobs'::regclass
    and indisready and indisvalid and not indisunique;
  if index_definition is distinct from
     'create index media_jobs_pending_session_claim_idx on public.media_jobs using btree (session_id, manual_requested desc, priority desc, next_retry_at, created_at, id) where (status = ''pending''::text)'
  then
    raise exception 'public.media_jobs_pending_session_claim_idx is missing, invalid, or unexpected';
  end if;

  select regexp_replace(lower(pg_get_indexdef(indexrelid)), '\s+', ' ', 'g')
  into index_definition
  from pg_catalog.pg_index
  where indexrelid = to_regclass('public.media_jobs_pending_local_session_claim_idx')
    and indrelid = 'public.media_jobs'::regclass
    and indisready and indisvalid and not indisunique;
  if index_definition is distinct from
     'create index media_jobs_pending_local_session_claim_idx on public.media_jobs using btree (session_id, manual_requested desc, priority desc, next_retry_at, created_at, id) where ((status = ''pending''::text) and (((storage_path is not null) and (actual_size > 0)) or (nullif(btrim(coalesce((message_key ->> ''media_base64''::text), (message_key ->> ''base64''::text), ''''::text)), ''''::text) is not null) or (nullif(btrim(coalesce((message_key ->> ''upload_intent_path''::text), ''''::text)), ''''::text) is not null)))'
  then
    raise exception 'public.media_jobs_pending_local_session_claim_idx is missing, invalid, or unexpected';
  end if;

  select regexp_replace(lower(pg_get_indexdef(indexrelid)), '\s+', ' ', 'g')
  into index_definition
  from pg_catalog.pg_index
  where indexrelid = to_regclass('public.media_jobs_pending_exhausted_idx')
    and indrelid = 'public.media_jobs'::regclass
    and indisready and indisvalid and not indisunique;
  if index_definition is distinct from
     'create index media_jobs_pending_exhausted_idx on public.media_jobs using btree (provider_started_at, id) where ((status = ''pending''::text) and (attempts >= max_attempts))'
  then
    raise exception 'public.media_jobs_pending_exhausted_idx is missing, invalid, or unexpected';
  end if;
end;
$verify_whatsapp_media_scale_online_artifacts$;

do $verify_no_ambiguous_pending_media_attempts$
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
$verify_no_ambiguous_pending_media_attempts$;

select pg_advisory_unlock(hashtextextended('vimob:whatsapp-media:scale-cutover', 0));
