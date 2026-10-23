begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  'e8100000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'wa-inactive-role@example.test', '', now(),
  '{}', '{}', now(), now(), '', '', '', ''
);
insert into public.organizations (id, name, slug, is_active)
values ('e8200000-0000-4000-8000-000000000001',
        'WA Inactive Role Org', 'wa-inactive-role-org', true);
insert into public.users (id, organization_id, name, email, role, is_active)
values ('e8100000-0000-4000-8000-000000000001',
        'e8200000-0000-4000-8000-000000000001',
        'WA Role Broker', 'wa-inactive-role@example.test', 'user', true)
on conflict (id) do update set organization_id = excluded.organization_id,
  name = excluded.name, email = excluded.email, role = excluded.role,
  is_active = excluded.is_active;
insert into public.organization_members (organization_id, user_id, role, is_active)
values ('e8200000-0000-4000-8000-000000000001',
        'e8100000-0000-4000-8000-000000000001', 'user', true)
on conflict (user_id, organization_id) do update set
  role = excluded.role, is_active = excluded.is_active;
insert into public.organization_modules (organization_id, module_name, is_enabled)
values ('e8200000-0000-4000-8000-000000000001', 'whatsapp', true)
on conflict (organization_id, module_name) do update
set is_enabled = excluded.is_enabled;
insert into public.leads (id, organization_id, assigned_user_id, name, source)
values ('e8300000-0000-4000-8000-000000000001',
        'e8200000-0000-4000-8000-000000000001', null,
        'Unassigned WA Role Lead', 'manual');

-- This broker has no default all-lead scope. The custom grant is the only
-- possible route to this unassigned lead's topic.
-- Schema-only clones do not contain the reference catalog seeded by migrations.
-- Keep the one required key inside this rolled-back fixture.
insert into public.available_permissions (key, name, category)
values ('lead_view_all', 'Ver todos os leads', 'leads')
on conflict (key) do nothing;

insert into public.organization_roles (id, organization_id, name, is_active)
values ('e8400000-0000-4000-8000-000000000001',
        'e8200000-0000-4000-8000-000000000001',
        'WA All Lead Viewer', false);
insert into public.organization_role_permissions (
  organization_role_id, permission_key, organization_id, role_id, permission_id
)
select 'e8400000-0000-4000-8000-000000000001'::uuid, 'lead_view_all',
       'e8200000-0000-4000-8000-000000000001'::uuid,
       'e8400000-0000-4000-8000-000000000001'::uuid, permission.id
from public.available_permissions as permission
where permission.key = 'lead_view_all';
insert into public.user_organization_roles (
  user_id, organization_role_id, organization_id, role_id, is_active
)
values ('e8100000-0000-4000-8000-000000000001',
        'e8400000-0000-4000-8000-000000000001',
        'e8200000-0000-4000-8000-000000000001',
        'e8400000-0000-4000-8000-000000000001', true);

select is((select count(*)::bigint from public.organization_role_permissions
           where role_id = 'e8400000-0000-4000-8000-000000000001'),
          1::bigint, 'the custom role has the all-lead grant');
select ok(has_function_privilege(
  'authenticated', 'private.can_receive_whatsapp_broadcast(text)', 'execute'),
  'authenticated callers can invoke the Realtime topic gate');
select ok(not has_function_privilege(
  'authenticated',
  'private.whatsapp_actor_has_lead_permission(uuid,uuid,text)', 'execute'),
  'the internal lead permission helper remains private');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub',
  'e8100000-0000-4000-8000-000000000001', true);
select ok(private.can_receive_whatsapp_broadcast(
  'whatsapp:e8200000-0000-4000-8000-000000000001:inbox'),
  'active membership and enabled WhatsApp module still allow the inbox');
select ok(not private.can_receive_whatsapp_broadcast(
  'whatsapp:e8200000-0000-4000-8000-000000000001:lead:e8300000-0000-4000-8000-000000000001'),
  'inactive custom role denies the lead topic despite active assignment');

reset role;
update public.organization_roles set is_active = true
where id = 'e8400000-0000-4000-8000-000000000001';
set local role authenticated;
select ok(private.can_receive_whatsapp_broadcast(
  'whatsapp:e8200000-0000-4000-8000-000000000001:lead:e8300000-0000-4000-8000-000000000001'),
  'activating the custom role restores the lead topic');

reset role;
update public.user_organization_roles set is_active = false
where role_id = 'e8400000-0000-4000-8000-000000000001';
set local role authenticated;
select ok(not private.can_receive_whatsapp_broadcast(
  'whatsapp:e8200000-0000-4000-8000-000000000001:lead:e8300000-0000-4000-8000-000000000001'),
  'inactive assignment also denies the lead topic');

reset role;
update public.user_organization_roles set is_active = true
where role_id = 'e8400000-0000-4000-8000-000000000001';
set local role authenticated;
select ok(private.can_receive_whatsapp_broadcast(
  'whatsapp:e8200000-0000-4000-8000-000000000001:lead:e8300000-0000-4000-8000-000000000001'),
  'restoring the assignment restores the lead topic');

reset role;
update public.organization_roles set is_active = false
where id = 'e8400000-0000-4000-8000-000000000001';
set local role authenticated;
select ok(not private.can_receive_whatsapp_broadcast(
  'whatsapp:e8200000-0000-4000-8000-000000000001:lead:e8300000-0000-4000-8000-000000000001'),
  'deactivating the role denies the next lead-topic authorization check');

reset role;
select * from finish();
rollback;
