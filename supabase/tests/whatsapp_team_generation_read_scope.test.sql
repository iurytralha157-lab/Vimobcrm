begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
select '00000000-0000-0000-0000-000000000000'::uuid, fixture.id::uuid,
  'authenticated', 'authenticated', fixture.email, '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
from (values
  ('dd100000-0000-4000-8000-000000000001', 'generation-leader@example.test'),
  ('dd100000-0000-4000-8000-000000000002', 'generation-broker@example.test'),
  ('dd100000-0000-4000-8000-000000000003', 'generation-foreign@example.test')
) as fixture(id, email);

insert into public.organizations (id, name, slug, is_active) values
  ('dd200000-0000-4000-8000-000000000001', 'Generation Org A', 'generation-org-a', true),
  ('dd200000-0000-4000-8000-000000000002', 'Generation Org B', 'generation-org-b', true);
insert into public.users (id, organization_id, name, email, role, is_active) values
  ('dd100000-0000-4000-8000-000000000001', 'dd200000-0000-4000-8000-000000000001', 'Leader', 'generation-leader@example.test', 'user', true),
  ('dd100000-0000-4000-8000-000000000002', 'dd200000-0000-4000-8000-000000000001', 'Broker', 'generation-broker@example.test', 'user', true),
  ('dd100000-0000-4000-8000-000000000003', 'dd200000-0000-4000-8000-000000000002', 'Foreign', 'generation-foreign@example.test', 'user', true)
on conflict (id) do update set
  organization_id = excluded.organization_id,
  name = excluded.name,
  email = excluded.email,
  role = excluded.role,
  is_active = excluded.is_active;
insert into public.organization_members (organization_id, user_id, role, is_active) values
  ('dd200000-0000-4000-8000-000000000001', 'dd100000-0000-4000-8000-000000000001', 'user', true),
  ('dd200000-0000-4000-8000-000000000001', 'dd100000-0000-4000-8000-000000000002', 'user', true),
  ('dd200000-0000-4000-8000-000000000002', 'dd100000-0000-4000-8000-000000000003', 'user', true)
on conflict (user_id, organization_id) do update set
  role = excluded.role,
  is_active = excluded.is_active;
insert into public.organization_modules (organization_id, module_name, is_enabled) values
  ('dd200000-0000-4000-8000-000000000001', 'whatsapp', true),
  ('dd200000-0000-4000-8000-000000000002', 'whatsapp', true);
insert into public.teams (id, organization_id, name, is_active) values
  ('dd400000-0000-4000-8000-000000000001', 'dd200000-0000-4000-8000-000000000001', 'Generation Team', true);
insert into public.team_members (organization_id, team_id, user_id, is_active, is_leader) values
  ('dd200000-0000-4000-8000-000000000001', 'dd400000-0000-4000-8000-000000000001', 'dd100000-0000-4000-8000-000000000001', true, true),
  ('dd200000-0000-4000-8000-000000000001', 'dd400000-0000-4000-8000-000000000001', 'dd100000-0000-4000-8000-000000000002', true, false);
insert into public.leads (id, organization_id, assigned_user_id, team_id, name, source) values
  ('dd300000-0000-4000-8000-000000000001', 'dd200000-0000-4000-8000-000000000001', 'dd100000-0000-4000-8000-000000000002', 'dd400000-0000-4000-8000-000000000001', 'Assigned lead', 'manual'),
  ('dd300000-0000-4000-8000-000000000002', 'dd200000-0000-4000-8000-000000000001', null, 'dd400000-0000-4000-8000-000000000001', 'Unassigned lead', 'manual'),
  ('dd300000-0000-4000-8000-000000000003', 'dd200000-0000-4000-8000-000000000002', 'dd100000-0000-4000-8000-000000000003', null, 'Foreign lead', 'manual');

-- Exercise lead RLS with live Auth sessions instead of an actor-only JWT.
-- Membership re-enrollment below must remain denied by the generation fence,
-- even when authentication itself is still valid.
insert into auth.sessions(id,user_id,created_at,updated_at) values
  ('dd500000-0000-4000-8000-000000000001','dd100000-0000-4000-8000-000000000001',now(),now()),
  ('dd500000-0000-4000-8000-000000000002','dd100000-0000-4000-8000-000000000002',now(),now()),
  ('dd500000-0000-4000-8000-000000000003','dd100000-0000-4000-8000-000000000003',now(),now());

select ok((select qual like '%private.whatsapp_actor_can_read_lead%'
           from pg_catalog.pg_policies
           where schemaname = 'public' and tablename = 'whatsapp_messages'
             and policyname = 'whatsapp_messages_select_owner_only'),
  'WhatsApp message RLS delegates lead access to the generation-fenced helper');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'dd100000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims','{"sub":"dd100000-0000-4000-8000-000000000001","role":"authenticated","session_id":"dd500000-0000-4000-8000-000000000001"}',true);
select ok(private.can_read_lead('dd200000-0000-4000-8000-000000000001',
  'dd100000-0000-4000-8000-000000000002', 'dd400000-0000-4000-8000-000000000001'),
  'current leader reads assigned team lead');
select ok(private.can_read_lead('dd200000-0000-4000-8000-000000000001',
  null, 'dd400000-0000-4000-8000-000000000001'),
  'current leader reads unassigned team lead');
select ok(private.whatsapp_actor_can_read_lead('dd200000-0000-4000-8000-000000000001',
  'dd300000-0000-4000-8000-000000000001', 'dd100000-0000-4000-8000-000000000001'),
  'WhatsApp helper allows current leader');
select ok(private.can_receive_whatsapp_broadcast(
  'whatsapp:dd200000-0000-4000-8000-000000000001:lead:dd300000-0000-4000-8000-000000000001'),
  'Realtime lead topic allows current leader');
select is((select count(*)::integer from public.leads
           where id = 'dd300000-0000-4000-8000-000000000001'), 1,
  'lead RLS allows current leader');

reset role;
update public.organization_members
set is_active = false, deleted_at = clock_timestamp()
where organization_id = 'dd200000-0000-4000-8000-000000000001'
  and user_id = 'dd100000-0000-4000-8000-000000000001';
update public.organization_members
set is_active = true, deleted_at = null
where organization_id = 'dd200000-0000-4000-8000-000000000001'
  and user_id = 'dd100000-0000-4000-8000-000000000001';
select ok((select membership.membership_generation > team_member.membership_generation
           from public.organization_members membership
           join public.team_members team_member
             on team_member.organization_id = membership.organization_id
            and team_member.user_id = membership.user_id
           where membership.organization_id = 'dd200000-0000-4000-8000-000000000001'
             and membership.user_id = 'dd100000-0000-4000-8000-000000000001'),
  'reinvite leaves the legacy leader team row in an older generation');

select ok(not private.whatsapp_actor_has_lead_permission(
  'dd200000-0000-4000-8000-000000000001',
  'dd100000-0000-4000-8000-000000000001', 'lead_view_team'),
  'legacy leader no longer inherits team permission');
set local role authenticated;
select ok(not private.can_read_lead('dd200000-0000-4000-8000-000000000001',
  'dd100000-0000-4000-8000-000000000002', 'dd400000-0000-4000-8000-000000000001'),
  'legacy leader cannot read assigned lead');
select ok(private.can_read_lead('dd200000-0000-4000-8000-000000000001',
  null, 'dd400000-0000-4000-8000-000000000001') is not true,
  'legacy leader cannot read unassigned lead');
select ok(not private.whatsapp_actor_can_read_lead('dd200000-0000-4000-8000-000000000001',
  'dd300000-0000-4000-8000-000000000001', 'dd100000-0000-4000-8000-000000000001'),
  'WhatsApp helper denies legacy leader');
select ok(not private.can_receive_whatsapp_broadcast(
  'whatsapp:dd200000-0000-4000-8000-000000000001:lead:dd300000-0000-4000-8000-000000000001'),
  'Realtime lead topic denies legacy leader');
select is((select count(*)::integer from public.leads
           where id = 'dd300000-0000-4000-8000-000000000001'), 0,
  'lead RLS denies legacy leader');

reset role;
update public.team_members set is_active = true
where organization_id = 'dd200000-0000-4000-8000-000000000001'
  and user_id = 'dd100000-0000-4000-8000-000000000001';
select ok((select membership.membership_generation = team_member.membership_generation
           from public.organization_members membership
           join public.team_members team_member
             on team_member.organization_id = membership.organization_id
            and team_member.user_id = membership.user_id
           where membership.organization_id = 'dd200000-0000-4000-8000-000000000001'
             and membership.user_id = 'dd100000-0000-4000-8000-000000000001'),
  'explicit team re-enrollment restores current generation');
set local role authenticated;
select ok(private.can_read_lead('dd200000-0000-4000-8000-000000000001',
  'dd100000-0000-4000-8000-000000000002', 'dd400000-0000-4000-8000-000000000001'),
  're-enrolled leader reads assigned team lead');
select ok(private.whatsapp_actor_can_read_lead('dd200000-0000-4000-8000-000000000001',
  'dd300000-0000-4000-8000-000000000001', 'dd100000-0000-4000-8000-000000000001'),
  'WhatsApp helper restores current leader access');

reset role;
update public.organization_members
set is_active = false, deleted_at = clock_timestamp()
where organization_id = 'dd200000-0000-4000-8000-000000000001'
  and user_id = 'dd100000-0000-4000-8000-000000000002';
update public.organization_members
set is_active = true, deleted_at = null
where organization_id = 'dd200000-0000-4000-8000-000000000001'
  and user_id = 'dd100000-0000-4000-8000-000000000002';
select ok((select membership.membership_generation > team_member.membership_generation
           from public.organization_members membership
           join public.team_members team_member
             on team_member.organization_id = membership.organization_id
            and team_member.user_id = membership.user_id
           where membership.organization_id = 'dd200000-0000-4000-8000-000000000001'
             and membership.user_id = 'dd100000-0000-4000-8000-000000000002'),
  'reinvite leaves assignee team row in an older generation');
set local role authenticated;
select ok(not private.can_read_lead('dd200000-0000-4000-8000-000000000001',
  'dd100000-0000-4000-8000-000000000002', 'dd400000-0000-4000-8000-000000000001'),
  'leader cannot inherit assigned lead through legacy assignee team row');
select ok(private.can_read_lead('dd200000-0000-4000-8000-000000000001',
  null, 'dd400000-0000-4000-8000-000000000001'),
  'leader still reads an unassigned team lead');
select ok(not private.whatsapp_actor_can_read_lead('dd200000-0000-4000-8000-000000000001',
  'dd300000-0000-4000-8000-000000000001', 'dd100000-0000-4000-8000-000000000001'),
  'WhatsApp helper denies legacy assignee team row');
select ok(not private.can_receive_whatsapp_broadcast(
  'whatsapp:dd200000-0000-4000-8000-000000000001:lead:dd300000-0000-4000-8000-000000000001'),
  'Realtime lead topic denies legacy assignee team row');
select set_config('request.jwt.claim.sub', 'dd100000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims','{"sub":"dd100000-0000-4000-8000-000000000002","role":"authenticated","session_id":"dd500000-0000-4000-8000-000000000002"}',true);
select ok(private.can_read_lead('dd200000-0000-4000-8000-000000000001',
  'dd100000-0000-4000-8000-000000000002', 'dd400000-0000-4000-8000-000000000001'),
  'direct assignee still reads own lead after reinvite');
select ok(private.whatsapp_actor_can_read_lead('dd200000-0000-4000-8000-000000000001',
  'dd300000-0000-4000-8000-000000000001', 'dd100000-0000-4000-8000-000000000002'),
  'WhatsApp helper keeps direct assignee access');

reset role;
update public.team_members set is_active = true
where organization_id = 'dd200000-0000-4000-8000-000000000001'
  and user_id = 'dd100000-0000-4000-8000-000000000002';
select ok((select membership.membership_generation = team_member.membership_generation
           from public.organization_members membership
           join public.team_members team_member
             on team_member.organization_id = membership.organization_id
            and team_member.user_id = membership.user_id
           where membership.organization_id = 'dd200000-0000-4000-8000-000000000001'
             and membership.user_id = 'dd100000-0000-4000-8000-000000000002'),
  'explicit assignee team re-enrollment restores current generation');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'dd100000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims','{"sub":"dd100000-0000-4000-8000-000000000001","role":"authenticated","session_id":"dd500000-0000-4000-8000-000000000001"}',true);
select ok(private.can_read_lead('dd200000-0000-4000-8000-000000000001',
  'dd100000-0000-4000-8000-000000000002', 'dd400000-0000-4000-8000-000000000001'),
  'leader again reads current team assignee');
select ok(private.whatsapp_actor_can_read_lead('dd200000-0000-4000-8000-000000000001',
  'dd300000-0000-4000-8000-000000000001', 'dd100000-0000-4000-8000-000000000001'),
  'WhatsApp helper again allows current team assignee');

select set_config('request.jwt.claim.sub', 'dd100000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims','{"sub":"dd100000-0000-4000-8000-000000000003","role":"authenticated","session_id":"dd500000-0000-4000-8000-000000000003"}',true);
select ok(not private.can_read_lead('dd200000-0000-4000-8000-000000000001',
  'dd100000-0000-4000-8000-000000000002', 'dd400000-0000-4000-8000-000000000001'),
  'other organization cannot read lead');
select ok(not private.whatsapp_actor_can_read_lead('dd200000-0000-4000-8000-000000000001',
  'dd300000-0000-4000-8000-000000000001', 'dd100000-0000-4000-8000-000000000003'),
  'other organization cannot read WhatsApp lead');
select ok(not private.can_receive_whatsapp_broadcast(
  'whatsapp:dd200000-0000-4000-8000-000000000001:lead:dd300000-0000-4000-8000-000000000001'),
  'other organization cannot subscribe to lead topic');

reset role;
select * from finish();
rollback;
