-- Run only on an isolated database after the nonlead retention migrations.
-- All fixtures and claims roll back; this never calls the Storage API.
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

select ok(private.whatsapp_media_url_could_reference_path(
  'https://storage.example.test/storage/v1/object/public/whatsapp-media/orgs/f7020000-0000-4000-8000-000000000001/assets/v2/a.jpg',
  'orgs/f7020000-0000-4000-8000-000000000001/assets/v2/a.jpg'
), 'URL for the same object is a reference');
select is(private.whatsapp_media_url_could_reference_path(
  'https://storage.example.test/storage/v1/object/public/whatsapp-media/orgs/f7020000-0000-4000-8000-000000000001/assets/v2/other.jpg',
  'orgs/f7020000-0000-4000-8000-000000000001/assets/v2/a.jpg'
), false, 'URL for a different object does not hold deletion');
select ok(private.whatsapp_media_url_could_reference_path(
  'https://storage.example.test/storage/v1/object/public/whatsapp-media/orgs/f7020000-0000-4000-8000-000000000001/assets/v2/a%20b.jpg',
  'orgs/f7020000-0000-4000-8000-000000000001/assets/v2/a.jpg'
), 'ambiguous percent encoding holds deletion');
select is(private.whatsapp_media_url_could_reference_path(
  'https://other.example.test/photo.jpg',
  'orgs/f7020000-0000-4000-8000-000000000001/assets/v2/a.jpg'
), false, 'external URL is unrelated');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  'f7010000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'nonlead-media-gc-test@example.test', '', now(), '{}', '{}', now(), now(),
  '', '', '', ''
);
insert into public.organizations (id, name, slug, is_active)
values ('f7020000-0000-4000-8000-000000000001',
        'Nonlead media GC SQL test', 'nonlead-media-gc-sql-test', true);
update public.users
set organization_id = 'f7020000-0000-4000-8000-000000000001',
    name = 'Nonlead media GC Tester', role = 'admin', is_active = true
where id = 'f7010000-0000-4000-8000-000000000001';
insert into public.whatsapp_sessions (
  id, organization_id, owner_user_id, instance_name, provider, status, is_active
) values (
  'f7030000-0000-4000-8000-000000000001',
  'f7020000-0000-4000-8000-000000000001',
  'f7010000-0000-4000-8000-000000000001',
  'nonlead-media-gc-test-session', 'evolution_go', 'connected', true
);
insert into public.whatsapp_conversations (
  id, organization_id, session_id, lead_id, remote_jid, contact_phone,
  contact_picture
) values (
  'f7040000-0000-4000-8000-000000000001',
  'f7020000-0000-4000-8000-000000000001',
  'f7030000-0000-4000-8000-000000000001', null,
  '5511999000011@s.whatsapp.net', '5511999000011',
  'https://storage.example.test/storage/v1/object/public/whatsapp-media/orgs/f7020000-0000-4000-8000-000000000001/assets/v2/other.jpg'
);

insert into private.whatsapp_nonlead_media_delete_outbox (
  id, organization_id, conversation_id, bucket_id, storage_path,
  created_at, next_attempt_at
) values
  ('f7050000-0000-4000-8000-000000000001',
   'f7020000-0000-4000-8000-000000000001',
   'f7040000-0000-4000-8000-000000000002',
   'whatsapp-media', 'unscoped/invalid.jpg',
   now() - interval '2 minutes', now() - interval '2 minutes'),
  ('f7050000-0000-4000-8000-000000000004',
   'f7020000-0000-4000-8000-000000000001',
   'f7040000-0000-4000-8000-000000000005',
   'whatsapp-media',
   'orgs/f7020000-0000-4000-8000-000000000001/sessions/not-a-uuid/incoming/invalid.jpg',
   now() - interval '105 seconds', now() - interval '105 seconds'),
  ('f7050000-0000-4000-8000-000000000003',
   'f7020000-0000-4000-8000-000000000001',
   'f7040000-0000-4000-8000-000000000004',
   'whatsapp-media',
   'orgs/f7020000-0000-4000-8000-000000000001/assets/v2/other.jpg',
   now() - interval '90 seconds', now() - interval '90 seconds'),
  ('f7050000-0000-4000-8000-000000000002',
   'f7020000-0000-4000-8000-000000000001',
   'f7040000-0000-4000-8000-000000000003',
   'whatsapp-media',
   'orgs/f7020000-0000-4000-8000-000000000001/assets/v2/a.jpg',
   now() - interval '1 minute', now() - interval '1 minute');

select is((
  select claimed.id::text
  from private.claim_whatsapp_nonlead_media_delete('nonlead-media-gc-test') as claimed
), 'f7050000-0000-4000-8000-000000000002',
  'one invalid ticket cannot block the next deletable object');
select is((
  select status from private.whatsapp_nonlead_media_delete_outbox
  where id = 'f7050000-0000-4000-8000-000000000001'
), 'dead', 'invalid path was safely isolated');
select is((
  select status from private.whatsapp_nonlead_media_delete_outbox
  where id = 'f7050000-0000-4000-8000-000000000004'
), 'dead', 'noncanonical same-organization session path was safely isolated');
select is((
  select status from private.whatsapp_nonlead_media_delete_outbox
  where id = 'f7050000-0000-4000-8000-000000000003'
), 'held_shared', 'surviving URL holds only its own object');
select throws_ok($$
  update public.whatsapp_conversations
  set contact_picture =
    'https://storage.example.test/storage/v1/object/public/whatsapp-media/orgs/f7020000-0000-4000-8000-000000000001/assets/v2/a.jpg'
  where id = 'f7040000-0000-4000-8000-000000000001'
$$, '55000', 'whatsapp_media_path_delete_in_progress',
  'legacy URL cannot attach to an object reserved for deletion');
select lives_ok($$
  update public.whatsapp_conversations
  set contact_picture =
    'https://storage.example.test/storage/v1/object/public/whatsapp-media/orgs/f7020000-0000-4000-8000-000000000001/assets/v2/other2.jpg'
  where id = 'f7040000-0000-4000-8000-000000000001'
$$, 'different object remains attachable');
select throws_ok($$
  insert into private.whatsapp_media_repair_source_paths (
    organization_id, session_id, conversation_id, storage_path
  ) values (
    'f7020000-0000-4000-8000-000000000001',
    'f7030000-0000-4000-8000-000000000001',
    'f7040000-0000-4000-8000-000000000001',
    'orgs/f7020000-0000-4000-8000-000000000001/assets/v2/a.jpg'
  )
$$, '55000', 'whatsapp_media_path_delete_in_progress',
  'repair provenance cannot attach to an object reserved for deletion');
select lives_ok($$
  insert into private.whatsapp_media_repair_source_paths (
    organization_id, session_id, conversation_id, storage_path
  ) values (
    'f7020000-0000-4000-8000-000000000001',
    'f7030000-0000-4000-8000-000000000002',
    'f7040000-0000-4000-8000-000000000001',
    'orgs/f7020000-0000-4000-8000-000000000001/sessions/f7030000-0000-4000-8000-000000000001/incoming/old.jpg'
  )
$$, 'same-organization repair provenance may hold another session incoming object');
select throws_ok($$
  insert into private.whatsapp_media_repair_source_paths (
    organization_id, session_id, conversation_id, storage_path
  ) values (
    'f7020000-0000-4000-8000-000000000001',
    'f7030000-0000-4000-8000-000000000001',
    'f7040000-0000-4000-8000-000000000001',
    'orgs/f7020000-0000-4000-8000-000000000002/sessions/f7030000-0000-4000-8000-000000000001/incoming/foreign.jpg'
  )
$$, '23514', null,
  'repair provenance cannot claim another organization incoming object');
select ok((
  select private.finish_whatsapp_nonlead_media_delete(
    item.id, item.lease_token, 'not_started'
  ) from private.whatsapp_nonlead_media_delete_outbox as item
  where item.id = 'f7050000-0000-4000-8000-000000000002'
), 'not-started delete releases its reservation');
select is((
  select count(*)::integer from private.whatsapp_media_path_operations
  where storage_path =
    'orgs/f7020000-0000-4000-8000-000000000001/assets/v2/a.jpg'
), 0, 'released reservation leaves no path operation');
select * from finish();
rollback;
