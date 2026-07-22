-- Supports the dashboard KPI that counts visits and meetings by the date the
-- appointment was created, while keeping the linked lead available to the
-- tenant and responsibility scope check.
create index if not exists idx_schedule_events_org_appointment_created_at
  on public.schedule_events (organization_id, created_at)
  include (lead_id)
  where event_type in ('visit', 'meeting');
