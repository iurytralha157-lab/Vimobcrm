begin;

create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  ('00000000-0000-0000-0000-000000000000', 'd1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'notification-user@example.test', crypt('test-password', gen_salt('bf', 4)), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'd1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'notification-admin@example.test', crypt('test-password', gen_salt('bf', 4)), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');

insert into public.organizations (id, name, slug, is_active)
values (
  'd2000000-0000-4000-8000-000000000001',
  'WhatsApp Notification Guard Test',
  'whatsapp-notification-guard-test',
  true
);

insert into public.users (id, organization_id, name, email, role, is_active)
values
  ('d1000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'Notification User', 'notification-user@example.test', 'user', true),
  ('d1000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000001', 'Notification Admin', 'notification-admin@example.test', 'admin', true)
on conflict (id) do update
set organization_id = excluded.organization_id,
    name = excluded.name,
    email = excluded.email,
    role = excluded.role,
    is_active = excluded.is_active;

insert into public.organization_members (organization_id, user_id, role, is_active)
values
  ('d2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'user', true),
  ('d2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002', 'admin', true)
on conflict (user_id, organization_id) do update
set role = excluded.role,
    is_active = excluded.is_active;

insert into public.whatsapp_sessions (
  id, organization_id, owner_user_id, instance_name, provider, status, is_active
)
values
  ('d3000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'notification-user-session', 'evolution_go', 'connected', true),
  ('d3000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002', 'notification-admin-session', 'evolution_go', 'connected', true);

select has_index(
  'public',
  'whatsapp_sessions',
  'whatsapp_sessions_one_notification_sender_per_org_idx',
  'notification sender uniqueness guard exists'
);

select ok(
  (
    select i.indisunique
       and pg_get_expr(i.indpred, i.indrelid) = '(is_notification_session = true)'
    from pg_index i
    join pg_class idx on idx.oid = i.indexrelid
    join pg_class tbl on tbl.oid = i.indrelid
    join pg_namespace ns on ns.oid = tbl.relnamespace
    where ns.nspname = 'public'
      and tbl.relname = 'whatsapp_sessions'
      and idx.relname = 'whatsapp_sessions_one_notification_sender_per_org_idx'
  ),
  'guard is unique and applies only to flagged notification sessions'
);

select has_function(
  'private',
  'is_whatsapp_notification_admin',
  array['uuid', 'uuid'],
  'notification sender admin helper exists'
);

select has_trigger(
  'public',
  'whatsapp_sessions',
  'tr_authorize_whatsapp_notification_sender',
  'notification sender activation guard exists'
);

select has_trigger(
  'public',
  'organization_members',
  'tr_clear_whatsapp_notification_sender_after_admin_loss',
  'admin loss cleanup guard exists'
);

select throws_ok(
  $$update public.whatsapp_sessions
    set is_notification_session = true
    where id = 'd3000000-0000-4000-8000-000000000001'::uuid$$,
  '42501',
  'Only organization administrators can configure a WhatsApp notification sender.',
  'ordinary user session cannot become the notification sender'
);

select lives_ok(
  $$update public.whatsapp_sessions
    set is_notification_session = true
    where id = 'd3000000-0000-4000-8000-000000000002'::uuid$$,
  'admin session can become the notification sender'
);

select is(
  (
    select is_notification_session
    from public.whatsapp_sessions
    where id = 'd3000000-0000-4000-8000-000000000002'::uuid
  ),
  true,
  'admin session remains selected'
);

update public.organization_members
set role = 'user'
where organization_id = 'd2000000-0000-4000-8000-000000000001'::uuid
  and user_id = 'd1000000-0000-4000-8000-000000000002'::uuid;

select is(
  (
    select is_notification_session
    from public.whatsapp_sessions
    where id = 'd3000000-0000-4000-8000-000000000002'::uuid
  ),
  false,
  'notification sender is cleared when its owner loses admin access'
);

select * from finish();
rollback;
