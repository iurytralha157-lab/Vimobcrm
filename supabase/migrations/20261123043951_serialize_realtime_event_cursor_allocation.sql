begin;
set local lock_timeout = '5s';

create function private.lock_realtime_event_cursor_allocation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- One global cursor is shared by all tenants. Lock before the identity
  -- default runs, and hold through commit so a later ID cannot appear first.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('vimob.private.realtime_events.cursor', 0)
  );
  return null;
end;
$$;

revoke all on function private.lock_realtime_event_cursor_allocation()
  from public, anon, authenticated, service_role;

create trigger realtime_events_lock_cursor_allocation
before insert on private.realtime_events
for each statement execute function private.lock_realtime_event_cursor_allocation();

commit;
