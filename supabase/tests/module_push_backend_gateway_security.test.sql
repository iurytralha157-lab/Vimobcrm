begin;

create extension if not exists pgtap with schema extensions;
select plan(17);

select ok(
  (select bool_and(
    not has_table_privilege(role_name, relation_name,
      'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    and not has_any_column_privilege(role_name, relation_name,
      'INSERT,UPDATE,REFERENCES')
  )
  from (values ('anon'), ('authenticated')) as role_names(role_name)
  cross join (values
    ('public.organization_modules'),
    ('public.push_tokens')
  ) as relations(relation_name)),
  'Data API roles have no table or column write privileges'
);

select ok(
  (select bool_and(has_table_privilege(role_name, relation_name, 'SELECT'))
   from (values ('anon'), ('authenticated')) as role_names(role_name)
   cross join (values
     ('public.organization_modules'),
     ('public.push_tokens')
   ) as relations(relation_name)),
  'legacy Data API select grants remain available under RLS'
);

select ok(
  (select bool_and(
    has_table_privilege(role_name, relation_name, 'SELECT')
    and has_table_privilege(role_name, relation_name, 'INSERT')
    and has_table_privilege(role_name, relation_name, 'UPDATE')
    and has_table_privilege(role_name, relation_name, 'DELETE')
  )
   from (values ('service_role'), ('postgres')) as role_names(role_name)
   cross join (values
     ('public.organization_modules'),
     ('public.push_tokens')
   ) as relations(relation_name)),
  'server database roles retain read and write privileges'
);

select ok(
  (select bool_and(relrowsecurity)
   from pg_catalog.pg_class
   where oid in (
     'public.organization_modules'::regclass,
     'public.push_tokens'::regclass
   )),
  'RLS remains enabled for both tables'
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
  ('e9200000-0000-4000-8000-000000000001'::uuid, 'gateway-a@example.test'),
  ('e9200000-0000-4000-8000-000000000002'::uuid, 'gateway-b@example.test')
) as fixture(id, email);

insert into public.organizations (id, name, slug, is_active)
values
  ('e9100000-0000-4000-8000-000000000001', 'Gateway Org A', 'module-push-gateway-a', true),
  ('e9100000-0000-4000-8000-000000000002', 'Gateway Org B', 'module-push-gateway-b', true);

insert into public.users (id, organization_id, name, email, role, is_active)
values
  ('e9200000-0000-4000-8000-000000000001', 'e9100000-0000-4000-8000-000000000001', 'Gateway A', 'gateway-a@example.test', 'admin', true),
  ('e9200000-0000-4000-8000-000000000002', 'e9100000-0000-4000-8000-000000000002', 'Gateway B', 'gateway-b@example.test', 'admin', true)
on conflict (id) do update set
  organization_id = excluded.organization_id,
  name = excluded.name,
  email = excluded.email,
  role = excluded.role,
  is_active = excluded.is_active;

insert into public.organization_members (organization_id, user_id, role, is_active)
values
  ('e9100000-0000-4000-8000-000000000001', 'e9200000-0000-4000-8000-000000000001', 'admin', true),
  ('e9100000-0000-4000-8000-000000000002', 'e9200000-0000-4000-8000-000000000002', 'admin', true)
on conflict (user_id, organization_id) do update set
  role = excluded.role,
  is_active = excluded.is_active;

insert into public.organization_modules (id, organization_id, module_name, is_enabled)
values
  ('e9300000-0000-4000-8000-000000000001', 'e9100000-0000-4000-8000-000000000001', 'api', true),
  ('e9300000-0000-4000-8000-000000000002', 'e9100000-0000-4000-8000-000000000002', 'api', true);

insert into public.push_tokens (id, organization_id, user_id, token, platform, endpoint)
values
  ('e9400000-0000-4000-8000-000000000001', 'e9100000-0000-4000-8000-000000000001', 'e9200000-0000-4000-8000-000000000001', 'synthetic-a', 'web', 'https://push.example.test/a'),
  ('e9400000-0000-4000-8000-000000000002', 'e9100000-0000-4000-8000-000000000002', 'e9200000-0000-4000-8000-000000000002', 'synthetic-b', 'web', 'https://push.example.test/b');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'e9200000-0000-4000-8000-000000000001', true);

select results_eq(
  $$select count(*)::bigint from public.organization_modules
    where id in ('e9300000-0000-4000-8000-000000000001',
                 'e9300000-0000-4000-8000-000000000002')$$,
  array[1::bigint],
  'Org A still reads its own module, not Org B module'
);
select results_eq(
  $$select count(*)::bigint from public.push_tokens
    where id in ('e9400000-0000-4000-8000-000000000001',
                 'e9400000-0000-4000-8000-000000000002')$$,
  array[1::bigint],
  'Org A still reads its own push token, not Org B token'
);
select throws_ok(
  $$insert into public.organization_modules (organization_id, module_name, is_enabled)
    values ('e9100000-0000-4000-8000-000000000001', 'campaigns', true)$$,
  '42501', null, 'client cannot insert a module directly'
);
select throws_ok(
  $$update public.organization_modules set is_enabled = false
    where id = 'e9300000-0000-4000-8000-000000000001'$$,
  '42501', null, 'client cannot update a module directly'
);
select throws_ok(
  $$delete from public.organization_modules
    where id = 'e9300000-0000-4000-8000-000000000001'$$,
  '42501', null, 'client cannot delete a module directly'
);
select throws_ok(
  $$insert into public.push_tokens (organization_id, user_id, token, platform)
    values ('e9100000-0000-4000-8000-000000000001',
            'e9200000-0000-4000-8000-000000000001', 'synthetic', 'web')$$,
  '42501', null, 'client cannot register a push token directly'
);
select throws_ok(
  $$update public.push_tokens set is_active = false
    where id = 'e9400000-0000-4000-8000-000000000001'$$,
  '42501', null, 'client cannot update its push token directly'
);
select throws_ok(
  $$delete from public.push_tokens
    where id = 'e9400000-0000-4000-8000-000000000001'$$,
  '42501', null, 'client cannot delete its push token directly'
);

select set_config('request.jwt.claim.sub', 'e9200000-0000-4000-8000-000000000002', true);
select results_eq(
  $$select count(*)::bigint from public.organization_modules
    where id in ('e9300000-0000-4000-8000-000000000001',
                 'e9300000-0000-4000-8000-000000000002')$$,
  array[1::bigint],
  'Org B still reads its own module, not Org A module'
);
select results_eq(
  $$select count(*)::bigint from public.push_tokens
    where id in ('e9400000-0000-4000-8000-000000000001',
                 'e9400000-0000-4000-8000-000000000002')$$,
  array[1::bigint],
  'Org B still reads its own push token, not Org A token'
);
select throws_ok(
  $$update public.push_tokens set is_active = false
    where id = 'e9400000-0000-4000-8000-000000000001'$$,
  '42501', null, 'Org B cannot update an Org A push token directly'
);

reset role;
set local role service_role;
select results_eq(
  $$update public.organization_modules set is_enabled = false
    where id = 'e9300000-0000-4000-8000-000000000001' returning id$$,
  $$values ('e9300000-0000-4000-8000-000000000001'::uuid)$$,
  'service role can still update modules'
);
select results_eq(
  $$update public.push_tokens set is_active = false
    where id = 'e9400000-0000-4000-8000-000000000002' returning id$$,
  $$values ('e9400000-0000-4000-8000-000000000002'::uuid)$$,
  'service role can still update push tokens'
);

reset role;
select * from finish();
rollback;
