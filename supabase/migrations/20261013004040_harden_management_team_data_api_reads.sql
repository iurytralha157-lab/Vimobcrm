-- Keep SELECT grants needed by legacy pipeline/RLS selectors, but AND every
-- client read with the Teams gateway's effective permission and team scope.
-- These helpers are private definers only because policies inspect the same
-- team/member/link tables: an invoker would recurse through their own RLS.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

do $preflight$
begin
  if pg_catalog.to_regprocedure('private.get_user_organization_id()') is null
     or pg_catalog.to_regprocedure('private.has_active_lead_read_session()') is null
     or pg_catalog.to_regprocedure('private.can_read_management_team(uuid,uuid,uuid)') is not null
     or pg_catalog.to_regprocedure('private.can_read_management_team_member(uuid,uuid,uuid,bigint,boolean)') is not null
     or exists (
       select 1 from (values ('teams'), ('team_members'), ('team_pipelines')) expected(name)
       where not exists (
         select 1 from pg_catalog.pg_class relation
         join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
         where namespace.nspname = 'public' and relation.relname = expected.name
           and relation.relrowsecurity
       ) or not pg_catalog.has_table_privilege('authenticated', 'public.' || expected.name, 'select')
     ) then
    raise exception 'management_team_read_preflight_failed: expected session helper, table grants or RLS are unavailable';
  end if;
end;
$preflight$;

create function private.can_read_management_team(
  p_organization_id uuid, p_team_id uuid, p_pipeline_id uuid
)
returns boolean language plpgsql stable security definer set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  member_role text;
  is_leader boolean;
  target_is_led boolean;
  effective_keys text[];
  required_permission_key text;
  override_allowed boolean;
begin
  if actor_id is null or p_organization_id is null or p_team_id is null
     or not private.has_active_lead_read_session()
     or not exists (select 1 from public.teams team
                    where team.id = p_team_id and team.organization_id = p_organization_id)
     or (p_pipeline_id is not null and not exists (
       select 1 from public.pipelines pipeline
       where pipeline.id = p_pipeline_id and pipeline.organization_id = p_organization_id
     )) then return false; end if;

  select pg_catalog.lower(pg_catalog.btrim(account.role)) into actor_role
  from public.users account
  where account.id = actor_id and coalesce(account.is_active, false);
  if not found then return false; end if;
  -- Existing permissive policies retain their selected-org/global-superadmin
  -- boundary. No JWT role or user_metadata claim can grant this bypass.
  if actor_role = 'super_admin' then return true; end if;
  if private.get_user_organization_id() is distinct from p_organization_id then return false; end if;

  select pg_catalog.lower(pg_catalog.btrim(coalesce(nullif(member.role, ''), 'user'))) into member_role
  from public.organization_members member
  join public.organizations organization on organization.id = member.organization_id
  where member.organization_id = p_organization_id and member.user_id = actor_id
    and coalesce(member.is_active, false) and member.deleted_at is null
    and coalesce(organization.is_active, true);
  if not found then return false; end if;
  if member_role in ('owner', 'admin') then return true; end if;

  select count(*) > 0, coalesce(bool_or(team.id = p_team_id), false)
  into is_leader, target_is_led
  from public.team_members leader
  join public.teams team on team.id = leader.team_id and team.organization_id = leader.organization_id
  join public.organization_members membership
    on membership.organization_id = leader.organization_id and membership.user_id = leader.user_id
   and membership.is_active = true and membership.deleted_at is null
   and membership.membership_generation = leader.membership_generation
  where leader.organization_id = p_organization_id and leader.user_id = actor_id
    and coalesce(leader.is_active, true) and coalesce(leader.is_leader, false)
    and coalesce(team.is_active, true);

  -- Match permissions.Expand for only the four keys relevant to TeamView.
  -- The gateway loads role grants through available_permissions.id/key; a
  -- stale permission_key text alone must not create a grant absent in Go.
  select coalesce(array_agg(distinct expanded.key), array[]::text[]) into effective_keys
  from public.user_organization_roles assignment
  join public.organization_roles role
    on role.id = assignment.role_id and role.organization_id = assignment.organization_id
  join public.organization_role_permissions grant_row
    on grant_row.role_id = role.id and grant_row.organization_id = role.organization_id
  join public.available_permissions permission on permission.id = grant_row.permission_id
  cross join lateral unnest(case pg_catalog.lower(pg_catalog.btrim(permission.key))
    when 'settings_manage' then array['team_manage', 'pipeline_manage']
    when 'settings_teams' then array['team_manage']
    when 'teams_manage' then array['team_manage']
    when 'pipeline_edit' then array['pipeline_manage']
    when 'settings_pipelines' then array['pipeline_manage']
    when 'cadences_manage' then array['pipeline_manage']
    else array[pg_catalog.lower(pg_catalog.btrim(permission.key))]
  end) expanded(key)
  where assignment.user_id = actor_id and assignment.organization_id = p_organization_id
    and coalesce(assignment.is_active, false) and coalesce(role.is_active, false);

  if not ('*' = any(effective_keys)) then
    -- Canonical writes never create contradictory alias rows. If legacy data
    -- does, do not pick an arbitrary grant: Go iterates its override map without
    -- a stable alias order. This actor needs that ambiguity repaired first.
    if exists (
      select 1 from public.user_permission_overrides denied
      cross join lateral (select case pg_catalog.lower(pg_catalog.btrim(denied.permission_key))
        when 'settings_teams' then 'team_manage' when 'teams_manage' then 'team_manage'
        when 'pipeline_edit' then 'pipeline_manage' when 'settings_pipelines' then 'pipeline_manage'
        when 'cadences_manage' then 'pipeline_manage'
        else pg_catalog.lower(pg_catalog.btrim(denied.permission_key)) end as key) canonical
      where denied.organization_id = p_organization_id and denied.user_id = actor_id
        and canonical.key in ('team_view','team_manage','pipeline_manage','distribution_manage')
      group by canonical.key
      having bool_or(coalesce(denied.allowed,false)) and bool_or(not coalesce(denied.allowed,false))
    ) then return false; end if;
    if member_role = 'manager' or is_leader then effective_keys := effective_keys || array['team_view']; end if;
    if is_leader then effective_keys := effective_keys || array['team_manage']; end if;
    -- Unlike grants above, current Resolve only accepts canonical/simple alias
    -- overrides. Composite settings_manage overrides are ignored in Go and SQL.
    foreach required_permission_key in array array['team_view', 'team_manage', 'pipeline_manage', 'distribution_manage'] loop
      select override.allowed into override_allowed
      from public.user_permission_overrides override
      where override.organization_id = p_organization_id and override.user_id = actor_id
        and (case pg_catalog.lower(pg_catalog.btrim(override.permission_key))
          when 'settings_teams' then 'team_manage' when 'teams_manage' then 'team_manage'
          when 'pipeline_edit' then 'pipeline_manage' when 'settings_pipelines' then 'pipeline_manage'
          when 'cadences_manage' then 'pipeline_manage'
          else pg_catalog.lower(pg_catalog.btrim(override.permission_key)) end) = required_permission_key
      limit 1;
      if found then
        effective_keys := array_remove(effective_keys, required_permission_key);
        if override_allowed then effective_keys := effective_keys || array[required_permission_key]; end if;
      end if;
    end loop;
    -- Resolve reapplies implications AFTER overrides. A denied TeamView is
    -- implied again by any effective management permission, exactly as in Go.
    if not ('team_view' = any(effective_keys) or 'team_manage' = any(effective_keys)
            or 'pipeline_manage' = any(effective_keys) or 'distribution_manage' = any(effective_keys)) then
      return false;
    end if;
  end if;
  return member_role = 'manager' or not is_leader or target_is_led;
end;
$function$;

create function private.can_read_management_team_member(
  p_organization_id uuid, p_team_id uuid, p_user_id uuid,
  p_membership_generation bigint, p_is_active boolean
)
returns boolean language sql stable security definer set search_path = ''
as $function$
  select coalesce(p_is_active, true)
    and private.can_read_management_team(p_organization_id, p_team_id, null)
    and exists (
      select 1 from public.users account
      join public.organization_members membership on membership.user_id = account.id
       and membership.organization_id = p_organization_id
       and membership.is_active = true and membership.deleted_at is null
       and membership.membership_generation = p_membership_generation
      where account.id = p_user_id and coalesce(account.is_active, false)
    );
$function$;
revoke all on function private.can_read_management_team(uuid,uuid,uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.can_read_management_team_member(uuid,uuid,uuid,bigint,boolean)
  from public, anon, authenticated, service_role;
grant execute on function private.can_read_management_team(uuid,uuid,uuid),
  private.can_read_management_team_member(uuid,uuid,uuid,bigint,boolean) to authenticated;

create policy management_team_read_scope on public.teams
as restrictive for select to authenticated
using (private.can_read_management_team(organization_id, id, null));
create policy management_team_member_read_scope on public.team_members
as restrictive for select to authenticated
using (private.can_read_management_team_member(organization_id, team_id, user_id, membership_generation, is_active));
create policy management_team_pipeline_read_scope on public.team_pipelines
as restrictive for select to authenticated
using (private.can_read_management_team(organization_id, team_id, pipeline_id));

-- Preserve grants and existing permissive policies. Reversal requires a
-- separately reviewed forward migration removing these three AND boundaries
-- and then the two private helpers; that reopens organization-wide client reads.
commit;
