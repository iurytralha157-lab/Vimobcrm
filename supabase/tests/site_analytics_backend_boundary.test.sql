begin;

create extension if not exists pgtap with schema extensions;
select plan(12);

select ok(
  (
    select relrowsecurity
    from pg_catalog.pg_class
    where oid = 'public.site_analytics_events'::regclass
  ),
  'raw site analytics retain RLS as defense in depth'
);

select results_eq(
  $$
    select count(*)::bigint
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'site_analytics_events'
  $$,
  array[0::bigint],
  'raw site analytics expose no direct client policies'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'public.site_analytics_events',
    'select'
  ),
  'authenticated clients cannot read raw site analytics through Data API'
);

select ok(
  (
    select bool_and(
      not has_table_privilege(
        browser_role.name,
        'public.site_analytics_events',
        privilege.name
      )
    )
    from unnest(array['anon', 'authenticated']) as browser_role(name)
    cross join unnest(array[
      'select',
      'insert',
      'update',
      'delete',
      'truncate',
      'references',
      'trigger'
    ]) as privilege(name)
  ),
  'browser roles have no raw site analytics table privileges'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_class as relation
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        relation.relacl,
        pg_catalog.acldefault('r', relation.relowner)
      )
    ) as privilege
    where relation.oid = 'public.site_analytics_events'::regclass
      and privilege.grantee = 0
  ),
  'PUBLIC has no raw site analytics table privileges'
);

select ok(
  (
    select count(*) = 4
      and bool_and(
        privilege_type = any(array['DELETE', 'INSERT', 'SELECT', 'UPDATE'])
      )
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'site_analytics_events'
      and grantee = 'service_role'
  ),
  'service_role has exactly the CRUD privileges used by backend analytics flows'
);

select ok(
  (
    select bool_and(
      not has_table_privilege(
        'service_role',
        'public.site_analytics_events',
        privilege.name
      )
    )
    from unnest(array['truncate', 'references', 'trigger']) as privilege(name)
  ),
  'service_role has no schema-management privileges on raw site analytics'
);

insert into public.organizations (id, name, slug, is_active)
values (
  'e9700000-0000-4000-8000-000000000001',
  'Site Analytics Backend Boundary',
  'site-analytics-backend-boundary',
  true
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  'e9800000-0000-4000-8000-000000000001',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

select throws_ok(
  $$select count(*) from public.site_analytics_events$$,
  '42501',
  null,
  'authenticated requests cannot bypass the Go gateway with a direct query'
);

reset role;
set local role service_role;

select lives_ok(
  $$
    insert into public.site_analytics_events (
      id,
      organization_id,
      session_id,
      event_type,
      page_path,
      metadata
    ) values (
      'e9900000-0000-4000-8000-000000000001',
      'e9700000-0000-4000-8000-000000000001',
      'site-analytics-backend-boundary-session',
      'pageview',
      '/site-analytics-backend-boundary',
      '{"boundary":"backend"}'::jsonb
    )
  $$,
  'service_role can insert raw site analytics'
);

select results_eq(
  $$
    select count(*)::bigint
    from public.site_analytics_events
    where id = 'e9900000-0000-4000-8000-000000000001'
  $$,
  array[1::bigint],
  'service_role can read raw site analytics'
);

select results_eq(
  $$
    update public.site_analytics_events
    set duration_seconds = 42
    where id = 'e9900000-0000-4000-8000-000000000001'
    returning duration_seconds
  $$,
  array[42],
  'service_role can update raw site analytics'
);

select results_eq(
  $$
    delete from public.site_analytics_events
    where id = 'e9900000-0000-4000-8000-000000000001'
    returning id
  $$,
  array['e9900000-0000-4000-8000-000000000001'::uuid],
  'service_role can delete raw site analytics'
);

reset role;

select * from finish();
rollback;
