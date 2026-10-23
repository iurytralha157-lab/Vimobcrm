begin;

create extension if not exists pgtap with schema extensions;
select plan(27);

-- A missing table privilege denies the Data API request before any permissive
-- legacy write policy can run. Keep the intended read grants separately.
select ok(
  (select bool_and(not has_table_privilege('anon', relation_name, privilege_name))
   from (values
     ('public.organization_roles'),
     ('public.organization_role_permissions'),
     ('public.user_organization_roles'),
     ('public.user_permissions'),
     ('public.permissions')
   ) as relation(relation_name)
   cross join (values
     ('insert'), ('update'), ('delete'), ('truncate'), ('references'), ('trigger')
   ) as privilege(privilege_name)),
  'anon cannot mutate role or permission tables'
);

select ok(
  (select bool_and(not has_table_privilege('authenticated', relation_name, privilege_name))
   from (values
     ('public.organization_roles'),
     ('public.organization_role_permissions'),
     ('public.user_organization_roles'),
     ('public.user_permissions'),
     ('public.permissions')
   ) as relation(relation_name)
   cross join (values
     ('insert'), ('update'), ('delete'), ('truncate'), ('references'), ('trigger')
   ) as privilege(privilege_name)),
  'authenticated users cannot bypass the API with direct RBAC writes'
);

select ok(
  (select bool_and(has_table_privilege('anon', relation_name, 'select'))
   from (values
     ('public.organization_roles'),
     ('public.organization_role_permissions'),
     ('public.user_organization_roles'),
     ('public.permissions')
   ) as relation(relation_name)),
  'legacy anonymous reads retain their grants and RLS'
);

select ok(
  (select bool_and(has_table_privilege('authenticated', relation_name, 'select'))
   from (values
     ('public.organization_roles'),
     ('public.organization_role_permissions'),
     ('public.user_organization_roles'),
     ('public.user_permissions'),
     ('public.permissions')
   ) as relation(relation_name)),
  'authenticated reads retain their grants and RLS'
);

select ok(
  not has_table_privilege('anon', 'public.user_permissions', 'select'),
  'anonymous clients still cannot read per-user permissions'
);

select ok(
  (select bool_and(has_table_privilege('service_role', relation_name, privilege_name))
   from (values
     ('public.organization_roles'),
     ('public.organization_role_permissions'),
     ('public.user_organization_roles'),
     ('public.user_permissions'),
     ('public.permissions')
   ) as relation(relation_name)
   cross join (values ('select'), ('insert'), ('update'), ('delete'))
     as privilege(privilege_name)),
  'service_role retains read and write privileges for server consumers'
);

select ok(
  (select bool_and(has_table_privilege('postgres', relation_name, privilege_name))
   from (values
     ('public.organization_roles'),
     ('public.organization_role_permissions'),
     ('public.user_organization_roles'),
     ('public.user_permissions'),
     ('public.permissions')
   ) as relation(relation_name)
   cross join (values ('select'), ('insert'), ('update'), ('delete'))
     as privilege(privilege_name)),
  'the Go database owner retains read and write privileges'
);

select ok(
  (select bool_and(relrowsecurity)
   from pg_class
   where oid in (
     'public.organization_roles'::regclass,
     'public.organization_role_permissions'::regclass,
     'public.user_organization_roles'::regclass,
     'public.user_permissions'::regclass,
     'public.permissions'::regclass
   )),
  'RLS remains enabled on every directly readable RBAC table'
);

select ok(
  not has_table_privilege('authenticated', 'public.user_roles', 'insert,update,delete'),
  'the earlier backend-only user_roles boundary remains intact'
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
  ('e7200000-0000-4000-8000-000000000001'::uuid, 'rbac-gateway-a@example.test'),
  ('e7200000-0000-4000-8000-000000000002'::uuid, 'rbac-gateway-b@example.test')
) as fixture(id, email);

insert into public.organizations (id, name, slug, is_active)
values
  ('e7100000-0000-4000-8000-000000000001', 'RBAC Gateway Org A', 'rbac-gateway-org-a', true),
  ('e7100000-0000-4000-8000-000000000002', 'RBAC Gateway Org B', 'rbac-gateway-org-b', true);

insert into public.users (id, organization_id, name, email, role, is_active)
values
  ('e7200000-0000-4000-8000-000000000001', 'e7100000-0000-4000-8000-000000000001', 'Admin A', 'rbac-gateway-a@example.test', 'admin', true),
  ('e7200000-0000-4000-8000-000000000002', 'e7100000-0000-4000-8000-000000000002', 'Admin B', 'rbac-gateway-b@example.test', 'admin', true)
on conflict (id) do update
set organization_id = excluded.organization_id,
    name = excluded.name, email = excluded.email,
    role = excluded.role, is_active = excluded.is_active;

insert into public.organization_members (organization_id, user_id, role, is_active)
values
  ('e7100000-0000-4000-8000-000000000001', 'e7200000-0000-4000-8000-000000000001', 'admin', true),
  ('e7100000-0000-4000-8000-000000000002', 'e7200000-0000-4000-8000-000000000002', 'admin', true)
on conflict (user_id, organization_id) do update
set role = excluded.role, is_active = excluded.is_active;

insert into public.organization_roles (id, organization_id, name, is_active)
values
  ('e7300000-0000-4000-8000-000000000001', 'e7100000-0000-4000-8000-000000000001', 'RBAC test role A', true),
  ('e7300000-0000-4000-8000-000000000002', 'e7100000-0000-4000-8000-000000000002', 'RBAC test role B', true);

insert into public.organization_role_permissions (
  id, organization_role_id, permission_key, organization_id, role_id, permission_id
)
select
  fixture.id, fixture.role_id, 'users_manage', fixture.organization_id,
  fixture.role_id, permission.id
from (values
  ('e7500000-0000-4000-8000-000000000001'::uuid,
   'e7300000-0000-4000-8000-000000000001'::uuid,
   'e7100000-0000-4000-8000-000000000001'::uuid),
  ('e7500000-0000-4000-8000-000000000002'::uuid,
   'e7300000-0000-4000-8000-000000000002'::uuid,
   'e7100000-0000-4000-8000-000000000002'::uuid)
) as fixture(id, role_id, organization_id)
join public.available_permissions as permission on permission.key = 'users_manage';

insert into public.user_organization_roles (
  id, user_id, organization_role_id, organization_id, role_id, is_active
)
values
  ('e7400000-0000-4000-8000-000000000001', 'e7200000-0000-4000-8000-000000000001', 'e7300000-0000-4000-8000-000000000001', 'e7100000-0000-4000-8000-000000000001', 'e7300000-0000-4000-8000-000000000001', true),
  ('e7400000-0000-4000-8000-000000000002', 'e7200000-0000-4000-8000-000000000002', 'e7300000-0000-4000-8000-000000000002', 'e7100000-0000-4000-8000-000000000002', 'e7300000-0000-4000-8000-000000000002', true);

insert into public.permissions (id, key, description)
values ('e7600000-0000-4000-8000-000000000001', 'rbac_gateway_test', 'Rolled-back RBAC grant test');

insert into public.user_permissions (id, user_id, permission_key)
values
  ('e7700000-0000-4000-8000-000000000001', 'e7200000-0000-4000-8000-000000000001', 'rbac_gateway_test'),
  ('e7700000-0000-4000-8000-000000000002', 'e7200000-0000-4000-8000-000000000002', 'rbac_gateway_test');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'e7200000-0000-4000-8000-000000000001', true);

select results_eq($$select count(*)::bigint from public.organization_roles where id in ('e7300000-0000-4000-8000-000000000001', 'e7300000-0000-4000-8000-000000000002')$$, array[1::bigint], 'Org A reads only its role');
select results_eq($$select count(*)::bigint from public.organization_role_permissions where id in ('e7500000-0000-4000-8000-000000000001', 'e7500000-0000-4000-8000-000000000002')$$, array[1::bigint], 'Org A reads only its role grant');
select results_eq($$select count(*)::bigint from public.user_organization_roles where id in ('e7400000-0000-4000-8000-000000000001', 'e7400000-0000-4000-8000-000000000002')$$, array[1::bigint], 'Org A reads only its assignments');
select results_eq($$select count(*)::bigint from public.user_permissions where id in ('e7700000-0000-4000-8000-000000000001', 'e7700000-0000-4000-8000-000000000002')$$, array[1::bigint], 'Org A reads only its own legacy permissions');
select results_eq($$select count(*)::bigint from public.permissions where key = 'rbac_gateway_test'$$, array[1::bigint], 'permission catalog remains readable');

select throws_ok($$insert into public.organization_roles (organization_id, name) values ('e7100000-0000-4000-8000-000000000001', 'Denied role')$$, '42501', null, 'Org A admin cannot insert its own role via Data API');
select throws_ok($$update public.organization_role_permissions set permission_key = 'permissions_manage' where id = 'e7500000-0000-4000-8000-000000000002'$$, '42501', null, 'Org A admin cannot update an Org B grant');
select throws_ok($$delete from public.user_organization_roles where id = 'e7400000-0000-4000-8000-000000000001'$$, '42501', null, 'Org A admin cannot delete its own assignment directly');
select throws_ok($$insert into public.user_permissions (user_id, permission_key) values ('e7200000-0000-4000-8000-000000000001', 'rbac_gateway_test')$$, '42501', null, 'Org A admin cannot insert a legacy permission directly');
select throws_ok($$delete from public.permissions where key = 'rbac_gateway_test'$$, '42501', null, 'Org A admin cannot edit the global permission catalog');

select set_config('request.jwt.claim.sub', 'e7200000-0000-4000-8000-000000000002', true);
select results_eq($$select count(*)::bigint from public.organization_roles where id in ('e7300000-0000-4000-8000-000000000001', 'e7300000-0000-4000-8000-000000000002')$$, array[1::bigint], 'Org B reads only its role');
select results_eq($$select count(*)::bigint from public.organization_role_permissions where id in ('e7500000-0000-4000-8000-000000000001', 'e7500000-0000-4000-8000-000000000002')$$, array[1::bigint], 'Org B reads only its role grant');
select results_eq($$select count(*)::bigint from public.user_organization_roles where id in ('e7400000-0000-4000-8000-000000000001', 'e7400000-0000-4000-8000-000000000002')$$, array[1::bigint], 'Org B reads only its assignments');
select results_eq($$select count(*)::bigint from public.user_permissions where id in ('e7700000-0000-4000-8000-000000000001', 'e7700000-0000-4000-8000-000000000002')$$, array[1::bigint], 'Org B reads only its own legacy permissions');
select results_eq($$select count(*)::bigint from public.permissions where key = 'rbac_gateway_test'$$, array[1::bigint], 'Org B also reads the permission catalog');

reset role;
set local role anon;
select results_eq($$select count(*)::bigint from public.permissions where key = 'rbac_gateway_test'$$, array[1::bigint], 'anonymous permission catalog read remains available');
select throws_ok($$select count(*) from public.user_permissions$$, '42501', null, 'anonymous clients cannot read user-specific permissions');

reset role;
set local role service_role;
select results_eq(
  $$update public.organization_roles set description = 'server write' where id = 'e7300000-0000-4000-8000-000000000001' returning id$$,
  $$values ('e7300000-0000-4000-8000-000000000001'::uuid)$$,
  'service_role still updates a role through the server path'
);

reset role;
select * from finish();
rollback;
