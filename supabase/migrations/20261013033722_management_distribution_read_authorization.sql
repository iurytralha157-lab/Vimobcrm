-- Match the gateway's distribution permission and queue visibility, retaining
-- SELECT grants for legitimate selectors. No client can turn this private
-- helper into a cross-tenant catalog: selected-org permissive policies remain.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

do $preflight$
begin
  if pg_catalog.to_regprocedure('private.has_active_lead_read_session()') is null
     or pg_catalog.to_regprocedure('private.get_user_organization_id()') is null
     or pg_catalog.to_regprocedure('private.can_read_management_distribution(uuid,uuid)') is not null
     or exists (
       select 1 from (values ('round_robins'), ('round_robin_rules'), ('round_robin_members')) expected(name)
       where not exists (
         select 1 from pg_catalog.pg_class relation
         join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
         where namespace.nspname = 'public' and relation.relname = expected.name and relation.relrowsecurity
       ) or not pg_catalog.has_table_privilege('authenticated', 'public.' || expected.name, 'select')
     ) then
    raise exception 'management_distribution_read_preflight_failed';
  end if;
end;
$preflight$;

create function private.can_read_management_distribution(p_organization_id uuid, p_queue_id uuid)
returns boolean language plpgsql stable security definer set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  member_role text;
  queue_creator uuid;
  queue_pipeline uuid;
  led_teams uuid[];
  led_users uuid[];
  led_pipelines uuid[];
  effective_keys text[];
  override_allowed boolean;
begin
  if actor_id is null or p_organization_id is null or p_queue_id is null
     or not private.has_active_lead_read_session() then return false; end if;
  select queue.created_by, queue.pipeline_id into queue_creator, queue_pipeline
  from public.round_robins queue
  where queue.id = p_queue_id and queue.organization_id = p_organization_id and queue.deleted_at is null;
  if not found then return false; end if;

  select lower(btrim(account.role)) into actor_role from public.users account
  where account.id = actor_id and coalesce(account.is_active, false);
  if not found then return false; end if;
  if actor_role = 'super_admin' then return true; end if;
  if private.get_user_organization_id() is distinct from p_organization_id then return false; end if;
  select lower(btrim(coalesce(nullif(member.role, ''), 'user'))) into member_role
  from public.organization_members member
  join public.organizations organization on organization.id = member.organization_id
  where member.organization_id = p_organization_id and member.user_id = actor_id
    and coalesce(member.is_active, false) and member.deleted_at is null
    and coalesce(organization.is_active, true);
  if not found then return false; end if;
  if member_role in ('owner', 'admin') then return true; end if;

  -- No built-in manager/leader default implies DistributionManage. Go Expand
  -- has no alias or composite expansion that grants this permission.
  select coalesce(array_agg(distinct lower(btrim(permission.key))), array[]::text[]) into effective_keys
  from public.user_organization_roles assignment
  join public.organization_roles role
    on role.id = assignment.role_id and role.organization_id = assignment.organization_id
  join public.organization_role_permissions grant_row
    on grant_row.role_id = role.id and grant_row.organization_id = role.organization_id
  join public.available_permissions permission on permission.id = grant_row.permission_id
  where assignment.user_id = actor_id and assignment.organization_id = p_organization_id
    and coalesce(assignment.is_active, false) and coalesce(role.is_active, false);
  if not ('*' = any(effective_keys)) then
    -- Contradictory legacy spellings are ambiguous in Go's override map;
    -- deny this additional Data API path until the ambiguity is repaired.
    if exists (
      select 1 from public.user_permission_overrides override
      where override.organization_id = p_organization_id and override.user_id = actor_id
        and lower(btrim(override.permission_key)) = 'distribution_manage'
      having bool_or(coalesce(override.allowed, false)) and bool_or(not coalesce(override.allowed, false))
    ) then return false; end if;
    select override.allowed into override_allowed from public.user_permission_overrides override
    where override.organization_id = p_organization_id and override.user_id = actor_id
      and lower(btrim(override.permission_key)) = 'distribution_manage' limit 1;
    if found then
      if not coalesce(override_allowed, false) then return false; end if;
    elsif not ('distribution_manage' = any(effective_keys)) then return false;
    end if;
  end if;

  -- Generation-aware leadership matches tenant.Repository.RefreshLeadership.
  select coalesce(array_agg(distinct team.id), array[]::uuid[]) into led_teams
  from public.team_members leader
  join public.teams team on team.id = leader.team_id and team.organization_id = leader.organization_id
  join public.organization_members membership
    on membership.organization_id = leader.organization_id and membership.user_id = leader.user_id
   and membership.is_active = true and membership.deleted_at is null
   and membership.membership_generation = leader.membership_generation
  where leader.organization_id = p_organization_id and leader.user_id = actor_id
    and coalesce(leader.is_active, true) and coalesce(leader.is_leader, false) and coalesce(team.is_active, true);
  if cardinality(led_teams) = 0 then return true; end if;
  select coalesce(array_agg(distinct member.user_id), array[]::uuid[]) || array[actor_id] into led_users
  from public.team_members member
  join public.users account on account.id = member.user_id
  join public.organization_members membership
    on membership.organization_id = member.organization_id and membership.user_id = member.user_id
   and membership.is_active = true and membership.deleted_at is null
   and membership.membership_generation = member.membership_generation
  where member.organization_id = p_organization_id and member.team_id = any(led_teams)
    and coalesce(member.is_active, true) and coalesce(account.is_active, false);
  select coalesce(array_agg(distinct link.pipeline_id), array[]::uuid[]) into led_pipelines
  from public.team_pipelines link
  join public.pipelines pipeline on pipeline.id = link.pipeline_id and pipeline.organization_id = link.organization_id
  where link.organization_id = p_organization_id and link.team_id = any(led_teams) and coalesce(pipeline.is_active, true);
  return coalesce(queue_creator = actor_id, false) or coalesce(queue_pipeline = any(led_pipelines), false) or exists (
    select 1 from public.round_robin_members member
    where member.organization_id = p_organization_id and member.round_robin_id = p_queue_id
      and coalesce(member.is_active, true)
      and (member.team_id = any(led_teams) or member.user_id = any(led_users))
  );
end;
$function$;
revoke all on function private.can_read_management_distribution(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.can_read_management_distribution(uuid,uuid) to authenticated;

create policy management_distribution_read_scope on public.round_robins
as restrictive for select to authenticated
using (private.can_read_management_distribution(organization_id, id));
create policy management_distribution_rule_read_scope on public.round_robin_rules
as restrictive for select to authenticated
using (private.can_read_management_distribution(organization_id, round_robin_id));
create policy management_distribution_member_read_scope on public.round_robin_members
as restrictive for select to authenticated
using (private.can_read_management_distribution(organization_id, round_robin_id));

-- Reversal is a reviewed forward migration dropping these three restrictive
-- policies and then this helper; it reopens the previous organization catalog.
commit;
