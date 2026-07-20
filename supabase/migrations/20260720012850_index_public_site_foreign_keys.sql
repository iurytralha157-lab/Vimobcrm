-- Cover the single-column foreign keys used during lead/property deletion.
-- Existing analytics indexes are organization-first and cannot satisfy these
-- referential checks efficiently.
create index if not exists idx_site_analytics_events_lead_fk
  on public.site_analytics_events(lead_id)
  where lead_id is not null;

create index if not exists idx_site_analytics_events_property_fk
  on public.site_analytics_events(property_id)
  where property_id is not null;

create index if not exists idx_site_lead_submissions_lead_fk
  on public.site_lead_submissions(lead_id)
  where lead_id is not null;
