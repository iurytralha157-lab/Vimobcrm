begin;

create extension if not exists pgtap with schema extensions;
select plan(32);

do $compat_local_whatsapp_session_name$
begin
  if exists (
    select 1 from pg_catalog.pg_attribute
    where attrelid = 'public.whatsapp_sessions'::regclass
      and attname = 'name' and not attisdropped
  ) then
    execute $sql$alter table public.whatsapp_sessions alter column name set default 'pgTAP compatibility'$sql$;
  end if;
end;
$compat_local_whatsapp_session_name$;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000', 'b1000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'automation-owner@example.test',
  crypt('test-password', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
);

insert into public.organizations (id, name, slug, is_active)
values ('b2000000-0000-4000-8000-000000000001', 'Automation Runtime Test', 'automation-runtime-test', true);

insert into public.users (id, organization_id, name, email, role, is_active)
values ('b1000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 'Automation Owner', 'automation-owner@example.test', 'admin', true);

insert into public.organization_members (organization_id, user_id, role, is_active)
values ('b2000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'admin', true);

insert into public.organization_modules (organization_id, module_name, is_enabled)
values ('b2000000-0000-4000-8000-000000000001', 'automations', true);

insert into public.leads (id, organization_id, name, source)
values
  ('b3000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 'Reply Lead', 'manual'),
  ('b3000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000001', 'Timeout Lead', 'manual'),
  ('b3000000-0000-4000-8000-000000000003', 'b2000000-0000-4000-8000-000000000001', 'Race Lead', 'manual'),
  ('b3000000-0000-4000-8000-000000000004', 'b2000000-0000-4000-8000-000000000001', 'New Conversation Lead', 'manual');
update public.leads set phone = '(11) 99999-9999' where id = 'b3000000-0000-4000-8000-000000000004';

insert into public.whatsapp_sessions (
  id, organization_id, owner_user_id, instance_name, provider, status, is_active
) values (
  'b9000000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001',
  'automation-session',
  'evolution_go',
  'connected',
  true
);

insert into public.automations (
  id, organization_id, name, is_active, trigger_type, trigger_config, flow_definition
) values (
  'b4000000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000001',
  'Reply-aware delay',
  false,
  'manual',
  '{"trigger_type":"manual"}'::jsonb,
  '{}'::jsonb
);

insert into public.automation_flow_versions (
  id, automation_id, organization_id, version, trigger_type, trigger_config,
  graph, graph_checksum, first_node_key, requires_review
) values (
  'b5000000-0000-4000-8000-000000000001',
  'b4000000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000001',
  1,
  'manual',
  '{"trigger_type":"manual"}'::jsonb,
  '{
    "nodes": [
      {"id":"delay","type":"delay","config":{"delay_value":1,"delay_type":"minutes","stop_on_reply":true}},
      {"id":"replied","type":"action","action_type":"send_whatsapp","config":{}},
      {"id":"no_reply","type":"action","action_type":"send_whatsapp","config":{}},
      {"id":"send","type":"action","action_type":"send_whatsapp","config":{}}
    ],
    "connections": [
      {"source":"delay","target":"replied","condition_branch":"replied"},
      {"source":"delay","target":"no_reply","condition_branch":"no_reply"}
    ],
    "settings": {}
  }'::jsonb,
  'test-checksum',
  'delay',
  false
);

insert into public.automations (
  id, organization_id, name, is_active, trigger_type, trigger_config, flow_definition
) values (
  'b4000000-0000-4000-8000-000000000002',
  'b2000000-0000-4000-8000-000000000001',
  'Simple delay compatibility',
  false,
  'manual',
  '{"trigger_type":"manual"}'::jsonb,
  '{}'::jsonb
);

insert into public.automation_flow_versions (
  id, automation_id, organization_id, version, trigger_type, trigger_config,
  graph, graph_checksum, first_node_key, requires_review
) values (
  'b5000000-0000-4000-8000-000000000002',
  'b4000000-0000-4000-8000-000000000002',
  'b2000000-0000-4000-8000-000000000001',
  1,
  'manual',
  '{"trigger_type":"manual"}'::jsonb,
  '{
    "nodes": [
      {"id":"delay","type":"delay","config":{"delay_value":1,"delay_type":"minutes"}},
      {"id":"next","type":"action","action_type":"send_whatsapp","config":{}}
    ],
    "connections": [
      {"source":"delay","target":"next","condition_branch":"default"}
    ],
    "settings": {}
  }'::jsonb,
  'simple-delay-checksum',
  'delay',
  false
);

update public.automations
set active_flow_version_id = 'b5000000-0000-4000-8000-000000000001', is_active = true
where id = 'b4000000-0000-4000-8000-000000000001';

update public.automations
set active_flow_version_id = 'b5000000-0000-4000-8000-000000000002', is_active = true
where id = 'b4000000-0000-4000-8000-000000000002';

insert into public.automation_executions (
  id, automation_id, flow_version_id, organization_id, lead_id,
  status, current_node_key, locked_by, locked_at, attempt_count
) values
  ('b6000000-0000-4000-8000-000000000001', 'b4000000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000001', 'running', 'delay', 'lease-reply', now(), 1),
  ('b6000000-0000-4000-8000-000000000002', 'b4000000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000002', 'running', 'delay', 'lease-timeout', now(), 1),
  ('b6000000-0000-4000-8000-000000000003', 'b4000000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000003', 'running', 'delay', 'lease-race', now(), 1),
  ('b6000000-0000-4000-8000-000000000004', 'b4000000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000004', 'running', 'send', 'lease-send', now(), 1),
  ('b6000000-0000-4000-8000-000000000005', 'b4000000-0000-4000-8000-000000000002', 'b5000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000002', 'running', 'delay', 'lease-simple', now(), 1);

insert into public.automation_execution_steps (
  id, execution_id, organization_id, flow_version_id, node_key, node_type, status, attempt
) values
  ('b7000000-0000-4000-8000-000000000001', 'b6000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000001', 'delay', 'delay', 'running', 1),
  ('b7000000-0000-4000-8000-000000000002', 'b6000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000001', 'delay', 'delay', 'running', 1),
  ('b7000000-0000-4000-8000-000000000003', 'b6000000-0000-4000-8000-000000000003', 'b2000000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000001', 'delay', 'delay', 'running', 1),
  ('b7000000-0000-4000-8000-000000000005', 'b6000000-0000-4000-8000-000000000005', 'b2000000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000002', 'delay', 'delay', 'running', 1);

select ok(
  public.enter_automation_delay_wait(
    'b2000000-0000-4000-8000-000000000001',
    'b6000000-0000-4000-8000-000000000001',
    'b7000000-0000-4000-8000-000000000001',
    'delay', 'lease-reply', now() + interval '1 minute'
  ),
  'enter wait updates execution and step atomically'
);
select is((select status from public.automation_executions where id = 'b6000000-0000-4000-8000-000000000001'), 'waiting', 'execution is waiting');
select is((select status from public.automation_execution_steps where id = 'b7000000-0000-4000-8000-000000000001'), 'waiting', 'step is waiting');

select is(
  (public.resume_automation_delay(
    'b2000000-0000-4000-8000-000000000001',
    'b6000000-0000-4000-8000-000000000001',
    'replied', now(), '{"content":"sim"}'::jsonb,
    'b3000000-0000-4000-8000-000000000001', null
  )->>'status'),
  'queued',
  'reply resumes execution'
);
select is((select current_node_key from public.automation_executions where id = 'b6000000-0000-4000-8000-000000000001'), 'replied', 'reply branch advances exactly once');
select is((select status from public.automation_execution_steps where id = 'b7000000-0000-4000-8000-000000000001'), 'succeeded', 'reply closes waiting step');
select is((select output->>'branch' from public.automation_execution_steps where id = 'b7000000-0000-4000-8000-000000000001'), 'replied', 'reply branch is audited');

select ok(public.enter_automation_delay_wait('b2000000-0000-4000-8000-000000000001', 'b6000000-0000-4000-8000-000000000002', 'b7000000-0000-4000-8000-000000000002', 'delay', 'lease-timeout', now() + interval '1 minute'), 'second execution enters wait');
update public.automation_executions set next_execution_at = now() - interval '1 second' where id = 'b6000000-0000-4000-8000-000000000002';
select is((select count(*)::integer from public.release_due_automation_delays(10) released where released.id = 'b6000000-0000-4000-8000-000000000002'), 1, 'timeout worker releases due delay');
select is((select current_node_key from public.automation_executions where id = 'b6000000-0000-4000-8000-000000000002'), 'no_reply', 'timeout selects no_reply branch');
select is((select status from public.automation_execution_steps where id = 'b7000000-0000-4000-8000-000000000002'), 'succeeded', 'timeout closes waiting step');

select ok(public.enter_automation_delay_wait('b2000000-0000-4000-8000-000000000001', 'b6000000-0000-4000-8000-000000000003', 'b7000000-0000-4000-8000-000000000003', 'delay', 'lease-race', now() + interval '1 minute'), 'race execution enters wait');
insert into public.automation_event_outbox (
  id, organization_id, event_type, aggregate_type, aggregate_id, lead_id,
  dedupe_key, payload, status
) select
  'b8000000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000001',
  'message_received', 'lead', 'b3000000-0000-4000-8000-000000000003',
  'b3000000-0000-4000-8000-000000000003', 'runtime-race-reply',
  jsonb_build_object('occurred_at', step.started_at), 'pending'
from public.automation_execution_steps step
where step.id = 'b7000000-0000-4000-8000-000000000003';
update public.automation_executions execution
set next_execution_at = step.started_at
from public.automation_execution_steps step
where execution.id = 'b6000000-0000-4000-8000-000000000003'
  and step.id = 'b7000000-0000-4000-8000-000000000003';
select is((select count(*)::integer from public.release_due_automation_delays(10) released where released.id = 'b6000000-0000-4000-8000-000000000003'), 0, 'durable pending reply fences timeout worker');
select is(
  (public.resume_automation_delay(
    'b2000000-0000-4000-8000-000000000001',
    'b6000000-0000-4000-8000-000000000003',
    'replied',
    (select private.safe_automation_timestamptz(payload->>'occurred_at') from public.automation_event_outbox where id = 'b8000000-0000-4000-8000-000000000001'),
    '{}'::jsonb,
    'b3000000-0000-4000-8000-000000000003',
    null
  )->>'status'),
  'queued',
  'event consumer wins timeout race'
);
select is((select current_node_key from public.automation_executions where id = 'b6000000-0000-4000-8000-000000000003'), 'replied', 'race resolves to replied branch');

select ok(public.enter_automation_delay_wait('b2000000-0000-4000-8000-000000000001', 'b6000000-0000-4000-8000-000000000005', 'b7000000-0000-4000-8000-000000000005', 'delay', 'lease-simple', now() + interval '1 minute'), 'simple delay enters wait');
update public.automation_executions set next_execution_at = now() - interval '1 second' where id = 'b6000000-0000-4000-8000-000000000005';
select is((select count(*)::integer from public.release_due_automation_delays(10) released where released.id = 'b6000000-0000-4000-8000-000000000005'), 1, 'simple delay accepts legacy default branch');
select is((select current_node_key from public.automation_executions where id = 'b6000000-0000-4000-8000-000000000005'), 'next', 'simple delay advances to its next node');

select ok(
  coalesce((public.resolve_automation_whatsapp_conversation(
    'b2000000-0000-4000-8000-000000000001',
    'b6000000-0000-4000-8000-000000000004',
    'send', 'lease-send', 'b9000000-0000-4000-8000-000000000001'
  )->>'ok')::boolean, false),
  'lead without conversation gets a tenant-safe conversation'
);
select is((select count(*)::integer from public.whatsapp_conversations where organization_id = 'b2000000-0000-4000-8000-000000000001' and lead_id = 'b3000000-0000-4000-8000-000000000004'), 1, 'conversation is created once');
select is((select remote_jid from public.whatsapp_conversations where lead_id = 'b3000000-0000-4000-8000-000000000004'), '5511999999999@s.whatsapp.net', 'phone is normalized to canonical WhatsApp JID');
select ok((select conversation_id is not null from public.automation_executions where id = 'b6000000-0000-4000-8000-000000000004'), 'execution is bound to resolved conversation');
select ok(
  coalesce((public.resolve_automation_whatsapp_conversation(
    'b2000000-0000-4000-8000-000000000001',
    'b6000000-0000-4000-8000-000000000004',
    'send', 'lease-send', 'b9000000-0000-4000-8000-000000000001'
  )->>'ok')::boolean, false),
  'conversation resolution is idempotent'
);

insert into public.automation_effect_dispatches (
  organization_id, execution_id, node_key, effect_key, effect_type, status, request
) values (
  'b2000000-0000-4000-8000-000000000001',
  'b6000000-0000-4000-8000-000000000004',
  'send', 'automation:b6000000-0000-4000-8000-000000000004:send:send_whatsapp',
  'send_whatsapp', 'sending', '{"delivery_contract":"canonical_whatsapp_outbox_v1"}'::jsonb
);

select ok(
  coalesce((public.enqueue_automation_whatsapp_outbox(
    'b2000000-0000-4000-8000-000000000001',
    'b6000000-0000-4000-8000-000000000004',
    'send', 'lease-send',
    'automation:b6000000-0000-4000-8000-000000000004:send:send_whatsapp',
    (select conversation_id from public.automation_executions where id = 'b6000000-0000-4000-8000-000000000004'),
    'b9000000-0000-4000-8000-000000000001',
    'automation:b6000000-0000-4000-8000-000000000004:send:send_whatsapp',
    'text', 'Ola', null, null, null, null
  )->>'ok')::boolean, false),
  'automation delivery is accepted atomically by the canonical outbox'
);
select is((select count(*)::integer from public.whatsapp_messages where client_message_id = 'automation:b6000000-0000-4000-8000-000000000004:send:send_whatsapp'), 1, 'outbound history contains one queued message');
select is((select count(*)::integer from public.whatsapp_outbox where client_message_id = 'automation:b6000000-0000-4000-8000-000000000004:send:send_whatsapp'), 1, 'durable outbox contains one delivery');
select is((select status from public.whatsapp_outbox where client_message_id = 'automation:b6000000-0000-4000-8000-000000000004:send:send_whatsapp'), 'pending', 'delivery starts pending for the backend worker');
select is((select payload->>'action' from public.whatsapp_outbox where client_message_id = 'automation:b6000000-0000-4000-8000-000000000004:send:send_whatsapp'), 'send.text', 'outbox payload matches the Go worker contract');
select is((select count(*)::integer from public.lead_timeline_events where metadata->>'automation_effect_key' = 'automation:b6000000-0000-4000-8000-000000000004:send:send_whatsapp'), 1, 'timeline contains one automation event');
select is((select status from public.automation_effect_dispatches where effect_key = 'automation:b6000000-0000-4000-8000-000000000004:send:send_whatsapp'), 'succeeded', 'durable queue acceptance closes the effect ledger atomically');
select ok((select last_contact_at is null and first_response_at is null from public.leads where id = 'b3000000-0000-4000-8000-000000000004') and (select last_message = 'Ola' from public.whatsapp_conversations where lead_id = 'b3000000-0000-4000-8000-000000000004'), 'queue activity updates the preview without claiming provider delivery');
select is((select count(*)::integer from public.whatsapp_contact_identity_aliases where lead_id = 'b3000000-0000-4000-8000-000000000004'), 1, 'canonical identity alias is persisted');

select * from finish();
rollback;
