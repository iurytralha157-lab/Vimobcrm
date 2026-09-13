begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.user_activity_sessions
  add column if not exists idle_since_at timestamptz;

comment on column public.user_activity_sessions.idle_since_at is
  'Server-maintained timestamp for the current uninterrupted idle period; null outside idle or when legacy state has not yet been observed.';

-- The browser owns the online/idle status transition, but it must not be able
-- to forge the transition timestamp. Existing idle rows intentionally remain
-- null: their last_seen_at is a heartbeat and cannot recover when idle began.
create or replace function private.maintain_user_activity_idle_since()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
begin
  if new.status <> 'idle' then
    new.idle_since_at := null;
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.idle_since_at := pg_catalog.clock_timestamp();
  elsif old.status is distinct from 'idle' then
    new.idle_since_at := pg_catalog.clock_timestamp();
  else
    new.idle_since_at := old.idle_since_at;
  end if;

  return new;
end;
$function$;

comment on function private.maintain_user_activity_idle_since() is
  'Computes and protects idle_since_at from client writes while preserving it across idle heartbeats.';

alter function private.maintain_user_activity_idle_since()
  owner to postgres;

revoke all on function private.maintain_user_activity_idle_since()
  from public, anon, authenticated, service_role;

drop trigger if exists maintain_user_activity_idle_since
  on public.user_activity_sessions;
create trigger maintain_user_activity_idle_since
before insert or update of status, idle_since_at
on public.user_activity_sessions
for each row
execute function private.maintain_user_activity_idle_since();

commit;
