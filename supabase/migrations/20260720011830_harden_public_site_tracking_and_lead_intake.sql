alter table public.site_analytics_events
  add column if not exists property_id uuid,
  add column if not exists lead_id uuid,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

-- Older local/staging snapshots may predate columns already used by
-- handle_lead_intake in production.
alter table public.round_robin_members
  add column if not exists leads_count integer not null default 0;

alter table public.assignments_log
  add column if not exists round_robin_id uuid references public.round_robins(id) on delete set null;

create index if not exists idx_assignments_log_round_robin
  on public.assignments_log(organization_id, round_robin_id, created_at desc)
  where round_robin_id is not null;

alter table public.round_robin_logs
  add column if not exists member_id uuid references public.round_robin_members(id) on delete set null;

create index if not exists idx_round_robin_logs_member
  on public.round_robin_logs(organization_id, member_id, created_at desc)
  where member_id is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'site_analytics_events_property_org_fkey'
  ) then
    alter table public.site_analytics_events
      add constraint site_analytics_events_property_org_fkey
      foreign key (property_id)
      references public.properties(id)
      on delete set null
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'site_analytics_events_lead_org_fkey'
  ) then
    alter table public.site_analytics_events
      add constraint site_analytics_events_lead_org_fkey
      foreign key (lead_id)
      references public.leads(id)
      on delete set null
      not valid;
  end if;
end $$;

alter table public.site_analytics_events
  validate constraint site_analytics_events_property_org_fkey;
alter table public.site_analytics_events
  validate constraint site_analytics_events_lead_org_fkey;

create index if not exists idx_site_analytics_org_session_created
  on public.site_analytics_events(organization_id, session_id, created_at desc)
  where session_id is not null;

create index if not exists idx_site_analytics_org_property_created
  on public.site_analytics_events(organization_id, property_id, created_at desc)
  where property_id is not null;

create index if not exists idx_site_analytics_org_campaign_created
  on public.site_analytics_events(organization_id, utm_source, utm_campaign, created_at desc)
  where utm_source is not null or utm_campaign is not null;

create table if not exists public.site_lead_submissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  submission_id text not null,
  session_id text,
  lead_id uuid,
  created_at timestamptz not null default now(),
  constraint site_lead_submissions_org_submission_unique unique (organization_id, submission_id),
  constraint site_lead_submissions_lead_org_fkey
    foreign key (lead_id)
    references public.leads(id)
    on delete set null
);

alter table public.site_lead_submissions enable row level security;
revoke all privileges on table public.site_lead_submissions from public, anon, authenticated;
grant select, insert, update on table public.site_lead_submissions to service_role;

create index if not exists idx_site_lead_submissions_org_session_created
  on public.site_lead_submissions(organization_id, session_id, created_at desc)
  where session_id is not null;
