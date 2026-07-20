begin;

create extension if not exists pgtap with schema extensions;
select plan(3);

select is(
  (
    select count(*)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relrowsecurity
      and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
      and (
        has_table_privilege('anon', c.oid, 'select,insert,update,delete,truncate,references,trigger')
        or has_table_privilege('authenticated', c.oid, 'select,insert,update,delete,truncate,references,trigger')
      )
  ),
  0::bigint,
  'Default-deny backend tables expose no client table privileges'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.vista_integrations'::regclass),
  'Vista credentials retain RLS protection'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.imoview_integrations'::regclass),
  'Imoview credentials retain RLS protection'
);

select * from finish();
rollback;
