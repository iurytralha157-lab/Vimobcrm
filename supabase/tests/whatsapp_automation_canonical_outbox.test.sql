begin;

create extension if not exists pgtap with schema extensions;
select plan(28);

-- Local development still has the retired `name` column as NOT NULL. Give it
-- a transaction-local compatibility default while keeping every fixture and
-- the tested RPC on the production session contract.
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

select ok(
  not has_function_privilege(
    'public',
    'public.enqueue_automation_whatsapp_outbox(uuid,uuid,text,text,text,uuid,uuid,text,text,text,text,text,bigint,text)',
    'EXECUTE'
  ),
  'PUBLIC cannot enqueue automation WhatsApp deliveries'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.enqueue_automation_whatsapp_outbox(uuid,uuid,text,text,text,uuid,uuid,text,text,text,text,text,bigint,text)',
    'EXECUTE'
  ),
  'anon cannot enqueue automation WhatsApp deliveries'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.enqueue_automation_whatsapp_outbox(uuid,uuid,text,text,text,uuid,uuid,text,text,text,text,text,bigint,text)',
    'EXECUTE'
  ),
  'authenticated users cannot enqueue automation WhatsApp deliveries'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.enqueue_automation_whatsapp_outbox(uuid,uuid,text,text,text,uuid,uuid,text,text,text,text,text,bigint,text)',
    'EXECUTE'
  ),
  'only the service runtime can enqueue automation WhatsApp deliveries'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values
  ('00000000-0000-0000-0000-000000000000', 'cb000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'canonical-a@example.test', crypt('test-password', gen_salt('bf', 4)), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'cb000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'canonical-b@example.test', crypt('test-password', gen_salt('bf', 4)), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');

insert into public.organizations (id, name, slug, is_active)
values
  ('ca000000-0000-4000-8000-000000000001', 'Canonical Outbox A', 'canonical-outbox-a', true),
  ('ca000000-0000-4000-8000-000000000002', 'Canonical Outbox B', 'canonical-outbox-b', true);

insert into public.users (id, organization_id, name, email, role, is_active)
values
  ('cb000000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000001', 'Canonical Owner A', 'canonical-a@example.test', 'admin', true),
  ('cb000000-0000-4000-8000-000000000002', 'ca000000-0000-4000-8000-000000000002', 'Canonical Owner B', 'canonical-b@example.test', 'admin', true)
on conflict (id) do update
set organization_id = excluded.organization_id,
    name = excluded.name,
    email = excluded.email,
    role = excluded.role,
    is_active = excluded.is_active;

insert into public.organization_members (organization_id, user_id, role, is_active)
values
  ('ca000000-0000-4000-8000-000000000001', 'cb000000-0000-4000-8000-000000000001', 'admin', true),
  ('ca000000-0000-4000-8000-000000000002', 'cb000000-0000-4000-8000-000000000002', 'admin', true)
on conflict (user_id, organization_id) do update
set role = excluded.role,
    is_active = excluded.is_active;

insert into public.organization_modules (organization_id, module_name, is_enabled)
values
  ('ca000000-0000-4000-8000-000000000001', 'automations', true),
  ('ca000000-0000-4000-8000-000000000002', 'automations', true);

insert into public.leads (id, organization_id, name, phone, source)
values
  ('ca100000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000001', 'Text Lead', '5511999990001', 'manual'),
  ('ca100000-0000-4000-8000-000000000002', 'ca000000-0000-4000-8000-000000000001', 'Disconnected Lead', '5511999990002', 'manual'),
  ('ca100000-0000-4000-8000-000000000003', 'ca000000-0000-4000-8000-000000000001', 'Media Lead', '5511999990003', 'manual'),
  ('ca100000-0000-4000-8000-000000000004', 'ca000000-0000-4000-8000-000000000002', 'Foreign Lead', '5511999990004', 'manual');

insert into public.whatsapp_sessions (
  id, organization_id, owner_user_id, instance_name, provider, status, is_active
) values
  ('ca200000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000001', 'cb000000-0000-4000-8000-000000000001', 'canonical-connected', 'evolution_go', 'connected', true),
  ('ca200000-0000-4000-8000-000000000002', 'ca000000-0000-4000-8000-000000000001', 'cb000000-0000-4000-8000-000000000001', 'canonical-disconnected', 'evolution_go', 'disconnected', true),
  ('ca200000-0000-4000-8000-000000000003', 'ca000000-0000-4000-8000-000000000002', 'cb000000-0000-4000-8000-000000000002', 'canonical-foreign', 'evolution_go', 'connected', true);

insert into public.whatsapp_conversations (
  id, organization_id, session_id, lead_id, remote_jid, contact_phone, is_group
) values
  ('ca300000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000001', 'ca200000-0000-4000-8000-000000000001', 'ca100000-0000-4000-8000-000000000001', '5511999990001@s.whatsapp.net', '5511999990001', false),
  ('ca300000-0000-4000-8000-000000000002', 'ca000000-0000-4000-8000-000000000001', 'ca200000-0000-4000-8000-000000000002', 'ca100000-0000-4000-8000-000000000002', '5511999990002@s.whatsapp.net', '5511999990002', false),
  ('ca300000-0000-4000-8000-000000000003', 'ca000000-0000-4000-8000-000000000001', 'ca200000-0000-4000-8000-000000000001', 'ca100000-0000-4000-8000-000000000003', '5511999990003@s.whatsapp.net', '5511999990003', false),
  ('ca300000-0000-4000-8000-000000000004', 'ca000000-0000-4000-8000-000000000002', 'ca200000-0000-4000-8000-000000000003', 'ca100000-0000-4000-8000-000000000004', '5511999990004@s.whatsapp.net', '5511999990004', false);

insert into public.automations (
  id, organization_id, name, is_active, trigger_type, trigger_config, flow_definition
) values (
  'ca400000-0000-4000-8000-000000000001',
  'ca000000-0000-4000-8000-000000000001',
  'Canonical WhatsApp delivery', false, 'manual', '{}', '{}'
);

insert into public.automation_flow_versions (
  id, automation_id, organization_id, version, trigger_type, trigger_config,
  graph, graph_checksum, first_node_key, requires_review
) values (
  'ca500000-0000-4000-8000-000000000001',
  'ca400000-0000-4000-8000-000000000001',
  'ca000000-0000-4000-8000-000000000001',
  1, 'manual', '{}',
  '{"nodes":[{"id":"text","type":"action","action_type":"send_whatsapp","config":{}},{"id":"media","type":"action","action_type":"send_image","config":{}}],"connections":[],"settings":{}}',
  'canonical-outbox-contract', 'text', false
);

update public.automations
set active_flow_version_id = 'ca500000-0000-4000-8000-000000000001', is_active = true
where id = 'ca400000-0000-4000-8000-000000000001';

insert into public.automation_executions (
  id, automation_id, flow_version_id, organization_id, lead_id, conversation_id,
  status, current_node_key, locked_by, locked_at, attempt_count
) values
  ('ca600000-0000-4000-8000-000000000001', 'ca400000-0000-4000-8000-000000000001', 'ca500000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000001', 'ca100000-0000-4000-8000-000000000001', 'ca300000-0000-4000-8000-000000000001', 'running', 'text', 'lease-text', now(), 1),
  ('ca600000-0000-4000-8000-000000000002', 'ca400000-0000-4000-8000-000000000001', 'ca500000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000001', 'ca100000-0000-4000-8000-000000000002', 'ca300000-0000-4000-8000-000000000002', 'running', 'text', 'lease-disconnected', now(), 1),
  ('ca600000-0000-4000-8000-000000000003', 'ca400000-0000-4000-8000-000000000001', 'ca500000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000001', 'ca100000-0000-4000-8000-000000000003', 'ca300000-0000-4000-8000-000000000003', 'running', 'media', 'lease-media', now(), 1);

insert into public.automation_effect_dispatches (
  organization_id, execution_id, node_key, effect_key, effect_type, status, request
) values
  ('ca000000-0000-4000-8000-000000000001', 'ca600000-0000-4000-8000-000000000001', 'text', 'automation:ca600000-0000-4000-8000-000000000001:text:send_whatsapp', 'send_whatsapp', 'sending', '{"delivery_contract":"canonical_whatsapp_outbox_v1"}'),
  ('ca000000-0000-4000-8000-000000000001', 'ca600000-0000-4000-8000-000000000002', 'text', 'automation:ca600000-0000-4000-8000-000000000002:text:send_whatsapp', 'send_whatsapp', 'sending', '{"delivery_contract":"canonical_whatsapp_outbox_v1"}'),
  ('ca000000-0000-4000-8000-000000000001', 'ca600000-0000-4000-8000-000000000003', 'media', 'automation:ca600000-0000-4000-8000-000000000003:media:send_image', 'send_image', 'sending', '{"delivery_contract":"canonical_whatsapp_outbox_v1"}');

create temporary table canonical_text_result as
select public.enqueue_automation_whatsapp_outbox(
  'ca000000-0000-4000-8000-000000000001',
  'ca600000-0000-4000-8000-000000000001',
  'text', 'lease-text',
  'automation:ca600000-0000-4000-8000-000000000001:text:send_whatsapp',
  'ca300000-0000-4000-8000-000000000001',
  'ca200000-0000-4000-8000-000000000001',
  'automation:ca600000-0000-4000-8000-000000000001:text:send_whatsapp',
  'text', 'Ola pelo outbox', null, null, null, null
) as value;

select ok(coalesce((select (value->>'ok')::boolean from canonical_text_result), false), 'text automation is accepted by the durable queue');
select is((select status from public.whatsapp_messages where client_message_id = 'automation:ca600000-0000-4000-8000-000000000001:text:send_whatsapp'), 'queued', 'message is visible as queued before provider delivery');
select is(
  (select provider_message_id from public.whatsapp_messages where client_message_id = 'automation:ca600000-0000-4000-8000-000000000001:text:send_whatsapp'),
  '085DE8467FF0B5A5B54109A04A5A8873',
  'canonical message stores the provider id needed to merge a late outbound webhook'
);
select is((select status from public.whatsapp_outbox where client_message_id = 'automation:ca600000-0000-4000-8000-000000000001:text:send_whatsapp'), 'pending', 'outbox is pending for the Go worker');
select is(
  (select provider_message_id from public.whatsapp_outbox where client_message_id = 'automation:ca600000-0000-4000-8000-000000000001:text:send_whatsapp'),
  '085DE8467FF0B5A5B54109A04A5A8873',
  'outbox stores the same provider id used by the send payload for receipt reconciliation'
);
select is(
  (select payload from public.whatsapp_outbox where client_message_id = 'automation:ca600000-0000-4000-8000-000000000001:text:send_whatsapp'),
  '{"action":"send.text","body":{"id":"085DE8467FF0B5A5B54109A04A5A8873","number":"5511999990001","text":"Ola pelo outbox"}}'::jsonb,
  'text payload exactly matches the Go worker contract'
);
select throws_ok(
  $$update public.whatsapp_outbox
    set payload = jsonb_set(payload, '{body,id}', '"ATTACKER-CONTROLLED-ID"'::jsonb, true)
    where client_message_id = 'automation:ca600000-0000-4000-8000-000000000001:text:send_whatsapp'$$,
  '23514',
  'whatsapp_outbox_provider_request_id_mismatch',
  'provider idempotency key cannot be changed after durable acceptance'
);
select throws_ok(
  $$update public.whatsapp_outbox
    set provider_message_id = 'ATTACKER-CONTROLLED-ID'
    where client_message_id = 'automation:ca600000-0000-4000-8000-000000000001:text:send_whatsapp'$$,
  '23514',
  'whatsapp_outbox_provider_message_id_mismatch',
  'provider message id cannot diverge from the deterministic request id after durable acceptance'
);
select throws_ok(
  $$update public.whatsapp_outbox
    set payload = '{"action":"send.text"}'::jsonb
    where client_message_id = 'automation:ca600000-0000-4000-8000-000000000001:text:send_whatsapp'$$,
  '23514',
  'invalid_whatsapp_outbox_send_body',
  'send payload without a body fails closed before provider delivery'
);
select is((select status from public.automation_effect_dispatches where execution_id = 'ca600000-0000-4000-8000-000000000001'), 'succeeded', 'effect succeeds only after durable acceptance');
select is((select event_type from public.lead_timeline_events where metadata->>'automation_effect_key' = 'automation:ca600000-0000-4000-8000-000000000001:text:send_whatsapp'), 'whatsapp_message_queued', 'timeline records queue acceptance without claiming delivery');
select ok((select last_contact_at is null and first_response_at is null from public.leads where id = 'ca100000-0000-4000-8000-000000000001'), 'queue acceptance does not forge provider acknowledgement metrics');

with reaction_message as (
  insert into public.whatsapp_messages (
    organization_id, conversation_id, session_id, lead_id,
    message_id, client_message_id, from_me, direction,
    message_type, content, status, sent_at, metadata
  ) values (
    'ca000000-0000-4000-8000-000000000001',
    'ca300000-0000-4000-8000-000000000001',
    'ca200000-0000-4000-8000-000000000001',
    'ca100000-0000-4000-8000-000000000001',
    'queued:canonical-reaction', 'canonical-reaction-client', true, 'outbound',
    'reaction', '👍', 'queued', now(),
    '{"origin":"automation"}'::jsonb
  ) returning id
)
insert into public.whatsapp_outbox (
  organization_id, session_id, conversation_id, message_id,
  client_message_id, recipient_jid, message_type, payload, status
)
select
  'ca000000-0000-4000-8000-000000000001',
  'ca200000-0000-4000-8000-000000000001',
  'ca300000-0000-4000-8000-000000000001',
  reaction_message.id,
  'canonical-reaction-client', '5511999990001@s.whatsapp.net', 'reaction',
  '{"action":"message.react","body":{"id":"target-provider-message","messageId":"target-provider-message","reaction":"👍"}}'::jsonb,
  'pending'
from reaction_message;

select is(
  (select payload->'body'->>'id' from public.whatsapp_outbox where client_message_id = 'canonical-reaction-client'),
  'target-provider-message',
  'reaction target id is not rewritten as a send idempotency key'
);

select is(
  public.enqueue_automation_whatsapp_outbox(
    'ca000000-0000-4000-8000-000000000001',
    'ca600000-0000-4000-8000-000000000001',
    'text', 'lease-text',
    'automation:ca600000-0000-4000-8000-000000000001:text:send_whatsapp',
    'ca300000-0000-4000-8000-000000000001',
    'ca200000-0000-4000-8000-000000000001',
    'automation:ca600000-0000-4000-8000-000000000001:text:send_whatsapp',
    'text', 'Ola pelo outbox', null, null, null, null
  )->>'outbox_id',
  (select value->>'outbox_id' from canonical_text_result),
  'identical replay returns the canonical outbox row'
);
select ok(
  (select count(*) = 1 from public.whatsapp_messages where client_message_id = 'automation:ca600000-0000-4000-8000-000000000001:text:send_whatsapp')
  and (select count(*) = 1 from public.whatsapp_outbox where client_message_id = 'automation:ca600000-0000-4000-8000-000000000001:text:send_whatsapp')
  and (select count(*) = 1 from public.lead_timeline_events where metadata->>'automation_effect_key' = 'automation:ca600000-0000-4000-8000-000000000001:text:send_whatsapp'),
  'idempotent replay cannot duplicate message, outbox, or timeline rows'
);

select throws_ok(
  $$select public.enqueue_automation_whatsapp_outbox(
    'ca000000-0000-4000-8000-000000000001', 'ca600000-0000-4000-8000-000000000001',
    'text', 'lease-text', 'automation:ca600000-0000-4000-8000-000000000001:text:send_whatsapp',
    'ca300000-0000-4000-8000-000000000001', 'ca200000-0000-4000-8000-000000000001',
    'automation:ca600000-0000-4000-8000-000000000001:text:send_whatsapp',
    'text', 'Conteudo diferente', null, null, null, null
  )$$,
  '23505', 'automation_whatsapp_message_idempotency_collision',
  'same effect key cannot be reused with different content'
);
select throws_ok(
  $$select public.enqueue_automation_whatsapp_outbox(
    'ca000000-0000-4000-8000-000000000001', 'ca600000-0000-4000-8000-000000000001',
    'text', 'lease-text', 'automation:ca600000-0000-4000-8000-000000000001:text:send_whatsapp',
    'ca300000-0000-4000-8000-000000000004', 'ca200000-0000-4000-8000-000000000001',
    'automation:ca600000-0000-4000-8000-000000000001:text:send_whatsapp',
    'text', 'Ola pelo outbox', null, null, null, null
  )$$,
  '23514', 'automation_whatsapp_queue_context_mismatch',
  'conversation from another tenant cannot be queued'
);
select throws_ok(
  $$select public.enqueue_automation_whatsapp_outbox(
    'ca000000-0000-4000-8000-000000000001', 'ca600000-0000-4000-8000-000000000001',
    'text', 'lease-text', 'automation:ca600000-0000-4000-8000-000000000001:text:send_whatsapp',
    'ca300000-0000-4000-8000-000000000003', 'ca200000-0000-4000-8000-000000000001',
    'automation:ca600000-0000-4000-8000-000000000001:text:send_whatsapp',
    'text', 'Ola pelo outbox', null, null, null, null
  )$$,
  '23514', 'automation_whatsapp_queue_context_mismatch',
  'conversation from another lead in the same tenant cannot be queued'
);
select throws_ok(
  $$select public.enqueue_automation_whatsapp_outbox(
    'ca000000-0000-4000-8000-000000000001', 'ca600000-0000-4000-8000-000000000002',
    'text', 'lease-disconnected', 'automation:ca600000-0000-4000-8000-000000000002:text:send_whatsapp',
    'ca300000-0000-4000-8000-000000000002', 'ca200000-0000-4000-8000-000000000002',
    'automation:ca600000-0000-4000-8000-000000000002:text:send_whatsapp',
    'text', 'Nao pode sair', null, null, null, null
  )$$,
  '23514', 'automation_whatsapp_queue_context_mismatch',
  'disconnected session fails closed before queueing'
);
select ok(
  (select status = 'sending' from public.automation_effect_dispatches where execution_id = 'ca600000-0000-4000-8000-000000000002')
  and (select count(*) = 0 from public.whatsapp_outbox where client_message_id = 'automation:ca600000-0000-4000-8000-000000000002:text:send_whatsapp'),
  'failed disconnected preflight leaves effect retryable and creates no outbox row'
);

select throws_ok(
  $$select public.enqueue_automation_whatsapp_outbox(
    'ca000000-0000-4000-8000-000000000001', 'ca600000-0000-4000-8000-000000000003',
    'media', 'lease-media', 'automation:ca600000-0000-4000-8000-000000000003:media:send_image',
    'ca300000-0000-4000-8000-000000000003', 'ca200000-0000-4000-8000-000000000001',
    'automation:ca600000-0000-4000-8000-000000000003:media:send_image',
    'image', 'Legenda', 'image/jpeg',
    'orgs/ca000000-0000-4000-8000-000000000002/sessions/ca200000-0000-4000-8000-000000000003/outgoing/foreign.jpg',
    1024, 'foto.jpg'
  )$$,
  '22023', 'invalid_or_cross_tenant_automation_whatsapp_media',
  'media path from another tenant fails closed'
);
select ok(
  (select status = 'sending' from public.automation_effect_dispatches where execution_id = 'ca600000-0000-4000-8000-000000000003')
  and (select count(*) = 0 from public.whatsapp_outbox where client_message_id = 'automation:ca600000-0000-4000-8000-000000000003:media:send_image'),
  'rejected media path leaves effect retryable and creates no outbox row'
);

create temporary table canonical_media_result as
select public.enqueue_automation_whatsapp_outbox(
  'ca000000-0000-4000-8000-000000000001',
  'ca600000-0000-4000-8000-000000000003',
  'media', 'lease-media',
  'automation:ca600000-0000-4000-8000-000000000003:media:send_image',
  'ca300000-0000-4000-8000-000000000003',
  'ca200000-0000-4000-8000-000000000001',
  'automation:ca600000-0000-4000-8000-000000000003:media:send_image',
  'image', 'Legenda', 'image/jpeg',
  'orgs/ca000000-0000-4000-8000-000000000001/sessions/ca200000-0000-4000-8000-000000000001/outgoing/photo.jpg',
  1024, 'foto.jpg'
) as value;

select ok(coalesce((select (value->>'ok')::boolean from canonical_media_result), false), 'same-tenant persisted media is accepted');
select is(
  (select payload from public.whatsapp_outbox where client_message_id = 'automation:ca600000-0000-4000-8000-000000000003:media:send_image'),
  '{"action":"send.media","body":{"id":"F5650B46629639D37ADE7BBED4329011","number":"5511999990003","type":"image","mediatype":"image","mediaType":"image","caption":"Legenda","mimetype":"image/jpeg","filename":"foto.jpg","mediaStoragePath":"orgs/ca000000-0000-4000-8000-000000000001/sessions/ca200000-0000-4000-8000-000000000001/outgoing/photo.jpg"}}'::jsonb,
  'media payload carries a private storage path for fresh worker signing'
);

select * from finish();
rollback;
