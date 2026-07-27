begin;

set local lock_timeout = '2s';
set local statement_timeout = '30s';

-- Production accumulated legacy policy names that duplicate the canonical
-- policies below. Guard the replacements so schema drift aborts the migration
-- instead of silently changing access.
do $guard$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'system_settings'
      and policyname = 'Allow public read system_settings'
  ) and not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'system_settings'
      and policyname = 'Public can view system settings'
      and cmd = 'SELECT'
      and 'anon' = any(roles)
      and lower(regexp_replace(coalesce(qual, ''), '[[:space:]()]', '', 'g')) = 'true'
  ) then
    raise exception 'Cannot remove duplicate system_settings policy: canonical replacement is missing';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'users'
      and policyname in ('Users can update own profile', 'Users can update their own profile')
  ) and not (
    exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'users'
        and policyname = 'users_update_own'
        and cmd = 'UPDATE'
        and 'authenticated' = any(roles)
        and qual ~ 'auth\.uid'
        and with_check ~ 'auth\.uid'
    )
    and exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'users'
        and policyname = 'users_update_safe'
        and cmd = 'UPDATE'
        and 'public' = any(roles)
        and qual ~ 'auth\.uid'
        and qual ~ 'is_super_admin'
    )
  ) then
    raise exception 'Cannot remove duplicate users policies: canonical replacements are missing';
  end if;
end
$guard$;

drop policy if exists "Allow public read system_settings" on public.system_settings;
drop policy if exists "Users can update own profile" on public.users;
drop policy if exists "Users can update their own profile" on public.users;

do $verify$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and (
        (tablename = 'system_settings' and policyname = 'Allow public read system_settings')
        or (
          tablename = 'users'
          and policyname in ('Users can update own profile', 'Users can update their own profile')
        )
      )
  ) then
    raise exception 'Duplicate policy cleanup did not complete';
  end if;
end
$verify$;

commit;
