-- A WhatsApp connection may belong to any organization member, but only a
-- connection owned by an organization administrator can become the sender for
-- internal system notifications.

create or replace function private.is_whatsapp_notification_admin(
  p_organization_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1
      from public.organization_members membership
      join public.users app_user
        on app_user.id = membership.user_id
      where membership.organization_id = p_organization_id
        and membership.user_id = p_user_id
        and coalesce(membership.is_active, false) = true
        and coalesce(app_user.is_active, false) = true
        and lower(coalesce(membership.role, '')) in ('owner', 'admin', 'super_admin')
    )
    or exists (
      select 1
      from public.users app_user
      where app_user.id = p_user_id
        and coalesce(app_user.is_active, false) = true
        and lower(coalesce(app_user.role, '')) = 'super_admin'
    );
$$;

revoke all on function private.is_whatsapp_notification_admin(uuid, uuid)
  from public, anon, authenticated;

create or replace function private.enforce_whatsapp_notification_sender_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_whatsapp_notification_admin(
    new.organization_id,
    new.owner_user_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'Only organization administrators can configure a WhatsApp notification sender.';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_whatsapp_notification_sender_admin()
  from public, anon, authenticated;

drop trigger if exists tr_authorize_whatsapp_notification_sender
  on public.whatsapp_sessions;

create trigger tr_authorize_whatsapp_notification_sender
before insert or update of is_notification_session, organization_id, owner_user_id
on public.whatsapp_sessions
for each row
when (new.is_notification_session = true)
execute function private.enforce_whatsapp_notification_sender_admin();

create or replace function private.clear_whatsapp_notification_sender_after_admin_loss()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
  target_user_id uuid;
begin
  if tg_op = 'DELETE' then
    target_organization_id := old.organization_id;
    target_user_id := old.user_id;
  else
    target_organization_id := new.organization_id;
    target_user_id := new.user_id;
  end if;

  if private.is_whatsapp_notification_admin(
    target_organization_id,
    target_user_id
  ) then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  update public.whatsapp_sessions
  set is_notification_session = false,
      updated_at = now()
  where organization_id = target_organization_id
    and owner_user_id = target_user_id
    and is_notification_session = true;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.clear_whatsapp_notification_sender_after_admin_loss()
  from public, anon, authenticated;

drop trigger if exists tr_clear_whatsapp_notification_sender_after_admin_loss
  on public.organization_members;

create trigger tr_clear_whatsapp_notification_sender_after_admin_loss
after update of role, is_active or delete
on public.organization_members
for each row
execute function private.clear_whatsapp_notification_sender_after_admin_loss();

-- Remove stale or active flags that violate the new invariant.
update public.whatsapp_sessions session
set is_notification_session = false,
    updated_at = now()
where session.is_notification_session = true
  and not private.is_whatsapp_notification_admin(
    session.organization_id,
    session.owner_user_id
  );

comment on function private.is_whatsapp_notification_admin(uuid, uuid) is
  'Returns whether a WhatsApp session owner may represent an organization as its internal notification sender.';

comment on trigger tr_authorize_whatsapp_notification_sender
  on public.whatsapp_sessions is
  'Prevents non-admin-owned WhatsApp sessions from becoming organization notification senders.';

comment on trigger tr_clear_whatsapp_notification_sender_after_admin_loss
  on public.organization_members is
  'Clears the notification sender flag when its owner loses organization administrator access.';
