begin;

create extension if not exists pgtap with schema extensions;
select plan(12);

select ok(
  (select count(*) from pg_policies where schemaname='public' and tablename='commissions' and policyname like 'service commissions %') in (0,4),
  'commissions consolidation is complete or not required'
);
select ok(
  not exists (select 1 from pg_policies where schemaname='public' and tablename='commissions' and policyname like 'service commissions %' and cmd='ALL'),
  'commissions canonical policies are command-specific'
);
select ok(
  not exists (select 1 from pg_policies where schemaname='public' and tablename='commissions' and policyname like 'service commissions %' and 'public'=any(roles)),
  'commissions canonical policies target authenticated users'
);

select ok(
  (select count(*) from pg_policies where schemaname='public' and tablename='coverage_areas' and policyname like 'coverage areas consolidated %') in (0,4),
  'coverage consolidation is complete or not required'
);
select ok(
  not exists (select 1 from pg_policies where schemaname='public' and tablename='coverage_areas' and policyname like 'coverage areas consolidated %' and cmd='ALL'),
  'coverage canonical policies are command-specific'
);
select ok(
  case
    when to_regclass('public.coverage_areas') is null then true
    else has_table_privilege('authenticated','public.coverage_areas','SELECT')
  end,
  'coverage read privilege remains when the table exists'
);

select ok(
  (select count(*) from pg_policies where schemaname='public' and tablename='service_plans' and policyname like 'service plans consolidated %') in (0,4),
  'service plan consolidation is complete or not required'
);
select ok(
  not exists (select 1 from pg_policies where schemaname='public' and tablename='service_plans' and policyname like 'service plans consolidated %' and cmd='ALL'),
  'service plan canonical policies are command-specific'
);
select ok(
  case
    when to_regclass('public.service_plans') is null then true
    else has_table_privilege('authenticated','public.service_plans','SELECT')
  end,
  'service plan read privilege remains when the table exists'
);

select ok(
  (select count(*) from pg_policies where schemaname='public' and tablename='telecom_customers' and policyname like 'telecom customers consolidated %') in (0,4),
  'telecom customer consolidation is complete or not required'
);
select ok(
  not exists (select 1 from pg_policies where schemaname='public' and tablename='telecom_customers' and policyname like 'telecom customers consolidated %' and cmd='ALL'),
  'telecom customer canonical policies are command-specific'
);
select ok(
  case
    when to_regclass('public.telecom_customers') is null then true
    else has_table_privilege('authenticated','public.telecom_customers','SELECT')
  end,
  'telecom customer read privilege remains when the table exists'
);

select * from finish();
rollback;
