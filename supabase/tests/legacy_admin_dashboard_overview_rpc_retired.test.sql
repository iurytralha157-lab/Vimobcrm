begin;

create extension if not exists pgtap with schema extensions;
select plan(5);

select ok(
  to_regprocedure('public.admin_dashboard_overview(integer)') is null,
  'the broken legacy admin dashboard overview RPC is retired'
);

select ok(
  to_regclass('public.asaas_payments') is not null
  and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'asaas_payments'
      and column_name = 'payment_date'
      and data_type = 'date'
  ),
  'the active platform billing source is preserved'
);

select ok(
  to_regclass('public.automation_executions') is not null
  and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'automation_executions'
      and column_name = 'started_at'
      and data_type = 'timestamp with time zone'
  ),
  'the active automation execution source is preserved'
);

select ok(
  to_regclass('public.activities') is not null
  and to_regclass('public.error_events') is not null,
  'the active administrative activity and error sources are preserved'
);

select ok(
  to_regclass('public.organizations') is not null
  and to_regclass('public.users') is not null
  and to_regclass('public.leads') is not null,
  'the active platform KPI sources are preserved'
);

select * from finish();
rollback;
