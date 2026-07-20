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
  not has_table_privilege('anon', 'public.system_settings', 'SELECT')
    and not has_table_privilege('authenticated', 'public.system_settings', 'SELECT'),
  'system settings are hidden from Data API client roles'
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
  not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'users'
      and cmd in ('INSERT', 'UPDATE', 'DELETE')
  ),
  'user mutations are backend-owned'
);

select ok(
  not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'users'
      and policyname in ('users_update_safe', 'users_update_own')
  ),
  'legacy direct user update policies are absent'
);

select ok(
  not has_table_privilege('authenticated', 'public.users', 'UPDATE')
    and not has_any_column_privilege('authenticated', 'public.users', 'UPDATE'),
  'authenticated users have no direct update privilege'
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
