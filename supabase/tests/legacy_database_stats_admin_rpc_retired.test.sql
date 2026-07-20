begin;

create extension if not exists pgtap with schema extensions;
select plan(4);

select ok(
  to_regprocedure('public.get_database_stats_admin()') is null,
  'the broken legacy database statistics RPC is retired'
);

select ok(
  to_regclass('public.organizations') is not null
  and to_regclass('public.users') is not null
  and to_regclass('public.organization_members') is not null,
  'the active critical admin table-count sources are preserved'
);

select ok(
  to_regclass('public.admin_subscription_plans') is not null
  and to_regclass('public.audit_logs') is not null
  and to_regclass('public.notifications') is not null,
  'the remaining active admin table-count sources are preserved'
);

select ok(
  to_regclass('storage.objects') is not null,
  'the storage object catalog is preserved without the legacy full-scan RPC'
);

select * from finish();
rollback;
