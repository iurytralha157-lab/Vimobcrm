begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;
select plan(11);

select ok(not has_table_privilege('anon', 'public.lead_property_interests', 'select,insert,update,delete,truncate'),
  'anonymous clients have no association reads or writes');
select ok(has_table_privilege('authenticated', 'public.lead_property_interests', 'select')
  and not has_any_column_privilege('authenticated', 'public.lead_property_interests', 'insert,update')
  and not has_table_privilege('authenticated', 'public.lead_property_interests', 'delete,truncate'),
  'authenticated clients retain association reads without direct writes');
select ok(has_function_privilege('authenticated', 'private.lead_property_interest_has_same_tenant(uuid)', 'execute')
  and not has_function_privilege('anon', 'private.lead_property_interest_has_same_tenant(uuid)', 'execute')
  and not has_function_privilege('service_role', 'private.lead_property_interest_has_same_tenant(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.guard_lead_property_interest_tenant()', 'execute')
  and not has_table_privilege('authenticated', 'public.properties', 'select'),
  'the private policy predicate is restricted and property reads stay backend-only');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token)
values ('d8110000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'interest-security@example.test', '', now(), '{}', '{}',
  now(), now(), '', '', '', '');
insert into public.organizations (id, name, slug, is_active) values
  ('d8120000-0000-4000-8000-000000000001', 'Interest A', 'interest-security-a', true),
  ('d8120000-0000-4000-8000-000000000002', 'Interest B', 'interest-security-b', true);
insert into public.users (id, organization_id, name, email, role, is_active) values
  ('d8110000-0000-4000-8000-000000000001', 'd8120000-0000-4000-8000-000000000001',
    'Interest A', 'interest-security@example.test', 'user', true)
on conflict (id) do update set organization_id = excluded.organization_id, role = 'user', is_active = true;
insert into public.organization_members (organization_id, user_id, role, is_active) values
  ('d8120000-0000-4000-8000-000000000001', 'd8110000-0000-4000-8000-000000000001', 'user', true)
on conflict (user_id, organization_id) do update set role = 'user', is_active = true, deleted_at = null;
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('d8130000-0000-4000-8000-000000000001', 'd8110000-0000-4000-8000-000000000001', now(), now());
insert into public.leads (id, organization_id, assigned_user_id, name, source) values
  ('d8140000-0000-4000-8000-000000000001', 'd8120000-0000-4000-8000-000000000001',
    'd8110000-0000-4000-8000-000000000001', 'Lead A', 'manual'),
  ('d8140000-0000-4000-8000-000000000002', 'd8120000-0000-4000-8000-000000000002', null, 'Lead B', 'manual');
insert into public.properties (id, organization_id, code, tipo_de_negocio, finalidade) values
  ('d8150000-0000-4000-8000-000000000001', 'd8120000-0000-4000-8000-000000000001', 'INTEREST-A', 'venda', 'venda'),
  ('d8150000-0000-4000-8000-000000000002', 'd8120000-0000-4000-8000-000000000002', 'INTEREST-B', 'venda', 'venda');

set local role service_role;
insert into public.lead_property_interests (lead_id, property_id) values
  ('d8140000-0000-4000-8000-000000000001', 'd8150000-0000-4000-8000-000000000001'),
  ('d8140000-0000-4000-8000-000000000002', 'd8150000-0000-4000-8000-000000000002');
select lives_ok($$insert into public.lead_property_interests (lead_id, property_id, interest_level, notes)
  values ('d8140000-0000-4000-8000-000000000001', 'd8150000-0000-4000-8000-000000000001', 'high', 'Portal fixture')
  on conflict (lead_id, property_id) do update set interest_level = 'high'$$,
  'the portal upsert can update a valid same-organization association');
select throws_ok($$insert into public.lead_property_interests (lead_id, property_id)
  values ('d8140000-0000-4000-8000-000000000001', 'd8150000-0000-4000-8000-000000000002')$$,
  '23514', 'invalid lead property interest tenant', 'backend cannot insert a cross-organization association');
select throws_ok($$update public.lead_property_interests set property_id = 'd8150000-0000-4000-8000-000000000002'
  where lead_id = 'd8140000-0000-4000-8000-000000000001'$$,
  '23514', 'invalid lead property interest tenant', 'backend cannot relink an association to another organization');
reset role;

-- Seed a row that could have existed before the migration, within this rollback-only test.
alter table public.lead_property_interests disable trigger guard_lead_property_interest_tenant;
insert into public.lead_property_interests (id, lead_id, property_id) values
  ('d8160000-0000-4000-8000-000000000001', 'd8140000-0000-4000-8000-000000000001', 'd8150000-0000-4000-8000-000000000002');
alter table public.lead_property_interests enable trigger guard_lead_property_interest_tenant;
select is((select count(*)::integer from public.lead_property_interests
  where id = 'd8160000-0000-4000-8000-000000000001'), 1, 'legacy cross-organization data remains stored');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd8110000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"session_id":"d8130000-0000-4000-8000-000000000001"}', true);
select results_eq($$select property_id, interest_level from public.lead_property_interests
  where lead_id in ('d8140000-0000-4000-8000-000000000001', 'd8140000-0000-4000-8000-000000000002')$$,
  $$values ('d8150000-0000-4000-8000-000000000001'::uuid, 'high'::text)$$,
  'organization A sees the valid relation only, including after portal upsert');
select throws_ok($$insert into public.lead_property_interests (lead_id, property_id)
  values ('d8140000-0000-4000-8000-000000000001', 'd8150000-0000-4000-8000-000000000002')$$,
  '42501', null, 'organization A cannot probe an existing private property in B');
select throws_ok($$insert into public.lead_property_interests (lead_id, property_id)
  values ('d8140000-0000-4000-8000-000000000001', 'd8150000-0000-4000-8000-000000000003')$$,
  '42501', null, 'a nonexistent property receives the same denial');
reset role;

set local role anon;
select throws_ok('select id from public.lead_property_interests', '42501', null,
  'anonymous clients cannot list any associations');
reset role;

select * from finish();
rollback;
