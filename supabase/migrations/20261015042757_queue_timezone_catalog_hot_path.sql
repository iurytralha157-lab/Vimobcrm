-- The timezone catalog contains names only. AT TIME ZONE still resolves current
-- offsets and DST transitions on each call; no queue/person/permission is cached.
-- Refresh after installing a different PostgreSQL timezone database.
-- Rollback: restore the two predecessor functions before dropping these helpers.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

create table private.queue_timezone_catalog (name text primary key);
alter table private.queue_timezone_catalog enable row level security;
revoke all on private.queue_timezone_catalog from public,anon,authenticated,service_role;

create or replace function private.refresh_queue_timezone_catalog() returns integer
language plpgsql security definer set search_path = '' as $function$
declare refreshed integer;
begin
  if session_user <> 'postgres' or current_setting('role',true) not in ('none','postgres') then
    raise exception using errcode='42501',message='queue_timezone_refresh_postgres_only';
  end if;
  lock table private.queue_timezone_catalog in share row exclusive mode;
  with names as materialized (select name from pg_catalog.pg_timezone_names),
    retired as (delete from private.queue_timezone_catalog old
      where not exists(select 1 from names n where n.name=old.name))
  insert into private.queue_timezone_catalog(name) select name from names
    on conflict(name) do nothing;
  select count(*)::integer into refreshed from private.queue_timezone_catalog;
  return refreshed;
end;
$function$;
revoke all on function private.refresh_queue_timezone_catalog() from public,anon,authenticated,service_role;
select private.refresh_queue_timezone_catalog();

create or replace function private.queue_timezone_name_valid(p_name text) returns boolean
language sql stable security definer set search_path = '' as $function$
  select exists(select 1 from private.queue_timezone_catalog where name=p_name);
$function$;
revoke all on function private.queue_timezone_name_valid(text) from public,anon,authenticated,service_role;

create or replace function private.queue_schedule_valid(p_schedule jsonb)
returns boolean language plpgsql stable security definer set search_path = '' as $function$
declare d jsonb; seen integer[] := '{}'; active_days integer := 0; n integer;
begin
  if jsonb_typeof(p_schedule) is distinct from 'object'
    or p_schedule->'version' is distinct from '1'::jsonb
    or jsonb_typeof(p_schedule->'timezone') is distinct from 'string'
    or not private.queue_timezone_name_valid(p_schedule->>'timezone')
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


create or replace function private.queue_runtime_members(p_org uuid,p_queue uuid,p_now timestamptz)
returns table(member_id uuid,user_id uuid,team_id uuid,team_member_id uuid,"position" integer,weight integer,is_available boolean,window_key text,available_until timestamptz)
language sql stable security definer set search_path = '' as $function$
  with queue_window_context as materialized (
    select q.*,private.queue_window(p_org,p_queue,p_now) as operating_window
    from public.round_robins q where q.organization_id=p_org and q.id=p_queue
  ), queue as (
    select q.*,coalesce(q.operating_window->>'timezone','America/Sao_Paulo') as tz
    from queue_window_context q
  ), expanded as (
    select m.id as member_id,m.user_id,m.team_id,tm.id as team_member_id,m.position,m.weight,0 as kind,m.created_at
    from public.round_robin_members m join public.organization_members om on om.organization_id=m.organization_id and om.user_id=m.user_id
      and om.is_active and om.deleted_at is null and om.membership_generation=m.membership_generation
    join public.users u on u.id=m.user_id and u.is_active
    left join public.teams t on t.id=m.team_id and t.organization_id=m.organization_id and coalesce(t.is_active,true)
    left join public.team_members tm on tm.team_id=m.team_id and tm.organization_id=m.organization_id and tm.user_id=m.user_id
      and coalesce(tm.is_active,true) and tm.membership_generation=om.membership_generation
    where m.organization_id=p_org and m.round_robin_id=p_queue and coalesce(m.is_active,true) and m.user_id is not null
      and (m.team_id is null or (t.id is not null and tm.id is not null))
    union all
    select m.id,tm.user_id,m.team_id,tm.id,m.position,m.weight,1,tm.created_at
    from public.round_robin_members m join public.teams t on t.id=m.team_id and t.organization_id=m.organization_id and coalesce(t.is_active,true)
    join public.team_members tm on tm.team_id=m.team_id and tm.organization_id=m.organization_id and coalesce(tm.is_active,true)
    join public.organization_members om on om.organization_id=tm.organization_id and om.user_id=tm.user_id and om.is_active
      and om.deleted_at is null and om.membership_generation=tm.membership_generation
    join public.users u on u.id=tm.user_id and u.is_active
    where m.organization_id=p_org and m.round_robin_id=p_queue and coalesce(m.is_active,true) and m.user_id is null
  ), availability as (
    select e.*,w.starts_at,w.ends_at,
      coalesce((q.operating_window->>'valid')::boolean,false)
        and (e.team_member_id is null or w.starts_at is not null) as is_available,
      coalesce(q.operating_window->>'windowKey','closed') as queue_window_key
    from expanded e cross join queue q
    left join lateral (
      select min(v.starts_at) as starts_at,max(v.ends_at) as ends_at from (
        select ((p_now at time zone q.tz)::date+offset_day + case when coalesce(a.is_all_day,false) then time '00:00' else a.start_time end) at time zone q.tz as starts_at,
          ((p_now at time zone q.tz)::date+offset_day+case when coalesce(a.is_all_day,false) or a.start_time>a.end_time then 1 else 0 end
            +case when coalesce(a.is_all_day,false) then time '00:00' else a.end_time end) at time zone q.tz as ends_at
        from public.member_availability a cross join generate_series(-1,0) offset_day
        where a.organization_id=p_org and a.team_member_id=e.team_member_id and coalesce(a.is_active,true)
          and a.day_of_week=extract(dow from (p_now at time zone q.tz)::date+offset_day)::integer
      ) v where v.starts_at<=p_now and v.ends_at>p_now
    ) w on true
  ), ranked as (
    select a.*,row_number() over(partition by a.user_id order by a.is_available desc,a.kind,a.position,a.created_at,a.member_id,a.team_member_id) as rank
    from availability a
  ) select r.member_id,r.user_id,r.team_id,r.team_member_id,r.position,r.weight,r.is_available,
      r.queue_window_key||':'||coalesce(r.starts_at::text,'direct'),r.ends_at
    from ranked r where r.rank=1;
$function$;


revoke all on function private.queue_schedule_valid(jsonb),
  private.queue_runtime_members(uuid,uuid,timestamptz) from public,anon,authenticated,service_role;
commit;
