-- A grant is effective only when the API can prove the owner's current
-- authority. Existing rows have NULL scope and remain ineffective until
-- explicitly granted again. Conversation visibility is still lead-scoped.
alter table public.whatsapp_session_access
  add column grant_scope text,
  add column grant_team_id uuid references public.teams(id) on delete cascade;

alter table public.whatsapp_session_access
  add constraint whatsapp_session_access_grant_scope_check
  check (
    grant_scope is null and grant_team_id is null
    or grant_scope = 'organization' and grant_team_id is null
    or grant_scope = 'team' and grant_team_id is not null
  );

comment on column public.whatsapp_session_access.grant_scope is
  'Authority used by the session owner to grant access: organization or team. NULL legacy grants are not effective.';
comment on column public.whatsapp_session_access.grant_team_id is
  'The active team whose leader granted access; NULL for organization grants.';

create index whatsapp_session_access_team_recipient_idx
  on public.whatsapp_session_access (grant_team_id, user_id)
  where grant_scope = 'team';
create index whatsapp_session_access_team_grantor_idx
  on public.whatsapp_session_access (grant_team_id, granted_by)
  where grant_scope = 'team';
create index whatsapp_session_access_org_grantor_idx
  on public.whatsapp_session_access (organization_id, granted_by)
  where grant_scope = 'organization';

-- Removing a member from a team or ending a leadership term permanently
-- withdraws grants from that term. A later return requires a new grant.
create function private.revoke_whatsapp_team_grants_on_member_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    delete from public.whatsapp_session_access access
    where access.grant_scope = 'team'
      and access.grant_team_id = old.team_id
      and (access.user_id = old.user_id or access.granted_by = old.user_id);
    return old;
  end if;

  if old.team_id is distinct from new.team_id
    or old.user_id is distinct from new.user_id
    or old.organization_id is distinct from new.organization_id
    or (coalesce(old.is_active, false) and not coalesce(new.is_active, false))
  then
    delete from public.whatsapp_session_access access
    where access.grant_scope = 'team'
      and access.grant_team_id = old.team_id
      and (access.user_id = old.user_id or access.granted_by = old.user_id);
  elsif coalesce(old.is_leader, false) and not coalesce(new.is_leader, false) then
    delete from public.whatsapp_session_access access
    where access.grant_scope = 'team'
      and access.grant_team_id = old.team_id
      and access.granted_by = old.user_id;
  end if;
  return new;
end;
$function$;

create trigger revoke_whatsapp_team_grants_on_member_change
after update or delete on public.team_members
for each row execute function private.revoke_whatsapp_team_grants_on_member_change();

create function private.revoke_whatsapp_team_grants_on_team_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if coalesce(old.is_active, false) and not coalesce(new.is_active, false)
    or old.organization_id is distinct from new.organization_id
  then
    delete from public.whatsapp_session_access access
    where access.grant_scope = 'team'
      and access.grant_team_id = old.id;
  end if;
  return new;
end;
$function$;

create trigger revoke_whatsapp_team_grants_on_team_change
after update on public.teams
for each row execute function private.revoke_whatsapp_team_grants_on_team_change();

-- Membership suspension removes both received grants and grants issued by
-- that owner. A role downgrade removes grants issued under organization scope.
create function private.revoke_whatsapp_grants_on_org_member_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    delete from public.whatsapp_session_access access
    where access.organization_id = old.organization_id
      and (access.user_id = old.user_id or access.granted_by = old.user_id);
    return old;
  end if;

  if old.organization_id is distinct from new.organization_id
    or old.user_id is distinct from new.user_id
    or (coalesce(old.is_active, false) and not coalesce(new.is_active, false))
    or (old.deleted_at is null and new.deleted_at is not null)
  then
    delete from public.whatsapp_session_access access
    where access.organization_id = old.organization_id
      and (access.user_id = old.user_id or access.granted_by = old.user_id);
  elsif lower(btrim(old.role)) in ('owner', 'admin', 'manager')
    and lower(btrim(new.role)) not in ('owner', 'admin', 'manager')
  then
    delete from public.whatsapp_session_access access
    where access.organization_id = old.organization_id
      and access.grant_scope = 'organization'
      and access.granted_by = old.user_id;
  end if;
  return new;
end;
$function$;

create trigger revoke_whatsapp_grants_on_org_member_change
after update or delete on public.organization_members
for each row execute function private.revoke_whatsapp_grants_on_org_member_change();

-- A user can also be suspended at the profile level without changing the
-- organization membership. Remove their grants permanently in that case.
create function private.revoke_whatsapp_grants_on_user_deactivation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if coalesce(old.is_active, false) and not coalesce(new.is_active, false) then
    delete from public.whatsapp_session_access access
    where access.user_id = old.id or access.granted_by = old.id;
  end if;
  return new;
end;
$function$;

create trigger revoke_whatsapp_grants_on_user_deactivation
after update of is_active on public.users
for each row execute function private.revoke_whatsapp_grants_on_user_deactivation();

revoke all on function private.revoke_whatsapp_team_grants_on_member_change() from public, anon, authenticated;
revoke all on function private.revoke_whatsapp_team_grants_on_team_change() from public, anon, authenticated;
revoke all on function private.revoke_whatsapp_grants_on_org_member_change() from public, anon, authenticated;
revoke all on function private.revoke_whatsapp_grants_on_user_deactivation() from public, anon, authenticated;
