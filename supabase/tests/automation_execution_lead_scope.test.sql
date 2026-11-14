-- Synthetic fixtures roll back. The test uses the same role and claims as
-- the Data API, with the existing module and lead permissions in place.
begin;
select plan(16);

-- Exercise the execution-specific gate independently of the Leads gate as
-- on environments that have the lead audience policies but lack its Auth gate.
drop policy if exists leads_select_requires_active_session on public.leads;
select ok(has_function_privilege('authenticated', 'private.has_active_automation_execution_read_session()', 'execute')
  and not has_function_privilege('anon', 'private.has_active_automation_execution_read_session()', 'execute')
  and not has_function_privilege('service_role', 'private.has_active_automation_execution_read_session()', 'execute'),
  'execution session checker can be used only by authenticated roles');

create temporary table execution_scope_fixture (
  org_a uuid, org_b uuid, user_a uuid, user_b uuid, user_c uuid,
  session_a uuid, session_b uuid, session_c uuid,
  lead_a uuid, lead_b uuid, lead_c uuid, automation_a uuid, automation_b uuid,
  execution_a uuid, execution_b uuid, execution_c uuid, orphan_execution uuid
);
insert into execution_scope_fixture values (
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()
);
grant select on execution_scope_fixture to authenticated, anon, service_role;

insert into public.organizations (id, name, slug, is_active)
select org_id, 'Synthetic execution scope', 'execution-scope-' || org_id, true
from execution_scope_fixture f cross join lateral (values (f.org_a), (f.org_b)) organizations(org_id);
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select actor_id, 'authenticated', 'authenticated', actor_id || '@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
from execution_scope_fixture f cross join lateral (values (f.user_a), (f.user_b), (f.user_c)) actors(actor_id);
insert into public.users (id, organization_id, name, email, role, is_active)
select actor_id, org_id, 'Synthetic broker', actor_id || '@example.invalid', 'user', true
from execution_scope_fixture f cross join lateral (values (f.user_a, f.org_a), (f.user_b, f.org_a), (f.user_c, f.org_b)) actors(actor_id, org_id)
on conflict (id) do update set organization_id = excluded.organization_id, role = 'user', is_active = true;
insert into public.organization_members (organization_id, user_id, role, is_active)
select org_id, actor_id, 'user', true
from execution_scope_fixture f cross join lateral (values (f.user_a, f.org_a), (f.user_b, f.org_a), (f.user_c, f.org_b)) actors(actor_id, org_id)
on conflict (user_id, organization_id) do update set role = 'user', is_active = true, deleted_at = null;
insert into public.organization_modules (organization_id, module_name, is_enabled)
select org_id, 'automations', true
from execution_scope_fixture f cross join lateral (values (f.org_a), (f.org_b)) organizations(org_id);
insert into public.available_permissions (key, name, description, category)
values ('automations_view', 'Synthetic AutomationsView', 'Synthetic permission fixture', 'automations')
on conflict (key) do nothing;
insert into public.organization_roles (id, organization_id, name, is_active)
select role_id, org_id, 'Synthetic automation monitor', true
from execution_scope_fixture f cross join lateral (values (f.session_a, f.org_a), (f.session_c, f.org_b)) roles(role_id, org_id);
insert into public.organization_role_permissions (organization_role_id, role_id, organization_id, permission_id, permission_key)
select role_id, role_id, org_id, permission.id, permission.key
from execution_scope_fixture f cross join lateral (values (f.session_a, f.org_a), (f.session_c, f.org_b)) roles(role_id, org_id)
cross join public.available_permissions permission where permission.key = 'automations_view';
insert into public.user_organization_roles (organization_role_id, role_id, organization_id, user_id, is_active)
select role_id, role_id, org_id, actor_id, true from execution_scope_fixture f cross join lateral
  (values (f.session_a, f.org_a, f.user_a), (f.session_a, f.org_a, f.user_b), (f.session_c, f.org_b, f.user_c)) roles(role_id, org_id, actor_id);
insert into auth.sessions (id, user_id, created_at, updated_at)
select session_id, actor_id, now(), now()
from execution_scope_fixture f cross join lateral (values (f.session_a, f.user_a), (f.session_b, f.user_b), (f.session_c, f.user_c)) sessions(session_id, actor_id);
insert into public.leads (id, organization_id, assigned_user_id, name, source)
select lead_id, org_id, actor_id, 'Synthetic assignee lead', 'manual'
from execution_scope_fixture f cross join lateral
  (values (f.lead_a, f.org_a, f.user_a), (f.lead_b, f.org_a, f.user_b), (f.lead_c, f.org_b, f.user_c)) leads(lead_id, org_id, actor_id);
insert into public.automations (id, organization_id, created_by, name, trigger_type, is_active)
select automation_id, org_id, actor_id, 'Synthetic automation', 'manual', false
from execution_scope_fixture f cross join lateral
  (values (f.automation_a, f.org_a, f.user_a), (f.automation_b, f.org_b, f.user_c)) automations(automation_id, org_id, actor_id);
insert into public.automation_executions (id, automation_id, organization_id, lead_id, status, execution_data)
select execution_id, automation_id, org_id, lead_id, 'completed',
       '{"reply_payload":{"content":"synthetic reply"},"trigger_data":{"content":"synthetic trigger"}}'::jsonb
from execution_scope_fixture f cross join lateral (
  values (f.execution_a, f.automation_a, f.org_a, f.lead_a),
    (f.execution_b, f.automation_a, f.org_a, f.lead_b),
    (f.execution_c, f.automation_b, f.org_b, f.lead_c),
    (f.orphan_execution, f.automation_a, f.org_a, null)
) executions(execution_id, automation_id, org_id, lead_id);

set local role authenticated;
select set_config('request.jwt.claim.sub', user_a::text, true) from execution_scope_fixture;
select set_config('request.jwt.claims', jsonb_build_object('sub', user_a, 'role', 'authenticated', 'session_id', session_a)::text, true)
from execution_scope_fixture;
select is((select execution_data #>> '{reply_payload,content}' from public.automation_executions
  where id = f.execution_a), 'synthetic reply', 'assignee with AutomationsView retains the execution payload')
from execution_scope_fixture f;
select ok(not exists (select 1 from public.automation_executions where id = f.execution_b),
  'AutomationsView cannot read the payload of a colleague-only lead') from execution_scope_fixture f;
select ok(not exists (select 1 from public.automation_executions where id = f.execution_c),
  'AutomationsView cannot cross organizations') from execution_scope_fixture f;
select ok(not exists (select 1 from public.automation_executions where id = f.orphan_execution),
  'orphaned or legacy unbound execution payload is hidden') from execution_scope_fixture f;
select set_config('request.jwt.claim.sub', user_c::text, true) from execution_scope_fixture;
select set_config('request.jwt.claims', jsonb_build_object('sub', user_c, 'role', 'authenticated', 'session_id', session_c)::text, true)
from execution_scope_fixture;
select is((select execution_data #>> '{reply_payload,content}' from public.automation_executions
  where id = f.execution_c), 'synthetic reply', 'second tenant retains its own execution payload')
from execution_scope_fixture f;
select ok(not exists (select 1 from public.automation_executions where id = f.execution_a),
  'second tenant cannot read the first tenant payload') from execution_scope_fixture f;
select set_config('request.jwt.claim.sub', user_a::text, true) from execution_scope_fixture;
select set_config('request.jwt.claims', jsonb_build_object('sub', user_a, 'role', 'authenticated', 'session_id', session_a)::text, true)
from execution_scope_fixture;
reset role;

update public.leads l set assigned_user_id = f.user_b from execution_scope_fixture f where l.id = f.lead_a;
set local role authenticated;
select ok(not exists (select 1 from public.automation_executions where id = f.execution_a),
  'former assignee loses access after transfer') from execution_scope_fixture f;
select set_config('request.jwt.claim.sub', user_b::text, true) from execution_scope_fixture;
select set_config('request.jwt.claims', jsonb_build_object('sub', user_b, 'role', 'authenticated', 'session_id', session_b)::text, true)
from execution_scope_fixture;
select is((select execution_data #>> '{trigger_data,content}' from public.automation_executions
  where id = f.execution_a), 'synthetic trigger', 'new assignee gains access to the retained payload')
from execution_scope_fixture f;
reset role;

delete from public.user_organization_roles where user_id = (select user_b from execution_scope_fixture);
set local role authenticated;
select ok(not exists (select 1 from public.automation_executions where id = f.execution_a),
  'lead visibility alone cannot grant access to automation execution payloads') from execution_scope_fixture f;
reset role;
insert into public.user_organization_roles (organization_role_id, role_id, organization_id, user_id, is_active)
select session_a, session_a, org_a, user_b, true from execution_scope_fixture;

set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', user_b, 'role', 'authenticated', 'session_id', session_b, 'amr', jsonb_build_array(jsonb_build_object('method', 'recovery'))
)::text, true) from execution_scope_fixture;
select ok(not exists (select 1 from public.automation_executions where id = f.execution_a),
  'password recovery session cannot read execution payloads') from execution_scope_fixture f;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', user_b, 'role', 'authenticated', 'session_id', session_a
)::text, true) from execution_scope_fixture;
select ok(not exists (select 1 from public.automation_executions where id = f.execution_a),
  'another user session cannot establish execution read access') from execution_scope_fixture f;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', user_b, 'role', 'authenticated', 'session_id', 'not-a-uuid'
)::text, true) from execution_scope_fixture;
select ok(not exists (select 1 from public.automation_executions where id = f.execution_a),
  'malformed session claim fails closed') from execution_scope_fixture f;
select set_config('request.jwt.claims', jsonb_build_object('sub', user_b, 'role', 'authenticated', 'session_id', session_b)::text, true)
from execution_scope_fixture;
reset role;

delete from auth.sessions where id = (select session_b from execution_scope_fixture);
set local role authenticated;
select ok(not exists (select 1 from public.automation_executions where id = f.execution_a),
  'revoked browser session cannot read current lead payloads') from execution_scope_fixture f;
reset role;
set local role anon;
select ok(not has_table_privilege('public.automation_executions', 'select'),
  'anonymous role has no direct read grant');
reset role;
set local role service_role;
select is((select count(*)::integer from public.automation_executions execution cross join execution_scope_fixture f
  where execution.id in (f.execution_a, f.execution_b, f.execution_c, f.orphan_execution)), 4,
  'service role keeps access to retained execution rows, including orphaned ones');
reset role;
select * from finish();
rollback;
