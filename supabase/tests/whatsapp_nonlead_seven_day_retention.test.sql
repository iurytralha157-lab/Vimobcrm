-- Run only against an isolated, migrated test database. The transaction rolls
-- back all fixtures. This file does not call Storage or activate production.
begin;
create extension if not exists pgtap with schema extensions;
select plan(41);

create temp table nonlead_test_clock(t0 timestamptz not null) on commit drop;
insert into nonlead_test_clock values (clock_timestamp());

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  'e7010000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'nonlead-retention-test@example.test',
  crypt('test-password', gen_salt('bf', 4)), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now(),
  '', '', '', ''
);
insert into public.organizations (id, name, slug, is_active)
values ('e7020000-0000-4000-8000-000000000001',
        'Nonlead retention SQL test', 'nonlead-retention-sql-test', true);
-- The auth.users trigger has already created the matching public.users row.
update public.users
set organization_id = 'e7020000-0000-4000-8000-000000000001',
    name = 'Nonlead Retention Tester', role = 'admin', is_active = true
where id = 'e7010000-0000-4000-8000-000000000001';
insert into public.whatsapp_sessions (
  id, organization_id, owner_user_id, instance_name, provider, status, is_active
) values (
  'e7030000-0000-4000-8000-000000000001',
  'e7020000-0000-4000-8000-000000000001',
  'e7010000-0000-4000-8000-000000000001',
  'nonlead-retention-sql-test-session', 'evolution_go', 'connected', true
);

insert into private.whatsapp_webhook_session_cutovers (
  session_id, routing_epoch, cutoff_at
)
select 'e7030000-0000-4000-8000-000000000001',
       'e7070000-0000-4000-8000-000000000001',
       t0 - interval '10 days'
from nonlead_test_clock;

select is(
  (select count(*) from private.whatsapp_nonlead_retention_sessions
   where session_id = 'e7030000-0000-4000-8000-000000000001'),
  0::bigint,
  'applying the migrations leaves this session unactivated'
);

-- The fixture activates a historical clock only inside this rolled-back test;
-- real activation starts at its own atomic capture time and never backfills.
insert into private.whatsapp_nonlead_retention_sessions (
  session_id, organization_id, capture_from, purge_enabled
)
select 'e7030000-0000-4000-8000-000000000001',
       'e7020000-0000-4000-8000-000000000001',
       t0 - interval '10 days', true
from nonlead_test_clock;

insert into public.whatsapp_conversations (
  id, organization_id, session_id, lead_id, remote_jid, contact_phone
) values
  ('e7040000-0000-4000-8000-000000000001',
   'e7020000-0000-4000-8000-000000000001',
   'e7030000-0000-4000-8000-000000000001', null,
   '5511999000001@s.whatsapp.net', '5511999000001'),
  ('e7040000-0000-4000-8000-000000000002',
   'e7020000-0000-4000-8000-000000000001',
   'e7030000-0000-4000-8000-000000000001', null,
   '5511999000002@s.whatsapp.net', '5511999000002');

insert into public.whatsapp_webhook_inbox (
  organization_id, session_id, event_key, event_type, payload,
  processing_lane, status, created_at
)
select 'e7020000-0000-4000-8000-000000000001',
       'e7030000-0000-4000-8000-000000000001',
       'nonlead-a-first', 'message',
       '{"__vimob_ingress":{"cutover_epoch":"e7070000-0000-4000-8000-000000000001","routing_snapshot":{"version":1,"messages":[]}}}'::jsonb,
       'live', 'processed', t0 - interval '6 days'
from nonlead_test_clock;
insert into public.whatsapp_webhook_routing_snapshots (
  organization_id, session_id, provider_message_id, inbox_event_key,
  processing_lane, routing_key, binding_eligible, target_mode, snapshot
) values (
  'e7020000-0000-4000-8000-000000000001',
  'e7030000-0000-4000-8000-000000000001',
  'nonlead-provider-a-first', 'nonlead-a-first', 'live',
  'epoch:nonlead-test-a', true, 'snapshot',
  '{"conversation_id":"e7040000-0000-4000-8000-000000000001"}'::jsonb
);
select private.record_whatsapp_nonlead_first_ingress(
  'e7020000-0000-4000-8000-000000000001',
  'e7030000-0000-4000-8000-000000000001',
  'nonlead-a-first', 'nonlead-provider-a-first', true
);
select is(
  (select ignored_reason
   from private.whatsapp_nonlead_ingress_route_decision(
     'e7020000-0000-4000-8000-000000000001',
     'e7030000-0000-4000-8000-000000000001',
     'epoch:nonlead-test-a', 'pre-cutover-provider-never-seen',
     (select t0 - interval '11 days' from nonlead_test_clock))),
  'pre_cutover_provider_replay'::text,
  'a delayed pre-cutover provider callback cannot create a new CRM event'
);
insert into public.whatsapp_messages (
  id, organization_id, conversation_id, session_id,
  provider_message_id, message_id, from_me, direction,
  message_type, content, status, capture_state
) values (
  'e7060000-0000-4000-8000-000000000001',
  'e7020000-0000-4000-8000-000000000001',
  'e7040000-0000-4000-8000-000000000001',
  'e7030000-0000-4000-8000-000000000001',
  'nonlead-provider-a-first', 'nonlead-provider-a-first',
  false, 'inbound', 'text', 'Primeiro contato', 'received', 'recorded'
);
select is(
  (select first_received_at from private.whatsapp_nonlead_retention_candidates
   where conversation_id = 'e7040000-0000-4000-8000-000000000001'),
  (select t0 - interval '6 days' from nonlead_test_clock),
  'deadline starts at inbox arrival, not the delayed message INSERT'
);
select is(
  (select expires_at from private.whatsapp_nonlead_retention_candidates
   where conversation_id = 'e7040000-0000-4000-8000-000000000001'),
  (select t0 + interval '24 hours' from nonlead_test_clock),
  'seven days means exactly 168 elapsed hours'
);

insert into public.whatsapp_webhook_inbox (
  organization_id, session_id, event_key, event_type, payload,
  processing_lane, status, created_at
)
select 'e7020000-0000-4000-8000-000000000001',
       'e7030000-0000-4000-8000-000000000001',
       'nonlead-a-second', 'message',
       '{"__vimob_ingress":{"cutover_epoch":"e7070000-0000-4000-8000-000000000001","routing_snapshot":{"version":1,"messages":[]}}}'::jsonb,
       'live', 'processed', t0 - interval '5 days'
from nonlead_test_clock;
insert into public.whatsapp_webhook_routing_snapshots (
  organization_id, session_id, provider_message_id, inbox_event_key,
  processing_lane, routing_key, binding_eligible, target_mode, snapshot
) values (
  'e7020000-0000-4000-8000-000000000001',
  'e7030000-0000-4000-8000-000000000001',
  'nonlead-provider-a-second', 'nonlead-a-second', 'live',
  'epoch:nonlead-test-a', true, 'snapshot',
  '{"conversation_id":"e7040000-0000-4000-8000-000000000001"}'::jsonb
);
select private.record_whatsapp_nonlead_first_ingress(
  'e7020000-0000-4000-8000-000000000001',
  'e7030000-0000-4000-8000-000000000001',
  'nonlead-a-second', 'nonlead-provider-a-second', true
);
insert into public.whatsapp_messages (
  id, organization_id, conversation_id, session_id,
  provider_message_id, message_id, from_me, direction,
  message_type, content, status, capture_state
) values (
  'e7060000-0000-4000-8000-000000000002',
  'e7020000-0000-4000-8000-000000000001',
  'e7040000-0000-4000-8000-000000000001',
  'e7030000-0000-4000-8000-000000000001',
  'nonlead-provider-a-second', 'nonlead-provider-a-second',
  false, 'inbound', 'text', 'Mensagem posterior', 'received', 'recorded'
);
select is(
  (select first_received_at from private.whatsapp_nonlead_retention_candidates
   where conversation_id = 'e7040000-0000-4000-8000-000000000001'),
  (select t0 - interval '6 days' from nonlead_test_clock),
  'later inbound does not change first_received_at'
);
select is(
  (select expires_at from private.whatsapp_nonlead_retention_candidates
   where conversation_id = 'e7040000-0000-4000-8000-000000000001'),
  (select t0 + interval '24 hours' from nonlead_test_clock),
  'later inbound does not extend the deadline'
);

insert into public.leads (id, organization_id, name, phone, source)
values ('e7050000-0000-4000-8000-000000000001',
        'e7020000-0000-4000-8000-000000000001',
        'Converted test contact', '5511999000001', 'manual');
select public.activate_whatsapp_conversation_lead_binding(
  'e7020000-0000-4000-8000-000000000001',
  'e7040000-0000-4000-8000-000000000001',
  'e7050000-0000-4000-8000-000000000001', null
);
select is(
  (select state from private.whatsapp_nonlead_retention_candidates
   where conversation_id = 'e7040000-0000-4000-8000-000000000001'),
  'converted'::text,
  'conversion before deadline preserves the full conversation'
);

-- A second direct conversation is already eight days old at the test clock.
insert into public.whatsapp_webhook_inbox (
  organization_id, session_id, event_key, event_type, payload,
  processing_lane, status, created_at
)
select 'e7020000-0000-4000-8000-000000000001',
       'e7030000-0000-4000-8000-000000000001',
       'nonlead-b-old', 'message',
       '{"__vimob_ingress":{"cutover_epoch":"e7070000-0000-4000-8000-000000000001","routing_snapshot":{"version":1,"messages":[]}}}'::jsonb,
       'live', 'processed', t0 - interval '8 days'
from nonlead_test_clock;
insert into public.whatsapp_webhook_routing_snapshots (
  organization_id, session_id, provider_message_id, inbox_event_key,
  processing_lane, routing_key, binding_eligible, target_mode, snapshot
) values (
  'e7020000-0000-4000-8000-000000000001',
  'e7030000-0000-4000-8000-000000000001',
  'nonlead-provider-b-old', 'nonlead-b-old', 'live',
  'epoch:nonlead-test-b', true, 'snapshot',
  '{"conversation_id":"e7040000-0000-4000-8000-000000000002"}'::jsonb
);
select private.record_whatsapp_nonlead_first_ingress(
  'e7020000-0000-4000-8000-000000000001',
  'e7030000-0000-4000-8000-000000000001',
  'nonlead-b-old', 'nonlead-provider-b-old', true
);
insert into public.whatsapp_messages (
  id, organization_id, conversation_id, session_id,
  provider_message_id, message_id, from_me, direction,
  message_type, content, status, capture_state, media_storage_path
) values (
  'e7060000-0000-4000-8000-000000000003',
  'e7020000-0000-4000-8000-000000000001',
  'e7040000-0000-4000-8000-000000000002',
  'e7030000-0000-4000-8000-000000000001',
  'nonlead-provider-b-old', 'nonlead-provider-b-old',
  false, 'inbound', 'text', 'Histórico a excluir', 'received', 'recorded',
  'orgs/e7020000-0000-4000-8000-000000000001/assets/v2/shared-test-object'
);
update public.whatsapp_messages
set media_storage_path =
  'orgs/e7020000-0000-4000-8000-000000000001/assets/v2/shared-test-object'
where id = 'e7060000-0000-4000-8000-000000000001';
-- A successful repair has already repointed the message to the shared v2
-- asset. Its old incoming paths remain only in the private provenance ledger.
insert into private.whatsapp_media_repair_source_paths (
  organization_id, session_id, conversation_id, storage_path
) values
  ('e7020000-0000-4000-8000-000000000001',
   'e7030000-0000-4000-8000-000000000001',
   'e7040000-0000-4000-8000-000000000002',
    'orgs/e7020000-0000-4000-8000-000000000001/sessions/e7030000-0000-4000-8000-000000000002/incoming/old-unshared.jpg'),
  ('e7020000-0000-4000-8000-000000000001',
   'e7030000-0000-4000-8000-000000000001',
   'e7040000-0000-4000-8000-000000000002',
   'orgs/e7020000-0000-4000-8000-000000000001/sessions/e7030000-0000-4000-8000-000000000001/incoming/old-shared.jpg'),
  ('e7020000-0000-4000-8000-000000000001',
   'e7030000-0000-4000-8000-000000000001',
   'e7040000-0000-4000-8000-000000000001',
   'orgs/e7020000-0000-4000-8000-000000000001/sessions/e7030000-0000-4000-8000-000000000001/incoming/old-shared.jpg');
select ok(
  (select expires_at <= clock_timestamp()
   from private.whatsapp_nonlead_retention_candidates
   where conversation_id = 'e7040000-0000-4000-8000-000000000002'),
  'expired nonlead candidate is due regardless of worker timing'
);
select throws_ok(
  $$insert into public.whatsapp_messages (
      organization_id, conversation_id, session_id, provider_message_id,
      message_id, from_me, direction, message_type, content, capture_state
    ) values (
      'e7020000-0000-4000-8000-000000000001',
      'e7040000-0000-4000-8000-000000000002',
      'e7030000-0000-4000-8000-000000000001',
      'nonlead-provider-b-blocked', 'nonlead-provider-b-blocked',
      false, 'inbound', 'text', 'Não anexar ao ciclo vencido', 'recorded'
    )$$,
  '55000', 'whatsapp_nonlead_retention_deadline_passed',
  'new message cannot attach to the expired physical conversation'
);
select is(
  private.whatsapp_nonlead_retention_visible(
    'e7020000-0000-4000-8000-000000000001',
    'e7040000-0000-4000-8000-000000000002'),
  false,
  'active policy hides the expired nonlead conversation at its deadline'
);

create temp table nonlead_new_route(route text not null) on commit drop;
insert into nonlead_new_route(route)
select private.current_whatsapp_nonlead_routing_key(
  'e7020000-0000-4000-8000-000000000001',
  'e7030000-0000-4000-8000-000000000001',
  'epoch:nonlead-test-b'
);
select isnt((select route from nonlead_new_route), 'epoch:nonlead-test-b'::text,
  'new inbox event uses a route independent of the old predecessor chain');

insert into public.whatsapp_webhook_inbox (
  organization_id, session_id, event_key, event_type, payload,
  processing_lane, status, created_at
)
select 'e7020000-0000-4000-8000-000000000001',
       'e7030000-0000-4000-8000-000000000001',
       'nonlead-b-new', 'message',
       jsonb_build_object('__vimob_ingress', jsonb_build_object(
         'cutover_epoch', 'e7070000-0000-4000-8000-000000000001',
         'routing_snapshot', jsonb_build_object('version', 1, 'messages', '[]'::jsonb)
       )),
       'live', 'pending', t0
from nonlead_test_clock;
insert into public.whatsapp_webhook_routing_snapshots (
  organization_id, session_id, provider_message_id, inbox_event_key,
  processing_lane, routing_key, binding_eligible, target_mode, snapshot
)
select 'e7020000-0000-4000-8000-000000000001',
       'e7030000-0000-4000-8000-000000000001',
       'nonlead-provider-b-new', 'nonlead-b-new', 'live',
       route, true, 'snapshot', '{}'::jsonb
from nonlead_new_route;
select private.record_whatsapp_nonlead_first_ingress(
  'e7020000-0000-4000-8000-000000000001',
  'e7030000-0000-4000-8000-000000000001',
  'nonlead-b-new', 'nonlead-provider-b-new', true
);
select ok(
  public.whatsapp_nonlead_event_is_purged(
    'e7020000-0000-4000-8000-000000000001',
    'e7030000-0000-4000-8000-000000000001',
    'nonlead-provider-b-old', 'nonlead-b-old',
    (select t0 - interval '8 days' from nonlead_test_clock)
  ),
  'old event is fenced by the seven-day route cutoff'
);
select ok(
  not public.whatsapp_nonlead_event_is_purged(
    'e7020000-0000-4000-8000-000000000001',
    'e7030000-0000-4000-8000-000000000001',
    'nonlead-provider-b-new', 'nonlead-b-new',
    (select t0 from nonlead_test_clock)
  ),
  'genuinely new event is not classified as replay'
);

select is(
  private.try_purge_whatsapp_nonlead_conversation(
    'e7040000-0000-4000-8000-000000000002'
  ), 'purged'::text,
  'transactional purge retires only the expired nonlead conversation'
);
select ok(
  not exists (select 1 from public.whatsapp_conversations
              where id = 'e7040000-0000-4000-8000-000000000002')
  and exists (select 1 from public.whatsapp_conversations
              where id = 'e7040000-0000-4000-8000-000000000001'),
  'lead-linked conversation and its history survive the nonlead purge'
);
select ok(
  not exists (select 1 from public.whatsapp_webhook_inbox
              where event_key = 'nonlead-b-old')
  and exists (select 1 from public.whatsapp_webhook_inbox
              where event_key = 'nonlead-b-new' and status = 'pending'),
  'only the isolated old raw inbox row is deleted; new event remains'
);
select ok(
  public.whatsapp_nonlead_event_is_purged(
    'e7020000-0000-4000-8000-000000000001',
    'e7030000-0000-4000-8000-000000000001',
    'nonlead-provider-b-old', null, null
  ),
  'hashed provider tombstone blocks replay after old snapshot deletion'
);
select ok(
  not exists (select 1 from private.whatsapp_media_repair_source_paths
              where conversation_id = 'e7040000-0000-4000-8000-000000000002')
  and exists (select 1 from private.whatsapp_media_repair_source_paths
              where conversation_id = 'e7040000-0000-4000-8000-000000000001'
                and storage_path like '%/incoming/old-shared.jpg'),
  'purge retires only the expired conversation source ledger'
);
select is(
  (select count(*) from private.whatsapp_nonlead_media_delete_outbox
   where conversation_id = 'e7040000-0000-4000-8000-000000000002'),
  3::bigint,
  'purge queues the repaired shared asset and both displaced incoming paths'
);
create temp table nonlead_repair_gc_lease on commit drop as
select * from private.claim_whatsapp_nonlead_media_delete('nonlead-test-worker');
select is(
  (select storage_path from nonlead_repair_gc_lease),
   'orgs/e7020000-0000-4000-8000-000000000001/sessions/e7030000-0000-4000-8000-000000000002/incoming/old-unshared.jpg'::text,
   'GC claims another same-organization session old incoming object after repair and purge'
);
select is(
  (select count(*) from private.whatsapp_nonlead_media_delete_outbox
   where storage_path like '%/assets/v2/shared-test-object'),
  0::bigint,
  'shared replacement asset ticket is removed without deletion'
);
select is(
  (select status from private.whatsapp_nonlead_media_delete_outbox
   where storage_path like '%/incoming/old-shared.jpg'),
  'held_shared'::text,
  'old incoming object still referenced by another conversation is held'
);
select ok(
  (select private.mark_whatsapp_nonlead_media_delete_started(id, lease_token)
   from nonlead_repair_gc_lease),
  'GC records HTTP start for the unshared old incoming object'
);
select ok(
  (select private.finish_whatsapp_nonlead_media_delete(
    id, lease_token, 'confirmed_deleted') from nonlead_repair_gc_lease),
  'confirmed deletion retires the old incoming object ticket'
);
select is(
  (select count(*) from private.whatsapp_nonlead_media_delete_outbox
   where storage_path like '%/incoming/old-unshared.jpg'),
  0::bigint,
  'deleted old incoming path is no longer retained in the outbox'
);

insert into private.whatsapp_nonlead_media_delete_outbox (
  organization_id, conversation_id, bucket_id, storage_path
) values (
  'e7020000-0000-4000-8000-000000000001',
  'e7040000-0000-4000-8000-000000000002',
  'whatsapp-media',
  'orgs/e7020000-0000-4000-8000-000000000001/assets/v2/unshared-test-object'
);
create temp table nonlead_gc_lease on commit drop as
select * from private.claim_whatsapp_nonlead_media_delete('nonlead-test-worker');
select is((select count(*) from nonlead_gc_lease), 1::bigint,
  'one worker claims an unshared path and reserves deletion');
select is(
  (select count(*) from private.claim_whatsapp_nonlead_media_delete('other-worker')),
  0::bigint,
  'a second worker cannot claim the same path');
select ok(
  (select private.mark_whatsapp_nonlead_media_delete_started(id, lease_token)
   from nonlead_gc_lease),
  'worker records HTTP start before contacting Storage'
);
select ok(
  (select private.finish_whatsapp_nonlead_media_delete(
    id, lease_token, 'confirmed_deleted') from nonlead_gc_lease),
  'confirmed Storage deletion removes the ticket and path fence'
);
select is(
  (select count(*) from private.whatsapp_nonlead_media_delete_outbox
   where storage_path like '%/unshared-test-object'),
  0::bigint,
  'confirmed object path is not retained in active CRM tables'
);

-- The first CTWA callback can sit in inbox longer than seven days without
-- ever creating a conversation candidate. Its ACK still owns the deadline.
insert into public.whatsapp_webhook_inbox (
  organization_id, session_id, event_key, event_type, payload,
  processing_lane, status, created_at
)
select 'e7020000-0000-4000-8000-000000000001',
       'e7030000-0000-4000-8000-000000000001',
       'nonlead-c-ctwa-old', 'MessagesUpsert',
       '{"__vimob_ingress":{"cutover_epoch":"e7070000-0000-4000-8000-000000000001","routing_snapshot":{"version":1,"messages":[]}}}'::jsonb,
       'live', 'pending', t0 - interval '8 days'
from nonlead_test_clock;
insert into public.whatsapp_webhook_routing_snapshots (
  organization_id, session_id, provider_message_id, inbox_event_key,
  processing_lane, routing_key, binding_eligible, target_mode, snapshot
) values (
  'e7020000-0000-4000-8000-000000000001',
  'e7030000-0000-4000-8000-000000000001',
  'nonlead-provider-c-ctwa-old', 'nonlead-c-ctwa-old', 'live',
  'epoch:nonlead-test-c', true, 'snapshot',
  '{"context_kind":"contextual_intake"}'::jsonb
);
select private.record_whatsapp_nonlead_first_ingress(
  'e7020000-0000-4000-8000-000000000001',
  'e7030000-0000-4000-8000-000000000001',
  'nonlead-c-ctwa-old', 'nonlead-provider-c-ctwa-old', true
);
select is(
  (select first_inbound_at
   from private.whatsapp_nonlead_retention_route_generations
   where routing_key = 'epoch:nonlead-test-c'),
  (select t0 - interval '8 days' from nonlead_test_clock),
  'the unprocessed first CTWA starts its deadline at the durable inbox ACK'
);
select ok(
  public.whatsapp_nonlead_event_is_purged(
    'e7020000-0000-4000-8000-000000000001',
    'e7030000-0000-4000-8000-000000000001',
    'nonlead-provider-c-ctwa-old', 'nonlead-c-ctwa-old',
    (select t0 - interval '8 days' from nonlead_test_clock)
  ),
  'expired first CTWA is fenced before lead creation and distribution'
);
select isnt(
  private.current_whatsapp_nonlead_routing_key(
    'e7020000-0000-4000-8000-000000000001',
    'e7030000-0000-4000-8000-000000000001',
    'epoch:nonlead-test-c'),
  'epoch:nonlead-test-c'::text,
  'new provider callbacks advance past the unprocessed old CTWA route'
);
update public.whatsapp_webhook_inbox
set status = 'processing', locked_at = clock_timestamp(),
    locked_by = 'vimob-api-evolution-webhook-cutover1-nonlead-test'
where event_key = 'nonlead-c-ctwa-old';
select ok(
  private.complete_whatsapp_nonlead_expired_inbox(
    (select id from public.whatsapp_webhook_inbox
     where event_key = 'nonlead-c-ctwa-old'),
    'e7020000-0000-4000-8000-000000000001',
    'e7030000-0000-4000-8000-000000000001',
    'nonlead-provider-c-ctwa-old',
    'vimob-api-evolution-webhook-cutover1-nonlead-test'
  ),
  'expired isolated CTWA completes without running its normal processor'
);
select ok(
  not exists (select 1 from public.whatsapp_webhook_inbox
              where event_key = 'nonlead-c-ctwa-old')
  and not exists (select 1 from public.whatsapp_webhook_routing_snapshots
                  where provider_message_id = 'nonlead-provider-c-ctwa-old')
  and not exists (select 1 from public.whatsapp_webhook_routing_outcomes
                  where provider_message_id = 'nonlead-provider-c-ctwa-old')
  and exists (
    select 1 from private.whatsapp_nonlead_message_tombstones
    where organization_id = 'e7020000-0000-4000-8000-000000000001'
      and session_id = 'e7030000-0000-4000-8000-000000000001'
      and provider_message_id_hash =
        encode(digest('nonlead-provider-c-ctwa-old', 'sha256'), 'hex')
  ),
  'completion removes raw inbox, snapshot and outcome while retaining hashed replay proof'
);
select is(
  (select ignored_reason from private.whatsapp_nonlead_ingress_route_decision(
    'e7020000-0000-4000-8000-000000000001',
    'e7030000-0000-4000-8000-000000000001',
    'epoch:nonlead-test-c', 'nonlead-provider-c-unknown-clock', null)),
  'ambiguous_nonlead_generation'::text,
  'missing provider clock after route expiry gets a minimal ACK without CRM effects'
);
select is(
  (select ignored_reason from private.whatsapp_nonlead_ingress_route_decision(
    'e7020000-0000-4000-8000-000000000001',
    'e7030000-0000-4000-8000-000000000001',
    'epoch:nonlead-test-c', 'nonlead-provider-c-new',
    (select t0 from nonlead_test_clock))),
  null::text,
  'a proven new provider event after the deadline remains eligible'
);

-- A two-event old chain keeps the predecessor outcome until its successor
-- completes. Only then can both snapshots and their copied metadata go.
insert into public.whatsapp_webhook_inbox (
  organization_id, session_id, event_key, event_type, payload,
  processing_lane, status, created_at
)
select 'e7020000-0000-4000-8000-000000000001',
       'e7030000-0000-4000-8000-000000000001',
       'nonlead-d-first', 'MessagesUpsert',
       '{"__vimob_ingress":{"cutover_epoch":"e7070000-0000-4000-8000-000000000001","routing_snapshot":{"version":1,"messages":[]}}}'::jsonb,
       'live', 'pending', t0 - interval '8 days'
from nonlead_test_clock;
insert into public.whatsapp_webhook_routing_snapshots (
  organization_id, session_id, provider_message_id, inbox_event_key,
  processing_lane, routing_key, binding_eligible, target_mode, snapshot
) values (
  'e7020000-0000-4000-8000-000000000001',
  'e7030000-0000-4000-8000-000000000001',
  'nonlead-provider-d-first', 'nonlead-d-first', 'live',
  'epoch:nonlead-test-d', true, 'snapshot',
  '{"context_kind":"contextual_intake"}'::jsonb
);
select private.record_whatsapp_nonlead_first_ingress(
  'e7020000-0000-4000-8000-000000000001',
  'e7030000-0000-4000-8000-000000000001',
  'nonlead-d-first', 'nonlead-provider-d-first', true
);
insert into public.whatsapp_webhook_inbox (
  organization_id, session_id, event_key, event_type, payload,
  processing_lane, status, created_at
)
select 'e7020000-0000-4000-8000-000000000001',
       'e7030000-0000-4000-8000-000000000001',
       'nonlead-d-second', 'MessagesUpsert',
       '{"__vimob_ingress":{"cutover_epoch":"e7070000-0000-4000-8000-000000000001","routing_snapshot":{"version":1,"messages":[{"provider_message_id":"nonlead-provider-d-second","binding_eligible":true,"predecessor_provider_message_id":"nonlead-provider-d-first","predecessor_inbox_event_key":"nonlead-d-first"}]}}}'::jsonb,
       'live', 'pending', t0 - interval '7 days 23 hours'
from nonlead_test_clock;
insert into public.whatsapp_webhook_routing_snapshots (
  organization_id, session_id, provider_message_id, inbox_event_key,
  processing_lane, routing_key, predecessor_provider_message_id,
  binding_eligible, target_mode, snapshot
) values (
  'e7020000-0000-4000-8000-000000000001',
  'e7030000-0000-4000-8000-000000000001',
  'nonlead-provider-d-second', 'nonlead-d-second', 'live',
  'epoch:nonlead-test-d', 'nonlead-provider-d-first',
  true, 'inherit_predecessor', '{"context_kind":"contextual_intake"}'::jsonb
);
select private.record_whatsapp_nonlead_first_ingress(
  'e7020000-0000-4000-8000-000000000001',
  'e7030000-0000-4000-8000-000000000001',
  'nonlead-d-second', 'nonlead-provider-d-second', true
);
update public.whatsapp_webhook_inbox
set status = 'processing', locked_at = clock_timestamp(),
    locked_by = 'vimob-api-evolution-webhook-cutover1-nonlead-test'
where event_key = 'nonlead-d-first';
select ok(
  private.complete_whatsapp_nonlead_expired_inbox(
    (select id from public.whatsapp_webhook_inbox where event_key = 'nonlead-d-first'),
    'e7020000-0000-4000-8000-000000000001',
    'e7030000-0000-4000-8000-000000000001',
    'nonlead-provider-d-first',
    'vimob-api-evolution-webhook-cutover1-nonlead-test'
  ),
  'first expired event in an old route completes without CRM effects'
);
select ok(
  exists (select 1 from public.whatsapp_webhook_routing_snapshots
          where provider_message_id = 'nonlead-provider-d-first')
  and exists (select 1 from public.whatsapp_webhook_routing_outcomes
              where provider_message_id = 'nonlead-provider-d-first')
  and exists (select 1 from public.whatsapp_webhook_inbox
              where event_key = 'nonlead-d-second'),
  'predecessor proof remains while another old event is waiting'
);
update public.whatsapp_webhook_inbox
set status = 'processing', locked_at = clock_timestamp(),
    locked_by = 'vimob-api-evolution-webhook-cutover1-nonlead-test'
where event_key = 'nonlead-d-second';
select ok(
  private.complete_whatsapp_nonlead_expired_inbox(
    (select id from public.whatsapp_webhook_inbox where event_key = 'nonlead-d-second'),
    'e7020000-0000-4000-8000-000000000001',
    'e7030000-0000-4000-8000-000000000001',
    'nonlead-provider-d-second',
    'vimob-api-evolution-webhook-cutover1-nonlead-test'
  ),
  'last expired event in an old route completes atomically'
);
select ok(
  not exists (select 1 from public.whatsapp_webhook_inbox
              where event_key in ('nonlead-d-first', 'nonlead-d-second'))
  and not exists (select 1 from public.whatsapp_webhook_routing_snapshots
                  where routing_key = 'epoch:nonlead-test-d')
  and not exists (select 1 from public.whatsapp_webhook_routing_outcomes
                  where provider_message_id in
                    ('nonlead-provider-d-first', 'nonlead-provider-d-second'))
  and (select count(*) from private.whatsapp_nonlead_message_tombstones
       where organization_id = 'e7020000-0000-4000-8000-000000000001'
         and session_id = 'e7030000-0000-4000-8000-000000000001'
         and provider_message_id_hash in (
           encode(digest('nonlead-provider-d-first', 'sha256'), 'hex'),
           encode(digest('nonlead-provider-d-second', 'sha256'), 'hex')
         )) = 2,
  'finished old chain removes every raw copy and keeps only hashed replay proof'
);

select * from finish();
rollback;
