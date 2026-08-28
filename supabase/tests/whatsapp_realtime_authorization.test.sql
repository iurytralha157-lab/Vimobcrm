begin;

create extension if not exists pgtap with schema extensions;
select plan(18);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  ('00000000-0000-0000-0000-000000000000', 'd1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'realtime-broker@example.test', crypt('test-password', gen_salt('bf', 4)), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'd1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'realtime-admin@example.test', crypt('test-password', gen_salt('bf', 4)), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'd1000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'realtime-cross@example.test', crypt('test-password', gen_salt('bf', 4)), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');

insert into public.organizations (id, name, slug, is_active)
values
  ('d2000000-0000-4000-8000-000000000001', 'Realtime Auth Org A', 'realtime-auth-org-a', true),
  ('d2000000-0000-4000-8000-000000000002', 'Realtime Auth Org B', 'realtime-auth-org-b', true);

insert into public.users (id, organization_id, name, email, role, is_active)
values
  ('d1000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'Realtime Broker', 'realtime-broker@example.test', 'user', true),
  ('d1000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000001', 'Realtime Admin', 'realtime-admin@example.test', 'admin', true),
  ('d1000000-0000-4000-8000-000000000003', 'd2000000-0000-4000-8000-000000000002', 'Realtime Cross', 'realtime-cross@example.test', 'user', true)
on conflict (id) do update
set organization_id = excluded.organization_id,
    name = excluded.name,
    email = excluded.email,
    role = excluded.role,
    is_active = excluded.is_active;

insert into public.organization_members (organization_id, user_id, role, is_active)
values
  ('d2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'user', true),
  ('d2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002', 'admin', true),
  ('d2000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000003', 'user', true)
on conflict (user_id, organization_id) do update
set role = excluded.role,
    is_active = excluded.is_active;

insert into public.leads (id, organization_id, assigned_user_id, name, source)
values
  ('d3000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'Realtime Lead A', 'manual'),
  ('d3000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000003', 'Realtime Lead B', 'manual');

select ok(
  not private.can_receive_whatsapp_broadcast('whatsapp:d2000000-0000-4000-8000-000000000001:inbox'),
  'anonymous callers cannot subscribe'
);
select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'realtime'
      and tablename = 'messages'
      and policyname = 'whatsapp_authorized_private_broadcast'
      and qual ilike '%can_receive_whatsapp_broadcast%'
  ),
  'Realtime RLS delegates to the canonical topic helper'
);
select ok(
  has_function_privilege('authenticated', 'private.can_receive_whatsapp_broadcast(text)', 'execute'),
  'authenticated can execute the topic authorization helper'
);
select ok(
  not has_function_privilege('authenticated', 'private.has_effective_whatsapp_view(uuid)', 'execute'),
  'the effective permission helper is not directly exposed'
);
select ok(
  pg_get_functiondef('private.has_effective_whatsapp_view(uuid)'::regprocedure)
    ilike '%in (''owner'', ''admin'')%',
  'owner and admin roles bypass per-user permission denials like the backend resolver'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);

select ok(
  private.can_receive_whatsapp_broadcast('whatsapp:d2000000-0000-4000-8000-000000000001:inbox'),
  'default WhatsApp module behavior remains enabled when no explicit row exists'
);
select ok(
  private.can_receive_whatsapp_broadcast('whatsapp:d2000000-0000-4000-8000-000000000001:lead:d3000000-0000-4000-8000-000000000001'),
  'assigned broker can receive its authorized lead topic'
);
select ok(
  not private.can_receive_whatsapp_broadcast('whatsapp:d2000000-0000-4000-8000-000000000001:lead:not-a-uuid'),
  'malformed lead topics fail closed'
);
select ok(
  not private.can_receive_whatsapp_broadcast('whatsapp:d2000000-0000-4000-8000-000000000002:inbox'),
  'a broker cannot subscribe across organizations'
);

reset role;
insert into public.organization_modules (organization_id, module_name, is_enabled)
values ('d2000000-0000-4000-8000-000000000001', 'whatsapp', false)
on conflict (organization_id, module_name) do update set is_enabled = excluded.is_enabled;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);
select ok(
  (
    select is_enabled
    from public.organization_modules
    where organization_id = 'd2000000-0000-4000-8000-000000000001'
      and module_name = 'whatsapp'
  )
  and private.can_receive_whatsapp_broadcast('whatsapp:d2000000-0000-4000-8000-000000000001:inbox'),
  'mandatory WhatsApp remains enabled and preserves authorized Realtime access'
);

reset role;
update public.organization_modules
set is_enabled = true
where organization_id = 'd2000000-0000-4000-8000-000000000001'
  and module_name = 'whatsapp';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);
select ok(
  private.can_receive_whatsapp_broadcast('whatsapp:d2000000-0000-4000-8000-000000000001:inbox'),
  'an enabled WhatsApp module allows a permitted member'
);

reset role;
insert into public.user_permission_overrides (
  organization_id, user_id, permission_key, allowed
)
values
  ('d2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'whatsapp_view', false),
  ('d2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'whatsapp_operate', false),
  ('d2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'whatsapp_manage', false),
  ('d2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002', 'whatsapp_view', false),
  ('d2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002', 'whatsapp_operate', false),
  ('d2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002', 'whatsapp_manage', false)
on conflict (organization_id, user_id, permission_key) do update
set allowed = excluded.allowed;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);
select ok(
  not private.can_receive_whatsapp_broadcast('whatsapp:d2000000-0000-4000-8000-000000000001:inbox'),
  'explicit denial of the effective WhatsApp permission set denies Realtime'
);

reset role;
update public.user_permission_overrides
set allowed = true
where organization_id = 'd2000000-0000-4000-8000-000000000001'
  and user_id = 'd1000000-0000-4000-8000-000000000001'
  and permission_key = 'whatsapp_manage';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);
select ok(
  private.can_receive_whatsapp_broadcast('whatsapp:d2000000-0000-4000-8000-000000000001:inbox'),
  'whatsapp_manage implies whatsapp_view like the backend permission resolver'
);

select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000002', true);
select ok(
  private.can_receive_whatsapp_broadcast('whatsapp:d2000000-0000-4000-8000-000000000001:inbox'),
  'organization admins retain effective WhatsApp view permission'
);

select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000003', true);
select ok(
  not private.can_receive_whatsapp_broadcast('whatsapp:d2000000-0000-4000-8000-000000000001:inbox'),
  'cross-organization members cannot use another organization topic'
);
select ok(
  private.can_receive_whatsapp_broadcast('whatsapp:d2000000-0000-4000-8000-000000000002:inbox'),
  'cross-organization fixture can use only its own inbox'
);
select ok(
  not private.can_receive_whatsapp_broadcast('whatsapp:d2000000-0000-4000-8000-000000000001:lead:d3000000-0000-4000-8000-000000000001'),
  'cross-organization members cannot use another organization lead topic'
);

reset role;
update public.organization_modules
set is_enabled = false
where organization_id = 'd2000000-0000-4000-8000-000000000001'
  and module_name = 'whatsapp';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000002', true);
select ok(
  (
    select is_enabled
    from public.organization_modules
    where organization_id = 'd2000000-0000-4000-8000-000000000001'
      and module_name = 'whatsapp'
  )
  and private.can_receive_whatsapp_broadcast('whatsapp:d2000000-0000-4000-8000-000000000001:inbox'),
  'mandatory WhatsApp cannot be disabled for organization admins'
);

reset role;
select * from finish();
rollback;
