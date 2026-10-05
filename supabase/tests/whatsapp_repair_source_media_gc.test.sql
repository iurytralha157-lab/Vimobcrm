-- Isolated pgTAP proof: a repaired lead keeps its new media, while displaced
-- Storage paths become durable delete tickets. No Storage HTTP call is made.
begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  'fb010000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'whatsapp-repair-gc@example.test', '', now(), '{}', '{}', now(), now(),
  '', '', '', ''
);
insert into public.organizations (id, name, slug, is_active)
values ('fb020000-0000-4000-8000-000000000001',
        'WhatsApp repair GC SQL test', 'whatsapp-repair-gc-sql-test', true);
update public.users
set organization_id = 'fb020000-0000-4000-8000-000000000001',
    name = 'Repair GC Tester', role = 'admin', is_active = true
where id = 'fb010000-0000-4000-8000-000000000001';
insert into public.whatsapp_sessions (
  id, organization_id, owner_user_id, instance_name, provider, status, is_active
) values (
  'fb030000-0000-4000-8000-000000000001',
  'fb020000-0000-4000-8000-000000000001',
  'fb010000-0000-4000-8000-000000000001',
  'repair-gc-sql-test-session', 'evolution_go', 'connected', true
);
insert into public.leads (id, organization_id, name)
values
  ('fb060000-0000-4000-8000-000000000001',
   'fb020000-0000-4000-8000-000000000001', 'Repaired lead A'),
  ('fb060000-0000-4000-8000-000000000002',
   'fb020000-0000-4000-8000-000000000001', 'Repaired lead B'),
  ('fb060000-0000-4000-8000-000000000003',
   'fb020000-0000-4000-8000-000000000001', 'Live shared asset C');
insert into public.whatsapp_conversations (
  id, organization_id, session_id, lead_id, remote_jid, contact_phone
) values
  ('fb040000-0000-4000-8000-000000000001',
   'fb020000-0000-4000-8000-000000000001',
   'fb030000-0000-4000-8000-000000000001',
   'fb060000-0000-4000-8000-000000000001',
   '5511999000101@s.whatsapp.net', '5511999000101'),
  ('fb040000-0000-4000-8000-000000000002',
   'fb020000-0000-4000-8000-000000000001',
   'fb030000-0000-4000-8000-000000000001',
   'fb060000-0000-4000-8000-000000000002',
   '5511999000102@s.whatsapp.net', '5511999000102'),
  ('fb040000-0000-4000-8000-000000000003',
   'fb020000-0000-4000-8000-000000000001',
   'fb030000-0000-4000-8000-000000000001',
   'fb060000-0000-4000-8000-000000000003',
   '5511999000103@s.whatsapp.net', '5511999000103');
insert into public.whatsapp_messages (
  id, organization_id, conversation_id, session_id, provider_message_id,
  message_id, from_me, direction, message_type, media_mime_type,
  media_status, media_storage_path, media_size, metadata, status, sent_at
) values
  ('fb070000-0000-4000-8000-000000000001',
   'fb020000-0000-4000-8000-000000000001',
   'fb040000-0000-4000-8000-000000000001',
   'fb030000-0000-4000-8000-000000000001',
   'repair-gc-message-a', 'repair-gc-message-a', false, 'inbound',
   'image', 'image/png', 'ready',
   'orgs/fb020000-0000-4000-8000-000000000001/assets/v2/new-a.png',
   101, '{}'::jsonb, 'received', now()),
  ('fb070000-0000-4000-8000-000000000002',
   'fb020000-0000-4000-8000-000000000001',
   'fb040000-0000-4000-8000-000000000002',
   'fb030000-0000-4000-8000-000000000001',
   'repair-gc-message-b', 'repair-gc-message-b', false, 'inbound',
   'image', 'image/png', 'ready',
   'orgs/fb020000-0000-4000-8000-000000000001/assets/v2/new-b.png',
   102, '{}'::jsonb, 'received', now()),
  ('fb070000-0000-4000-8000-000000000003',
   'fb020000-0000-4000-8000-000000000001',
   'fb040000-0000-4000-8000-000000000003',
   'fb030000-0000-4000-8000-000000000001',
   'repair-gc-message-c', 'repair-gc-message-c', false, 'inbound',
   'image', 'image/png', 'ready',
   'orgs/fb020000-0000-4000-8000-000000000001/assets/v2/live-old.png',
   103, '{}'::jsonb, 'received', now());
insert into public.media_jobs (
  id, organization_id, session_id, conversation_id, message_id,
  provider_message_id, message_key, media_type, media_mime_type,
  status, attempts, max_attempts, next_retry_at, dedupe_key, asset_key,
  declared_size, storage_path, actual_size, completed_at
) values
  ('fb080000-0000-4000-8000-000000000001',
   'fb020000-0000-4000-8000-000000000001',
   'fb030000-0000-4000-8000-000000000001',
   'fb040000-0000-4000-8000-000000000001',
   'fb070000-0000-4000-8000-000000000001',
   'repair-gc-message-a', '{}'::jsonb, 'image', 'image/png',
   'completed', 1, 3, now(), 'repair-gc-a', 'repair-gc-asset-a', 101,
   'orgs/fb020000-0000-4000-8000-000000000001/assets/v2/new-a.png',
   101, now()),
  ('fb080000-0000-4000-8000-000000000002',
   'fb020000-0000-4000-8000-000000000001',
   'fb030000-0000-4000-8000-000000000001',
   'fb040000-0000-4000-8000-000000000002',
   'fb070000-0000-4000-8000-000000000002',
   'repair-gc-message-b', '{}'::jsonb, 'image', 'image/png',
   'completed', 1, 3, now(), 'repair-gc-b', 'repair-gc-asset-b', 102,
   'orgs/fb020000-0000-4000-8000-000000000001/assets/v2/new-b.png',
   102, now());
insert into private.whatsapp_media_repair_source_paths (
  organization_id, session_id, conversation_id, storage_path
) values
  ('fb020000-0000-4000-8000-000000000001',
   'fb030000-0000-4000-8000-000000000001',
   'fb040000-0000-4000-8000-000000000001',
   'orgs/fb020000-0000-4000-8000-000000000001/assets/v2/shared-old.png'),
  ('fb020000-0000-4000-8000-000000000001',
   'fb030000-0000-4000-8000-000000000001',
   'fb040000-0000-4000-8000-000000000001',
   'orgs/fb020000-0000-4000-8000-000000000001/assets/v2/exclusive-old.png'),
  ('fb020000-0000-4000-8000-000000000001',
   'fb030000-0000-4000-8000-000000000001',
   'fb040000-0000-4000-8000-000000000002',
   'orgs/fb020000-0000-4000-8000-000000000001/assets/v2/shared-old.png');

select is(private.stage_whatsapp_repair_source_media_delete(
  'fb020000-0000-4000-8000-000000000001',
  array['fb080000-0000-4000-8000-000000000001'::uuid],
  array[
    'orgs/fb020000-0000-4000-8000-000000000001/assets/v2/shared-old.png',
    'orgs/fb020000-0000-4000-8000-000000000001/assets/v2/exclusive-old.png'
  ],
  'orgs/fb020000-0000-4000-8000-000000000001/assets/v2/new-a.png'
), 2, 'two distinct paths displaced by one repaired lead are staged');
select is((select count(*)::integer from private.whatsapp_media_repair_source_paths
           where conversation_id = 'fb040000-0000-4000-8000-000000000001'),
          0, 'its old ledgers were atomically converted into tickets');
select is((select count(*)::integer from private.whatsapp_media_repair_source_paths
           where conversation_id = 'fb040000-0000-4000-8000-000000000002'),
          1, 'another lead ledger remains a reference');
select is((select count(*)::integer from private.whatsapp_nonlead_media_delete_outbox
           where conversation_id = 'fb040000-0000-4000-8000-000000000001'
             and status = 'pending'),
          2, 'both displaced objects have durable tickets');
select is((select count(*)::integer from private.whatsapp_nonlead_media_delete_outbox
           where conversation_id = 'fb040000-0000-4000-8000-000000000002'),
          0, 'no ticket is created for an unrelated lead');
select throws_ok($$
  select private.stage_whatsapp_repair_source_media_delete(
    'fb020000-0000-4000-8000-000000000001',
    array['fb080000-0000-4000-8000-000000000002'::uuid],
    array['orgs/fb020000-0000-4000-8000-000000000001/assets/v2/shared-old.png'],
    'orgs/fb020000-0000-4000-8000-000000000001/assets/v2/wrong-new.png'
  )
$$, '55000', 'whatsapp_repair_source_gc_completion_unproven',
  'an unconfirmed replacement cannot stage Storage deletion');

update private.whatsapp_nonlead_media_delete_outbox
set created_at = now() - interval '2 minutes',
    next_attempt_at = now() - interval '2 minutes'
where conversation_id = 'fb040000-0000-4000-8000-000000000001'
  and storage_path like '%/shared-old.png';
update private.whatsapp_nonlead_media_delete_outbox
set created_at = now() - interval '1 minute',
    next_attempt_at = now() - interval '1 minute'
where conversation_id = 'fb040000-0000-4000-8000-000000000001'
  and storage_path like '%/exclusive-old.png';
create temporary table repair_gc_first_claim as
select * from private.claim_whatsapp_nonlead_media_delete('repair-gc-test');
select is((select storage_path from repair_gc_first_claim),
  'orgs/fb020000-0000-4000-8000-000000000001/assets/v2/exclusive-old.png',
  'claim skips shared ledger and selects only unreferenced old asset');
select is((select status from private.whatsapp_nonlead_media_delete_outbox
           where storage_path like '%/shared-old.png'),
          'held_shared', 'ticket stays visible while another ledger exists');
select ok((select private.mark_whatsapp_nonlead_media_delete_started(
  id, lease_token) from repair_gc_first_claim),
  'an unreferenced source may enter the external Storage stage');
select ok((select private.finish_whatsapp_nonlead_media_delete(
  id, lease_token, 'confirmed_deleted') from repair_gc_first_claim),
  'confirmed Storage deletion settles the exclusive path');
select is((select count(*)::integer from private.whatsapp_nonlead_media_delete_outbox
           where storage_path like '%/exclusive-old.png'),
          0, 'exclusive ticket is removed after confirmed delete');

select is(private.stage_whatsapp_repair_source_media_delete(
  'fb020000-0000-4000-8000-000000000001',
  array['fb080000-0000-4000-8000-000000000002'::uuid],
  array['orgs/fb020000-0000-4000-8000-000000000001/assets/v2/shared-old.png'],
  'orgs/fb020000-0000-4000-8000-000000000001/assets/v2/new-b.png'
), 1, 'second lead separately stages the shared old asset');
select is((select count(*)::integer from private.whatsapp_media_repair_source_paths
           where storage_path like '%/shared-old.png'),
          0, 'all shared source ledgers are now resolved');
create temporary table repair_gc_shared_claim as
select * from private.claim_whatsapp_nonlead_media_delete('repair-gc-test');
select is((select storage_path from repair_gc_shared_claim),
  'orgs/fb020000-0000-4000-8000-000000000001/assets/v2/shared-old.png',
  'one worker reserves the now-unreferenced shared object');
select ok((select private.mark_whatsapp_nonlead_media_delete_started(
  id, lease_token) from repair_gc_shared_claim),
  'shared path can start only after every source is resolved');
select ok((select private.finish_whatsapp_nonlead_media_delete(
  id, lease_token, 'confirmed_deleted') from repair_gc_shared_claim),
  'one confirmed delete settles the shared object');
select is((select count(*)::integer from private.whatsapp_nonlead_media_delete_outbox
           where storage_path like '%/shared-old.png'),
          0, 'duplicate tickets for the same path are settled together');

insert into private.whatsapp_media_repair_source_paths (
  organization_id, session_id, conversation_id, storage_path
) values (
  'fb020000-0000-4000-8000-000000000001',
  'fb030000-0000-4000-8000-000000000001',
  'fb040000-0000-4000-8000-000000000001',
  'orgs/fb020000-0000-4000-8000-000000000001/assets/v2/live-old.png'
);
select is(private.stage_whatsapp_repair_source_media_delete(
  'fb020000-0000-4000-8000-000000000001',
  array['fb080000-0000-4000-8000-000000000001'::uuid],
  array['orgs/fb020000-0000-4000-8000-000000000001/assets/v2/live-old.png'],
  'orgs/fb020000-0000-4000-8000-000000000001/assets/v2/new-a.png'
), 1, 'a displaced path shared with a live message gets a ticket');
select is((select count(*)::integer from private.claim_whatsapp_nonlead_media_delete(
  'repair-gc-test')),
  0, 'claim refuses to delete a current lead message asset');
select is((select media_storage_path from public.whatsapp_messages
           where id = 'fb070000-0000-4000-8000-000000000003'),
  'orgs/fb020000-0000-4000-8000-000000000001/assets/v2/live-old.png',
  'the surviving lead retains its media');
select is(has_function_privilege('anon',
  'private.stage_whatsapp_repair_source_media_delete(uuid,uuid[],text[],text)',
  'EXECUTE'), false, 'anonymous callers cannot stage Storage deletion');
select is(has_function_privilege('authenticated',
  'private.stage_whatsapp_repair_source_media_delete(uuid,uuid[],text[],text)',
  'EXECUTE'), false, 'CRM browser callers cannot stage Storage deletion');
select is(has_function_privilege('service_role',
  'private.stage_whatsapp_repair_source_media_delete(uuid,uuid[],text[],text)',
  'EXECUTE'), false, 'service Data API cannot stage Storage deletion');

select * from finish();
rollback;
