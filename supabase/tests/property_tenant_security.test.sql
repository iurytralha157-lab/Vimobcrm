begin;

create extension if not exists pgtap with schema extensions;
select plan(39);

select is(
  (
    select column_default
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'properties'
      and column_name = 'published_on_site'
  ),
  'false',
  'new properties are not published by default'
);

select results_eq(
  $$select count(*)::bigint from public.available_permissions where key in ('property_view', 'property_manage')$$,
  array[2::bigint],
  'property permissions are available on a clean database'
);

select is(
  (select public from storage.buckets where id = 'properties'),
  true,
  'legacy property media remains public until asset promotion is implemented'
);

select is(
  (select public from storage.buckets where id = 'property-private'),
  false,
  'confidential property media uses a private bucket'
);

select ok(
  exists (
    select 1
    from storage.buckets
    where id = 'property-private'
      and file_size_limit = 10485760
      and 'application/pdf' = any(allowed_mime_types)
      and 'image/jpeg' = any(allowed_mime_types)
  ),
  'private property media has explicit size and MIME restrictions'
);

select ok(
  not has_table_privilege('anon', 'public.properties', 'SELECT'),
  'anonymous clients have no property table access'
);

select ok(
  not has_table_privilege('authenticated', 'public.properties', 'SELECT'),
  'authenticated clients cannot bypass the backend to read property PII'
);

select ok(
  not has_table_privilege('authenticated', 'public.property_owners', 'SELECT'),
  'authenticated clients cannot bypass the backend to read owner PII'
);

select ok(
  has_table_privilege('authenticated', 'public.property_cities', 'SELECT')
  and has_table_privilege('authenticated', 'public.property_neighborhoods', 'SELECT')
  and has_table_privilege('authenticated', 'public.property_condominiums', 'SELECT')
  and has_table_privilege('authenticated', 'public.property_types', 'SELECT'),
  'authenticated clients retain read-only access to location catalogs through RLS'
);

select ok(
  not has_table_privilege('authenticated', 'public.property_cities', 'INSERT')
  and not has_table_privilege('authenticated', 'public.property_neighborhoods', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.property_condominiums', 'DELETE')
  and not has_table_privilege('authenticated', 'public.property_types', 'INSERT'),
  'authenticated clients cannot mutate location catalogs directly'
);

select ok(
  has_table_privilege('service_role', 'public.properties', 'SELECT')
  and has_table_privilege('service_role', 'public.properties', 'INSERT')
  and has_table_privilege('service_role', 'public.property_owners', 'UPDATE')
  and has_table_privilege('service_role', 'public.property_condominiums', 'DELETE')
  and not has_table_privilege('service_role', 'public.properties', 'TRUNCATE')
  and not has_table_privilege('service_role', 'public.property_owners', 'TRIGGER'),
  'service role retains CRUD without schema-level property privileges'
);

select results_eq(
  $$
    select count(*)::bigint
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'properties',
        'property_owners',
        'property_cities',
        'property_neighborhoods',
        'property_condominiums',
        'property_types'
      )
  $$,
  array[24::bigint],
  'each protected property table has one canonical policy per operation'
);

select results_eq(
  $$
    select count(*)::bigint
    from pg_trigger
    where not tgisinternal
      and tgname = any(array[
        'zz_tenant_ref_properties_owner_id',
        'zz_tenant_ref_properties_city_id',
        'zz_tenant_ref_properties_neighborhood_id',
        'zz_tenant_ref_properties_condominium_id',
        'zz_tenant_ref_properties_property_type_id',
        'zz_tenant_ref_properties_corretor_id',
        'zz_tenant_ref_properties_created_by',
        'zz_tenant_ref_properties_responsible_user_id',
        'zz_tenant_ref_properties_cadastrado_por',
        'zz_tenant_ref_property_owners_created_by',
        'zz_tenant_ref_property_neighborhoods_city_id',
        'zz_tenant_ref_property_condominiums_city_id',
        'zz_tenant_ref_property_condominiums_neighborhood_id'
      ]::text[])
  $$,
  array[13::bigint],
  'tenant-reference triggers protect the complete legacy property graph'
);

select results_eq(
  $$
    select count(*)::bigint
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname like 'property private managers %'
      and 'authenticated' = any(roles)
  $$,
  array[0::bigint],
  'private property media is reachable only through the authorized BFF'
);

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  email_change,
  email_change_token_new,
  recovery_token
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
    ('a2000000-0000-4000-8000-000000000001'::uuid, 'property-none-a@example.test'),
    ('a2000000-0000-4000-8000-000000000002'::uuid, 'property-view-a@example.test'),
    ('a2000000-0000-4000-8000-000000000003'::uuid, 'property-manage-a@example.test'),
    ('a2000000-0000-4000-8000-000000000004'::uuid, 'property-leader-a@example.test'),
    ('a2000000-0000-4000-8000-000000000005'::uuid, 'property-broker-a@example.test'),
    ('a2000000-0000-4000-8000-000000000006'::uuid, 'property-manage-b@example.test')
) as fixture(id, email);

insert into public.organizations (id, name, slug, is_active)
values
  ('a1000000-0000-4000-8000-000000000001', 'Property Security Org A', 'property-security-org-a', true),
  ('a1000000-0000-4000-8000-000000000002', 'Property Security Org B', 'property-security-org-b', true);

insert into public.users (id, organization_id, name, email, role, is_active)
values
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'No Permission A', 'property-none-a@example.test', 'user', true),
  ('a2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'Viewer A', 'property-view-a@example.test', 'user', true),
  ('a2000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'Manager A', 'property-manage-a@example.test', 'user', true),
  ('a2000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'Leader A', 'property-leader-a@example.test', 'user', true),
  ('a2000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000001', 'Broker A', 'property-broker-a@example.test', 'user', true),
  ('a2000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000002', 'Manager B', 'property-manage-b@example.test', 'user', true)
on conflict (id) do update
set organization_id = excluded.organization_id,
    name = excluded.name,
    email = excluded.email,
    role = excluded.role,
    is_active = excluded.is_active;

insert into public.organization_members (organization_id, user_id, role, is_active)
select
  fixture.organization_id,
  fixture.user_id,
  'user',
  true
from (
  values
    ('a1000000-0000-4000-8000-000000000001'::uuid, 'a2000000-0000-4000-8000-000000000001'::uuid),
    ('a1000000-0000-4000-8000-000000000001'::uuid, 'a2000000-0000-4000-8000-000000000002'::uuid),
    ('a1000000-0000-4000-8000-000000000001'::uuid, 'a2000000-0000-4000-8000-000000000003'::uuid),
    ('a1000000-0000-4000-8000-000000000001'::uuid, 'a2000000-0000-4000-8000-000000000004'::uuid),
    ('a1000000-0000-4000-8000-000000000001'::uuid, 'a2000000-0000-4000-8000-000000000005'::uuid),
    ('a1000000-0000-4000-8000-000000000002'::uuid, 'a2000000-0000-4000-8000-000000000006'::uuid)
) as fixture(organization_id, user_id)
on conflict (user_id, organization_id) do update
set role = excluded.role,
    is_active = excluded.is_active;

insert into public.organization_roles (id, organization_id, name, is_active)
values
  ('a3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'Property Viewer A', true),
  ('a3000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'Property Manager A', true),
  ('a3000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000002', 'Property Manager B', true);

insert into public.organization_role_permissions (
  id,
  organization_role_id,
  permission_key,
  organization_id,
  role_id,
  permission_id
)
select
  fixture.id,
  fixture.role_id,
  fixture.permission_key,
  fixture.organization_id,
  fixture.role_id,
  permission.id
from (
  values
    ('a4000000-0000-4000-8000-000000000001'::uuid, 'a1000000-0000-4000-8000-000000000001'::uuid, 'a3000000-0000-4000-8000-000000000001'::uuid, 'property_view'::text),
    ('a4000000-0000-4000-8000-000000000002'::uuid, 'a1000000-0000-4000-8000-000000000001'::uuid, 'a3000000-0000-4000-8000-000000000002'::uuid, 'property_manage'::text),
    ('a4000000-0000-4000-8000-000000000003'::uuid, 'a1000000-0000-4000-8000-000000000002'::uuid, 'a3000000-0000-4000-8000-000000000003'::uuid, 'property_manage'::text)
) as fixture(id, organization_id, role_id, permission_key)
join public.available_permissions as permission
  on permission.key = fixture.permission_key;

insert into public.user_organization_roles (
  id,
  user_id,
  organization_role_id,
  organization_id,
  role_id,
  is_active
)
values
  ('a5000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', true),
  ('a5000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000004', 'a3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', true),
  ('a5000000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000003', 'a3000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000002', true),
  ('a5000000-0000-4000-8000-000000000004', 'a2000000-0000-4000-8000-000000000006', 'a3000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-000000000003', true);

insert into public.teams (id, organization_id, name, is_active)
values ('a6000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'Property Team A', true);

insert into public.team_members (id, team_id, user_id, is_leader, organization_id, is_active)
values
  ('a6100000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000004', true, 'a1000000-0000-4000-8000-000000000001', true),
  ('a6100000-0000-4000-8000-000000000002', 'a6000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000005', false, 'a1000000-0000-4000-8000-000000000001', true);

insert into public.property_cities (id, organization_id, name, uf)
values
  ('a7000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'Cidade A', 'SP'),
  ('a7000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002', 'Cidade B', 'RJ');

insert into public.property_neighborhoods (id, organization_id, city_id, name)
values
  ('a7100000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000001', 'Bairro A'),
  ('a7100000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000002', 'Bairro B');

insert into public.property_condominiums (id, organization_id, city_id, neighborhood_id, name)
values
  ('a7200000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000001', 'a7100000-0000-4000-8000-000000000001', 'Condominio A'),
  ('a7200000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000002', 'a7100000-0000-4000-8000-000000000002', 'Condominio B');

insert into public.property_types (id, organization_id, name)
values
  ('a7300000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'Apartamento A'),
  ('a7300000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002', 'Apartamento B');

insert into public.property_owners (id, organization_id, name, email, created_by)
values
  ('a8000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'Owner Viewer A', 'owner-viewer-a@example.test', 'a2000000-0000-4000-8000-000000000002'),
  ('a8000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'Owner Broker A', 'owner-broker-a@example.test', 'a2000000-0000-4000-8000-000000000005'),
  ('a8000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'Owner Manager A', 'owner-manager-a@example.test', 'a2000000-0000-4000-8000-000000000003'),
  ('a8000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000002', 'Owner Manager B', 'owner-manager-b@example.test', 'a2000000-0000-4000-8000-000000000006');

insert into public.properties (
  id,
  organization_id,
  code,
  title,
  owner_id,
  city_id,
  neighborhood_id,
  condominium_id,
  property_type_id,
  created_by,
  responsible_user_id
)
values
  ('a9000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'SEC-A-1', 'Property Viewer A', 'a8000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000001', 'a7100000-0000-4000-8000-000000000001', 'a7200000-0000-4000-8000-000000000001', 'a7300000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000002'),
  ('a9000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'SEC-A-2', 'Property Broker A', 'a8000000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000001', 'a7100000-0000-4000-8000-000000000001', 'a7200000-0000-4000-8000-000000000001', 'a7300000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000005', 'a2000000-0000-4000-8000-000000000005'),
  ('a9000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'SEC-A-3', 'Property Manager A', 'a8000000-0000-4000-8000-000000000003', 'a7000000-0000-4000-8000-000000000001', 'a7100000-0000-4000-8000-000000000001', 'a7200000-0000-4000-8000-000000000001', 'a7300000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000003'),
  ('a9000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000002', 'SEC-B-1', 'Property Manager B', 'a8000000-0000-4000-8000-000000000004', 'a7000000-0000-4000-8000-000000000002', 'a7100000-0000-4000-8000-000000000002', 'a7200000-0000-4000-8000-000000000002', 'a7300000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000006', 'a2000000-0000-4000-8000-000000000006');

insert into public.property_ownerships (
  organization_id,
  property_id,
  owner_id,
  ownership_percentage,
  valid_from
)
values (
  'a1000000-0000-4000-8000-000000000001',
  'a9000000-0000-4000-8000-000000000001',
  'a8000000-0000-4000-8000-000000000003',
  40,
  current_date
);

insert into storage.objects (bucket_id, name, owner)
values
  ('property-private', 'orgs/a1000000-0000-4000-8000-000000000001/properties/a9000000-0000-4000-8000-000000000001/document.pdf', 'a2000000-0000-4000-8000-000000000003'),
  ('property-private', 'orgs/a1000000-0000-4000-8000-000000000002/properties/a9000000-0000-4000-8000-000000000004/document.pdf', 'a2000000-0000-4000-8000-000000000006');

-- The production grants intentionally keep PII behind the backend. Granting
-- privileges inside this rolled-back test proves RLS remains safe if a future
-- migration accidentally exposes the tables again.
grant select, insert, update, delete
  on public.properties, public.property_owners
  to authenticated;
grant insert, update, delete
  on public.property_cities, public.property_neighborhoods, public.property_condominiums, public.property_types
  to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'a2000000-0000-4000-8000-000000000001', true);

select results_eq(
  $$select count(*)::bigint from public.property_cities$$,
  array[0::bigint],
  'member without property permission cannot read location catalogs'
);

select results_eq(
  $$select count(*)::bigint from public.properties$$,
  array[0::bigint],
  'member without property permission sees no properties even if table SELECT is restored'
);

select throws_ok(
  $$insert into public.properties (organization_id, code, title) values ('a1000000-0000-4000-8000-000000000001', 'SEC-DENY-NONE', 'Denied')$$,
  '42501',
  null,
  'member without property_manage cannot create a property'
);

select results_eq(
  $$select count(*)::bigint from public.property_owners$$,
  array[0::bigint],
  'member without property permission sees no owners'
);

select set_config('request.jwt.claim.sub', 'a2000000-0000-4000-8000-000000000002', true);

select results_eq(
  $$select count(*)::bigint from public.properties$$,
  array[1::bigint],
  'property_view sees only properties created by or assigned to the viewer'
);

select results_eq(
  $$select count(*)::bigint from public.property_owners$$,
  array[2::bigint],
  'property_view sees legacy and normalized owners linked to visible properties'
);

select results_eq(
  $$
    select count(*)::bigint
    from (
      select id from public.property_cities
      union all
      select id from public.property_neighborhoods
      union all
      select id from public.property_condominiums
      union all
      select id from public.property_types
    ) as locations
  $$,
  array[4::bigint],
  'property_view reads only its organization location catalogs'
);

select throws_ok(
  $$insert into public.properties (organization_id, code, title) values ('a1000000-0000-4000-8000-000000000001', 'SEC-DENY-VIEW', 'Denied')$$,
  '42501',
  null,
  'property_view cannot mutate properties'
);

select results_eq(
  $$select count(*)::bigint from storage.objects where bucket_id = 'property-private'$$,
  array[0::bigint],
  'property_view cannot enumerate confidential property media'
);

select set_config('request.jwt.claim.sub', 'a2000000-0000-4000-8000-000000000004', true);

select is(
  (select array_agg(id order by id) from public.properties),
  array['a9000000-0000-4000-8000-000000000002'::uuid],
  'team leader with property_view sees the active team member property only'
);

select is(
  (select array_agg(id order by id) from public.property_owners),
  array['a8000000-0000-4000-8000-000000000002'::uuid],
  'team leader sees only the owner linked to the visible team property'
);

select set_config('request.jwt.claim.sub', 'a2000000-0000-4000-8000-000000000003', true);

select results_eq(
  $$select count(*)::bigint from public.properties$$,
  array[3::bigint],
  'property_manage sees every property in its organization and none from another tenant'
);

select results_eq(
  $$select count(*)::bigint from public.property_owners$$,
  array[3::bigint],
  'property_manage sees every owner in its organization and none from another tenant'
);

select results_eq(
  $$
    insert into public.properties (
      organization_id,
      code,
      title,
      created_by,
      responsible_user_id
    )
    values (
      'a1000000-0000-4000-8000-000000000001',
      'SEC-A-NEW',
      'Manager-created property',
      'a2000000-0000-4000-8000-000000000003',
      'a2000000-0000-4000-8000-000000000003'
    )
    returning published_on_site
  $$,
  array[false],
  'property_manage can create a same-tenant draft through RLS'
);

select throws_ok(
  $$insert into public.properties (organization_id, code, title) values ('a1000000-0000-4000-8000-000000000002', 'SEC-DENY-ORG-B', 'Denied cross tenant')$$,
  '42501',
  null,
  'property_manage from Org A cannot create a property in Org B'
);

select throws_ok(
  $$
    insert into public.properties (organization_id, code, title, owner_id)
    values (
      'a1000000-0000-4000-8000-000000000001',
      'SEC-CROSS-OWNER',
      'Cross owner',
      'a8000000-0000-4000-8000-000000000004'
    )
  $$,
  '23514',
  null,
  'tenant trigger rejects an owner from another organization'
);

select throws_ok(
  $$
    insert into public.properties (organization_id, code, title, responsible_user_id)
    values (
      'a1000000-0000-4000-8000-000000000001',
      'SEC-CROSS-USER',
      'Cross responsible user',
      'a2000000-0000-4000-8000-000000000006'
    )
  $$,
  '23514',
  null,
  'tenant trigger rejects a responsible user from another organization'
);

select throws_ok(
  $$
    insert into public.properties (organization_id, code, title, property_type_id)
    values (
      'a1000000-0000-4000-8000-000000000001',
      'SEC-CROSS-TYPE',
      'Cross property type',
      'a7300000-0000-4000-8000-000000000002'
    )
  $$,
  '23514',
  null,
  'tenant trigger rejects a property type from another organization'
);

select throws_ok(
  $$
    insert into public.properties (organization_id, code, title, property_type_id)
    values (
      'a1000000-0000-4000-8000-000000000001',
      'SEC-MISSING-TYPE',
      'Missing property type',
      'afffffff-ffff-4fff-8fff-ffffffffffff'
    )
  $$,
  '23503',
  null,
  'NOT VALID foreign key still rejects a missing property type on new writes'
);

select results_eq(
  $$select count(*)::bigint from storage.objects where bucket_id = 'property-private'$$,
  array[0::bigint],
  'property_manage cannot read private objects without the BFF'
);

select throws_ok(
  $$
    insert into storage.objects (bucket_id, name, owner)
    values (
      'property-private',
      'orgs/a1000000-0000-4000-8000-000000000001/properties/a9000000-0000-4000-8000-000000000001/new.pdf',
      auth.uid()
    )
    returning name
  $$,
  '42501',
  null,
  'property_manage cannot write private media without a BFF signed upload'
);

select throws_ok(
  $$
    insert into storage.objects (bucket_id, name, owner)
    values (
      'property-private',
      'orgs/a1000000-0000-4000-8000-000000000002/properties/a9000000-0000-4000-8000-000000000004/forged.pdf',
      auth.uid()
    )
  $$,
  '42501',
  null,
  'property_manage cannot write private media into another organization prefix'
);

reset role;

select throws_ok(
  $$
    insert into public.property_neighborhoods (organization_id, city_id, name)
    values (
      'a1000000-0000-4000-8000-000000000001',
      'a7000000-0000-4000-8000-000000000002',
      'Cross-tenant neighborhood'
    )
  $$,
  '23514',
  null,
  'tenant trigger also protects service-level location writes'
);

set local role service_role;

select results_eq(
  $$select count(*)::bigint from public.properties where id::text like 'a9000000-%' or code = 'SEC-A-NEW'$$,
  array[5::bigint],
  'service role still reads all backend property rows across tenants'
);

select results_eq(
  $$select count(*)::bigint from storage.objects where bucket_id = 'property-private'$$,
  array[2::bigint],
  'service role still reads private media across tenants'
);

reset role;

select * from finish();
rollback;
