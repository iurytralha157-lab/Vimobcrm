begin;

create extension if not exists pgtap with schema extensions;
select plan(21);

select results_eq(
  $$
    select count(*)::bigint
    from pg_class
    where oid = any(array[
      'public.property_features'::regclass,
      'public.property_proximities'::regclass
    ])
      and relrowsecurity
  $$,
  array[2::bigint],
  'legacy feature and proximity catalogs keep RLS enabled'
);

select ok(
  not has_table_privilege('anon', 'public.property_features', 'SELECT')
  and not has_table_privilege('anon', 'public.property_features', 'INSERT')
  and not has_table_privilege('anon', 'public.property_features', 'UPDATE')
  and not has_table_privilege('anon', 'public.property_features', 'DELETE')
  and not has_table_privilege('anon', 'public.property_proximities', 'SELECT')
  and not has_table_privilege('anon', 'public.property_proximities', 'INSERT')
  and not has_table_privilege('anon', 'public.property_proximities', 'UPDATE')
  and not has_table_privilege('anon', 'public.property_proximities', 'DELETE'),
  'anonymous clients have no legacy property catalog privileges'
);

select ok(
  has_table_privilege('authenticated', 'public.property_features', 'SELECT')
  and has_table_privilege('authenticated', 'public.property_proximities', 'SELECT')
  and not has_table_privilege('authenticated', 'public.property_features', 'INSERT')
  and not has_table_privilege('authenticated', 'public.property_features', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.property_features', 'DELETE')
  and not has_table_privilege('authenticated', 'public.property_proximities', 'INSERT')
  and not has_table_privilege('authenticated', 'public.property_proximities', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.property_proximities', 'DELETE'),
  'authenticated clients keep read-only table grants'
);

select ok(
  has_table_privilege('service_role', 'public.property_features', 'SELECT')
  and has_table_privilege('service_role', 'public.property_features', 'INSERT')
  and has_table_privilege('service_role', 'public.property_features', 'UPDATE')
  and has_table_privilege('service_role', 'public.property_features', 'DELETE')
  and has_table_privilege('service_role', 'public.property_proximities', 'SELECT')
  and has_table_privilege('service_role', 'public.property_proximities', 'INSERT')
  and has_table_privilege('service_role', 'public.property_proximities', 'UPDATE')
  and has_table_privilege('service_role', 'public.property_proximities', 'DELETE')
  and not has_table_privilege('service_role', 'public.property_features', 'TRUNCATE')
  and not has_table_privilege('service_role', 'public.property_proximities', 'TRIGGER'),
  'service role retains only the CRUD privileges needed by the backend'
);

select results_eq(
  $$
    select count(*)::bigint
    from pg_policies
    where schemaname = 'public'
      and tablename in ('property_features', 'property_proximities')
      and policyname <> 'vimob_active_membership_guard'
      and roles = array['authenticated']::name[]
  $$,
  array[8::bigint],
  'each legacy catalog has one authenticated policy per CRUD operation'
);

select results_eq(
  $$
    select count(*)::bigint
    from pg_policies
    where schemaname = 'public'
      and tablename in ('property_features', 'property_proximities')
      and roles && array['public', 'anon']::name[]
  $$,
  array[0::bigint],
  'legacy catalogs expose no PUBLIC or anonymous policies'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
select
  '00000000-0000-0000-0000-000000000000'::uuid,
  fixture.id,
  'authenticated',
  'authenticated',
  fixture.email,
  crypt('test-password', gen_salt('bf', 4)),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now(),
  '',
  '',
  '',
  ''
from (
  values
    ('c9200000-0000-4000-8000-000000000001'::uuid, 'legacy-catalog-none@example.test'),
    ('c9200000-0000-4000-8000-000000000002'::uuid, 'legacy-catalog-view@example.test'),
    ('c9200000-0000-4000-8000-000000000003'::uuid, 'legacy-catalog-manage@example.test')
) as fixture(id, email);

insert into public.organizations (id, name, slug, is_active)
values
  ('c9100000-0000-4000-8000-000000000001', 'Legacy Catalog Org A', 'legacy-catalog-org-a', true),
  ('c9100000-0000-4000-8000-000000000002', 'Legacy Catalog Org B', 'legacy-catalog-org-b', true);

insert into public.users (id, organization_id, name, email, role, is_active)
values
  ('c9200000-0000-4000-8000-000000000001', 'c9100000-0000-4000-8000-000000000001', 'No Permission', 'legacy-catalog-none@example.test', 'user', true),
  ('c9200000-0000-4000-8000-000000000002', 'c9100000-0000-4000-8000-000000000001', 'Viewer', 'legacy-catalog-view@example.test', 'user', true),
  ('c9200000-0000-4000-8000-000000000003', 'c9100000-0000-4000-8000-000000000001', 'Manager', 'legacy-catalog-manage@example.test', 'user', true)
on conflict (id) do update
set organization_id = excluded.organization_id,
    name = excluded.name,
    email = excluded.email,
    role = excluded.role,
    is_active = excluded.is_active;

insert into public.organization_members (organization_id, user_id, role, is_active)
values
  ('c9100000-0000-4000-8000-000000000001', 'c9200000-0000-4000-8000-000000000001', 'user', true),
  ('c9100000-0000-4000-8000-000000000001', 'c9200000-0000-4000-8000-000000000002', 'user', true),
  ('c9100000-0000-4000-8000-000000000001', 'c9200000-0000-4000-8000-000000000003', 'admin', true)
on conflict (user_id, organization_id) do update
set role = excluded.role,
    is_active = excluded.is_active;

insert into public.organization_roles (id, organization_id, name, is_active)
values (
  'c9300000-0000-4000-8000-000000000001',
  'c9100000-0000-4000-8000-000000000001',
  'Legacy Catalog Viewer',
  true
);

insert into public.organization_role_permissions (
  id, organization_role_id, permission_key, organization_id, role_id, permission_id
)
select
  'c9400000-0000-4000-8000-000000000001',
  'c9300000-0000-4000-8000-000000000001',
  'property_view',
  'c9100000-0000-4000-8000-000000000001',
  'c9300000-0000-4000-8000-000000000001',
  permission.id
from public.available_permissions as permission
where permission.key = 'property_view';

insert into public.user_organization_roles (
  id, user_id, organization_role_id, organization_id, role_id, is_active
)
values (
  'c9500000-0000-4000-8000-000000000001',
  'c9200000-0000-4000-8000-000000000002',
  'c9300000-0000-4000-8000-000000000001',
  'c9100000-0000-4000-8000-000000000001',
  'c9300000-0000-4000-8000-000000000001',
  true
);

insert into public.property_features (id, organization_id, name)
values
  ('c9600000-0000-4000-8000-000000000001', 'c9100000-0000-4000-8000-000000000001', 'Feature Org A'),
  ('c9600000-0000-4000-8000-000000000002', 'c9100000-0000-4000-8000-000000000002', 'Feature Org B');

insert into public.property_proximities (id, organization_id, name)
values
  ('c9700000-0000-4000-8000-000000000001', 'c9100000-0000-4000-8000-000000000001', 'Proximity Org A'),
  ('c9700000-0000-4000-8000-000000000002', 'c9100000-0000-4000-8000-000000000002', 'Proximity Org B');

-- Production grants make all browser writes fail before RLS. Temporarily
-- restore only DML privileges inside this rolled-back test to prove the policy
-- layer also fails closed if a future migration regresses the grant boundary.
grant insert, update, delete on table
  public.property_features,
  public.property_proximities
to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'c9200000-0000-4000-8000-000000000001', true);

select results_eq(
  $$
    select count(*)::bigint
    from (
      select id from public.property_features
      union all
      select id from public.property_proximities
    ) as catalog
  $$,
  array[0::bigint],
  'member without property permission reads no legacy catalog rows'
);

select throws_ok(
  $$insert into public.property_features (organization_id, name) values ('c9100000-0000-4000-8000-000000000001', 'Denied Feature')$$,
  '42501',
  null,
  'member without property_manage cannot insert legacy features'
);

select throws_ok(
  $$insert into public.property_proximities (organization_id, name) values ('c9100000-0000-4000-8000-000000000001', 'Denied Proximity')$$,
  '42501',
  null,
  'member without property_manage cannot insert legacy proximities'
);

select set_config('request.jwt.claim.sub', 'c9200000-0000-4000-8000-000000000002', true);

select results_eq(
  $$
    select count(*)::bigint
    from (
      select id from public.property_features
      union all
      select id from public.property_proximities
    ) as catalog
  $$,
  array[2::bigint],
  'property_view reads only same-tenant legacy catalog rows'
);

select is_empty(
  $$update public.property_features set name = 'Viewer Mutation' where id = 'c9600000-0000-4000-8000-000000000001' returning id$$,
  'property_view cannot update a legacy feature'
);

select is_empty(
  $$delete from public.property_proximities where id = 'c9700000-0000-4000-8000-000000000001' returning id$$,
  'property_view cannot delete a legacy proximity'
);

select set_config('request.jwt.claim.sub', 'c9200000-0000-4000-8000-000000000003', true);

select results_eq(
  $$insert into public.property_features (organization_id, name) values ('c9100000-0000-4000-8000-000000000001', 'Manager Feature') returning name$$,
  array['Manager Feature'::text],
  'property_manage may insert a same-tenant legacy feature at the RLS layer'
);

select results_eq(
  $$insert into public.property_proximities (organization_id, name) values ('c9100000-0000-4000-8000-000000000001', 'Manager Proximity') returning name$$,
  array['Manager Proximity'::text],
  'property_manage may insert a same-tenant legacy proximity at the RLS layer'
);

select results_eq(
  $$update public.property_features set name = 'Manager Feature Updated' where organization_id = 'c9100000-0000-4000-8000-000000000001' and name = 'Manager Feature' returning name$$,
  array['Manager Feature Updated'::text],
  'property_manage may update a same-tenant legacy feature at the RLS layer'
);

select results_eq(
  $$delete from public.property_proximities where organization_id = 'c9100000-0000-4000-8000-000000000001' and name = 'Manager Proximity' returning name$$,
  array['Manager Proximity'::text],
  'property_manage may delete a same-tenant legacy proximity at the RLS layer'
);

select throws_ok(
  $$insert into public.property_features (organization_id, name) values ('c9100000-0000-4000-8000-000000000002', 'Cross-tenant Feature')$$,
  '42501',
  null,
  'property_manage cannot insert a feature into another tenant'
);

select throws_ok(
  $$insert into public.property_proximities (organization_id, name) values ('c9100000-0000-4000-8000-000000000002', 'Cross-tenant Proximity')$$,
  '42501',
  null,
  'property_manage cannot insert a proximity into another tenant'
);

select results_eq(
  $$
    select count(*)::bigint
    from (
      select id from public.property_features where organization_id = 'c9100000-0000-4000-8000-000000000002'
      union all
      select id from public.property_proximities where organization_id = 'c9100000-0000-4000-8000-000000000002'
    ) as cross_tenant_catalog
  $$,
  array[0::bigint],
  'property_manage cannot enumerate another tenant legacy catalog'
);

reset role;

select results_eq(
  $$select count(*)::bigint from public.property_features where name like 'Denied %' or name like 'Cross-tenant %'$$,
  array[0::bigint],
  'denied feature writes leave no rows behind'
);

select results_eq(
  $$select count(*)::bigint from public.property_proximities where name like 'Denied %' or name like 'Cross-tenant %'$$,
  array[0::bigint],
  'denied proximity writes leave no rows behind'
);

select * from finish();
rollback;
