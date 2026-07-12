begin;

create extension if not exists pgtap with schema extensions;
select plan(17);

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
values
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'org-a@example.test',
    crypt('test-password', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-0000-0000-000000000002',
    'authenticated',
    'authenticated',
    'org-b@example.test',
    crypt('test-password', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-0000-0000-000000000003',
    'authenticated',
    'authenticated',
    'inactive@example.test',
    crypt('test-password', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    ''
  );

insert into public.organizations (id, name, slug, is_active)
values
  ('20000000-0000-0000-0000-000000000001', 'Security Test Org A', 'security-test-org-a', true),
  ('20000000-0000-0000-0000-000000000002', 'Security Test Org B', 'security-test-org-b', true);

insert into public.users (id, organization_id, name, email, role, is_active)
values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'User A', 'org-a@example.test', 'admin', true),
  ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'User B', 'org-b@example.test', 'user', true),
  ('10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', 'Inactive User', 'inactive@example.test', 'user', true);

insert into public.organization_members (organization_id, user_id, role, is_active)
values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'user', true),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'admin', true),
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 'user', false);

insert into public.pipelines (id, organization_id, name, position, is_active)
values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Pipeline A', 1, true),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'Pipeline B', 1, true);

insert into public.stages (id, organization_id, pipeline_id, name, position)
values
  ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Stage A', 1),
  ('40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 'Stage B', 1);

insert into public.leads (
  id,
  organization_id,
  pipeline_id,
  stage_id,
  assigned_user_id,
  name,
  phone
)
values
  (
    '50000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'Lead A',
    '5511999990001'
  ),
  (
    '50000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000002',
    '30000000-0000-0000-0000-000000000002',
    '40000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000002',
    'Lead B',
    '5511999990002'
  );

insert into public.whatsapp_sessions (
  id,
  organization_id,
  owner_user_id,
  name,
  instance_name,
  status,
  is_active
)
values
  ('60000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Session A', 'security-test-org-a', 'connected', true),
  ('60000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'Session B', 'security-test-org-b', 'connected', true);

insert into public.whatsapp_conversations (
  id,
  organization_id,
  session_id,
  lead_id,
  assigned_user_id,
  remote_jid,
  contact_name
)
values
  (
    '70000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '60000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '5511999990001@s.whatsapp.net',
    'Lead A'
  ),
  (
    '70000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000002',
    '60000000-0000-0000-0000-000000000002',
    '50000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000002',
    '5511999990002@s.whatsapp.net',
    'Lead B'
  );

insert into public.audit_logs (id, organization_id, user_id, action, entity_type, entity_id)
values
  ('80000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'update', 'lead', '50000000-0000-0000-0000-000000000001'),
  ('80000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'update', 'lead', '50000000-0000-0000-0000-000000000002');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select ok(
  private.is_org_member('20000000-0000-0000-0000-000000000001'),
  'active member is authorized in Org A'
);
select ok(
  not private.is_org_member('20000000-0000-0000-0000-000000000002'),
  'users.organization_id and global role do not authorize Org B'
);
select ok(
  not private.has_org_role('20000000-0000-0000-0000-000000000002', array['admin']),
  'global admin role does not become Org B admin'
);
select ok(
  not private.has_permission('20000000-0000-0000-0000-000000000002', 'lead_manage'),
  'global admin role grants no Org B permission'
);
select results_eq(
  $$select count(*)::bigint from public.leads$$,
  array[1::bigint],
  'Org A user sees only Org A leads'
);
select results_eq(
  $$select count(*)::bigint from public.leads where id = '50000000-0000-0000-0000-000000000002'$$,
  array[0::bigint],
  'Org A user cannot fetch an Org B lead by id'
);
select results_eq(
  $$select count(*)::bigint from public.pipelines$$,
  array[1::bigint],
  'Org A user sees only Org A pipelines'
);
select results_eq(
  $$select count(*)::bigint from public.whatsapp_conversations$$,
  array[1::bigint],
  'Org A user sees only authorized WhatsApp conversations'
);
select results_eq(
  $$select count(*)::bigint from public.audit_logs$$,
  array[1::bigint],
  'Org A user sees only Org A audit history'
);
select throws_ok(
  $$insert into public.audit_logs (organization_id, user_id, action, entity_type) values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'forged', 'security_test')$$,
  '42501',
  null,
  'authenticated clients cannot forge audit events'
);
select throws_ok(
  $$update public.users set organization_id = '20000000-0000-0000-0000-000000000002' where id = '10000000-0000-0000-0000-000000000001'$$,
  '42501',
  null,
  'authenticated clients cannot change organization preference directly'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
select ok(
  not private.is_org_member('20000000-0000-0000-0000-000000000001'),
  'inactive membership is denied'
);
select results_eq(
  $$select count(*)::bigint from public.leads$$,
  array[0::bigint],
  'inactive member sees no leads'
);

reset role;

select throws_ok(
  $$insert into public.leads (organization_id, pipeline_id, stage_id, name) values ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', 'Cross-org lead')$$,
  '23514',
  null,
  'service-level writes cannot attach an Org B pipeline to an Org A lead'
);
select throws_ok(
  $$insert into public.whatsapp_conversations (organization_id, session_id, remote_jid) values ('20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000002', 'cross-org@s.whatsapp.net')$$,
  '23514',
  null,
  'service-level writes cannot attach an Org B session to an Org A conversation'
);
select results_eq(
  $$select count(*)::bigint from public.users where role not in ('user', 'super_admin')$$,
  array[1::bigint],
  'fixture confirms global admin exists only to test that it grants no tenant access'
);
select results_eq(
  $$select count(*)::bigint from storage.objects where bucket_id in ('logos', 'site-images') and split_part(name, '/', 1) = 'sites'$$,
  array[0::bigint],
  'legacy organization-less storage paths are absent'
);

select * from finish();
rollback;
