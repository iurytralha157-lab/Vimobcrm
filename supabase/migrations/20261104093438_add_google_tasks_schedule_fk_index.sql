-- The existing tenant-first index serves scoped reads but cannot lead FK
-- maintenance by schedule_event_id alone (including ON DELETE SET NULL).
-- Keep that index and add the narrow FK lookup path. Rollback: drop this new
-- index only; the schema and remote synchronization behavior are unchanged.
set lock_timeout='5s';
create index google_tasks_links_schedule_event_fk_idx
  on public.google_tasks_links(schedule_event_id)
  where schedule_event_id is not null;
reset lock_timeout;
