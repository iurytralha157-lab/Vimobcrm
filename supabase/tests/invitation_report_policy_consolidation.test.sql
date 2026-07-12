begin;

create extension if not exists pgtap with schema extensions;
select plan(8);

select ok(
  (select count(*) from pg_policies where schemaname='public' and tablename='invitations' and policyname like 'invitations consolidated %') in (0,4),
  'invitation consolidation is complete or not required'
);
select ok(
  not exists (select 1 from pg_policies where schemaname='public' and tablename='invitations' and policyname like 'invitations consolidated %' and cmd='ALL'),
  'invitation policies are command-specific'
);
select ok(
  not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='invitations'
      and policyname='invitations consolidated select'
      and position('invitation_token' in coalesce(qual,'')) = 0
  ),
  'invitation token lookup remains in the select policy'
);
select ok(
  case
    when to_regclass('public.invitations') is null then true
    else has_table_privilege('authenticated','public.invitations','SELECT')
  end,
  'invitation read privilege remains when the table exists'
);

select ok(
  (select count(*) from pg_policies where schemaname='public' and tablename='prospecting_reports' and policyname like 'prospecting reports consolidated %') in (0,4),
  'prospecting report consolidation is complete or not required'
);
select ok(
  not exists (select 1 from pg_policies where schemaname='public' and tablename='prospecting_reports' and policyname like 'prospecting reports consolidated %' and cmd='ALL'),
  'prospecting report policies are command-specific'
);
select ok(
  not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='prospecting_reports'
      and policyname='prospecting reports consolidated select'
      and position('true' in lower(coalesce(qual,''))) = 0
  ),
  'legacy global report read remains unchanged'
);
select ok(
  case
    when to_regclass('public.prospecting_reports') is null then true
    else has_table_privilege('authenticated','public.prospecting_reports','SELECT')
  end,
  'prospecting report read privilege remains when the table exists'
);

select * from finish();
rollback;
