begin;

create extension if not exists pgtap with schema extensions;
select plan(6);

select ok(
  to_regprocedure('public.admin_dashboard_timeseries(integer)') is null,
  'the broken legacy admin dashboard timeseries RPC is retired'
);

select ok(
  to_regclass('public.asaas_payments') is not null,
  'the canonical dashboard revenue source is preserved'
);

select ok(
  to_regclass('public.automation_executions') is not null,
  'the canonical dashboard automation source is preserved'
);

select ok(
  to_regclass('public.organizations') is not null,
  'the canonical dashboard organization source is preserved'
);

select ok(
  to_regclass('public.leads') is not null,
  'the canonical dashboard lead source is preserved'
);

select ok(
  to_regprocedure('public.admin_dashboard_overview(integer)') is null
  and to_regprocedure('public.get_database_stats_admin()') is null,
  'the completed Super Admin RPC cutover remains enforced'
);

select * from finish();
rollback;
