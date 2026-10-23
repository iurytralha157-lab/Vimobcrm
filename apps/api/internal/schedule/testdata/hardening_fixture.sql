-- Minimal SQL fixture for the dedicated loopback agenda_schedule database.
-- This is not a production migration or a Supabase/RLS baseline.
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(), name text not null, is_active boolean default true
);
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(), organization_id uuid references public.organizations(id) on delete cascade,
  name text not null, avatar_url text, is_active boolean default true
);
create table if not exists public.organization_members (
  organization_id uuid references public.organizations(id) on delete cascade, user_id uuid references public.users(id) on delete cascade,
  is_active boolean default true, deleted_at timestamptz, membership_generation uuid default gen_random_uuid(),
  primary key (organization_id,user_id)
);
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(), organization_id uuid references public.organizations(id) on delete cascade,
  name text not null, is_active boolean default true
);
create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(), organization_id uuid references public.organizations(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade, user_id uuid references public.users(id) on delete cascade,
  is_leader boolean default false, is_active boolean default true, membership_generation uuid
);
create table if not exists public.organization_attention_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade, timezone text
);
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(), organization_id uuid references public.organizations(id) on delete cascade,
  name text, phone text, source text, assigned_user_id uuid, team_id uuid
);
create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(), organization_id uuid references public.organizations(id) on delete cascade,
  title text, code text, responsible_user_id uuid, created_by uuid
);
create table if not exists public.schedule_events (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id), lead_id uuid references public.leads(id), property_id uuid references public.properties(id),
  created_by uuid references public.users(id), team_id uuid references public.teams(id), lead_source_snapshot text,
  title text not null, description text, event_type text not null default 'task', start_time timestamptz not null, end_time timestamptz not null,
  is_all_day boolean not null default false, location text, status text not null default 'scheduled', visibility text not null default 'default',
  reminder_minutes integer default 30, recurrence_parent_id uuid references public.schedule_events(id) on delete set null,
  recurrence_rule text, recurrence_until timestamptz, recurrence_count integer,
  google_event_id text, google_sync_status text, google_sync_error text, google_calendar_connection_id uuid, google_calendar_id text,
  completed_by uuid, completed_at timestamptz, outcome text, outcome_notes text, performed_by uuid, outcome_recorded_at timestamptz,
  rescheduled_from_event_id uuid references public.schedule_events(id), rescheduled_to_event_id uuid references public.schedule_events(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (recurrence_rule is null or recurrence_rule in ('daily','weekly','monthly','yearly')),
  check (status in ('scheduled','completed','cancelled','canceled','no_show')),
  check (visibility in ('default','public','private')),
  check (reminder_minutes is null or reminder_minutes between 0 and 120)
);
create unique index if not exists fixture_rescheduled_from on public.schedule_events(rescheduled_from_event_id) where rescheduled_from_event_id is not null;
create unique index if not exists fixture_rescheduled_to on public.schedule_events(rescheduled_to_event_id) where rescheduled_to_event_id is not null;
create table if not exists public.schedule_event_assignees (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_id uuid not null references public.schedule_events(id) on delete cascade, user_id uuid not null references public.users(id),
  primary key(event_id,user_id)
);
create table if not exists public.schedule_event_comments (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  event_id uuid not null references public.schedule_events(id) on delete cascade, user_id uuid not null references public.users(id),
  content text not null, created_at timestamptz not null default now()
);
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(), organization_id uuid references public.organizations(id) on delete cascade,
  user_id uuid, title text, content text, body text, type text, channel text, target_url text, metadata jsonb, lead_id uuid,
  created_at timestamptz default now()
);
create table if not exists public.lead_timeline_events (
  id uuid primary key default gen_random_uuid(), organization_id uuid references public.organizations(id) on delete cascade,
  lead_id uuid, actor_user_id uuid, user_id uuid, event_type text, title text, description text, metadata jsonb
);
create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(), organization_id uuid references public.organizations(id) on delete cascade,
  lead_id uuid, user_id uuid, type text, content text, metadata jsonb
);
create table if not exists public.google_calendar_tokens (
  id uuid primary key default gen_random_uuid(), organization_id uuid references public.organizations(id) on delete cascade,
  user_id uuid, disconnected_at timestamptz
);
create table if not exists public.google_calendar_sync_jobs (
  id uuid primary key default gen_random_uuid(), organization_id uuid references public.organizations(id) on delete cascade,
  schedule_event_id uuid references public.schedule_events(id) on delete set null, action text, payload jsonb, created_by uuid,
  status text default 'queued', next_run_at timestamptz default now()
);
create table if not exists public.google_calendar_event_links (
  id uuid primary key default gen_random_uuid(), organization_id uuid references public.organizations(id) on delete cascade,
  schedule_event_id uuid references public.schedule_events(id) on delete set null, deleted_at timestamptz
);
