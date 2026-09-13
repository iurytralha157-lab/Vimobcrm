begin;

create extension if not exists pgtap with schema extensions;
select plan(8);

select ok(
  has_table_privilege('anon', 'public.organization_members', 'select'),
  'anonymous clients retain the legacy tenant-filtered membership read'
);

select ok(
  has_table_privilege('authenticated', 'public.organization_members', 'select'),
  'authenticated clients retain the tenant-filtered membership read'
);

select ok(
  not has_table_privilege(
    'anon',
    'public.organization_members',
    'insert,update,delete,truncate,references,trigger'
  ),
  'anonymous clients have no organization membership mutation privileges'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'public.organization_members',
    'insert,update,delete,truncate,references,trigger'
  ),
  'authenticated clients have no organization membership mutation privileges'
);

select ok(
  (
    select bool_and(has_table_privilege('service_role', 'public.organization_members', privilege_name))
    from (
      values ('select'), ('insert'), ('update'), ('delete')
    ) as privilege(privilege_name)
  ),
  'service_role retains backend membership DML privileges'
);

select ok(
  (
    select bool_and(has_table_privilege('postgres', 'public.organization_members', privilege_name))
    from (
      values ('select'), ('insert'), ('update'), ('delete')
    ) as privilege(privilege_name)
  ),
  'postgres retains backend membership DML privileges'
);

select ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.organization_members'::regclass
  ),
  'organization membership RLS remains enabled for direct reads'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select throws_ok(
  $$
    update public.organization_members
    set role = 'owner'
    where false
  $$,
  '42501',
  null,
  'an authenticated admin cannot bypass the API role hierarchy through Data API updates'
);

reset role;

select * from finish();
rollback;
