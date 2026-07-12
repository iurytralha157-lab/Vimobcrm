begin;

create extension if not exists pgtap with schema extensions;
select plan(8);

select is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename = 'system_settings'
      and policyname = 'Allow public read system_settings'
  ),
  0::bigint,
  'legacy duplicate system settings policy is absent'
);

select ok(
  not exists (
    select 1
    from pg_policies first_policy
    join pg_policies second_policy
      on second_policy.schemaname = first_policy.schemaname
     and second_policy.tablename = first_policy.tablename
     and second_policy.cmd = first_policy.cmd
     and second_policy.policyname > first_policy.policyname
     and second_policy.roles = first_policy.roles
     and coalesce(second_policy.qual, '') = coalesce(first_policy.qual, '')
     and coalesce(second_policy.with_check, '') = coalesce(first_policy.with_check, '')
    where first_policy.schemaname = 'public'
      and first_policy.tablename = 'system_settings'
  ),
  'system settings has no byte-for-byte duplicate policies'
);

select ok(
  has_table_privilege('anon', 'public.system_settings', 'SELECT'),
  'anonymous system settings reads keep their table privilege'
);

select is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename = 'users'
      and policyname in ('Users can update own profile', 'Users can update their own profile')
  ),
  0::bigint,
  'legacy duplicate user update policies are absent'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'users'
      and cmd = 'UPDATE'
      and ('authenticated' = any(roles) or 'public' = any(roles))
      and qual ~ 'auth\.uid'
      and with_check ~ 'auth\.uid'
  ),
  'authenticated users retain the checked own-profile update policy'
);

select ok(
  case
    when exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'users'
        and policyname = 'users_update_safe'
    ) then exists (
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
    else true
  end,
  'legacy production safe update policy is preserved when installed'
);

select ok(
  has_table_privilege('authenticated', 'public.users', 'UPDATE')
    or has_any_column_privilege('authenticated', 'public.users', 'UPDATE'),
  'authenticated users retain a users update privilege'
);

select ok(
  not exists (
    select 1
    from pg_policies first_policy
    join pg_policies second_policy
      on second_policy.schemaname = first_policy.schemaname
     and second_policy.tablename = first_policy.tablename
     and second_policy.cmd = first_policy.cmd
     and second_policy.policyname > first_policy.policyname
     and second_policy.roles = first_policy.roles
     and coalesce(second_policy.qual, '') = coalesce(first_policy.qual, '')
     and coalesce(second_policy.with_check, '') = coalesce(first_policy.with_check, '')
    where first_policy.schemaname = 'public'
      and first_policy.tablename = 'users'
  ),
  'users has no byte-for-byte duplicate policies'
);

select * from finish();
rollback;
