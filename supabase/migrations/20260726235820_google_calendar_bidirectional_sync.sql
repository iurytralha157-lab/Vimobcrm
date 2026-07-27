-- Vimob CRM - Google Agenda bidirectional synchronization.
--
-- This migration upgrades the legacy plaintext-token table in place, moves
-- any existing credentials to Supabase Vault, adds the durable sync
-- structures and schedules the private workers.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

alter table public.google_calendar_tokens
  add column if not exists organization_id uuid,
  add column if not exists account_email text,
  add column if not exists account_picture_url text,
  add column if not exists token_secret_ref uuid,
  add column if not exists scopes text[] not null default '{}'::text[],
  add column if not exists calendar_summary text,
  add column if not exists sync_token text,
  add column if not exists sync_enabled boolean not null default true,
  add column if not exists sync_status text not null default 'idle',
  add column if not exists connected_at timestamptz not null default now(),
  add column if not exists disconnected_at timestamptz,
  add column if not exists last_synced_at timestamptz,
  add column if not exists last_watch_renewed_at timestamptz,
  add column if not exists watch_expires_at timestamptz,
  add column if not exists last_error text;

update public.google_calendar_tokens tokens
set organization_id = users.organization_id,
    account_email = users.email,
    calendar_id = coalesce(nullif(btrim(tokens.calendar_id), ''), 'primary'),
    created_at = coalesce(tokens.created_at, now()),
    updated_at = coalesce(tokens.updated_at, now()),
    connected_at = coalesce(tokens.connected_at, tokens.created_at, now())
from public.users users
where users.id = tokens.user_id
  and (
    tokens.organization_id is null
    or tokens.account_email is null
    or nullif(btrim(tokens.calendar_id), '') is null
    or tokens.created_at is null
    or tokens.updated_at is null
  );

do $migration$
declare
  token_row record;
  secret_id uuid;
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'google_calendar_tokens'
      and column_name = 'access_token'
  ) then
    for token_row in execute $query$
      select id, user_id, access_token, refresh_token, expires_at, token_secret_ref
      from public.google_calendar_tokens
      where token_secret_ref is null
        and nullif(access_token, '') is not null
    $query$
    loop
      secret_id := vault.create_secret(
        jsonb_build_object(
          'access_token', token_row.access_token,
          'refresh_token', nullif(token_row.refresh_token, ''),
          'expires_at', token_row.expires_at,
          'token_type', 'Bearer'
        )::text,
        'google-calendar-' || token_row.user_id::text || '-' || token_row.id::text,
        'Vimob CRM Google Agenda OAuth token migrated from the legacy table'
      );

      update public.google_calendar_tokens
      set token_secret_ref = secret_id
      where id = token_row.id;
    end loop;
  end if;

  if exists (
    select 1
    from public.google_calendar_tokens
    where organization_id is null
      or account_email is null
      or token_secret_ref is null
  ) then
    raise exception 'Google Agenda legacy rows could not be safely migrated';
  end if;
end
$migration$;

alter table public.google_calendar_tokens
  drop constraint if exists google_calendar_tokens_user_id_key,
  drop constraint if exists google_calendar_tokens_unique,
  drop constraint if exists google_calendar_tokens_sync_status_check;

drop index if exists public.google_calendar_tokens_user_id_key;
drop index if exists public.google_calendar_tokens_unique;

alter table public.google_calendar_tokens
  alter column organization_id set not null,
  alter column account_email set not null,
  alter column calendar_id set default 'primary',
  alter column calendar_id set not null,
  alter column expires_at drop not null,
  alter column created_at set default now(),
  alter column created_at set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null,
  drop column if exists access_token,
  drop column if exists refresh_token;

alter table public.google_calendar_tokens
  add constraint google_calendar_tokens_sync_status_check
    check (sync_status in ('idle', 'syncing', 'connected', 'error', 'disconnected')),
  add constraint google_calendar_tokens_secret_check
    check (disconnected_at is not null or token_secret_ref is not null),
  add constraint google_calendar_tokens_unique
    unique (organization_id, user_id, account_email);

do $migration$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.google_calendar_tokens'::regclass
      and conname = 'google_calendar_tokens_organization_id_fkey'
  ) then
    alter table public.google_calendar_tokens
      add constraint google_calendar_tokens_organization_id_fkey
      foreign key (organization_id) references public.organizations(id) on delete cascade;
  end if;
end
$migration$;

create unique index if not exists uq_google_calendar_tokens_active_user
  on public.google_calendar_tokens(organization_id, user_id)
  where disconnected_at is null;

create index if not exists idx_google_calendar_tokens_sync_due
  on public.google_calendar_tokens(sync_enabled, watch_expires_at, last_synced_at)
  where disconnected_at is null;

create table if not exists public.google_calendar_event_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.google_calendar_tokens(id) on delete cascade,
  schedule_event_id uuid references public.schedule_events(id) on delete cascade,
  google_calendar_id text not null default 'primary',
  google_event_id text not null,
  google_etag text,
  google_ical_uid text,
  google_html_link text,
  google_status text,
  google_updated_at timestamptz,
  last_origin text not null default 'vimob',
  last_synced_at timestamptz,
  last_error text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint google_calendar_event_links_origin_check
    check (last_origin in ('vimob', 'google', 'sync')),
  constraint google_calendar_event_links_unique_google
    unique (connection_id, google_calendar_id, google_event_id),
  constraint google_calendar_event_links_unique_schedule
    unique (connection_id, schedule_event_id)
);

create table if not exists public.google_calendar_channels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.google_calendar_tokens(id) on delete cascade,
  channel_id text not null unique,
  resource_id text,
  resource_uri text,
  calendar_id text not null default 'primary',
  token_hash text not null,
  expires_at timestamptz not null,
  stopped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.google_calendar_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid references public.google_calendar_tokens(id) on delete cascade,
  schedule_event_id uuid references public.schedule_events(id) on delete set null,
  action text not null,
  status text not null default 'queued',
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  next_run_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint google_calendar_sync_jobs_action_check
    check (action in ('push_upsert', 'push_delete', 'pull_incremental', 'full_sync', 'renew_watch')),
  constraint google_calendar_sync_jobs_status_check
    check (status in ('queued', 'running', 'succeeded', 'failed', 'dead')),
  constraint google_calendar_sync_jobs_attempts_check
    check (attempts >= 0 and max_attempts between 1 and 20)
);

create table if not exists public.google_calendar_oauth_states (
  state_hash text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  return_url text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.schedule_events
  add column if not exists google_calendar_connection_id uuid
    references public.google_calendar_tokens(id) on delete set null,
  add column if not exists google_calendar_id text,
  add column if not exists google_sync_status text,
  add column if not exists google_last_synced_at timestamptz,
  add column if not exists google_sync_error text;

create index if not exists idx_google_calendar_event_links_schedule
  on public.google_calendar_event_links(schedule_event_id)
  where schedule_event_id is not null;

create index if not exists idx_google_calendar_event_links_google
  on public.google_calendar_event_links(connection_id, google_calendar_id, google_event_id)
  where deleted_at is null;

create index if not exists idx_google_calendar_channels_connection
  on public.google_calendar_channels(connection_id, expires_at)
  where stopped_at is null;

create index if not exists idx_google_calendar_sync_jobs_ready
  on public.google_calendar_sync_jobs(status, next_run_at, attempts);

create unique index if not exists uq_google_calendar_sync_jobs_pull_pending
  on public.google_calendar_sync_jobs(connection_id, action)
  where action = 'pull_incremental'
    and status in ('queued', 'running', 'failed');

create index if not exists idx_google_calendar_oauth_states_expiry
  on public.google_calendar_oauth_states(expires_at)
  where consumed_at is null;

drop trigger if exists set_updated_at_google_calendar_tokens on public.google_calendar_tokens;
create trigger set_updated_at_google_calendar_tokens
before update on public.google_calendar_tokens
for each row execute function private.set_updated_at();

drop trigger if exists set_updated_at_google_calendar_event_links on public.google_calendar_event_links;
create trigger set_updated_at_google_calendar_event_links
before update on public.google_calendar_event_links
for each row execute function private.set_updated_at();

drop trigger if exists set_updated_at_google_calendar_channels on public.google_calendar_channels;
create trigger set_updated_at_google_calendar_channels
before update on public.google_calendar_channels
for each row execute function private.set_updated_at();

drop trigger if exists set_updated_at_google_calendar_sync_jobs on public.google_calendar_sync_jobs;
create trigger set_updated_at_google_calendar_sync_jobs
before update on public.google_calendar_sync_jobs
for each row execute function private.set_updated_at();

do $migration$
declare
  table_name text;
  policy_name text;
begin
  foreach table_name in array array[
    'google_calendar_tokens',
    'google_calendar_event_links',
    'google_calendar_channels',
    'google_calendar_sync_jobs',
    'google_calendar_oauth_states'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
    execute format('grant select, insert, update, delete on table public.%I to service_role', table_name);

    for policy_name in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = table_name
    loop
      execute format('drop policy %I on public.%I', policy_name, table_name);
    end loop;
  end loop;
end
$migration$;

create or replace function public.google_calendar_save_token_secret(
  p_existing_secret_ref uuid,
  p_secret text,
  p_name text,
  p_description text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, vault
as $function$
declare
  secret_id uuid := p_existing_secret_ref;
begin
  if nullif(p_secret, '') is null then
    raise exception 'Google Agenda token secret is required';
  end if;

  if secret_id is null then
    secret_id := vault.create_secret(p_secret, p_name, p_description);
  else
    perform vault.update_secret(secret_id, p_secret, p_name, p_description);
  end if;

  return secret_id;
end
$function$;

create or replace function public.google_calendar_get_token_secret(p_secret_ref uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public, vault
as $function$
  select decrypted_secret
  from vault.decrypted_secrets
  where id = p_secret_ref;
$function$;

create or replace function public.google_calendar_disconnect_connection(p_connection_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, vault
as $function$
declare
  secret_id uuid;
begin
  select token_secret_ref
  into secret_id
  from public.google_calendar_tokens
  where id = p_connection_id
  for update;

  update public.google_calendar_tokens
  set token_secret_ref = null,
      sync_enabled = false,
      sync_status = 'disconnected',
      disconnected_at = now(),
      sync_token = null,
      watch_expires_at = null,
      last_error = null
  where id = p_connection_id;

  if secret_id is not null then
    delete from vault.secrets where id = secret_id;
  end if;
end
$function$;

create or replace function public.google_calendar_verify_cron_secret(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, vault
as $function$
  select coalesce(
    p_secret = (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'google_calendar_cron_secret'
      limit 1
    ),
    false
  );
$function$;

create or replace function public.google_calendar_claim_sync_jobs(
  p_limit integer default 10,
  p_worker text default 'google-calendar-sync'
)
returns setof public.google_calendar_sync_jobs
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if nullif(btrim(p_worker), '') is null then
    raise exception 'Google Agenda worker name is required';
  end if;

  return query
  with candidates as (
    select jobs.id
    from public.google_calendar_sync_jobs jobs
    where jobs.attempts < jobs.max_attempts
      and (
        (
          jobs.status in ('queued', 'failed')
          and jobs.next_run_at <= now()
        )
        or (
          jobs.status = 'running'
          and jobs.locked_at < now() - interval '5 minutes'
        )
      )
    order by jobs.next_run_at, jobs.created_at, jobs.id
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 10), 100))
  )
  update public.google_calendar_sync_jobs claimed
  set status = 'running',
      locked_at = now(),
      locked_by = btrim(p_worker),
      last_error = null
  from candidates
  where claimed.id = candidates.id
  returning claimed.*;
end
$function$;

revoke all on function public.google_calendar_save_token_secret(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.google_calendar_get_token_secret(uuid) from public, anon, authenticated;
revoke all on function public.google_calendar_disconnect_connection(uuid) from public, anon, authenticated;
revoke all on function public.google_calendar_verify_cron_secret(text) from public, anon, authenticated;
revoke all on function public.google_calendar_claim_sync_jobs(integer, text) from public, anon, authenticated;

grant execute on function public.google_calendar_save_token_secret(uuid, text, text, text) to service_role;
grant execute on function public.google_calendar_get_token_secret(uuid) to service_role;
grant execute on function public.google_calendar_disconnect_connection(uuid) to service_role;
grant execute on function public.google_calendar_verify_cron_secret(text) to service_role;
grant execute on function public.google_calendar_claim_sync_jobs(integer, text) to service_role;

do $migration$
begin
  if not exists (
    select 1
    from vault.secrets
    where name = 'google_calendar_cron_secret'
  ) then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'google_calendar_cron_secret',
      'Authenticates private Google Agenda scheduled workers'
    );
  end if;
end
$migration$;

create or replace function private.invoke_google_calendar_worker(
  p_action text,
  p_limit integer default null
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public, vault, net
as $function$
declare
  cron_secret text;
  request_body jsonb;
begin
  select decrypted_secret
  into cron_secret
  from vault.decrypted_secrets
  where name = 'google_calendar_cron_secret'
  limit 1;

  if cron_secret is null then
    raise exception 'Google Agenda cron secret is missing';
  end if;

  request_body := jsonb_build_object('action', p_action);
  if p_limit is not null then
    request_body := request_body || jsonb_build_object('limit', p_limit);
  end if;

  return net.http_post(
    url := 'https://iemalzlfnbouobyjwlwi.supabase.co/functions/v1/google-calendar-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-vimob-cron-secret', cron_secret
    ),
    body := request_body,
    timeout_milliseconds := 55000
  );
end
$function$;

revoke all on function private.invoke_google_calendar_worker(text, integer) from public, anon, authenticated;

do $migration$
declare
  existing_job_id bigint;
begin
  for existing_job_id in
    select jobid
    from cron.job
    where jobname in ('google-calendar-sync-jobs', 'google-calendar-renew-watches')
  loop
    perform cron.unschedule(existing_job_id);
  end loop;
end
$migration$;

select cron.schedule(
  'google-calendar-sync-jobs',
  '* * * * *',
  $cron$select private.invoke_google_calendar_worker('run_due_jobs', 20);$cron$
);

select cron.schedule(
  'google-calendar-renew-watches',
  '17 3 * * *',
  $cron$select private.invoke_google_calendar_worker('renew_watches');$cron$
);
