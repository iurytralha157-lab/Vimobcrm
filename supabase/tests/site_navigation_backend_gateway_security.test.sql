begin;

create extension if not exists pgtap with schema extensions;
select plan(24);

select ok(
  (select bool_and(not has_table_privilege(role_name, relation_name, privilege_name))
   from (values ('anon'), ('authenticated')) as role_names(role_name)
   cross join (values
     ('public.site_menu_items'),
     ('public.site_search_filters')
   ) as relations(relation_name)
   cross join (values
     ('insert'), ('update'), ('delete'), ('truncate'), ('references'), ('trigger')
   ) as privileges(privilege_name)),
  'Data API roles cannot mutate site navigation tables'
);

select ok(
  (select bool_and(has_table_privilege(role_name, relation_name, 'select'))
   from (values ('anon'), ('authenticated')) as role_names(role_name)
   cross join (values
     ('public.site_menu_items'),
     ('public.site_search_filters')
   ) as relations(relation_name)),
  'existing anonymous and member reads remain available'
);

select ok(
  (select bool_and(has_table_privilege(role_name, relation_name, privilege_name))
   from (values ('service_role'), ('postgres')) as role_names(role_name)
   cross join (values
     ('public.site_menu_items'),
     ('public.site_search_filters')
   ) as relations(relation_name)
   cross join (values
     ('select'), ('insert'), ('update'), ('delete')
   ) as privileges(privilege_name)),
  'server roles retain site navigation writes'
);

select ok(
  (select bool_and(relrowsecurity)
   from pg_catalog.pg_class
   where oid in (
     'public.site_menu_items'::regclass,
     'public.site_search_filters'::regclass
   )),
  'RLS remains enabled on both site navigation tables'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token
)
select
  '00000000-0000-0000-0000-000000000000'::uuid,
  fixture.id, 'authenticated', 'authenticated', fixture.email,
  crypt('test-password', gen_salt('bf', 4)), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now(), '', '', '', ''
from (values
  ('e8200000-0000-4000-8000-000000000001'::uuid, 'site-gateway-a@example.test'),
  ('e8200000-0000-4000-8000-000000000002'::uuid, 'site-gateway-b@example.test')
) as fixture(id, email);

insert into public.organizations (id, name, slug, is_active)
values
  ('e8100000-0000-4000-8000-000000000001', 'Site Gateway Org A', 'site-gateway-org-a', true),
  ('e8100000-0000-4000-8000-000000000002', 'Site Gateway Org B', 'site-gateway-org-b', true);

insert into public.users (id, organization_id, name, email, role, is_active)
values
  ('e8200000-0000-4000-8000-000000000001', 'e8100000-0000-4000-8000-000000000001', 'Admin A', 'site-gateway-a@example.test', 'admin', true),
  ('e8200000-0000-4000-8000-000000000002', 'e8100000-0000-4000-8000-000000000002', 'Admin B', 'site-gateway-b@example.test', 'admin', true);

insert into public.organization_members (organization_id, user_id, role, is_active)
values
  ('e8100000-0000-4000-8000-000000000001', 'e8200000-0000-4000-8000-000000000001', 'admin', true),
  ('e8100000-0000-4000-8000-000000000002', 'e8200000-0000-4000-8000-000000000002', 'admin', true);

insert into public.site_menu_items (
  id, organization_id, label, link_type, href, position, is_active
)
values
  ('e8300000-0000-4000-8000-000000000001', 'e8100000-0000-4000-8000-000000000001', 'Active A', 'page', '/a', 1, true),
  ('e8300000-0000-4000-8000-000000000002', 'e8100000-0000-4000-8000-000000000002', 'Active B', 'page', '/b', 1, true),
  ('e8300000-0000-4000-8000-000000000003', 'e8100000-0000-4000-8000-000000000001', 'Draft A', 'page', '/a-draft', 2, false),
  ('e8300000-0000-4000-8000-000000000004', 'e8100000-0000-4000-8000-000000000002', 'Draft B', 'page', '/b-draft', 2, false);

insert into public.site_search_filters (
  id, organization_id, filter_key, label, position, is_active
)
values
  ('e8400000-0000-4000-8000-000000000001', 'e8100000-0000-4000-8000-000000000001', 'city', 'Active A', 1, true),
  ('e8400000-0000-4000-8000-000000000002', 'e8100000-0000-4000-8000-000000000002', 'city', 'Active B', 1, true),
  ('e8400000-0000-4000-8000-000000000003', 'e8100000-0000-4000-8000-000000000001', 'type', 'Draft A', 2, false),
  ('e8400000-0000-4000-8000-000000000004', 'e8100000-0000-4000-8000-000000000002', 'type', 'Draft B', 2, false);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'e8200000-0000-4000-8000-000000000001', true);

select results_eq(
  $$select count(*)::bigint from public.site_menu_items where id in (
    'e8300000-0000-4000-8000-000000000001',
    'e8300000-0000-4000-8000-000000000002',
    'e8300000-0000-4000-8000-000000000003',
    'e8300000-0000-4000-8000-000000000004'
  )$$,
  array[2::bigint],
  'Org A can read its active and draft menu entries'
);
select results_eq(
  $$select count(*)::bigint from public.site_search_filters where id in (
    'e8400000-0000-4000-8000-000000000001',
    'e8400000-0000-4000-8000-000000000002',
    'e8400000-0000-4000-8000-000000000003',
    'e8400000-0000-4000-8000-000000000004'
  )$$,
  array[2::bigint],
  'Org A can read its active and draft search filters'
);

select throws_ok(
  $$insert into public.site_menu_items (organization_id, label, link_type, href)
    values ('e8100000-0000-4000-8000-000000000001', 'Blocked', 'page', '/blocked')$$,
  '42501', null, 'Org A cannot insert its own menu entry directly'
);
select throws_ok(
  $$update public.site_menu_items set label = 'Blocked'
    where id = 'e8300000-0000-4000-8000-000000000001'$$,
  '42501', null, 'Org A cannot update its own menu entry directly'
);
select throws_ok(
  $$delete from public.site_menu_items
    where id = 'e8300000-0000-4000-8000-000000000001'$$,
  '42501', null, 'Org A cannot delete its own menu entry directly'
);
select throws_ok(
  $$insert into public.site_search_filters (organization_id, filter_key, label)
    values ('e8100000-0000-4000-8000-000000000001', 'area', 'Blocked')$$,
  '42501', null, 'Org A cannot insert its own search filter directly'
);
select throws_ok(
  $$update public.site_search_filters set label = 'Blocked'
    where id = 'e8400000-0000-4000-8000-000000000001'$$,
  '42501', null, 'Org A cannot update its own search filter directly'
);
select throws_ok(
  $$delete from public.site_search_filters
    where id = 'e8400000-0000-4000-8000-000000000001'$$,
  '42501', null, 'Org A cannot delete its own search filter directly'
);
select throws_ok(
  $$insert into public.site_menu_items (organization_id, label, link_type, href)
    values ('e8100000-0000-4000-8000-000000000002', 'Blocked', 'page', '/blocked')$$,
  '42501', null, 'Org A cannot insert into Org B directly'
);
select throws_ok(
  $$update public.site_search_filters set label = 'Blocked'
    where id = 'e8400000-0000-4000-8000-000000000002'$$,
  '42501', null, 'Org A cannot update Org B directly'
);

select set_config('request.jwt.claim.sub', 'e8200000-0000-4000-8000-000000000002', true);
select results_eq(
  $$select count(*)::bigint from public.site_menu_items where id in (
    'e8300000-0000-4000-8000-000000000001',
    'e8300000-0000-4000-8000-000000000002',
    'e8300000-0000-4000-8000-000000000003',
    'e8300000-0000-4000-8000-000000000004'
  )$$,
  array[2::bigint],
  'Org B can read its active and draft menu entries'
);
select results_eq(
  $$select count(*)::bigint from public.site_search_filters where id in (
    'e8400000-0000-4000-8000-000000000001',
    'e8400000-0000-4000-8000-000000000002',
    'e8400000-0000-4000-8000-000000000003',
    'e8400000-0000-4000-8000-000000000004'
  )$$,
  array[2::bigint],
  'Org B can read its active and draft search filters'
);
select throws_ok(
  $$insert into public.site_menu_items (organization_id, label, link_type, href)
    values ('e8100000-0000-4000-8000-000000000002', 'Blocked', 'page', '/blocked')$$,
  '42501', null, 'Org B cannot insert its own menu entry directly'
);
select throws_ok(
  $$insert into public.site_search_filters (organization_id, filter_key, label)
    values ('e8100000-0000-4000-8000-000000000001', 'area', 'Blocked')$$,
  '42501', null, 'Org B cannot insert into Org A directly'
);

reset role;
set local role anon;
select results_eq(
  $$select count(*)::bigint from public.site_menu_items where id in (
    'e8300000-0000-4000-8000-000000000001',
    'e8300000-0000-4000-8000-000000000002',
    'e8300000-0000-4000-8000-000000000003',
    'e8300000-0000-4000-8000-000000000004'
  )$$,
  array[2::bigint],
  'anonymous site readers see active menu entries from both organizations'
);
select results_eq(
  $$select count(*)::bigint from public.site_search_filters where id in (
    'e8400000-0000-4000-8000-000000000001',
    'e8400000-0000-4000-8000-000000000002',
    'e8400000-0000-4000-8000-000000000003',
    'e8400000-0000-4000-8000-000000000004'
  )$$,
  array[2::bigint],
  'anonymous site readers see active filters from both organizations'
);
select throws_ok(
  $$insert into public.site_menu_items (organization_id, label, link_type, href)
    values ('e8100000-0000-4000-8000-000000000001', 'Blocked', 'page', '/blocked')$$,
  '42501', null, 'anonymous clients cannot insert menu entries'
);
select throws_ok(
  $$insert into public.site_search_filters (organization_id, filter_key, label)
    values ('e8100000-0000-4000-8000-000000000001', 'area', 'Blocked')$$,
  '42501', null, 'anonymous clients cannot insert search filters'
);

reset role;
set local role service_role;
select results_eq(
  $$update public.site_menu_items set label = 'Server A'
    where id = 'e8300000-0000-4000-8000-000000000001' returning id$$,
  $$values ('e8300000-0000-4000-8000-000000000001'::uuid)$$,
  'server role can still update menu entries'
);
select results_eq(
  $$update public.site_search_filters set label = 'Server B'
    where id = 'e8400000-0000-4000-8000-000000000002' returning id$$,
  $$values ('e8400000-0000-4000-8000-000000000002'::uuid)$$,
  'server role can still update search filters'
);

reset role;
select * from finish();
rollback;
