begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Browser activity writes run as the authenticated role. Replace every
-- client-supplied lifecycle timestamp with the database clock while leaving
-- trusted maintenance roles free to preserve historical timestamps.
create or replace function private.maintain_authenticated_user_activity_timestamps()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_now timestamptz;
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  v_now := pg_catalog.clock_timestamp();

  if tg_op = 'INSERT' then
    new.connected_at := v_now;
  else
    new.connected_at := old.connected_at;
  end if;

  new.last_seen_at := v_now;
  if new.status = 'offline' then
    new.disconnected_at := v_now;
  else
    new.disconnected_at := null;
  end if;

  return new;
end;
$function$;

comment on function private.maintain_authenticated_user_activity_timestamps() is
  'Uses the database clock for authenticated session lifecycle writes while allowing trusted retention to preserve historical timestamps.';

alter function private.maintain_authenticated_user_activity_timestamps()
  owner to postgres;

revoke all on function private.maintain_authenticated_user_activity_timestamps()
  from public, anon, authenticated, service_role;

drop trigger if exists maintain_authenticated_user_activity_timestamps
  on public.user_activity_sessions;
create trigger maintain_authenticated_user_activity_timestamps
before insert or update
on public.user_activity_sessions
for each row
execute function private.maintain_authenticated_user_activity_timestamps();

-- Reconcile any historical shape that predates the protected idle timestamp
-- and enforce only relationships that are safe for retained legacy rows.
update public.user_activity_sessions
set idle_since_at = null
where idle_since_at is not null
  and status <> 'idle';

update public.user_activity_sessions
set disconnected_at = null
where disconnected_at is not null
  and status <> 'offline';

alter table public.user_activity_sessions
  add constraint user_activity_sessions_idle_since_status_check
  check (idle_since_at is null or status = 'idle')
  not valid;

alter table public.user_activity_sessions
  add constraint user_activity_sessions_disconnected_status_check
  check (disconnected_at is null or status = 'offline')
  not valid;

alter table public.user_activity_sessions
  validate constraint user_activity_sessions_idle_since_status_check;

alter table public.user_activity_sessions
  validate constraint user_activity_sessions_disconnected_status_check;

commit;
