-- Fresh disposable SQL runtime only; never a CRM database.
\ir google_calendar_activation_status_export.fixture.sql
alter table public.organizations add column name text default 'Synthetic organization';
alter table public.schedule_events add column event_type text default 'task',
  add column status text default 'scheduled',add column google_event_id text,
  add column google_calendar_id text,add column google_calendar_connection_id uuid,
  add column google_last_synced_at timestamptz;
alter table public.google_calendar_event_links add column schedule_event_id uuid,
  add column google_calendar_id text,add column google_event_id text,add column google_status text;
\ir ../migrations/20261104085409_add_google_tasks_outbound_foundation.sql
\ir ../migrations/20261104085443_add_google_tasks_fenced_delivery.sql
\ir ../migrations/20261104093438_add_google_tasks_schedule_fk_index.sql
-- Freeze setup before independent suites that deliberately roll back.
commit;
\ir google_calendar_outbound_protocol.test.sql
\ir google_tasks_outbound.test.sql
