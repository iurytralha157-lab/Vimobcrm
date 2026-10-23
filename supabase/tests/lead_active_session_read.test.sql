begin;
create extension if not exists pgtap with schema extensions;
grant usage on schema extensions to anon, service_role;
select plan(50);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token)
select fixture.id::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', fixture.email, '', now(), '{}'::jsonb, '{}'::jsonb,
  now(), now(), '', '', '', ''
from (values
  ('df100000-0000-4000-8000-000000000001', 'session-read-user@example.test'),
  ('df100000-0000-4000-8000-000000000002', 'session-read-leader@example.test'),
  ('df100000-0000-4000-8000-000000000003', 'session-read-broker@example.test'),
  ('df100000-0000-4000-8000-000000000004', 'session-read-admin@example.test'),
  ('df100000-0000-4000-8000-000000000005', 'session-read-foreign@example.test')
) fixture(id, email);
insert into public.organizations (id, name, slug, is_active) values
  ('df200000-0000-4000-8000-000000000001', 'Session A', 'session-read-a', true),
  ('df200000-0000-4000-8000-000000000002', 'Session B', 'session-read-b', true);
insert into public.users (id, organization_id, name, email, role, is_active)
select id, case when email = 'session-read-foreign@example.test'
  then 'df200000-0000-4000-8000-000000000002'::uuid
  else 'df200000-0000-4000-8000-000000000001'::uuid end,
  email, email, 'user', true from auth.users where email like 'session-read-%@example.test'
on conflict (id) do update set organization_id = excluded.organization_id,
  name = excluded.name, role = 'user', is_active = true;
insert into public.organization_members (organization_id, user_id, role, is_active)
select organization_id, id, case when id = 'df100000-0000-4000-8000-000000000004' then 'admin' else 'user' end, true
from public.users where id in (
  'df100000-0000-4000-8000-000000000001', 'df100000-0000-4000-8000-000000000002',
  'df100000-0000-4000-8000-000000000003', 'df100000-0000-4000-8000-000000000004',
  'df100000-0000-4000-8000-000000000005'
);
insert into auth.sessions (id, user_id, created_at, updated_at)
select ('df600000-0000-4000-8000-' || right(id::text, 12))::uuid, id, now(), now()
from public.users where email like 'session-read-%@example.test';
insert into public.teams (id, organization_id, name, is_active) values
  ('df400000-0000-4000-8000-000000000001', 'df200000-0000-4000-8000-000000000001', 'Session Team', true);
insert into public.team_members (organization_id, team_id, user_id, is_active, is_leader) values
  ('df200000-0000-4000-8000-000000000001', 'df400000-0000-4000-8000-000000000001', 'df100000-0000-4000-8000-000000000002', true, true),
  ('df200000-0000-4000-8000-000000000001', 'df400000-0000-4000-8000-000000000001', 'df100000-0000-4000-8000-000000000003', true, false);
insert into public.leads (id, organization_id, assigned_user_id, team_id, name, source) values
  ('df300000-0000-4000-8000-000000000001', 'df200000-0000-4000-8000-000000000001', 'df100000-0000-4000-8000-000000000001', null, 'Own', 'manual'),
  ('df300000-0000-4000-8000-000000000002', 'df200000-0000-4000-8000-000000000001', 'df100000-0000-4000-8000-000000000003', null, 'Broker', 'manual'),
  ('df300000-0000-4000-8000-000000000003', 'df200000-0000-4000-8000-000000000001', null, 'df400000-0000-4000-8000-000000000001', 'Queue', 'manual'),
  ('df300000-0000-4000-8000-000000000004', 'df200000-0000-4000-8000-000000000002', 'df100000-0000-4000-8000-000000000005', null, 'Foreign', 'manual');
insert into public.lead_attachments (id, lead_id, file_name, file_url)
select ('df700000-0000-4000-8000-' || right(id::text, 12))::uuid, id,
  'synthetic.txt', 'https://files.example.test/synthetic'
from public.leads where id in (
  'df300000-0000-4000-8000-000000000001', 'df300000-0000-4000-8000-000000000002',
  'df300000-0000-4000-8000-000000000003', 'df300000-0000-4000-8000-000000000004'
);

select is((select count(*)::integer from pg_catalog.pg_policies
  where schemaname = 'public' and cmd = 'SELECT' and permissive = 'RESTRICTIVE'
    and roles = array['authenticated']::name[] and policyname in (
      'leads_select_requires_active_session', 'lead_attachments_select_requires_active_session')), 2,
  'session gates are restrictive SELECT policies for authenticated only');
select ok(has_function_privilege('authenticated', 'private.has_active_lead_read_session()', 'execute')
  and not has_function_privilege('anon', 'private.has_active_lead_read_session()', 'execute')
  and not has_function_privilege('service_role', 'private.has_active_lead_read_session()', 'execute'),
  'private helper grants no public, anon or service execution path');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'df100000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"df100000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select ok(not private.has_active_lead_read_session(), 'missing session claim fails closed');
select is((select count(*)::integer from public.leads), 0, 'missing session cannot read own leads');
select is((select count(*)::integer from public.lead_attachments), 0, 'missing session cannot read attachment metadata');
select set_config('request.jwt.claims', '{', true);
select ok(not private.has_active_lead_read_session(), 'malformed JWT claims fail closed in the helper');
select set_config('request.jwt.claims', '{"session_id":"not-a-uuid"}', true);
select ok(not private.has_active_lead_read_session(), 'malformed session UUID fails closed');
select is((select count(*)::integer from public.leads), 0, 'malformed session cannot read leads');
select set_config('request.jwt.claims', '{"session_id":"df600000000040008000000000000001"}', true);
select ok(not private.has_active_lead_read_session(), 'noncanonical session UUID is not accepted');
select set_config('request.jwt.claims', '{"session_id":"df600000-0000-4000-8000-000000000001","amr":[{"method":" Recovery "},{"method":"token_refresh"}]}', true);
select ok(not private.has_active_lead_read_session(), 'live recovery session remains isolated after token refresh');
select is((select count(*)::integer from public.leads), 0, 'recovery session cannot read leads through the Data API');
select is((select count(*)::integer from public.lead_attachments), 0, 'recovery session cannot read attachment metadata');
select set_config('request.jwt.claims', '{"session_id":"df600000-0000-4000-8000-000000000001","amr":{}}', true);
select ok(not private.has_active_lead_read_session(), 'malformed authentication-method claims fail closed');
select set_config('request.jwt.claims', '{"session_id":"df600000-0000-4000-8000-000000000001","amr":[{"method":123}]}', true);
select ok(not private.has_active_lead_read_session(), 'non-string authentication method fails closed');
select set_config('request.jwt.claims', '{"session_id":"df600000-0000-4000-8000-000000000001","amr":[{}]}', true);
select ok(not private.has_active_lead_read_session(), 'missing authentication method fails closed');
select set_config('request.jwt.claims', '{"session_id":"df600000-0000-4000-8000-000000000005"}', true);
select ok(not private.has_active_lead_read_session(), 'another user session cannot authenticate this user');
select is((select count(*)::integer from public.leads), 0, 'mismatched session cannot read leads');
select is((select count(*)::integer from public.lead_attachments), 0, 'mismatched session cannot read attachments');

select set_config('request.jwt.claims', '{"session_id":"df600000-0000-4000-8000-000000000001","amr":[{"method":"password"}]}', true);
select ok(private.has_active_lead_read_session(), 'matching active session is accepted');
select is((select count(*)::integer from public.leads), 1, 'active user preserves own lead scope');
select is((select count(*)::integer from public.lead_attachments), 1, 'active user preserves own attachment scope');
select is((select count(*)::integer from public.leads where organization_id = 'df200000-0000-4000-8000-000000000002'), 0,
  'active session grants no cross-tenant access');
reset role;
delete from auth.sessions where id = 'df600000-0000-4000-8000-000000000001';
set local role authenticated;
select ok(not private.has_active_lead_read_session(), 'revoked JWT session is rejected on the next statement');
select is((select count(*)::integer from public.leads), 0, 'revoked JWT loses lead reads');
select is((select count(*)::integer from public.lead_attachments), 0, 'revoked JWT loses attachment reads');
reset role;
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('df600000-0000-4000-8000-000000000001', 'df100000-0000-4000-8000-000000000001', now(), now());
insert into public.user_permission_overrides (organization_id, user_id, permission_key, allowed) values
  ('df200000-0000-4000-8000-000000000001', 'df100000-0000-4000-8000-000000000001', 'lead_view_own', false);
set local role authenticated;
select is((select count(*)::integer from public.leads), 0, 'active session does not bypass own permission denial');
select is((select count(*)::integer from public.lead_attachments), 0, 'active session does not bypass attachment own denial');
reset role;
delete from public.user_permission_overrides where user_id = 'df100000-0000-4000-8000-000000000001';
update public.organization_members set is_active = false where user_id = 'df100000-0000-4000-8000-000000000001';
set local role authenticated;
select ok(private.has_active_lead_read_session(), 'membership suspension is independent from Auth session liveness');
select is((select count(*)::integer from public.leads), 0, 'active session does not bypass inactive membership');
select is((select count(*)::integer from public.lead_attachments), 0, 'inactive membership still hides attachments');

select set_config('request.jwt.claim.sub', 'df100000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"session_id":"df600000-0000-4000-8000-000000000002"}', true);
select is((select count(*)::integer from public.leads), 2, 'active leader preserves current broker and existing queue scope');
select is((select count(*)::integer from public.lead_attachments), 2, 'active leader preserves scoped attachments');
select is((select count(*)::integer from public.leads where organization_id = 'df200000-0000-4000-8000-000000000002'), 0,
  'active leader cannot cross organizations');
reset role;
insert into public.user_permission_overrides (organization_id, user_id, permission_key, allowed) values
  ('df200000-0000-4000-8000-000000000001', 'df100000-0000-4000-8000-000000000002', 'lead_view_team', false);
set local role authenticated;
select is((select count(*)::integer from public.leads), 0, 'session does not bypass explicit team denial');
select is((select count(*)::integer from public.lead_attachments), 0, 'team denial still hides attachments');

select set_config('request.jwt.claim.sub', 'df100000-0000-4000-8000-000000000004', true);
select set_config('request.jwt.claims', '{"session_id":"df600000-0000-4000-8000-000000000004"}', true);
select is((select count(*)::integer from public.leads), 3, 'active app admin preserves organization-wide scope');
select is((select count(*)::integer from public.lead_attachments), 3, 'active app admin preserves organization attachment scope');
select is((select count(*)::integer from public.leads where organization_id = 'df200000-0000-4000-8000-000000000002'), 0,
  'app admin session does not grant another organization');
reset role;
delete from auth.sessions where id = 'df600000-0000-4000-8000-000000000004';
set local role authenticated;
select is((select count(*)::integer from public.leads), 0, 'revoked app admin session loses wide lead reads');
select is((select count(*)::integer from public.lead_attachments), 0, 'revoked app admin session loses wide attachment reads');

select set_config('request.jwt.claim.sub', 'df100000-0000-4000-8000-000000000005', true);
select set_config('request.jwt.claims', '{"session_id":"df600000-0000-4000-8000-000000000005"}', true);
select is((select count(*)::integer from public.leads), 1, 'active member of second tenant preserves its own lead');
select is((select count(*)::integer from public.lead_attachments), 1, 'second tenant member preserves its own attachment');
select is((select count(*)::integer from public.leads where organization_id = 'df200000-0000-4000-8000-000000000001'), 0,
  'second tenant cannot read the first organization');

reset role;
select set_config('request.jwt.claim.sub', '', true);
select ok(not private.has_active_lead_read_session(), 'valid session without an authenticated user still fails closed');
select set_config('request.jwt.claim.sub', 'not-a-uuid', true);
select ok(not private.has_active_lead_read_session(), 'malformed JWT subject fails closed in the helper');
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{}', true);
set local role service_role;
select is((select count(*)::integer from public.leads), 4, 'trusted service role preserves its existing RLS bypass without a browser session');
select is((select count(*)::integer from public.lead_attachments), 4, 'service role preserves all attachment reads');
reset role;
select is((select count(*)::integer from public.leads), 4, 'database administrator preserves operational access');
set local role anon;
select throws_ok('select * from public.leads', '42501', 'permission denied for table leads', 'anon lead grant stays closed');
select throws_ok('select * from public.lead_attachments', '42501', 'permission denied for table lead_attachments', 'anon attachment grant stays closed');
reset role;
select * from finish();
rollback;
