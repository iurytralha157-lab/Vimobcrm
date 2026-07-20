begin;

create extension if not exists pgtap with schema extensions;
select plan(6);

select ok(
  has_table_privilege('authenticated', 'public.users', 'select'),
  'Authenticated clients retain profile reads'
);

select ok(
  not has_table_privilege('authenticated', 'public.users', 'insert'),
  'Authenticated clients cannot insert user identities'
);

select ok(
  not has_table_privilege('authenticated', 'public.users', 'update'),
  'Authenticated clients cannot mutate privileged user columns'
);

select ok(
  not has_table_privilege('authenticated', 'public.users', 'delete'),
  'Authenticated clients cannot delete users'
);

select ok(
  not has_table_privilege('anon', 'public.users', 'select,insert,update,delete'),
  'Anonymous clients have no users table privileges'
);

select is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename = 'users'
      and cmd in ('INSERT', 'UPDATE', 'DELETE')
  ),
  0::bigint,
  'No client mutation policies remain on users'
);

select * from finish();
rollback;
