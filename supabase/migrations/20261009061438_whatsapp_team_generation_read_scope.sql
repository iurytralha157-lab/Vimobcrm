-- A removed and reinvited member may leave an active legacy team row behind.
-- Match the existing distribution generation fence on team-based lead reads.
-- Direct assignment and owner/admin access keep their prior semantics.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

do $preflight$
declare
  lead_definition text;
  whatsapp_definition text;
  permission_definition text;
begin
  if pg_catalog.to_regprocedure('private.can_read_lead(uuid,uuid,uuid)') is null
     or pg_catalog.to_regprocedure('private.whatsapp_actor_can_read_lead(uuid,uuid,uuid)') is null
     or pg_catalog.to_regprocedure('private.whatsapp_actor_has_lead_permission(uuid,uuid,text)') is null
     or not exists (
       select 1 from pg_catalog.pg_policies
       where schemaname = 'public' and tablename = 'leads'
         and policyname = 'leads_select_active_broker_team' and cmd = 'SELECT'
     ) or not exists (
       select 1 from pg_catalog.pg_policies
       where schemaname = 'public' and tablename = 'whatsapp_messages'
         and policyname = 'whatsapp_messages_select_owner_only' and cmd = 'SELECT'
     ) then
    raise exception 'team_generation_read_preflight_failed: expected read helpers or policies are missing';
  end if;

  select pg_catalog.pg_get_functiondef(
    'private.can_read_lead(uuid,uuid,uuid)'::regprocedure::oid
  ) into lead_definition;
  select pg_catalog.pg_get_functiondef(
    'private.whatsapp_actor_can_read_lead(uuid,uuid,uuid)'::regprocedure::oid
  ) into whatsapp_definition;
  select pg_catalog.pg_get_functiondef(
    'private.whatsapp_actor_has_lead_permission(uuid,uuid,text)'::regprocedure::oid
  ) into permission_definition;

  -- Abort on a changed upstream contract; these explicit replacements must
  -- preserve its active-membership, permission and team visibility branches.
  if pg_catalog.strpos(lead_definition,
       'private.lead_view_all_granted(target_organization_id)') = 0
     or pg_catalog.strpos(lead_definition,
       'target_assigned_user_id = (select auth.uid())') = 0
     or pg_catalog.strpos(lead_definition,
       'from public.team_members as leader') = 0
     or pg_catalog.strpos(lead_definition,
       'broker_organization_member.deleted_at is null') = 0
     or pg_catalog.strpos(whatsapp_definition,
       'private.whatsapp_actor_has_lead_permission(') = 0
     or pg_catalog.strpos(whatsapp_definition,
       'from public.team_members as leader') = 0
     or pg_catalog.strpos(whatsapp_definition,
       'broker_org_member.deleted_at is null') = 0
     or pg_catalog.strpos(permission_definition,
       'if found then return v_override; end if;') = 0
     or pg_catalog.strpos(permission_definition,
       'join public.organization_roles as role_row') = 0
     or pg_catalog.strpos(permission_definition,
       'coalesce(role_row.is_active, false)') = 0
  then
    raise exception 'team_generation_read_preflight_failed: read helper contract drifted';
  end if;
end;
$preflight$;

create or replace function private.can_read_lead(
  target_organization_id uuid,
  target_assigned_user_id uuid,
  target_team_id uuid
)
returns boolean language sql stable security definer set search_path = pg_catalog
as $function$
  select private.is_super_admin()
    or (
      private.is_org_member(target_organization_id)
      and (
        private.lead_view_all_granted(target_organization_id)
        or target_assigned_user_id = (select auth.uid())
        or exists (
          select 1
          from public.team_members as leader
          join public.organization_members as leader_membership
            on leader_membership.organization_id = leader.organization_id
           and leader_membership.user_id = leader.user_id
           and leader_membership.is_active = true
           and leader_membership.deleted_at is null
           and leader_membership.membership_generation = leader.membership_generation
          join public.teams as led_team
            on led_team.id = leader.team_id
           and led_team.organization_id = leader.organization_id
           and coalesce(led_team.is_active, true) = true
          where leader.organization_id = target_organization_id
            and leader.user_id = (select auth.uid())
            and coalesce(leader.is_active, false) = true
            and coalesce(leader.is_leader, false) = true
            and not exists (
              select 1
              from public.user_permission_overrides as denied_permission
              where denied_permission.organization_id = target_organization_id
                and denied_permission.user_id = leader.user_id
                and lower(btrim(denied_permission.permission_key)) = 'lead_view_team'
                and denied_permission.allowed = false
            )
            and (
              (target_assigned_user_id is null and led_team.id = target_team_id)
              or (
                target_assigned_user_id is not null
                and exists (
                  select 1
                  from public.team_members as broker_member
                  join public.users as broker
                    on broker.id = broker_member.user_id
                   and coalesce(broker.is_active, false) = true
                  join public.organization_members as broker_organization_member
                    on broker_organization_member.organization_id = broker_member.organization_id
                   and broker_organization_member.user_id = broker_member.user_id
                   and coalesce(broker_organization_member.is_active, false) = true
                   and broker_organization_member.deleted_at is null
                   and broker_organization_member.membership_generation = broker_member.membership_generation
                  where broker_member.organization_id = target_organization_id
                    and broker_member.team_id = led_team.id
                    and broker_member.user_id = target_assigned_user_id
                    and coalesce(broker_member.is_active, false) = true
                )
              )
            )
        )
      )
    );
$function$;
revoke all on function private.can_read_lead(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.can_read_lead(uuid, uuid, uuid)
  to authenticated, service_role;

create or replace function private.whatsapp_actor_can_read_lead(
  p_organization_id uuid, p_lead_id uuid, p_actor_user_id uuid
)
returns boolean language sql stable security definer set search_path = ''
as $function$
  select exists (
    select 1
    from public.leads as lead
    join public.organization_members as membership
      on membership.organization_id = lead.organization_id
     and membership.user_id = p_actor_user_id
     and membership.is_active
     and membership.deleted_at is null
    join public.users as actor
      on actor.id = p_actor_user_id
     and actor.organization_id = lead.organization_id
     and coalesce(actor.is_active, false)
    where lead.id = p_lead_id
      and lead.organization_id = p_organization_id
      and (
        membership.role in ('owner', 'admin')
        or private.whatsapp_actor_has_lead_permission(
          p_organization_id, p_actor_user_id, 'lead_view_all'
        )
        or (lead.assigned_user_id = p_actor_user_id
            and private.whatsapp_actor_has_lead_permission(
              p_organization_id, p_actor_user_id, 'lead_view_own'
            ))
        or (
          private.whatsapp_actor_has_lead_permission(
            p_organization_id, p_actor_user_id, 'lead_view_team'
          )
          and exists (
            select 1
            from public.team_members as leader
            join public.organization_members as leader_membership
              on leader_membership.organization_id = leader.organization_id
             and leader_membership.user_id = leader.user_id
             and leader_membership.is_active = true
             and leader_membership.deleted_at is null
             and leader_membership.membership_generation = leader.membership_generation
            join public.teams as team
              on team.id = leader.team_id
             and team.organization_id = leader.organization_id
             and coalesce(team.is_active, true)
            where leader.organization_id = p_organization_id
              and leader.user_id = p_actor_user_id
              and leader.is_active and leader.is_leader
              and (
                (lead.assigned_user_id is null and team.id = lead.team_id)
                or (lead.assigned_user_id is not null
                  and exists (
                    select 1
                    from public.team_members as broker_member
                    join public.users as broker
                      on broker.id = broker_member.user_id
                     and coalesce(broker.is_active, false)
                    join public.organization_members as broker_org_member
                      on broker_org_member.organization_id = broker_member.organization_id
                     and broker_org_member.user_id = broker_member.user_id
                     and broker_org_member.is_active
                     and broker_org_member.deleted_at is null
                     and broker_org_member.membership_generation = broker_member.membership_generation
                    where broker_member.organization_id = p_organization_id
                      and broker_member.team_id = team.id
                      and broker_member.user_id = lead.assigned_user_id
                      and broker_member.is_active
                  ))
              )
          )
        )
      )
  );
$function$;
revoke all on function private.whatsapp_actor_can_read_lead(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.whatsapp_actor_can_read_lead(uuid, uuid, uuid)
  to authenticated;

create or replace function private.whatsapp_actor_has_lead_permission(
  p_organization_id uuid, p_actor_user_id uuid, p_permission_key text
)
returns boolean language plpgsql stable security definer set search_path = ''
as $function$
declare
  v_role text;
  v_override boolean;
  v_default boolean := false;
  v_granted boolean := false;
begin
  if p_permission_key not in ('lead_view_all', 'lead_view_own', 'lead_view_team')
     or p_organization_id is null or p_actor_user_id is null then
    return false;
  end if;
  select member.role into v_role
  from public.organization_members as member
  join public.users as actor
    on actor.id = member.user_id
   and actor.organization_id = member.organization_id
   and coalesce(actor.is_active, false)
  where member.organization_id = p_organization_id
    and member.user_id = p_actor_user_id
    and member.is_active and member.deleted_at is null;
  if v_role is null then return false; end if;
  if v_role in ('owner', 'admin') then return true; end if;

  select override.allowed into v_override
  from public.user_permission_overrides as override
  where override.organization_id = p_organization_id
    and override.user_id = p_actor_user_id
    and pg_catalog.lower(pg_catalog.btrim(override.permission_key)) = p_permission_key
  limit 1;
  if found then return v_override; end if;

  v_default := p_permission_key = 'lead_view_own'
    or (p_permission_key = 'lead_view_all' and v_role = 'manager')
    or (p_permission_key = 'lead_view_team' and exists (
      select 1
      from public.team_members as leader
      join public.organization_members as leader_membership
        on leader_membership.organization_id = leader.organization_id
       and leader_membership.user_id = leader.user_id
       and leader_membership.is_active = true
       and leader_membership.deleted_at is null
       and leader_membership.membership_generation = leader.membership_generation
      join public.teams as team
        on team.id = leader.team_id
       and team.organization_id = leader.organization_id
       and coalesce(team.is_active, true)
      where leader.organization_id = p_organization_id
        and leader.user_id = p_actor_user_id
        and leader.is_active and leader.is_leader
    ));
  select exists (
    select 1
    from public.user_organization_roles as user_role
    join public.organization_roles as role_row
      on role_row.id = user_role.role_id
     and role_row.organization_id = user_role.organization_id
     and coalesce(role_row.is_active, false)
    join public.organization_role_permissions as role_permission
      on role_permission.role_id = user_role.role_id
     and role_permission.organization_id = user_role.organization_id
    join public.available_permissions as permission
      on permission.id = role_permission.permission_id
    where user_role.organization_id = p_organization_id
      and user_role.user_id = p_actor_user_id
      and user_role.is_active
      and (
        permission.key = p_permission_key
        or (p_permission_key = 'lead_view_all'
            and permission.key in ('lead_edit_all', 'lead_manage'))
        or (p_permission_key = 'lead_view_own'
            and permission.key = 'lead_edit_own')
      )
  ) into v_granted;
  return v_default or v_granted;
end;
$function$;
revoke all on function private.whatsapp_actor_has_lead_permission(uuid, uuid, text)
  from public, anon, authenticated, service_role;

commit;
