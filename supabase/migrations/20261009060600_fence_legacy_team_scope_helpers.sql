-- Legacy public wrappers and RLS policies call these private helpers. Keep
-- their signatures and existing EXECUTE grants, but derive team scope only
-- from active memberships in the caller's selected organization.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

do $preflight$
declare
  helper record;
  helper_oid regprocedure;
  definition text;
begin
  for helper in
    select * from (values
      ('private.get_user_led_pipeline_ids()', 'INNER JOIN team_members tm ON tm.team_id = tp.team_id'),
      ('private.get_user_led_team_ids()', 'SELECT team_id FROM public.team_members'),
      ('private.get_user_team_ids()', 'SELECT team_id FROM public.team_members'),
      ('private.is_team_leader(uuid)', 'SELECT 1 FROM public.team_members'),
      ('private.is_user_in_led_team(uuid,uuid)', 'from public.team_members leader_tm'),
      ('private.is_user_leader_of_team(uuid,uuid)', 'from public.team_members tm'),
      ('private.is_pipeline_in_led_team(uuid,uuid)', 'from public.team_members tm')
    ) as expected(signature, anchor)
  loop
    helper_oid := pg_catalog.to_regprocedure(helper.signature);
    if helper_oid is null then
      raise exception 'membership_generation_team_preflight_failed: % missing', helper.signature;
    end if;
    select pg_catalog.pg_get_functiondef(helper_oid::oid) into definition;
    if pg_catalog.strpos(definition, helper.anchor) = 0
       or pg_catalog.strpos(definition, 'membership_generation') > 0
       or not exists (
         select 1 from pg_catalog.pg_proc as procedure
         join pg_catalog.pg_language as language on language.oid = procedure.prolang
         where procedure.oid = helper_oid::oid
           and language.lanname = 'sql'
           and procedure.provolatile = 's'
           and procedure.prosecdef
       ) then
      raise exception 'membership_generation_team_preflight_failed: % definition drifted', helper.signature;
    end if;
  end loop;
end;
$preflight$;

create or replace function private.get_user_led_pipeline_ids()
returns setof uuid language sql stable security definer set search_path = ''
as $function$
  select distinct team_pipeline.pipeline_id
  from public.team_pipelines as team_pipeline
  join public.team_members as team_member
    on team_member.team_id = team_pipeline.team_id
   and team_member.organization_id = team_pipeline.organization_id
  join public.teams as team
    on team.id = team_member.team_id
   and team.organization_id = team_member.organization_id
   and coalesce(team.is_active, true) = true
  join public.organization_members as membership
    on membership.organization_id = team_member.organization_id
   and membership.user_id = team_member.user_id
   and membership.is_active = true
   and membership.deleted_at is null
   and membership.membership_generation = team_member.membership_generation
  join public.users as actor
    on actor.id = membership.user_id
   and actor.organization_id = membership.organization_id
   and actor.is_active = true
  where team_member.user_id = (select auth.uid())
    and team_member.is_active = true
    and team_member.is_leader = true;
$function$;

create or replace function private.get_user_led_team_ids()
returns setof uuid language sql stable security definer set search_path = ''
as $function$
  select distinct team.id
  from public.team_members as team_member
  join public.teams as team
    on team.id = team_member.team_id
   and team.organization_id = team_member.organization_id
   and coalesce(team.is_active, true) = true
  join public.organization_members as membership
    on membership.organization_id = team_member.organization_id
   and membership.user_id = team_member.user_id
   and membership.is_active = true
   and membership.deleted_at is null
   and membership.membership_generation = team_member.membership_generation
  join public.users as actor
    on actor.id = membership.user_id
   and actor.organization_id = membership.organization_id
   and actor.is_active = true
  where team_member.user_id = (select auth.uid())
    and team_member.is_active = true
    and team_member.is_leader = true;
$function$;

create or replace function private.get_user_team_ids()
returns setof uuid language sql stable security definer set search_path = ''
as $function$
  select distinct team.id
  from public.team_members as team_member
  join public.teams as team
    on team.id = team_member.team_id
   and team.organization_id = team_member.organization_id
   and coalesce(team.is_active, true) = true
  join public.organization_members as membership
    on membership.organization_id = team_member.organization_id
   and membership.user_id = team_member.user_id
   and membership.is_active = true
   and membership.deleted_at is null
   and membership.membership_generation = team_member.membership_generation
  join public.users as actor
    on actor.id = membership.user_id
   and actor.organization_id = membership.organization_id
   and actor.is_active = true
  where team_member.user_id = (select auth.uid())
    and team_member.is_active = true;
$function$;

create or replace function private.is_team_leader(check_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = ''
as $function$
  select exists (
    select 1
    from public.team_members as team_member
    join public.teams as team
      on team.id = team_member.team_id
     and team.organization_id = team_member.organization_id
     and coalesce(team.is_active, true) = true
    join public.organization_members as membership
      on membership.organization_id = team_member.organization_id
     and membership.user_id = team_member.user_id
     and membership.is_active = true
     and membership.deleted_at is null
     and membership.membership_generation = team_member.membership_generation
    join public.users as checked_user
      on checked_user.id = membership.user_id
     and checked_user.organization_id = membership.organization_id
     and checked_user.is_active = true
    where team_member.user_id = check_user_id
      and team_member.is_active = true
      and team_member.is_leader = true
      and team.organization_id = private.get_user_organization_id()
  );
$function$;

create or replace function private.is_user_in_led_team(
  p_target_user_id uuid, p_user_id uuid default auth.uid()
)
returns boolean language sql stable security definer set search_path = ''
as $function$
  select exists (
    select 1
    from public.team_members as leader_member
    join public.teams as team
      on team.id = leader_member.team_id
     and team.organization_id = leader_member.organization_id
     and coalesce(team.is_active, true) = true
    join public.team_members as target_member
      on target_member.team_id = leader_member.team_id
     and target_member.organization_id = leader_member.organization_id
    join public.organization_members as leader_membership
      on leader_membership.organization_id = leader_member.organization_id
     and leader_membership.user_id = leader_member.user_id
     and leader_membership.is_active = true
     and leader_membership.deleted_at is null
     and leader_membership.membership_generation = leader_member.membership_generation
    join public.organization_members as target_membership
      on target_membership.organization_id = target_member.organization_id
     and target_membership.user_id = target_member.user_id
     and target_membership.is_active = true
     and target_membership.deleted_at is null
     and target_membership.membership_generation = target_member.membership_generation
    where leader_member.user_id = p_user_id
      and leader_member.is_active = true
      and leader_member.is_leader = true
      and target_member.user_id = p_target_user_id
      and target_member.is_active = true
      and team.organization_id = private.get_user_organization_id()
  );
$function$;

create or replace function private.is_user_leader_of_team(
  p_team_id uuid, p_user_id uuid default auth.uid()
)
returns boolean language sql stable security definer set search_path = ''
as $function$
  select exists (
    select 1
    from public.team_members as team_member
    join public.teams as team
      on team.id = team_member.team_id
     and team.organization_id = team_member.organization_id
     and coalesce(team.is_active, true) = true
    join public.organization_members as membership
      on membership.organization_id = team_member.organization_id
     and membership.user_id = team_member.user_id
     and membership.is_active = true
     and membership.deleted_at is null
     and membership.membership_generation = team_member.membership_generation
    where team_member.team_id = p_team_id
      and team_member.user_id = p_user_id
      and team_member.is_active = true
      and team_member.is_leader = true
      and team.organization_id = private.get_user_organization_id()
  );
$function$;

create or replace function private.is_pipeline_in_led_team(
  p_pipeline_id uuid, p_user_id uuid default auth.uid()
)
returns boolean language sql stable security definer set search_path = ''
as $function$
  select exists (
    select 1
    from public.team_members as team_member
    join public.teams as team
      on team.id = team_member.team_id
     and team.organization_id = team_member.organization_id
     and coalesce(team.is_active, true) = true
    join public.team_pipelines as team_pipeline
      on team_pipeline.team_id = team.id
     and team_pipeline.organization_id = team.organization_id
    join public.organization_members as membership
      on membership.organization_id = team_member.organization_id
     and membership.user_id = team_member.user_id
     and membership.is_active = true
     and membership.deleted_at is null
     and membership.membership_generation = team_member.membership_generation
    where team_member.user_id = p_user_id
      and team_member.is_active = true
      and team_member.is_leader = true
      and team_pipeline.pipeline_id = p_pipeline_id
      and team.organization_id = private.get_user_organization_id()
  );
$function$;

commit;
