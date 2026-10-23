-- Explicit calendars enable the managed queue lifecycle. No queue is activated
-- or backfilled here; an absent calendar deliberately retains legacy behavior.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

create or replace function private.queue_schedule_valid(p_schedule jsonb)
returns boolean language plpgsql stable set search_path = '' as $function$
declare d jsonb; seen integer[] := '{}'; active_days integer := 0; n integer;
begin
  if jsonb_typeof(p_schedule) is distinct from 'object'
    or p_schedule->'version' is distinct from '1'::jsonb
    or jsonb_typeof(p_schedule->'timezone') is distinct from 'string'
    or not exists(select 1 from pg_catalog.pg_timezone_names where name = p_schedule->>'timezone')
    or jsonb_typeof(p_schedule->'days') is distinct from 'array'
    or jsonb_array_length(p_schedule->'days') <> 7 then return false; end if;
  for d in select value from jsonb_array_elements(p_schedule->'days') loop
    if jsonb_typeof(d) <> 'object' or coalesce(d->>'day_of_week','') !~ '^[0-6]$'
      or jsonb_typeof(d->'is_active') is distinct from 'boolean'
      or jsonb_typeof(d->'is_all_day') is distinct from 'boolean' then return false; end if;
    n := (d->>'day_of_week')::integer;
    if n = any(seen) then return false; end if;
    seen := array_append(seen,n);
    if (d->>'is_active')::boolean then active_days := active_days + 1; end if;
    if not (d->>'is_all_day')::boolean then
      if (d->>'is_active')::boolean and (
        coalesce(d->>'start_time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
        or coalesce(d->>'end_time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
      ) then return false; end if;
      if d->>'start_time' is not null and d->>'start_time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
        or d->>'end_time' is not null and d->>'end_time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' then return false; end if;
      if (d->>'is_active')::boolean and (d->>'start_time')::time = (d->>'end_time')::time then return false; end if;
    end if;
  end loop;
  return true;
exception when others then return false;
end;
$function$;

create or replace function private.queue_runtime_is_managed(p_organization_id uuid,p_round_robin_id uuid)
returns boolean language sql stable security definer set search_path = '' as $function$
  select exists(select 1 from public.round_robins q where q.organization_id=p_organization_id
    and q.id=p_round_robin_id and q.settings ? 'operating_schedule');
$function$;

create or replace function private.queue_window(p_organization_id uuid,p_round_robin_id uuid,
  p_now timestamptz default clock_timestamp()) returns jsonb
language plpgsql stable security definer set search_path = '' as $function$
declare q public.round_robins%rowtype; s jsonb; tz text; local_date date;
  opens timestamptz; closes timestamptz; next_opens timestamptz;
begin
  select * into q from public.round_robins where organization_id=p_organization_id and id=p_round_robin_id;
  if not found then return jsonb_build_object('managed',false,'open',false,'valid',false,'reason','queue_not_found'); end if;
  if not (q.settings ? 'operating_schedule') then
    return jsonb_build_object('managed',false,'open',coalesce(q.is_active,true),'valid',true,'reason','legacy');
  end if;
  s := q.settings->'operating_schedule';
  if not private.queue_schedule_valid(s) then
    return jsonb_build_object('managed',true,'open',false,'valid',false,'reason','invalid_schedule');
  end if;
  tz := s->>'timezone'; local_date := (p_now at time zone tz)::date;
  with windows as (
    select ((local_date + offset_day) + case when (d->>'is_all_day')::boolean then time '00:00' else (d->>'start_time')::time end) at time zone tz as starts_at,
      ((local_date + offset_day + case when (d->>'is_all_day')::boolean or (d->>'start_time')::time > (d->>'end_time')::time then 1 else 0 end)
        + case when (d->>'is_all_day')::boolean then time '00:00' else (d->>'end_time')::time end) at time zone tz as ends_at
    from generate_series(-1,8) offset_day cross join jsonb_array_elements(s->'days') d
    where (d->>'is_active')::boolean and extract(dow from local_date + offset_day)::integer=(d->>'day_of_week')::integer
  ) select min(starts_at) filter(where starts_at<=p_now and ends_at>p_now),
    max(ends_at) filter(where starts_at<=p_now and ends_at>p_now), min(starts_at) filter(where starts_at>p_now)
    into opens,closes,next_opens from windows;
  return jsonb_build_object('managed',true,'valid',true,
    'open',coalesce(q.is_active,true) and q.deleted_at is null and opens is not null,
    'reason',case when not coalesce(q.is_active,true) or q.deleted_at is not null then 'queue_inactive' when opens is null then 'queue_closed' else 'queue_open' end,
    'timezone',tz,'opensAt',opens,'closesAt',closes,'nextOpensAt',next_opens,
    'windowKey',case when opens is null then null else p_round_robin_id::text||':'||opens::text end);
end;
$function$;

create or replace function private.validate_queue_operating_schedule_write() returns trigger
language plpgsql security definer set search_path = '' as $function$
declare timeout_minutes integer; warning_minutes integer;
begin
  if new.settings ? 'operating_schedule' then
    if not private.queue_schedule_valid(new.settings->'operating_schedule') then
      raise exception using errcode='23514',message='invalid_queue_operating_schedule'; end if;
    timeout_minutes := coalesce((new.settings->>'redistribution_timeout_minutes')::integer,20);
    warning_minutes := coalesce((new.settings->>'redistribution_warning_minutes')::integer,0);
    if timeout_minutes not between 1 and 10080 or warning_minutes<0
      or (warning_minutes>0 and (timeout_minutes<=5 or warning_minutes>=timeout_minutes)) then
      raise exception using errcode='23514',message='invalid_queue_redistribution_warning'; end if;
    if new.settings ? 'redistribution_max_attempts' and (new.settings->>'redistribution_max_attempts')::integer not between 0 and 1000 then
      raise exception using errcode='23514',message='invalid_queue_redistribution_limit'; end if;
  end if;
  return new;
end;
$function$;
create trigger zz_validate_queue_operating_schedule before insert or update of settings on public.round_robins
  for each row execute function private.validate_queue_operating_schedule_write();

revoke all on function private.queue_schedule_valid(jsonb),private.queue_runtime_is_managed(uuid,uuid),
  private.queue_window(uuid,uuid,timestamptz),private.validate_queue_operating_schedule_write() from public,anon,authenticated,service_role;
grant execute on function private.queue_runtime_is_managed(uuid,uuid),private.queue_window(uuid,uuid,timestamptz) to service_role;
commit;
