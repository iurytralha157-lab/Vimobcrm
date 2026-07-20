-- Supports the backend schedule reminder worker, which finds events whose
-- reminder due time is now/past and still before the event starts.
create index if not exists idx_schedule_events_reminder_due
  on public.schedule_events (
    start_time,
    reminder_minutes
  )
  where coalesce(status, 'scheduled') = 'scheduled';
