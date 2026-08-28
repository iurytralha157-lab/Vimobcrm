-- Align private WhatsApp Broadcast authorization with the effective permission
-- contract returned by the Go tenant context. WhatsApp permissions are part of
-- the default member set; explicit per-user denials can remove them.

create or replace function private.has_effective_whatsapp_view(
  target_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_organization_id is not null
    and auth.uid() is not null
    and (
      private.is_super_admin()
      or exists (
        select 1
        from public.organization_members as membership
        where membership.organization_id = target_organization_id
          and membership.user_id = auth.uid()
          and coalesce(membership.is_active, false) = true
          and (
            lower(btrim(membership.role)) in ('owner', 'admin')
            or not exists (
              select 1
              from public.user_permission_overrides as permission_override
              where permission_override.organization_id = target_organization_id
                and permission_override.user_id = auth.uid()
                and lower(btrim(permission_override.permission_key)) = 'whatsapp_view'
                and permission_override.allowed = false
            )
            or not exists (
              select 1
              from public.user_permission_overrides as permission_override
              where permission_override.organization_id = target_organization_id
                and permission_override.user_id = auth.uid()
                and lower(btrim(permission_override.permission_key)) = 'whatsapp_operate'
                and permission_override.allowed = false
            )
            or not exists (
              select 1
              from public.user_permission_overrides as permission_override
              where permission_override.organization_id = target_organization_id
                and permission_override.user_id = auth.uid()
                and lower(btrim(permission_override.permission_key)) = 'whatsapp_manage'
                and permission_override.allowed = false
            )
          )
      )
    )
    and coalesce(
      (
        select bool_or(coalesce(module_access.is_enabled, false))
        from public.organization_modules as module_access
        where module_access.organization_id = target_organization_id
          and lower(btrim(module_access.module_name)) = 'whatsapp'
      ),
      true
    );
$$;

revoke all on function private.has_effective_whatsapp_view(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.can_receive_whatsapp_broadcast(
  p_topic text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  topic_organization_id uuid;
  topic_lead_id uuid;
begin
  if auth.uid() is null then
    return false;
  end if;

  if split_part(p_topic, ':', 1) = 'audit' then
    return private.can_receive_audit_broadcast(p_topic);
  end if;

  if split_part(p_topic, ':', 1) <> 'whatsapp' then
    return false;
  end if;

  topic_organization_id := private.safe_uuid(split_part(p_topic, ':', 2));
  if topic_organization_id is null
     or not private.has_effective_whatsapp_view(topic_organization_id) then
    return false;
  end if;

  if split_part(p_topic, ':', 3) = 'inbox' then
    return p_topic = 'whatsapp:' || topic_organization_id::text || ':inbox';
  end if;

  if split_part(p_topic, ':', 3) <> 'lead' then
    return false;
  end if;

  topic_lead_id := private.safe_uuid(split_part(p_topic, ':', 4));
  if topic_lead_id is null
     or p_topic <> 'whatsapp:' || topic_organization_id::text || ':lead:' || topic_lead_id::text then
    return false;
  end if;

  return exists (
    select 1
    from public.leads as lead
    where lead.id = topic_lead_id
      and lead.organization_id = topic_organization_id
      and private.can_access_lead(lead.organization_id, lead.assigned_user_id)
  );
end;
$$;

revoke all on function private.can_receive_whatsapp_broadcast(text)
  from public, anon;
grant execute on function private.can_receive_whatsapp_broadcast(text)
  to authenticated, service_role;
