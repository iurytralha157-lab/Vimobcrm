begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

select ok(
  not exists (
    select 1
    from (values
      ('public.user_organization_roles'::regclass),
      ('public.user_permission_overrides'::regclass)
    ) as target(relation_name)
    cross join (values ('anon'), ('authenticated')) as browser(role_name)
    cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) as action(privilege_name)
    where pg_catalog.has_table_privilege(
      browser.role_name, target.relation_name, action.privilege_name
    )
  ),
  'browser roles cannot write membership grant tables'
);

select ok(
  not exists (
    select 1
    from (values
      ('public.user_organization_roles'::regclass),
      ('public.user_permission_overrides'::regclass)
    ) as target(relation_name)
    join pg_catalog.pg_attribute as attribute
      on attribute.attrelid = target.relation_name
     and attribute.attnum > 0
     and not attribute.attisdropped
    cross join (values ('anon'), ('authenticated')) as browser(role_name)
    cross join (values ('INSERT'), ('UPDATE')) as action(privilege_name)
    where pg_catalog.has_column_privilege(
      browser.role_name, target.relation_name,
      attribute.attname, action.privilege_name
    )
  ),
  'browser roles have no column-level write bypass'
);

select ok(
  pg_catalog.has_table_privilege('service_role', 'public.user_organization_roles', 'INSERT')
    and pg_catalog.has_table_privilege('service_role', 'public.user_organization_roles', 'UPDATE')
    and pg_catalog.has_table_privilege('service_role', 'public.user_organization_roles', 'DELETE'),
  'backend keeps custom-role assignment writes'
);

select ok(
  pg_catalog.has_table_privilege('service_role', 'public.user_permission_overrides', 'INSERT')
    and pg_catalog.has_table_privilege('service_role', 'public.user_permission_overrides', 'UPDATE')
    and pg_catalog.has_table_privilege('service_role', 'public.user_permission_overrides', 'DELETE'),
  'backend keeps user override writes'
);

select ok(
  pg_catalog.has_table_privilege('postgres', 'public.user_organization_roles', 'INSERT')
    and pg_catalog.has_table_privilege('postgres', 'public.user_organization_roles', 'UPDATE')
    and pg_catalog.has_table_privilege('postgres', 'public.user_organization_roles', 'DELETE'),
  'migration owner keeps custom-role assignment writes'
);

select ok(
  pg_catalog.has_table_privilege('postgres', 'public.user_permission_overrides', 'INSERT')
    and pg_catalog.has_table_privilege('postgres', 'public.user_permission_overrides', 'UPDATE')
    and pg_catalog.has_table_privilege('postgres', 'public.user_permission_overrides', 'DELETE'),
  'migration owner keeps user override writes'
);

select * from finish();
rollback;
