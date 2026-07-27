-- Vimob CRM - Google Calendar bidirectional sync foundation.
-- OAuth tokens stay in Supabase Vault. The browser only sees safe status
-- through public.get_google_calendar_status().

alter table public.google_calendar_tokens
  add column if not exists calendar_id text not null default 'primary',
  add column if not exists calendar_summary text,
  add column if not exists account_picture_url text,
  add column if not exists sync_token text,
  add column if not exists sync_enabled boolean not null default true,
  add column if not exists sync_status text not null default 'idle',
  add column if not exists connected_at timestamptz not null default now(),
  add column if not exists disconnected_at timestamptz,
  add column if not exists last_synced_at timestamptz,
  add column if not exists last_watch_renewed_at timestamptz,
  add column if not exists watch_expires_at timestamptz,
  add column if not exists last_error text;

alter table public.google_calendar_tokens
  drop constraint if exists google_calendar_tokens_sync_status_check;

alter table public.google_calendar_tokens
  add constraint google_calendar_tokens_sync_status_check
  check (sync_status in ('idle', 'syncing', 'connected', 'error', 'disconnected'));

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
  constraint google_calendar_event_links_origin_check check (last_origin in ('vimob', 'google', 'sync')),
  constraint google_calendar_event_links_unique_google unique (connection_id, google_calendar_id, google_event_id),
  constraint google_calendar_event_links_unique_schedule unique (connection_id, schedule_event_id)
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
  constraint google_calendar_sync_jobs_action_check check (
    action in ('push_upsert', 'push_delete', 'pull_incremental', 'full_sync', 'renew_watch')
  ),
  constraint google_calendar_sync_jobs_status_check check (
    status in ('queued', 'running', 'succeeded', 'failed', 'dead')
  )
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
  add column if not exists google_calendar_connection_id uuid references public.google_calendar_tokens(id) on delete set null,
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

do $$
declare
  t text;
begin
  foreach t in array array[
    'google_calendar_tokens',
    'google_calendar_event_links',
    'google_calendar_channels',
    'google_calendar_sync_jobs',
    'google_calendar_oauth_states'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
    execute format('drop policy if exists %I on public.%I', 'members read ' || t, t);
    execute format('drop policy if exists %I on public.%I', 'communication admins manage ' || t, t);
    execute format('drop policy if exists %I on public.%I', 'backend manages ' || t, t);
    execute format('create policy %I on public.%I for all to service_role using (true) with check (true)', 'backend manages ' || t, t);
  end loop;
end $$;

drop policy if exists "google calendar users read own token rows" on public.google_calendar_tokens;
drop policy if exists "google calendar users manage own token rows" on public.google_calendar_tokens;

create or replace function private.get_google_calendar_status_impl()
returns table (
  id uuid,
  organization_id uuid,
  user_id uuid,
  account_email text,
  account_picture_url text,
  calendar_id text,
  calendar_summary text,
  sync_enabled boolean,
  sync_status text,
  connected_at timestamptz,
  disconnected_at timestamptz,
  last_synced_at timestamptz,
  watch_expires_at timestamptz,
  last_error text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select
    gct.id,
    gct.organization_id,
    gct.user_id,
    gct.account_email,
    gct.account_picture_url,
    gct.calendar_id,
    gct.calendar_summary,
    gct.sync_enabled,
    gct.sync_status,
    gct.connected_at,
    gct.disconnected_at,
    gct.last_synced_at,
    gct.watch_expires_at,
    gct.last_error,
    gct.created_at,
    gct.updated_at
  from public.google_calendar_tokens gct
  where gct.user_id = auth.uid()
    and gct.disconnected_at is null
  order by gct.created_at desc;
$$;

create or replace function public.get_google_calendar_status()
returns table (
  id uuid,
  organization_id uuid,
  user_id uuid,
  account_email text,
  account_picture_url text,
  calendar_id text,
  calendar_summary text,
  sync_enabled boolean,
  sync_status text,
  connected_at timestamptz,
  disconnected_at timestamptz,
  last_synced_at timestamptz,
  watch_expires_at timestamptz,
  last_error text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = public, private, pg_temp
as $$
  select * from private.get_google_calendar_status_impl();
$$;

grant execute on function private.get_google_calendar_status_impl() to authenticated;
grant execute on function public.get_google_calendar_status() to authenticated;
