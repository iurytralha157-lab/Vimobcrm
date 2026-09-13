-- Keep immutable event time separate from mutable visitor liveness. Reusing
-- created_at for heartbeats moves accumulated duration between report periods
-- and rewrites every created_at-based index on each update.

alter table public.site_analytics_events
  add column if not exists last_seen_at timestamptz;

comment on column public.site_analytics_events.last_seen_at is
  'Backend-maintained latest activity time for aggregated visitor heartbeats; created_at remains the immutable event time.';

create index if not exists idx_site_analytics_org_last_seen
  on public.site_analytics_events (organization_id, last_seen_at desc)
  where session_id is not null
    and event_type = 'page_duration'
    and last_seen_at is not null;
