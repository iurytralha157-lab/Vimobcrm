begin;

create extension if not exists pgtap with schema extensions;
select plan(31);

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
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-0000-0000-000000000002',
    'authenticated',
    'authenticated',
    'org-b@example.test',
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
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-0000-0000-000000000003',
    'authenticated',
    'authenticated',
    'inactive@example.test',
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
  );

insert into public.organizations (id, name, slug, is_active)
values
  ('20000000-0000-0000-0000-000000000001', 'Security Test Org A', 'security-test-org-a', true),
  ('20000000-0000-0000-0000-000000000002', 'Security Test Org B', 'security-test-org-b', true);

insert into public.users (id, organization_id, name, email, role, is_active)
values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'User A', 'org-a@example.test', 'admin', true),
  ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'User B', 'org-b@example.test', 'user', true),
  ('10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', 'Inactive User', 'inactive@example.test', 'user', true)
on conflict (id) do update
set organization_id = excluded.organization_id,
    name = excluded.name,
    email = excluded.email,
    role = excluded.role,
    is_active = excluded.is_active;

insert into public.organization_members (organization_id, user_id, role, is_active)
values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'user', true),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'admin', true),
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 'user', false)
on conflict (user_id, organization_id) do update
set role = excluded.role,
    is_active = excluded.is_active;

insert into public.pipelines (id, organization_id, name, position, is_active)
values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Pipeline A', 1, true),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'Pipeline B', 1, true);

insert into public.stages (id, organization_id, pipeline_id, name, stage_key, position)
values
  ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Stage A', 'security_test_stage_a', 1),
  ('40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 'Stage B', 'security_test_stage_b', 1);

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
  instance_name,
  provider,
  status,
  is_active
)
values
  ('60000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'security-test-org-a', 'evolution_go', 'connected', true),
  ('60000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'security-test-org-b', 'evolution_go', 'connected', true);

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
select ok(
  public.can_view_whatsapp_conversation('70000000-0000-0000-0000-000000000001')
  and not public.can_view_whatsapp_conversation('70000000-0000-0000-0000-000000000002'),
  'Org A user authorizes only its linked WhatsApp conversation through the backend helper'
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
select ok(
  private.get_user_organization_id() is null,
  'inactive member has no canonical organization in legacy RLS helpers'
);
select results_eq(
  $$select count(*)::bigint from public.pipelines$$,
  array[0::bigint],
  'inactive member sees no pipelines through the Data API'
);
select results_eq(
  $$select count(*)::bigint from public.organizations where id = '20000000-0000-0000-0000-000000000001'$$,
  array[0::bigint],
  'inactive member cannot read the organization row'
);
select throws_ok(
  $$insert into public.pipelines (organization_id, name, position, is_active) values ('20000000-0000-0000-0000-000000000001', 'Blocked inactive pipeline', 99, true)$$,
  '42501',
  null,
  'inactive member cannot create tenant data through the Data API'
);

reset role;
update public.organization_members
set is_active = true,
    deleted_at = null,
    updated_at = now()
where organization_id = '20000000-0000-0000-0000-000000000001'
  and user_id = '10000000-0000-0000-0000-000000000003';

update public.whatsapp_sessions
set owner_user_id = '10000000-0000-0000-0000-000000000003'
where id = '60000000-0000-0000-0000-000000000001';

delete from public.user_roles
where user_id = '10000000-0000-0000-0000-000000000003';

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
select results_eq(
  $$select count(*)::bigint from public.pipelines$$,
  array[1::bigint],
  'reactivating the membership restores organization access'
);

reset role;
update public.organization_members
set is_active = false,
    deleted_at = now(),
    updated_at = now()
where organization_id = '20000000-0000-0000-0000-000000000001'
  and user_id = '10000000-0000-0000-0000-000000000003';

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
select results_eq(
  $$select count(*)::bigint from public.pipelines$$,
  array[0::bigint],
  'an explicitly deleted membership stays outside the organization'
);

reset role;
update public.organization_members
set is_active = true,
    updated_at = now()
where organization_id = '20000000-0000-0000-0000-000000000001'
  and user_id = '10000000-0000-0000-0000-000000000003';

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
select ok(
  not private.is_org_member('20000000-0000-0000-0000-000000000001'),
  'a tombstone cannot be bypassed by setting only is_active back to true'
);
select results_eq(
  $$select count(*)::bigint from public.pipelines$$,
  array[0::bigint],
  'a tombstoned membership remains blocked by RLS'
);
select ok(
  not public.vimob_can_access_whatsapp_session('60000000-0000-0000-0000-000000000001', 'view'),
  'a tombstoned owner cannot bypass organization access through the WhatsApp helper'
);
select throws_ok(
  $$insert into public.user_roles (user_id, role) values ('10000000-0000-0000-0000-000000000003', 'super_admin')$$,
  '42501',
  null,
  'authenticated users cannot self-assign super_admin to bypass tenant guards'
);

reset role;

update public.organization_members
set is_active = false,
    deleted_at = null,
    updated_at = now()
where organization_id = '20000000-0000-0000-0000-000000000001'
  and user_id = '10000000-0000-0000-0000-000000000003';

insert into public.organization_members (organization_id, user_id, role, is_active, deleted_at)
values ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003', 'user', true, null)
on conflict (user_id, organization_id) do update
set is_active = true,
    deleted_at = null,
    updated_at = now();

update public.users
set organization_id = '20000000-0000-0000-0000-000000000002',
    is_active = true,
    role = 'user',
    updated_at = now()
where id = '10000000-0000-0000-0000-000000000003';

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select ok(
  not private.is_org_member('20000000-0000-0000-0000-000000000001')
    and private.is_org_member('20000000-0000-0000-0000-000000000002'),
  'multi-organization user keeps only the organization whose membership is active'
);
select results_eq(
  $$select count(*)::bigint from public.pipelines where organization_id = '20000000-0000-0000-0000-000000000001'
    union all
    select count(*)::bigint from public.pipelines where organization_id = '20000000-0000-0000-0000-000000000002'$$,
  array[0::bigint, 1::bigint],
  'multi-organization RLS hides the suspended tenant and preserves the active tenant'
);

reset role;

select results_eq(
  $$select count(*)::bigint
    from pg_policy policy
    join pg_class relation on relation.oid = policy.polrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in ('automation_nodes', 'automation_connections', 'meta_messages')
      and policy.polname = 'vimob_active_membership_guard'$$,
  array[3::bigint],
  'tenant child tables receive explicit active-membership guards'
);
select ok(
  exists (
    select 1
    from pg_policy policy
    join pg_class relation on relation.oid = policy.polrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'properties'
      and policy.polname = 'vimob_active_membership_guard'
      and (select oid from pg_roles where rolname = 'authenticated') = any(policy.polroles)
      and not ((select oid from pg_roles where rolname = 'anon') = any(policy.polroles))
  ),
  'active-membership guard applies to authenticated Data API calls without restricting anon policies'
);

select throws_ok(
  $$insert into public.leads (organization_id, pipeline_id, stage_id, name) values ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', 'Cross-org lead')$$,
  '23514',
  null,
  'service-level writes cannot attach an Org B pipeline to an Org A lead'
);
select results_eq(
  $$insert into public.whatsapp_conversations (organization_id, session_id, remote_jid)
    values ('20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000002', 'cross-org@s.whatsapp.net')
    returning organization_id$$,
  array['20000000-0000-0000-0000-000000000002'::uuid],
  'conversation organization is canonicalized from its session'
);
select results_eq(
  $$select count(*)::bigint
    from public.users
    where id in (
      '10000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000002',
      '10000000-0000-0000-0000-000000000003'
    )
      and role not in ('user', 'super_admin')$$,
  array[1::bigint],
  'fixture confirms global admin exists only to test that it grants no tenant access'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select results_eq(
  $$select count(*)::bigint from storage.objects where bucket_id in ('logos', 'site-images') and split_part(name, '/', 1) = 'sites'$$,
  array[0::bigint],
  'legacy organization-less storage paths cannot be enumerated by authenticated clients'
);
reset role;

select * from finish();
rollback;
