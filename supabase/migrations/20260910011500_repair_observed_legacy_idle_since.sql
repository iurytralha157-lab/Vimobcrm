begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- An idle session created before idle_since_at existed cannot reveal the true
-- beginning of its absence: last_seen_at is a heartbeat. Start the clock at
-- the first reliable server observation instead of inventing historical data.
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
  elsif old.status is distinct from 'idle'
    or old.idle_since_at is null then
    new.idle_since_at := pg_catalog.clock_timestamp();
  else
    new.idle_since_at := old.idle_since_at;
  end if;

  return new;
end;
$function$;

comment on function private.maintain_user_activity_idle_since() is
  'Computes and protects idle_since_at, starts legacy null states at their first reliable server observation, and preserves the value across idle heartbeats.';

alter function private.maintain_user_activity_idle_since()
  owner to postgres;

revoke all on function private.maintain_user_activity_idle_since()
  from public, anon, authenticated, service_role;

-- Fail closed if the prerequisite migration did not install the trigger. A
-- detached function would make the migration look successful without fixing
-- future heartbeats.
do $assert_idle_trigger$
begin
  if not exists (
    select 1
    from pg_catalog.pg_trigger as trigger
    where trigger.tgrelid = 'public.user_activity_sessions'::regclass
      and trigger.tgname = 'maintain_user_activity_idle_since'
      and trigger.tgfoid =
        'private.maintain_user_activity_idle_since()'::regprocedure
      and not trigger.tgisinternal
  ) then
    raise exception
      'maintain_user_activity_idle_since trigger is missing or detached';
  end if;
end
$assert_idle_trigger$;

-- Repair only sessions that the presence endpoint can currently consider
-- fresh. Stale legacy rows will be repaired by the trigger if they heartbeat
-- again. Lock candidates in a stable order, skip concurrent heartbeats, and
-- cap the one-time write; skipped/remaining rows self-repair on their next one.
with candidates as materialized (
  select activity.id
  from public.user_activity_sessions as activity
  where activity.status = 'idle'
    and activity.disconnected_at is null
    and activity.idle_since_at is null
    and activity.last_seen_at >=
      pg_catalog.statement_timestamp() - interval '3 minutes'
  order by activity.id
  for update of activity skip locked
  limit 10000
)
update public.user_activity_sessions as activity
set idle_since_at = pg_catalog.clock_timestamp()
from candidates
where activity.id = candidates.id;

comment on column public.user_activity_sessions.idle_since_at is
  'Server-maintained timestamp for the current uninterrupted idle period, or for the first reliable server observation when a legacy idle state had no timestamp.';

commit;
