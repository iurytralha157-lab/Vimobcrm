begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
select '00000000-0000-0000-0000-000000000000'::uuid, fixture.id::uuid,
  'authenticated', 'authenticated', fixture.email, '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
from (values
  ('de100000-0000-4000-8000-000000000001', 'own-parity-user@example.test'),
  ('de100000-0000-4000-8000-000000000002', 'own-parity-leader@example.test'),
  ('de100000-0000-4000-8000-000000000003', 'own-parity-broker@example.test'),
  ('de100000-0000-4000-8000-000000000004', 'own-parity-admin@example.test'),
  ('de100000-0000-4000-8000-000000000005', 'own-parity-manager@example.test'),
  ('de100000-0000-4000-8000-000000000006', 'own-parity-foreign@example.test')
) as fixture(id, email);

insert into public.organizations (id, name, slug, is_active) values
  ('de200000-0000-4000-8000-000000000001', 'Own Parity A', 'own-parity-a', true),
  ('de200000-0000-4000-8000-000000000002', 'Own Parity B', 'own-parity-b', true);
insert into public.users (id, organization_id, name, email, role, is_active)
select fixture.id::uuid, fixture.organization_id::uuid, fixture.name, fixture.email, 'user', true
from (values
  ('de100000-0000-4000-8000-000000000001', 'de200000-0000-4000-8000-000000000001', 'User', 'own-parity-user@example.test'),
  ('de100000-0000-4000-8000-000000000002', 'de200000-0000-4000-8000-000000000001', 'Leader', 'own-parity-leader@example.test'),
  ('de100000-0000-4000-8000-000000000003', 'de200000-0000-4000-8000-000000000001', 'Broker', 'own-parity-broker@example.test'),
  ('de100000-0000-4000-8000-000000000004', 'de200000-0000-4000-8000-000000000001', 'Admin', 'own-parity-admin@example.test'),
  ('de100000-0000-4000-8000-000000000005', 'de200000-0000-4000-8000-000000000001', 'Manager', 'own-parity-manager@example.test'),
  ('de100000-0000-4000-8000-000000000006', 'de200000-0000-4000-8000-000000000002', 'Foreign', 'own-parity-foreign@example.test')
) as fixture(id, organization_id, name, email)
on conflict (id) do update set organization_id = excluded.organization_id,
  name = excluded.name, role = excluded.role, is_active = excluded.is_active;
insert into public.organization_members (organization_id, user_id, role, is_active) values
  ('de200000-0000-4000-8000-000000000001', 'de100000-0000-4000-8000-000000000001', 'user', true),
  ('de200000-0000-4000-8000-000000000001', 'de100000-0000-4000-8000-000000000002', 'user', true),
  ('de200000-0000-4000-8000-000000000001', 'de100000-0000-4000-8000-000000000003', 'user', true),
  ('de200000-0000-4000-8000-000000000001', 'de100000-0000-4000-8000-000000000004', 'admin', true),
  ('de200000-0000-4000-8000-000000000001', 'de100000-0000-4000-8000-000000000005', 'manager', true),
  ('de200000-0000-4000-8000-000000000002', 'de100000-0000-4000-8000-000000000006', 'user', true)
on conflict (user_id, organization_id) do update set role = excluded.role, is_active = true, deleted_at = null;
insert into public.teams (id, organization_id, name, is_active) values
  ('de400000-0000-4000-8000-000000000001', 'de200000-0000-4000-8000-000000000001', 'Led Team', true),
  ('de400000-0000-4000-8000-000000000002', 'de200000-0000-4000-8000-000000000001', 'Recorded Other Team', true);
insert into public.team_members (organization_id, team_id, user_id, is_active, is_leader) values
  ('de200000-0000-4000-8000-000000000001', 'de400000-0000-4000-8000-000000000001', 'de100000-0000-4000-8000-000000000002', true, true),
  ('de200000-0000-4000-8000-000000000001', 'de400000-0000-4000-8000-000000000001', 'de100000-0000-4000-8000-000000000003', true, false);
insert into public.leads (id, organization_id, assigned_user_id, team_id, name, source) values
  ('de300000-0000-4000-8000-000000000001', 'de200000-0000-4000-8000-000000000001', 'de100000-0000-4000-8000-000000000001', null, 'Own lead', 'manual'),
  ('de300000-0000-4000-8000-000000000002', 'de200000-0000-4000-8000-000000000001', 'de100000-0000-4000-8000-000000000003', null, 'Broker lead without team', 'manual'),
  ('de300000-0000-4000-8000-000000000003', 'de200000-0000-4000-8000-000000000001', 'de100000-0000-4000-8000-000000000003', 'de400000-0000-4000-8000-000000000002', 'Broker lead with other team', 'manual'),
  ('de300000-0000-4000-8000-000000000004', 'de200000-0000-4000-8000-000000000001', null, 'de400000-0000-4000-8000-000000000001', 'Unassigned team queue', 'manual'),
  ('de300000-0000-4000-8000-000000000005', 'de200000-0000-4000-8000-000000000002', 'de100000-0000-4000-8000-000000000006', null, 'Other organization lead', 'manual');

select ok(has_function_privilege('authenticated', 'private.can_read_lead(uuid,uuid,uuid)', 'execute')
  and not has_function_privilege('anon', 'private.can_read_lead(uuid,uuid,uuid)', 'execute'), 'helper grants remain minimal');
select ok(not has_table_privilege('authenticated', 'public.leads', 'insert,update,delete'), 'read hardening does not restore direct client mutations');
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'de100000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.leads), 1, 'ordinary member sees only own lead');
select is((select count(*)::integer from public.leads where organization_id = 'de200000-0000-4000-8000-000000000002'), 0, 'ordinary member cannot read another organization');

reset role;
insert into public.organization_roles (id, organization_id, name, is_active) values
  ('de500000-0000-4000-8000-000000000001', 'de200000-0000-4000-8000-000000000001', 'Dashboard-only additive role', true);
insert into public.organization_role_permissions (organization_role_id, permission_key, organization_id, role_id, permission_id)
select 'de500000-0000-4000-8000-000000000001', 'dashboard_view', 'de200000-0000-4000-8000-000000000001',
  'de500000-0000-4000-8000-000000000001', id from public.available_permissions where key = 'dashboard_view';
insert into public.user_organization_roles (user_id, organization_role_id, organization_id, role_id, is_active) values
  ('de100000-0000-4000-8000-000000000001', 'de500000-0000-4000-8000-000000000001', 'de200000-0000-4000-8000-000000000001', 'de500000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is((select count(*)::integer from public.leads), 1, 'custom role without own grant preserves additive inherited own permission');
reset role;
insert into public.user_permission_overrides (organization_id, user_id, permission_key, allowed) values
  ('de200000-0000-4000-8000-000000000001', 'de100000-0000-4000-8000-000000000001', 'lead_view_own', false);
set local role authenticated;
select is((select count(*)::integer from public.leads), 0, 'explicit own denial closes direct Data API reads');
select ok(not private.can_read_lead_by_id('de300000-0000-4000-8000-000000000001'), 'attachment by-ID helper respects the same own denial');
reset role;
update public.organization_roles set is_active = false where id = 'de500000-0000-4000-8000-000000000001';
set local role authenticated;
select is((select count(*)::integer from public.leads), 0, 'inactive custom role cannot undo explicit own denial');
reset role;
update public.user_permission_overrides set allowed = true where user_id = 'de100000-0000-4000-8000-000000000001';
set local role authenticated;
select is((select count(*)::integer from public.leads), 1, 'explicit own allow restores direct assignment reads');

reset role;
update public.organization_members set is_active = false where user_id = 'de100000-0000-4000-8000-000000000001';
set local role authenticated;
select is((select count(*)::integer from public.leads), 0, 'inactive membership blocks own allow');
reset role;
update public.organization_members set is_active = true where user_id = 'de100000-0000-4000-8000-000000000001';
update public.users set is_active = false where id = 'de100000-0000-4000-8000-000000000001';
set local role authenticated;
select is((select count(*)::integer from public.leads), 0, 'inactive user blocks own allow');
reset role;
update public.users set is_active = true where id = 'de100000-0000-4000-8000-000000000001';
update public.organizations set is_active = false where id = 'de200000-0000-4000-8000-000000000001';
set local role authenticated;
select is((select count(*)::integer from public.leads), 0, 'inactive organization blocks own allow');
reset role;
update public.organizations set is_active = true where id = 'de200000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'de100000-0000-4000-8000-000000000002', true);
select is((select count(*)::integer from public.leads), 3, 'leader reads current broker leads across recorded team provenance plus existing queue scope');
select is((select count(*)::integer from public.leads where id = 'de300000-0000-4000-8000-000000000001'), 0, 'leader cannot read unrelated broker');
select is((select count(*)::integer from public.leads where id = 'de300000-0000-4000-8000-000000000005'), 0, 'leader cannot read another organization');
reset role;
insert into public.user_permission_overrides (organization_id, user_id, permission_key, allowed) values
  ('de200000-0000-4000-8000-000000000001', 'de100000-0000-4000-8000-000000000002', 'lead_view_team', false);
set local role authenticated;
select is((select count(*)::integer from public.leads), 0, 'explicit team denial remains independent from own permission');
reset role;
delete from public.user_permission_overrides where user_id = 'de100000-0000-4000-8000-000000000002';
update public.organization_members set is_active = false, deleted_at = clock_timestamp() where user_id = 'de100000-0000-4000-8000-000000000002';
update public.organization_members set is_active = true, deleted_at = null where user_id = 'de100000-0000-4000-8000-000000000002';
set local role authenticated;
select is((select count(*)::integer from public.leads), 0, 'old leader generation cannot restore team or queue reads');
reset role;
update public.team_members set is_active = true where user_id = 'de100000-0000-4000-8000-000000000002';
set local role authenticated;
select is((select count(*)::integer from public.leads), 3, 'explicit current-generation team enrollment restores leader scope');
reset role;
update public.organization_members set is_active = false, deleted_at = clock_timestamp() where user_id = 'de100000-0000-4000-8000-000000000003';
update public.organization_members set is_active = true, deleted_at = null where user_id = 'de100000-0000-4000-8000-000000000003';
set local role authenticated;
select is((select count(*)::integer from public.leads), 1, 'old broker generation cannot restore its leads to the leader');
select set_config('request.jwt.claim.sub', 'de100000-0000-4000-8000-000000000003', true);
select is((select count(*)::integer from public.leads), 2, 'direct assignment remains readable for active re-invited broker');

reset role;
insert into public.user_permission_overrides (organization_id, user_id, permission_key, allowed) values
  ('de200000-0000-4000-8000-000000000001', 'de100000-0000-4000-8000-000000000004', 'lead_view_own', false),
  ('de200000-0000-4000-8000-000000000001', 'de100000-0000-4000-8000-000000000004', 'lead_view_all', false);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'de100000-0000-4000-8000-000000000004', true);
select is((select count(*)::integer from public.leads), 4, 'admin retains organization-wide access despite individual deny');
select is((select count(*)::integer from public.leads where id = 'de300000-0000-4000-8000-000000000005'), 0, 'admin cannot cross its organization');
select set_config('request.jwt.claim.sub', 'de100000-0000-4000-8000-000000000005', true);
select is((select count(*)::integer from public.leads), 4, 'manager retains default organization-wide access');
reset role;
insert into public.user_permission_overrides (organization_id, user_id, permission_key, allowed) values
  ('de200000-0000-4000-8000-000000000001', 'de100000-0000-4000-8000-000000000005', 'lead_view_all', false);
set local role authenticated;
select is((select count(*)::integer from public.leads), 0, 'explicit all-lead deny narrows manager access');
select set_config('request.jwt.claim.sub', 'de100000-0000-4000-8000-000000000006', true);
select is((select count(*)::integer from public.leads), 1, 'foreign member sees its own organization only');
select is((select count(*)::integer from public.leads where organization_id = 'de200000-0000-4000-8000-000000000001'), 0, 'foreign member cannot cross into the fixture organization');

reset role;
select ok((select pg_catalog.pg_get_functiondef('private.can_read_lead(uuid,uuid,uuid)'::regprocedure::oid) like '%denied_own_permission%'), 'own denial is present in the deployed helper under test');
select ok((select pg_catalog.pg_get_functiondef('private.can_read_lead(uuid,uuid,uuid)'::regprocedure::oid) like '%broker_organization_member.membership_generation = broker_member.membership_generation%'), 'own hardening preserves generation fencing');
select ok(not exists (
  select 1 from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public' and procedure.proname = 'get_dashboard_stats'
    and (has_function_privilege('authenticated', procedure.oid, 'execute')
         or has_function_privilege('anon', procedure.oid, 'execute'))
), 'every legacy aggregate dashboard RPC overload remains unavailable to browser clients');
select ok(not exists (
  select 1 from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public' and procedure.proname in ('get_dashboard_team_lead_ids', 'get_funnel_data', 'get_lead_sources_data')
    and (has_function_privilege('authenticated', procedure.oid, 'execute')
         or has_function_privilege('anon', procedure.oid, 'execute'))
), 'every legacy team dashboard RPC overload remains unavailable to browser clients');
select ok(not exists (
  select 1 from pg_catalog.pg_proc procedure
  where procedure.oid in (
    pg_catalog.to_regprocedure('public.get_dashboard_stats()')::oid,
    pg_catalog.to_regprocedure('public.get_dashboard_team_lead_ids(uuid,timestamptz,timestamptz)')::oid
  ) and not has_function_privilege('service_role', procedure.oid, 'execute')
), 'canonical legacy RPC service_role grants are retained');
select * from finish();
rollback;
