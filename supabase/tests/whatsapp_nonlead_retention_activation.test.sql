-- Run only against an isolated, migrated test database. Every fixture is
-- rolled back. This test never activates a production session or calls Storage.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

create temp table retention_activation_clock(t0 timestamptz not null) on commit drop;
insert into retention_activation_clock values (clock_timestamp());

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  'e7110000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'nonlead-activation-test@example.test',
  crypt('test-password', gen_salt('bf', 4)), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now(),
  '', '', '', ''
);
insert into public.organizations (id, name, slug, is_active)
values ('e7120000-0000-4000-8000-000000000001',
        'Nonlead activation SQL test', 'nonlead-activation-sql-test', true);
update public.users
set organization_id = 'e7120000-0000-4000-8000-000000000001',
    name = 'Nonlead Activation Tester', role = 'admin', is_active = true
where id = 'e7110000-0000-4000-8000-000000000001';
insert into public.whatsapp_sessions (
  id, organization_id, owner_user_id, instance_name, provider, status, is_active
) values
  ('e7130000-0000-4000-8000-000000000001',
   'e7120000-0000-4000-8000-000000000001',
   'e7110000-0000-4000-8000-000000000001',
   'nonlead-disabled-test-session', 'evolution_go', 'connected', true),
  ('e7130000-0000-4000-8000-000000000002',
   'e7120000-0000-4000-8000-000000000001',
   'e7110000-0000-4000-8000-000000000001',
   'nonlead-activation-test-session', 'evolution_go', 'connected', true);

-- A prepared but disabled policy must have no effect on the inbox, messages,
-- visibility or media upload path, even if its stored timestamp is old.
insert into private.whatsapp_nonlead_retention_sessions (
  session_id, organization_id, capture_from, purge_enabled
)
select 'e7130000-0000-4000-8000-000000000001',
       'e7120000-0000-4000-8000-000000000001',
       t0 - interval '10 days', false
from retention_activation_clock;
select private.record_whatsapp_nonlead_first_ingress(
  'e7120000-0000-4000-8000-000000000001',
  'e7130000-0000-4000-8000-000000000001',
  'nonlead-disabled-no-inbox', 'nonlead-disabled-provider', true
);
select is(
  (select count(*) from private.whatsapp_nonlead_retention_route_generations
   where session_id = 'e7130000-0000-4000-8000-000000000001'),
  0::bigint,
  'disabled policy does not record an ingress anchor'
);
insert into public.whatsapp_conversations (
  id, organization_id, session_id, lead_id, remote_jid, contact_phone
) values (
  'e7140000-0000-4000-8000-000000000001',
  'e7120000-0000-4000-8000-000000000001',
  'e7130000-0000-4000-8000-000000000001', null,
  '5511999111000@s.whatsapp.net', '5511999111000'
);
insert into public.whatsapp_messages (
  id, organization_id, conversation_id, session_id,
  provider_message_id, message_id, from_me, direction,
  message_type, content, status, capture_state
) values (
  'e7160000-0000-4000-8000-000000000001',
  'e7120000-0000-4000-8000-000000000001',
  'e7140000-0000-4000-8000-000000000001',
  'e7130000-0000-4000-8000-000000000001',
  'nonlead-disabled-provider', 'nonlead-disabled-provider',
  false, 'inbound', 'text', 'Mensagem sem retenção ativa', 'received', 'recorded'
);
select is(
  (select count(*) from private.whatsapp_nonlead_retention_candidates
   where session_id = 'e7130000-0000-4000-8000-000000000001'),
  0::bigint,
  'disabled policy does not create a conversation candidate'
);

-- A stale candidate from an earlier preparation must also be inert while the
-- policy remains disabled. It cannot hide or block the physical conversation.
insert into private.whatsapp_nonlead_retention_candidates (
  conversation_id, organization_id, session_id, first_received_at, expires_at
)
select 'e7140000-0000-4000-8000-000000000001',
       'e7120000-0000-4000-8000-000000000001',
       'e7130000-0000-4000-8000-000000000001',
       t0 - interval '8 days', t0 - interval '1 day'
from retention_activation_clock;
select is(
  private.whatsapp_nonlead_retention_visible(
    'e7120000-0000-4000-8000-000000000001',
    'e7140000-0000-4000-8000-000000000001'),
  true,
  'disabled policy leaves an old conversation visible'
);
insert into public.whatsapp_messages (
  id, organization_id, conversation_id, session_id,
  provider_message_id, message_id, from_me, direction,
  message_type, content, status, capture_state
) values (
  'e7160000-0000-4000-8000-000000000002',
  'e7120000-0000-4000-8000-000000000001',
  'e7140000-0000-4000-8000-000000000001',
  'e7130000-0000-4000-8000-000000000001',
  'nonlead-disabled-provider-two', 'nonlead-disabled-provider-two',
  false, 'inbound', 'text', 'Mensagem adicional permitida', 'received', 'recorded'
);
select is(
  (select count(*) from public.whatsapp_messages
   where conversation_id = 'e7140000-0000-4000-8000-000000000001'),
  2::bigint,
  'disabled policy does not reject another message after the stored deadline'
);
select is(
  public.whatsapp_media_path_reserve(
    'e7120000-0000-4000-8000-000000000001',
    'e7140000-0000-4000-8000-000000000001',
    'whatsapp-media',
    'orgs/e7120000-0000-4000-8000-000000000001/sessions/e7130000-0000-4000-8000-000000000001/incoming/disabled-test-object',
    'upload'),
  '00000000-0000-0000-0000-000000000001'::uuid,
  'disabled policy accepts a normal incoming media upload'
);
select is(
  (select count(*) from private.whatsapp_media_path_operations
   where conversation_id = 'e7140000-0000-4000-8000-000000000001'),
  0::bigint,
  'disabled policy does not create a media deletion fence'
);
select throws_ok(
  $$select private.activate_whatsapp_nonlead_retention('e7130000-0000-4000-8000-000000000001')$$,
  '55000', 'whatsapp_nonlead_retention_cutover_required',
  'activation requires a proven session cutover'
);
insert into private.whatsapp_webhook_session_cutovers (
  session_id, routing_epoch, cutoff_at
)
select 'e7130000-0000-4000-8000-000000000001',
       'e7170000-0000-4000-8000-000000000002',
       t0 - interval '1 day'
from retention_activation_clock;
select throws_ok(
  $$select private.activate_whatsapp_nonlead_retention('e7130000-0000-4000-8000-000000000001')$$,
  '55000', 'whatsapp_nonlead_retention_old_state_present',
  'activation rejects stale candidates from a prepared session'
);

-- A separate clean session can activate, but only with a fresh boundary.
insert into private.whatsapp_webhook_session_cutovers (
  session_id, routing_epoch, cutoff_at
)
select 'e7130000-0000-4000-8000-000000000002',
       'e7170000-0000-4000-8000-000000000001',
       t0 - interval '1 day'
from retention_activation_clock;
insert into private.whatsapp_nonlead_retention_sessions (
  session_id, organization_id, capture_from, purge_enabled
)
select 'e7130000-0000-4000-8000-000000000002',
       'e7120000-0000-4000-8000-000000000001',
       t0 - interval '10 days', false
from retention_activation_clock;
insert into public.whatsapp_webhook_inbox (
  organization_id, session_id, event_key, event_type, payload,
  processing_lane, status, created_at
)
select 'e7120000-0000-4000-8000-000000000001',
       'e7130000-0000-4000-8000-000000000002',
       'nonlead-activation-processing', 'message',
       '{"__vimob_ingress":{"cutover_epoch":"e7170000-0000-4000-8000-000000000001","routing_snapshot":{"version":1,"messages":[]}}}'::jsonb,
       'live', 'pending', t0
from retention_activation_clock;
update public.whatsapp_webhook_inbox
set status = 'processing', locked_at = clock_timestamp(),
    locked_by = 'vimob-api-evolution-webhook-cutover1-nonlead-activation-sql-test'
where event_key = 'nonlead-activation-processing';
select throws_ok(
  $$select private.activate_whatsapp_nonlead_retention('e7130000-0000-4000-8000-000000000002')$$,
  '55000', 'whatsapp_nonlead_retention_inflight_webhooks',
  'activation waits until a processing webhook finishes'
);
delete from public.whatsapp_webhook_inbox
where event_key = 'nonlead-activation-processing';

create temp table retention_activation_result (
  before_at timestamptz not null,
  capture_from timestamptz,
  after_at timestamptz
) on commit drop;
insert into retention_activation_result (before_at) values (clock_timestamp());
update retention_activation_result
set capture_from = private.activate_whatsapp_nonlead_retention(
  'e7130000-0000-4000-8000-000000000002');
update retention_activation_result set after_at = clock_timestamp();
select ok(
  (select capture_from between before_at and after_at
   from retention_activation_result),
  'activation chooses the fresh capture boundary atomically'
);
select is(
  (select policy.capture_from from private.whatsapp_nonlead_retention_sessions as policy
   where policy.session_id = 'e7130000-0000-4000-8000-000000000002'),
  (select capture_from from retention_activation_result),
  'the active policy stores the returned boundary'
);
select is(
  private.activate_whatsapp_nonlead_retention('e7130000-0000-4000-8000-000000000002'),
  (select capture_from from retention_activation_result),
  'repeating activation does not move the capture boundary'
);
select throws_ok(
  $$select private.set_whatsapp_nonlead_purge_enabled('e7130000-0000-4000-8000-000000000002', false)$$,
  '55000', 'whatsapp_nonlead_retention_one_way',
  'legacy setter cannot disable an active policy'
);
select throws_ok(
  $$select private.set_whatsapp_nonlead_purge_enabled('e7130000-0000-4000-8000-000000000002', true)$$,
  '55000', 'whatsapp_nonlead_retention_use_activation',
  'legacy setter cannot bypass the activation fence'
);
select throws_ok(
  $$update private.whatsapp_nonlead_retention_sessions set purge_enabled = false where session_id = 'e7130000-0000-4000-8000-000000000002'$$,
  '55000', 'whatsapp_nonlead_retention_one_way',
  'direct update cannot disable an active policy'
);
select throws_ok(
  $$update private.whatsapp_nonlead_retention_sessions set capture_from = clock_timestamp() where session_id = 'e7130000-0000-4000-8000-000000000002'$$,
  '55000', 'whatsapp_nonlead_retention_one_way',
  'direct update cannot shift an active capture boundary'
);
select throws_ok(
  $$delete from private.whatsapp_nonlead_retention_sessions where session_id = 'e7130000-0000-4000-8000-000000000002'$$,
  '55000', 'whatsapp_nonlead_retention_one_way',
  'direct delete cannot restore visibility after activation'
);
select is(
  (select capture_from from private.whatsapp_nonlead_retention_sessions
   where session_id = 'e7130000-0000-4000-8000-000000000002'
     and purge_enabled = true),
  (select capture_from from retention_activation_result),
  'failed rollback attempts leave the active boundary unchanged'
);

select * from finish();
rollback;
