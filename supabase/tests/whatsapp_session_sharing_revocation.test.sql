begin;

create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  ('00000000-0000-0000-0000-000000000000', 'f7310000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'sharing-owner@example.test', crypt('test-password', gen_salt('bf', 4)), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'f7310000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'sharing-recipient@example.test', crypt('test-password', gen_salt('bf', 4)), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');

insert into public.organizations (id, name, slug, is_active)
values ('f7320000-0000-4000-8000-000000000001', 'Sharing Revocation Test', 'sharing-revocation-test', true);

insert into public.users (id, organization_id, name, email, role, is_active)
values
  ('f7310000-0000-4000-8000-000000000001', 'f7320000-0000-4000-8000-000000000001', 'Sharing Owner', 'sharing-owner@example.test', 'admin', true),
  ('f7310000-0000-4000-8000-000000000002', 'f7320000-0000-4000-8000-000000000001', 'Sharing Recipient', 'sharing-recipient@example.test', 'user', true);

insert into public.organization_members (organization_id, user_id, role, is_active)
values
  ('f7320000-0000-4000-8000-000000000001', 'f7310000-0000-4000-8000-000000000001', 'admin', true),
  ('f7320000-0000-4000-8000-000000000001', 'f7310000-0000-4000-8000-000000000002', 'user', true);

insert into public.teams (id, organization_id, name, is_active)
values ('f7330000-0000-4000-8000-000000000001', 'f7320000-0000-4000-8000-000000000001', 'Sharing Team', true);

insert into public.team_members (team_id, user_id, organization_id, is_leader, is_active)
values
  ('f7330000-0000-4000-8000-000000000001', 'f7310000-0000-4000-8000-000000000001', 'f7320000-0000-4000-8000-000000000001', true, true),
  ('f7330000-0000-4000-8000-000000000001', 'f7310000-0000-4000-8000-000000000002', 'f7320000-0000-4000-8000-000000000001', false, true);

insert into public.whatsapp_sessions (
  id, organization_id, owner_user_id, instance_name, provider, status
)
values ('f7340000-0000-4000-8000-000000000001', 'f7320000-0000-4000-8000-000000000001', 'f7310000-0000-4000-8000-000000000001', 'sharing-revocation-test', 'evolution_go', 'connected');

select col_is('public', 'whatsapp_session_access', 'grant_scope', 'text', 'grant authority is recorded');
select col_is('public', 'whatsapp_session_access', 'grant_team_id', 'uuid', 'team authority records its team');

insert into public.whatsapp_session_access (
  session_id, user_id, organization_id, granted_by,
  can_view, can_send, only_leads_access, access_mode, grant_scope, grant_team_id
)
values (
  'f7340000-0000-4000-8000-000000000001', 'f7310000-0000-4000-8000-000000000002',
  'f7320000-0000-4000-8000-000000000001', 'f7310000-0000-4000-8000-000000000001',
  true, true, true, 'assigned_leads_only', 'team', 'f7330000-0000-4000-8000-000000000001'
);

update public.team_members
set is_active = false
where team_id = 'f7330000-0000-4000-8000-000000000001'
  and user_id = 'f7310000-0000-4000-8000-000000000002';
select is((select count(*) from public.whatsapp_session_access), 0::bigint, 'leaving a team removes the grant');

update public.team_members
set is_active = true
where team_id = 'f7330000-0000-4000-8000-000000000001'
  and user_id = 'f7310000-0000-4000-8000-000000000002';
select is((select count(*) from public.whatsapp_session_access), 0::bigint, 'returning to the team does not restore the grant');

insert into public.whatsapp_session_access (
  session_id, user_id, organization_id, granted_by,
  can_view, can_send, only_leads_access, access_mode, grant_scope, grant_team_id
)
values (
  'f7340000-0000-4000-8000-000000000001', 'f7310000-0000-4000-8000-000000000002',
  'f7320000-0000-4000-8000-000000000001', 'f7310000-0000-4000-8000-000000000001',
  true, true, true, 'assigned_leads_only', 'team', 'f7330000-0000-4000-8000-000000000001'
);
update public.team_members
set is_leader = false
where team_id = 'f7330000-0000-4000-8000-000000000001'
  and user_id = 'f7310000-0000-4000-8000-000000000001';
select is((select count(*) from public.whatsapp_session_access), 0::bigint, 'losing leadership removes the grant');

update public.team_members
set is_leader = true
where team_id = 'f7330000-0000-4000-8000-000000000001'
  and user_id = 'f7310000-0000-4000-8000-000000000001';
insert into public.whatsapp_session_access (
  session_id, user_id, organization_id, granted_by,
  can_view, can_send, only_leads_access, access_mode, grant_scope, grant_team_id
)
values (
  'f7340000-0000-4000-8000-000000000001', 'f7310000-0000-4000-8000-000000000002',
  'f7320000-0000-4000-8000-000000000001', 'f7310000-0000-4000-8000-000000000001',
  true, true, true, 'assigned_leads_only', 'team', 'f7330000-0000-4000-8000-000000000001'
);
update public.teams
set is_active = false
where id = 'f7330000-0000-4000-8000-000000000001';
select is((select count(*) from public.whatsapp_session_access), 0::bigint, 'disabling the team removes its grants');

insert into public.whatsapp_session_access (
  session_id, user_id, organization_id, granted_by,
  can_view, can_send, only_leads_access, access_mode, grant_scope
)
values (
  'f7340000-0000-4000-8000-000000000001', 'f7310000-0000-4000-8000-000000000002',
  'f7320000-0000-4000-8000-000000000001', 'f7310000-0000-4000-8000-000000000001',
  true, true, true, 'assigned_leads_only', 'organization'
);
update public.organization_members
set role = 'user'
where organization_id = 'f7320000-0000-4000-8000-000000000001'
  and user_id = 'f7310000-0000-4000-8000-000000000001';
select is((select count(*) from public.whatsapp_session_access), 0::bigint, 'demoting the owner removes organization grants');

update public.organization_members
set role = 'admin'
where organization_id = 'f7320000-0000-4000-8000-000000000001'
  and user_id = 'f7310000-0000-4000-8000-000000000001';
insert into public.whatsapp_session_access (
  session_id, user_id, organization_id, granted_by,
  can_view, can_send, only_leads_access, access_mode, grant_scope
)
values (
  'f7340000-0000-4000-8000-000000000001', 'f7310000-0000-4000-8000-000000000002',
  'f7320000-0000-4000-8000-000000000001', 'f7310000-0000-4000-8000-000000000001',
  true, true, true, 'assigned_leads_only', 'organization'
);
update public.organization_members
set is_active = false
where organization_id = 'f7320000-0000-4000-8000-000000000001'
  and user_id = 'f7310000-0000-4000-8000-000000000002';
select is((select count(*) from public.whatsapp_session_access), 0::bigint, 'suspending the recipient removes all grants');

update public.organization_members
set is_active = true
where organization_id = 'f7320000-0000-4000-8000-000000000001'
  and user_id = 'f7310000-0000-4000-8000-000000000002';
insert into public.whatsapp_session_access (
  session_id, user_id, organization_id, granted_by,
  can_view, can_send, only_leads_access, access_mode, grant_scope
)
values (
  'f7340000-0000-4000-8000-000000000001', 'f7310000-0000-4000-8000-000000000002',
  'f7320000-0000-4000-8000-000000000001', 'f7310000-0000-4000-8000-000000000001',
  true, true, true, 'assigned_leads_only', 'organization'
);
update public.users set is_active = false where id = 'f7310000-0000-4000-8000-000000000002';
select is((select count(*) from public.whatsapp_session_access), 0::bigint, 'deactivating the recipient profile removes all grants');
update public.users set is_active = true where id = 'f7310000-0000-4000-8000-000000000002';
select is((select count(*) from public.whatsapp_session_access), 0::bigint, 'reactivating the profile does not restore the grant');

select ok(
  not has_function_privilege('authenticated', 'private.revoke_whatsapp_team_grants_on_member_change()', 'execute')
  and not has_function_privilege('authenticated', 'private.revoke_whatsapp_team_grants_on_team_change()', 'execute')
  and not has_function_privilege('authenticated', 'private.revoke_whatsapp_grants_on_org_member_change()', 'execute')
  and not has_function_privilege('authenticated', 'private.revoke_whatsapp_grants_on_user_deactivation()', 'execute'),
  'browser role cannot call revocation trigger functions'
);

select * from finish();
rollback;
