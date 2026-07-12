begin;

create extension if not exists pgtap with schema extensions;
select plan(10);

select is(
  case
    when exists (
      select 1 from pg_policies where schemaname = 'public'
        and tablename = 'contracts' and policyname like 'financial contracts %'
    ) then (
      select count(*) from pg_policies
      where schemaname = 'public' and tablename = 'contracts'
        and policyname in (
          'Super admin access contracts', 'contracts_isolation',
          'Admins can delete contracts', 'Users can insert contracts',
          'Org members can view contracts', 'brokers read own contracts',
          'Admins can update contracts'
        )
    )
    else 0
  end, 0::bigint, 'legacy contracts policies are absent after canonicalization'
);

select ok(
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'contracts' and policyname like 'financial contracts %') in (0, 4),
  'canonical contracts policy set is complete or not required'
);

select ok(
  not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'contracts'
      and policyname like 'financial contracts %' and cmd = 'ALL'
  ), 'contracts has no canonical FOR ALL policy'
);

select ok(
  not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'contracts'
      and policyname like 'financial contracts %' and cmd in ('INSERT', 'UPDATE', 'DELETE')
      and coalesce(qual, with_check, '') !~ 'private\.has_permission'
      and coalesce(with_check, qual, '') !~ 'private\.has_permission'
  ), 'contract writes require financial_manage when canonical policies are installed'
);

select ok(
  not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'contracts'
      and policyname = 'financial contracts select'
      and coalesce(qual, '') !~ 'private\.is_org_member'
  ), 'contract reads require active organization membership'
);

select is(
  case
    when exists (
      select 1 from pg_policies where schemaname = 'public'
        and tablename = 'financial_entries' and policyname like 'financial entries %'
    ) then (
      select count(*) from pg_policies
      where schemaname = 'public' and tablename = 'financial_entries'
        and policyname in (
          'Super admin access financial_entries', 'financial_isolation',
          'Admins can delete financial entries', 'Admins can insert financial entries',
          'Org members can view financial entries', 'Admins can update financial entries'
        )
    )
    else 0
  end, 0::bigint, 'legacy financial entry policies are absent after canonicalization'
);

select ok(
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'financial_entries' and policyname like 'financial entries %') in (0, 4),
  'canonical financial entry policy set is complete or not required'
);

select ok(
  not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'financial_entries'
      and policyname like 'financial entries %' and cmd = 'ALL'
  ), 'financial entries has no canonical FOR ALL policy'
);

select ok(
  not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'financial_entries'
      and policyname like 'financial entries %' and cmd in ('INSERT', 'UPDATE', 'DELETE')
      and coalesce(qual, with_check, '') !~ 'private\.has_permission'
      and coalesce(with_check, qual, '') !~ 'private\.has_permission'
  ), 'financial entry writes require financial_manage when canonical policies are installed'
);

select ok(
  not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'financial_entries'
      and policyname = 'financial entries select'
      and coalesce(qual, '') !~ 'private\.is_org_member'
  ), 'financial entry reads require active organization membership'
);

select * from finish();
rollback;
