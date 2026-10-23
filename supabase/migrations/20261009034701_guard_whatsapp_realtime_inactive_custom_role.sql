-- A deactivated custom role must stop granting lead visibility to WhatsApp
-- Realtime, even while its user assignment remains active.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

create or replace function private.whatsapp_actor_has_lead_permission(
  p_organization_id uuid, p_actor_user_id uuid, p_permission_key text
)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
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
    and pg_catalog.lower(pg_catalog.btrim(override.permission_key)) =
        p_permission_key
  limit 1;
  if found then return v_override; end if;

  v_default := p_permission_key = 'lead_view_own'
    or (p_permission_key = 'lead_view_all' and v_role = 'manager')
    or (p_permission_key = 'lead_view_team' and exists (
      select 1 from public.team_members as leader
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
$$;
revoke all on function private.whatsapp_actor_has_lead_permission(uuid, uuid, text)
  from public, anon, authenticated, service_role;

commit;
