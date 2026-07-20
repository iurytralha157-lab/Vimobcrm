alter table public.site_analytics_events
  add column if not exists property_id uuid,
  add column if not exists lead_id uuid,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists idx_site_analytics_org_session_created
  on public.site_analytics_events(organization_id, session_id, created_at desc)
  where session_id is not null;

create index if not exists idx_site_analytics_org_property_created
  on public.site_analytics_events(organization_id, property_id, created_at desc)
  where property_id is not null;

create index if not exists idx_site_analytics_org_campaign_created
  on public.site_analytics_events(organization_id, utm_source, utm_campaign, created_at desc)
  where utm_source is not null or utm_campaign is not null;
