-- Run only on an isolated migrated database. Fixtures and queued notices roll back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values
  ('00000000-0000-0000-0000-000000000000', 'f7410000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'disconnect-owner@example.test', '', now(), '{}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'f7410000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'disconnect-colleague@example.test', '', now(), '{}', '{}', now(), now(), '', '', '', '');

insert into public.organizations (id, name, slug, is_active)
values ('f7420000-0000-4000-8000-000000000001', 'Disconnect Owner Test', 'disconnect-owner-test', true);
insert into public.users (id, organization_id, name, email, role, is_active)
values
  ('f7410000-0000-4000-8000-000000000001', 'f7420000-0000-4000-8000-000000000001', 'Owner', 'disconnect-owner@example.test', 'admin', true),
  ('f7410000-0000-4000-8000-000000000002', 'f7420000-0000-4000-8000-000000000001', 'Colleague', 'disconnect-colleague@example.test', 'user', true)
on conflict (id) do update set organization_id = excluded.organization_id,
  name = excluded.name, email = excluded.email, role = excluded.role, is_active = excluded.is_active;
insert into public.organization_members (organization_id, user_id, role, is_active)
values
  ('f7420000-0000-4000-8000-000000000001', 'f7410000-0000-4000-8000-000000000001', 'admin', true),
  ('f7420000-0000-4000-8000-000000000001', 'f7410000-0000-4000-8000-000000000002', 'user', true)
on conflict (user_id, organization_id) do update set role = excluded.role, is_active = excluded.is_active;

insert into public.whatsapp_sessions (id, organization_id, owner_user_id, instance_name, provider, status)
values
  ('f7430000-0000-4000-8000-000000000001', 'f7420000-0000-4000-8000-000000000001', 'f7410000-0000-4000-8000-000000000001', 'disconnect-owner-1', 'evolution_go', 'connected'),
  ('f7430000-0000-4000-8000-000000000002', 'f7420000-0000-4000-8000-000000000001', 'f7410000-0000-4000-8000-000000000001', 'disconnect-owner-2', 'evolution_go', 'connected'),
  ('f7430000-0000-4000-8000-000000000003', 'f7420000-0000-4000-8000-000000000001', 'f7410000-0000-4000-8000-000000000001', 'disconnect-owner-3', 'evolution_go', 'connected');

select is((select count(*) from public.notifications where organization_id = 'f7420000-0000-4000-8000-000000000001'),
  0::bigint, 'connecting a session does not notify');
update public.whatsapp_sessions set status = 'disconnected'
where id = 'f7430000-0000-4000-8000-000000000001';
select is((select count(*) from public.notifications where organization_id = 'f7420000-0000-4000-8000-000000000001'),
  1::bigint, 'unexpected disconnect creates one notice');
select is((select user_id::text from public.notifications where organization_id = 'f7420000-0000-4000-8000-000000000001'),
  'f7410000-0000-4000-8000-000000000001', 'only the number owner receives it');
select ok((select metadata->>'event_key' = 'whatsapp_disconnected'
                  and metadata->>'whatsapp_dispatch_required' = 'true'
           from public.notifications where organization_id = 'f7420000-0000-4000-8000-000000000001'),
  'notice requests WhatsApp delivery');

update public.whatsapp_sessions set status = 'connected'
where id = 'f7430000-0000-4000-8000-000000000001';
update public.whatsapp_sessions set status = 'disconnected'
where id = 'f7430000-0000-4000-8000-000000000001';
select is((select count(*) from public.notifications where organization_id = 'f7420000-0000-4000-8000-000000000001'),
  1::bigint, 'the same disconnect episode is deduplicated');

update public.whatsapp_sessions set status = 'connected', last_connected_at = clock_timestamp()
where id = 'f7430000-0000-4000-8000-000000000001';
update public.whatsapp_sessions set status = 'disconnected'
where id = 'f7430000-0000-4000-8000-000000000001';
select is((select count(*) from public.notifications where organization_id = 'f7420000-0000-4000-8000-000000000001'),
  2::bigint, 'a later real reconnect starts a new notification episode');

update public.whatsapp_sessions
set status = 'disconnected', advanced_settings = coalesce(advanced_settings, '{}'::jsonb) || '{"lifecycle_operation":"disconnect"}'::jsonb
where id = 'f7430000-0000-4000-8000-000000000002';
select is((select count(*) from public.notifications where organization_id = 'f7420000-0000-4000-8000-000000000001'),
  2::bigint, 'owner-initiated disconnect is silent');

update public.organization_members set is_active = false
where organization_id = 'f7420000-0000-4000-8000-000000000001'
  and user_id = 'f7410000-0000-4000-8000-000000000001';
update public.whatsapp_sessions set status = 'disconnected'
where id = 'f7430000-0000-4000-8000-000000000003';
select is((select count(*) from public.notifications where organization_id = 'f7420000-0000-4000-8000-000000000001'),
  2::bigint, 'inactive owner does not receive a new notice');

select * from finish();
rollback;
