-- Profile mutations and organization switching are handled by the Go API,
-- which validates tenant context and active membership. A table-level UPDATE
-- grant allowed a browser client to also change role, is_active, points, XP and
-- organization_id, because PostgreSQL table grants override column revokes.
revoke all privileges on table public.users from anon, authenticated;
grant select on table public.users to authenticated;

drop policy if exists "Users can insert their profile" on public.users;
drop policy if exists "users_update_own" on public.users;
drop policy if exists "users_update_safe" on public.users;
drop policy if exists "Super admins can update any user" on public.users;
drop policy if exists "users can update safe own profile columns" on public.users;
drop policy if exists "Users can update own profile" on public.users;
drop policy if exists "Users can update their own profile" on public.users;

comment on table public.users is
  'Client-readable identity projection. All mutations go through the tenant-aware Go API or trusted database triggers.';
