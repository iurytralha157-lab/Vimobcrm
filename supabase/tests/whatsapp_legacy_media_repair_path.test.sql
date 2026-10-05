-- Run only on an isolated database after the preparation and both cutovers.
-- All fixture rows and path edits roll back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  'f8110000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'media-legacy-repair@example.test', '', now(), '{}', '{}', now(), now(),
  '', '', '', ''
);
insert into public.organizations (id, name, slug, is_active)
values ('f8120000-0000-4000-8000-000000000001',
        'Media legacy repair SQL test', 'media-legacy-repair-sql-test', true);
update public.users
set organization_id = 'f8120000-0000-4000-8000-000000000001',
    name = 'Media Legacy Tester', role = 'admin', is_active = true
where id = 'f8110000-0000-4000-8000-000000000001';
insert into public.whatsapp_sessions (
  id, organization_id, owner_user_id, instance_name, provider, status, is_active
) values (
  'f8130000-0000-4000-8000-000000000001',
  'f8120000-0000-4000-8000-000000000001',
  'f8110000-0000-4000-8000-000000000001',
  'media-legacy-repair-test', 'evolution_go', 'connected', true
);
insert into public.whatsapp_conversations (
  id, organization_id, session_id, remote_jid, contact_phone
) values (
  'f8140000-0000-4000-8000-000000000001',
  'f8120000-0000-4000-8000-000000000001',
  'f8130000-0000-4000-8000-000000000001',
  '5511999000088@s.whatsapp.net', '5511999000088'
);
insert into public.whatsapp_messages (
  id, organization_id, conversation_id, session_id,
  provider_message_id, message_id, direction, from_me,
  message_type, media_status, status, sent_at
) values (
  'f8150000-0000-4000-8000-000000000001',
  'f8120000-0000-4000-8000-000000000001',
  'f8140000-0000-4000-8000-000000000001',
  'f8130000-0000-4000-8000-000000000001',
  'legacy-repair-sql-message', 'legacy-repair-sql-message',
  'inbound', false, 'image', 'pending', 'received', now()
);
insert into public.media_jobs (
  id, organization_id, session_id, conversation_id, message_id,
  provider_message_id, message_key, media_type, media_mime_type,
  status, attempts, max_attempts, next_retry_at, dedupe_key, asset_key
) values (
  'f8160000-0000-4000-8000-000000000001',
  'f8120000-0000-4000-8000-000000000001',
  'f8130000-0000-4000-8000-000000000001',
  'f8140000-0000-4000-8000-000000000001',
  'f8150000-0000-4000-8000-000000000001',
  'legacy-repair-sql-message', '{}'::jsonb, 'image', 'image/png',
  'pending', 0, 3, now(), repeat('a', 64), repeat('b', 64)
);

select lives_ok($$
  update public.media_jobs
  set message_key = jsonb_build_object('repair_storage_path',
    'orgs/f8120000-0000-4000-8000-000000000001/sessions/f8130000-0000-4000-8000-000000000001/incoming/legacy-repair.png')
  where id = 'f8160000-0000-4000-8000-000000000001'
$$, 'same-organization same-session legacy incoming repair is allowed');
select lives_ok($$
  update public.media_jobs
  set message_key = jsonb_build_object('repair_storage_path',
    'orgs/f8120000-0000-4000-8000-000000000001/assets/v2/legacy-repair.png')
  where id = 'f8160000-0000-4000-8000-000000000001'
$$, 'canonical v2 repair remains allowed');
select lives_ok($$
  update public.media_jobs
  set message_key = jsonb_build_object('repair_storage_path',
    'orgs/f8120000-0000-4000-8000-000000000001/sessions/f8130000-0000-4000-8000-000000000002/incoming/legacy-repair.png')
  where id = 'f8160000-0000-4000-8000-000000000001'
$$, 'another session in the same organization is allowed for a shared source');
select throws_ok($$
  update public.media_jobs
  set message_key = jsonb_build_object('repair_storage_path',
    'orgs/f8120000-0000-4000-8000-000000000002/sessions/f8130000-0000-4000-8000-000000000001/incoming/legacy-repair.png')
  where id = 'f8160000-0000-4000-8000-000000000001'
$$, '23514', null, 'another organization is rejected');
select throws_ok($$
  update public.media_jobs
  set message_key = jsonb_build_object('repair_storage_path',
    'orgs/f8120000-0000-4000-8000-000000000001/sessions/f8130000-0000-4000-8000-000000000001/incoming/../legacy-repair.png')
  where id = 'f8160000-0000-4000-8000-000000000001'
$$, '23514', null, 'path traversal is rejected');
select throws_ok($$
  update public.media_jobs
  set message_key = jsonb_build_object('repair_storage_path',
    'orgs/f8120000-0000-4000-8000-000000000001/sessions/f8130000-0000-4000-8000-000000000001/incoming/')
  where id = 'f8160000-0000-4000-8000-000000000001'
$$, '23514', null, 'legacy incoming path requires an object name');
select throws_ok($$
  update public.media_jobs
  set message_key = jsonb_build_object('repair_storage_path',
    'orgs/f8120000-0000-4000-8000-000000000001/sessions/f8130000-0000-4000-8000-000000000001/incoming/nested/legacy-repair.png')
  where id = 'f8160000-0000-4000-8000-000000000001'
$$, '23514', null, 'legacy incoming path cannot reach nested objects');
select lives_ok($$
  update public.media_jobs
  set message_key = jsonb_build_object(
    'upload_intent_path',
    'orgs/f8120000-0000-4000-8000-000000000001/assets/v2/legacy-repair.png',
    'upload_intent_content_type', 'image/png', 'upload_intent_size', 12)
  where id = 'f8160000-0000-4000-8000-000000000001'
$$, 'upload intent still accepts the v2 namespace');
select throws_ok($$
  update public.media_jobs
  set message_key = jsonb_build_object(
    'upload_intent_path',
    'orgs/f8120000-0000-4000-8000-000000000001/sessions/f8130000-0000-4000-8000-000000000001/incoming/legacy-repair.png',
    'upload_intent_content_type', 'image/png', 'upload_intent_size', 12)
  where id = 'f8160000-0000-4000-8000-000000000001'
$$, '23514', null, 'upload intent remains restricted to v2');

select * from finish();
rollback;
