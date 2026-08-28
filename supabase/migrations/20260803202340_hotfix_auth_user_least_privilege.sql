-- Emergency least-privilege hardening for Auth user provisioning and the
-- legacy global role tables.

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (
    id,
    email,
    name,
    role,
    is_active,
    organization_id,
    avatar_url,
    created_at
  )
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), new.email),
    'user',
    true,
    null,
    null,
    now()
  )
  on conflict (id) do update
  set
    email = excluded.email,
    name = excluded.name;

  return new;
end;
$$;

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;
grant execute on function public.handle_new_auth_user() to service_role;

-- A global super-administrator is canonical only when the protected profile
-- itself is active and carries that role. Never derive this privilege from a
-- row that the same RLS helper is responsible for protecting.
create or replace function private.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = 'pg_catalog', 'public', 'private', 'extensions', 'pg_temp'
as $$
  select exists (
    select 1
    from public.users as profile
    where profile.id = auth.uid()
      and coalesce(profile.is_active, false) = true
      and profile.role = 'super_admin'
  );
$$;

create or replace function private.is_super_admin_member_bypass(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = 'pg_catalog', 'public', 'private', 'extensions', 'pg_temp'
as $$
  select exists (
    select 1
    from public.users as profile
    where profile.id = p_user_id
      and coalesce(profile.is_active, false) = true
      and profile.role = 'super_admin'
  );
$$;

drop policy if exists "vimob_canonical_7cef895a50e224c5c5cc6040" on public.user_roles;
drop policy if exists "vimob_canonical_77920959e4f738f75e1d68c2" on public.user_roles;
drop policy if exists "vimob_canonical_9bebdd14220276df1015499c" on public.user_roles;
drop policy if exists "vimob_canonical_bbe02fd258702a7417fa7ea6" on public.user_roles;
drop policy if exists user_roles_select_own_or_super_admin on public.user_roles;
drop policy if exists user_roles_super_admin_insert on public.user_roles;
drop policy if exists user_roles_super_admin_update on public.user_roles;
drop policy if exists user_roles_super_admin_delete on public.user_roles;

create policy user_roles_select_own_or_super_admin
on public.user_roles
for select
to authenticated
using (
  user_id = (select auth.uid())
  or private.is_super_admin()
);

create policy user_roles_super_admin_insert
on public.user_roles
for insert
to authenticated
with check (private.is_super_admin());

create policy user_roles_super_admin_update
on public.user_roles
for update
to authenticated
using (private.is_super_admin())
with check (private.is_super_admin());

create policy user_roles_super_admin_delete
on public.user_roles
for delete
to authenticated
using (private.is_super_admin());

drop policy if exists "vimob_canonical_a91bb1f55f06eb56129cb15d" on public.user_permissions;
drop policy if exists "vimob_canonical_598bb84307897a71fbabaffd" on public.user_permissions;
drop policy if exists "vimob_canonical_e456142ccc5f77dca09db3e2" on public.user_permissions;
drop policy if exists "vimob_canonical_c5fd652ba7c958a7a3985768" on public.user_permissions;
drop policy if exists user_permissions_select_own_or_super_admin on public.user_permissions;
drop policy if exists user_permissions_super_admin_insert on public.user_permissions;
drop policy if exists user_permissions_super_admin_update on public.user_permissions;
drop policy if exists user_permissions_super_admin_delete on public.user_permissions;

create policy user_permissions_select_own_or_super_admin
on public.user_permissions
for select
to authenticated
using (
  user_id = (select auth.uid())
  or private.is_super_admin()
);

create policy user_permissions_super_admin_insert
on public.user_permissions
for insert
to authenticated
with check (private.is_super_admin());

create policy user_permissions_super_admin_update
on public.user_permissions
for update
to authenticated
using (private.is_super_admin())
with check (private.is_super_admin());

create policy user_permissions_super_admin_delete
on public.user_permissions
for delete
to authenticated
using (private.is_super_admin());

revoke all on table public.user_roles from anon;
revoke all on table public.user_permissions from anon;

revoke all on table public.user_roles from authenticated;
grant select, insert, update, delete on table public.user_roles to authenticated;

revoke all on table public.user_permissions from authenticated;
grant select, insert, update, delete on table public.user_permissions to authenticated;
