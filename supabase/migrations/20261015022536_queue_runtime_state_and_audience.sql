begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

create table private.queue_lead_runtime (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  round_robin_id uuid not null references public.round_robins(id),
  episode_id uuid not null default gen_random_uuid(), revision bigint not null default 1,
  state text not null check(state in ('auto_assigned','pool_waiting','pool_ready','manual_protected','human_protected','closed','limit_exhausted')),
  reason text not null, round_number integer not null default 1 check(round_number>0),
  assignment_count integer not null default 0 check(assignment_count>=0),
  max_assignments integer not null check(max_assignments between 0 and 1000),
  last_user_id uuid, last_window_key text, baseline_at timestamptz not null,
  last_queue_close_at timestamptz,last_member_close_at timestamptz,
  last_distribution_event_id uuid,
  assigned_at timestamptz, due_at timestamptz, next_action_at timestamptz,
  entered_pool_at timestamptz, released_at timestamptz, protected_actor_id uuid,
  retry_count integer not null default 0 check(retry_count between 0 and 5),quarantined_at timestamptz,last_error_code text,
  created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
  primary key(organization_id,lead_id),unique(episode_id)
);
create index queue_lead_runtime_due_idx on private.queue_lead_runtime(next_action_at,organization_id,round_robin_id,lead_id)
  where state in ('auto_assigned','pool_waiting','pool_ready');
create index queue_lead_runtime_fifo_idx on private.queue_lead_runtime(organization_id,round_robin_id,entered_pool_at,lead_id)
  where state in ('pool_waiting','pool_ready','limit_exhausted');
create table private.queue_round_visits (
  organization_id uuid not null,lead_id uuid not null,episode_id uuid not null,round_number integer not null,
  user_id uuid not null,assigned_at timestamptz not null,
  primary key(organization_id,lead_id,episode_id,round_number,user_id),
  foreign key(organization_id,lead_id) references private.queue_lead_runtime(organization_id,lead_id) on delete cascade
);
create table private.queue_runtime_commands (
  transaction_id bigint not null,organization_id uuid not null,lead_id uuid not null,
  mode text not null check(mode in ('canonical','automatic','manual','claim')),actor_id uuid,
  primary key(transaction_id,organization_id,lead_id)
);
create table private.queue_pool_claim_receipts (
  organization_id uuid not null,actor_id uuid not null,idempotency_key text not null check(length(idempotency_key) between 1 and 200),
  lead_id uuid not null,round_robin_id uuid not null,episode_id uuid not null,expected_revision bigint not null,
  result jsonb not null,created_at timestamptz not null default clock_timestamp(),
  primary key(organization_id,actor_id,idempotency_key)
);
create table private.queue_runtime_events (
  id uuid primary key default gen_random_uuid(),organization_id uuid not null,lead_id uuid not null,
  round_robin_id uuid not null,episode_id uuid not null,round_number integer not null,
  event_type text not null,from_user_id uuid,to_user_id uuid,actor_id uuid,
  metadata jsonb not null default '{}'::jsonb,created_at timestamptz not null default clock_timestamp()
);
create index queue_runtime_events_lead_idx on private.queue_runtime_events(organization_id,lead_id,created_at desc);
alter table private.queue_lead_runtime enable row level security;
alter table private.queue_round_visits enable row level security;
alter table private.queue_runtime_commands enable row level security;
alter table private.queue_pool_claim_receipts enable row level security;
alter table private.queue_runtime_events enable row level security;
revoke all on private.queue_lead_runtime,private.queue_round_visits,private.queue_runtime_commands,
  private.queue_pool_claim_receipts,private.queue_runtime_events from public,anon,authenticated,service_role;

create or replace function private.queue_runtime_actor_active(p_org uuid,p_actor uuid) returns boolean
language sql stable security definer set search_path = '' as $function$
  select exists(select 1 from public.organization_members om join public.users u on u.id=om.user_id
    join public.organizations o on o.id=om.organization_id
    where om.organization_id=p_org and om.user_id=p_actor and om.is_active and om.deleted_at is null
      and u.is_active and coalesce(o.is_active,true));
$function$;

create or replace function private.queue_runtime_actor_admin(p_org uuid,p_actor uuid) returns boolean
language sql stable security definer set search_path = '' as $function$
  select private.queue_runtime_actor_active(p_org,p_actor) and (
    exists(select 1 from public.organization_members om where om.organization_id=p_org and om.user_id=p_actor and om.role in ('owner','admin'))
    or exists(select 1 from public.organizations o where o.id=p_org and o.created_by=p_actor));
$function$;

create or replace function private.queue_runtime_members(p_org uuid,p_queue uuid,p_now timestamptz)
returns table(member_id uuid,user_id uuid,team_id uuid,team_member_id uuid,"position" integer,weight integer,is_available boolean,window_key text,available_until timestamptz)
language sql stable security definer set search_path = '' as $function$
  with queue as (
    select q.*,case when exists(select 1 from pg_catalog.pg_timezone_names where name=q.settings->'operating_schedule'->>'timezone')
      then q.settings->'operating_schedule'->>'timezone' else 'America/Sao_Paulo' end as tz
    from public.round_robins q where q.organization_id=p_org and q.id=p_queue
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
    select e.*,w.starts_at,w.ends_at,e.team_member_id is null or w.starts_at is not null as is_available
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
      coalesce(private.queue_window(p_org,p_queue,p_now)->>'windowKey','closed')||':'||coalesce(r.starts_at::text,'direct'),r.ends_at
    from ranked r where r.rank=1;
$function$;

create or replace function private.queue_pool_audience(p_org uuid,p_queue uuid,p_actor uuid) returns boolean
language sql stable security definer set search_path = '' as $function$
  select private.queue_runtime_actor_active(p_org,p_actor) and (
    private.queue_runtime_actor_admin(p_org,p_actor)
    or exists(select 1 from private.queue_runtime_members(p_org,p_queue,clock_timestamp()) m where m.user_id=p_actor)
    or exists(select 1 from private.queue_runtime_members(p_org,p_queue,clock_timestamp()) m
      join public.team_members target on target.organization_id=p_org and target.user_id=m.user_id and coalesce(target.is_active,true)
      join public.organization_members target_org on target_org.organization_id=p_org and target_org.user_id=target.user_id
        and target_org.is_active and target_org.deleted_at is null and target_org.membership_generation=target.membership_generation
      join public.teams t on t.id=target.team_id and t.organization_id=p_org and coalesce(t.is_active,true)
      join public.team_members leader on leader.organization_id=p_org and leader.team_id=target.team_id and leader.user_id=p_actor
        and coalesce(leader.is_active,true) and coalesce(leader.is_leader,false)
      join public.organization_members leader_org on leader_org.organization_id=p_org and leader_org.user_id=p_actor
        and leader_org.is_active and leader_org.deleted_at is null and leader_org.membership_generation=leader.membership_generation));
$function$;

create or replace function private.queue_pool_read_access(p_organization_id uuid,p_lead_id uuid,p_actor_id uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $function$
declare r private.queue_lead_runtime%rowtype;
begin
  select * into r from private.queue_lead_runtime where organization_id=p_organization_id and lead_id=p_lead_id
    and state in ('pool_waiting','pool_ready','limit_exhausted');
  if not found then return null; end if;
  if current_setting('role',true) not in ('none','postgres','service_role') and p_actor_id is distinct from auth.uid() then return false; end if;
  return private.queue_pool_audience(p_organization_id,r.round_robin_id,p_actor_id);
end;
$function$;

create or replace function private.queue_pool_metadata(p_organization_id uuid,p_lead_id uuid,p_actor_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $function$
declare r private.queue_lead_runtime%rowtype;
begin
  if private.queue_pool_read_access(p_organization_id,p_lead_id,p_actor_id) is distinct from true then return null; end if;
  select * into r from private.queue_lead_runtime where organization_id=p_organization_id and lead_id=p_lead_id;
  return jsonb_build_object('roundRobinId',r.round_robin_id,'episodeId',r.episode_id,'revision',r.revision,'state',r.state,
    'reason',r.reason,'enteredAt',r.entered_pool_at,'nextActionAt',r.next_action_at,
    'canClaim',private.queue_runtime_actor_active(p_organization_id,p_actor_id) and (private.queue_runtime_actor_admin(p_organization_id,p_actor_id)
      or coalesce((select o.allowed from public.user_permission_overrides o where o.organization_id=p_organization_id and o.user_id=p_actor_id
        and lower(btrim(o.permission_key))='lead_operate'),private.user_has_permission_in_organization('lead_operate',p_actor_id,p_organization_id))));
end;
$function$;

create policy queue_pool_private_read on public.leads as restrictive for select to authenticated
  using(coalesce(private.queue_pool_read_access(organization_id,id,(select auth.uid())),true));
revoke all on function private.queue_runtime_actor_active(uuid,uuid),private.queue_runtime_actor_admin(uuid,uuid),
  private.queue_runtime_members(uuid,uuid,timestamptz),private.queue_pool_audience(uuid,uuid,uuid),
  private.queue_pool_metadata(uuid,uuid,uuid),private.queue_pool_read_access(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.queue_pool_read_access(uuid,uuid,uuid) to authenticated,service_role;
grant execute on function private.queue_pool_metadata(uuid,uuid,uuid) to service_role;
commit;
