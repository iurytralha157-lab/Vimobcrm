begin;

create extension if not exists pgtap with schema extensions;
select plan(6);

select ok(
  not has_table_privilege('anon', 'public.audit_logs', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    and not has_any_column_privilege('anon', 'public.audit_logs', 'SELECT,INSERT,UPDATE,REFERENCES'),
  'anonymous clients have no direct audit log table privileges'
);

select ok(
  not has_table_privilege('authenticated', 'public.audit_logs', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    and not has_any_column_privilege('authenticated', 'public.audit_logs', 'SELECT,INSERT,UPDATE,REFERENCES'),
  'authenticated clients have no direct audit log table privileges'
);

select ok(
  has_table_privilege('service_role', 'public.audit_logs', 'SELECT')
    and has_table_privilege('service_role', 'public.audit_logs', 'INSERT'),
  'server-side service role keeps audit log read and write privileges'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values (
  '00000000-0000-0000-0000-000000000000',
  '91500000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated', 'audit-feed@example.test',
  crypt('test-password', gen_salt('bf', 4)), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now(), '', '', '', ''
);

insert into public.organizations (id, name, slug, is_active)
values ('92500000-0000-0000-0000-000000000001', 'Audit Feed Test', 'audit-feed-test', true);

insert into public.users (id, organization_id, name, email, role, is_active)
values (
  '91500000-0000-0000-0000-000000000001',
  '92500000-0000-0000-0000-000000000001',
  'Audit Feed User', 'audit-feed@example.test', 'admin', true
)
on conflict (id) do update
set organization_id = excluded.organization_id,
    name = excluded.name,
    email = excluded.email,
    role = excluded.role,
    is_active = excluded.is_active;

insert into public.organization_members (organization_id, user_id, role, is_active)
values (
  '92500000-0000-0000-0000-000000000001',
  '91500000-0000-0000-0000-000000000001', 'admin', true
)
on conflict (user_id, organization_id) do update
set role = excluded.role,
    is_active = excluded.is_active;

insert into auth.sessions (id, user_id)
values (
  '93500000-0000-0000-0000-000000000001',
  '91500000-0000-0000-0000-000000000001'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '91500000-0000-0000-0000-000000000001', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"91500000-0000-0000-0000-000000000001","role":"authenticated","session_id":"93500000-0000-0000-0000-000000000001"}',
  true
);

select ok(
  private.can_receive_audit_broadcast('audit:92500000-0000-0000-0000-000000000001:feed'),
  'active admin session can join its organization audit feed'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"91500000-0000-0000-0000-000000000001","role":"authenticated","session_id":"93500000-0000-0000-0000-000000000002"}',
  true
);

select ok(
  not private.can_receive_audit_broadcast('audit:92500000-0000-0000-0000-000000000001:feed'),
  'a missing Auth session cannot join the audit feed'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"91500000-0000-0000-0000-000000000001","role":"authenticated","session_id":"93500000-0000-0000-0000-000000000001"}',
  true
);

select ok(
  not private.can_receive_audit_broadcast('audit:92500000-0000-0000-0000-000000000002:feed'),
  'an active admin session cannot join another organization audit feed'
);

select * from finish();
rollback;
