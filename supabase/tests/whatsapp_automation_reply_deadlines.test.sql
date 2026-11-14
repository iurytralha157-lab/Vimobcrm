begin;

create extension if not exists pgtap with schema extensions;
select plan(14);

select ok(
  not has_table_privilege('anon', 'private.whatsapp_automation_pending_replies', 'select')
  and not has_table_privilege('authenticated', 'private.whatsapp_automation_pending_replies', 'insert')
  and not has_table_privilege('service_role', 'private.whatsapp_automation_pending_replies', 'insert'),
  'webhook candidate evidence is writable only by the internal database owner'
);
select ok(
  not has_function_privilege('authenticated', 'public.resume_automation_delay(uuid,uuid,text,timestamptz,jsonb,uuid,uuid)', 'execute')
  and has_function_privilege('service_role', 'public.release_due_automation_delays(integer)', 'execute'),
  'existing wait RPC permissions remain intact'
);

do $compat$
begin
  if exists (
    select 1 from pg_catalog.pg_attribute
    where attrelid = 'public.whatsapp_sessions'::regclass and attname = 'name' and not attisdropped
  ) then
    execute $sql$alter table public.whatsapp_sessions alter column name set default 'Reply deadline fixture'$sql$;
  end if;
end;
$compat$;

create temporary table reply_fixture as
select gen_random_uuid() as owner_id, gen_random_uuid() as organization_id,
       gen_random_uuid() as session_id, gen_random_uuid() as generation,
       gen_random_uuid() as automation_id, gen_random_uuid() as flow_id;

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
select '00000000-0000-0000-0000-000000000000', owner_id, 'authenticated', 'authenticated',
       'automation-reply-deadlines@example.test', now(), '{"provider":"email"}', '{}'
from reply_fixture;

insert into public.organizations (id, name, slug, is_active)
select organization_id, 'Reply deadline fixture', 'automation-reply-deadlines-test', true from reply_fixture;

insert into public.users (id, organization_id, name, email, role, is_active)
select owner_id, organization_id, 'Fixture owner', 'automation-reply-deadlines@example.test', 'admin', true
from reply_fixture
on conflict (id) do update set organization_id = excluded.organization_id, role = excluded.role, is_active = true;

insert into public.organization_members (organization_id, user_id, role, is_active)
select organization_id, owner_id, 'admin', true from reply_fixture
on conflict (user_id, organization_id) do update set role = excluded.role, is_active = true;

insert into public.organization_modules (organization_id, module_name, is_enabled)
select organization_id, 'automations', true from reply_fixture;

insert into public.whatsapp_sessions (
  id, organization_id, owner_user_id, instance_name, provider, status, is_active, automation_reply_generation
)
select session_id, organization_id, owner_id, 'reply-deadline-fixture', 'evolution_go', 'connected', true, generation
from reply_fixture;

insert into public.automations (id, organization_id, name, is_active, trigger_type, trigger_config, flow_definition)
select automation_id, organization_id, 'Reply deadline fixture', false, 'manual', '{}', '{}' from reply_fixture;

insert into public.automation_flow_versions (
  id, automation_id, organization_id, version, trigger_type, trigger_config,
  graph, graph_checksum, first_node_key, requires_review, created_by
)
select flow_id, automation_id, organization_id, 1, 'manual', '{}',
       '{"nodes":[
           {"id":"delay","type":"delay","config":{"delay_value":1,"delay_type":"minutes","stop_on_reply":true}},
           {"id":"replied","type":"action","action_type":"send_whatsapp","config":{}},
           {"id":"no_reply","type":"action","action_type":"send_whatsapp","config":{}}
         ],"connections":[
           {"source":"delay","target":"replied","condition_branch":"replied"},
           {"source":"delay","target":"no_reply","condition_branch":"no_reply"}
         ]}', 'reply-deadline-test', 'delay', false, owner_id
from reply_fixture;

create temporary table reply_waits as
select fixture.*, test_number, gen_random_uuid() as lead_id, gen_random_uuid() as conversation_id,
       gen_random_uuid() as execution_id, gen_random_uuid() as inbox_id,
       '551198888010' || test_number as phone,
       now() - test_number * interval '3 seconds' as deadline
from reply_fixture fixture cross join generate_series(1, 2) test_number;

insert into public.leads (id, organization_id, name, source, phone)
select lead_id, organization_id, 'Reply deadline lead ' || test_number, 'manual', phone from reply_waits;

insert into public.whatsapp_conversations (id, organization_id, session_id, remote_jid, contact_phone, is_group)
select conversation_id, organization_id, session_id, phone || '@s.whatsapp.net', phone, false from reply_waits;

select public.activate_whatsapp_conversation_lead_binding(organization_id, conversation_id, lead_id, null)
from reply_waits;

insert into public.automation_executions (
  id, automation_id, flow_version_id, organization_id, lead_id, conversation_id,
  status, current_node_key, next_execution_at, attempt_count
)
select execution_id, automation_id, flow_id, organization_id, lead_id,
       case when test_number = 2 then null else conversation_id end,
       'waiting', 'delay', deadline, 1
from reply_waits;

insert into public.automation_execution_steps (
  execution_id, organization_id, flow_version_id, node_key, node_type, status, attempt, started_at
)
select execution_id, organization_id, flow_id, 'delay', 'delay', 'waiting', 1, deadline - interval '1 minute'
from reply_waits;

insert into public.whatsapp_webhook_inbox (
  id, organization_id, session_id, event_key, event_type, payload,
  processing_lane, status, created_at, locked_at, locked_by
)
select inbox_id, organization_id, session_id, 'reply-deadline-' || test_number, 'message',
       '{"__vimob_ingress":{"routing_snapshot":{"version":1}}}',
       'live', 'processing', deadline - interval '1 second', now(), 'synthetic-worker'
from reply_waits where test_number = 2;

insert into private.whatsapp_automation_pending_replies (
  organization_id, session_id, conversation_id, lead_id, binding_id, account_generation, inbox_id,
  provider_message_id, provider_occurred_at, inbox_accepted_at, hold_until
)
select wait.organization_id, wait.session_id, wait.conversation_id, wait.lead_id, binding.id, wait.generation,
       wait.inbox_id, 'exact-reply', wait.deadline - interval '1.5 seconds', wait.deadline - interval '1 second',
       wait.deadline + interval '20 seconds'
from reply_waits wait
join public.whatsapp_conversation_lead_bindings binding on binding.conversation_id = wait.conversation_id
where wait.test_number = 2 and binding.active_to is null;

select is(
  (public.resume_automation_delay(organization_id, execution_id, 'elapsed')->>'status'),
  'reply_pending', 'pending reply admitted before deadline holds a reply-aware wait without a conversation yet'
) from reply_waits where test_number = 2;

select is(
  (select id from public.release_due_automation_delays(1)),
  (select execution_id from reply_waits where test_number = 1),
  'oldest held wait leaves the only sweep slot for an unrelated due wait'
);

select is(
  (select current_node_key from public.automation_executions where id = reply_waits.execution_id),
  'no_reply', 'unrelated wait without a candidate keeps its timeout branch'
) from reply_waits where test_number = 1;

select ok(not private.whatsapp_automation_reply_pending_for_wait(
  organization_id, lead_id, gen_random_uuid(), deadline - interval '1 minute', deadline
), 'pending reply scope rejects another conversation') from reply_waits where test_number = 2;

select ok(not private.whatsapp_automation_reply_pending_for_wait(
  gen_random_uuid(), lead_id, conversation_id, deadline - interval '1 minute', deadline
), 'pending reply scope rejects another organization') from reply_waits where test_number = 2;

update private.whatsapp_automation_pending_replies set account_generation = gen_random_uuid()
where organization_id = (select organization_id from reply_fixture);

select ok(not private.whatsapp_automation_reply_pending_for_wait(
  organization_id, lead_id, conversation_id, deadline - interval '1 minute', deadline
), 'the same UUID session on a different provider account generation cannot hold a wait')
from reply_waits where test_number = 2;

update private.whatsapp_automation_pending_replies pending
set account_generation = wait.generation, hold_until = wait.deadline
from reply_waits wait where wait.inbox_id = pending.inbox_id;

select ok(not private.whatsapp_automation_reply_pending_for_wait(
  organization_id, lead_id, conversation_id, deadline - interval '1 minute', deadline
), 'expired confirmation candidates cannot keep a timeout waiting') from reply_waits where test_number = 2;

update private.whatsapp_automation_pending_replies pending
set hold_until = wait.deadline + interval '20 seconds'
from reply_waits wait where wait.inbox_id = pending.inbox_id;

select ok(not private.whatsapp_automation_reply_pending_for_wait(
  organization_id, lead_id, conversation_id, deadline - interval '1 minute', deadline - interval '1.25 seconds'
), 'provider occurrence cannot hold an earlier wait if durable admission was late')
from reply_waits where test_number = 2;

insert into public.whatsapp_messages (
  organization_id, conversation_id, session_id, lead_id, provider_message_id, message_id, from_me,
  direction, message_type, content, status, received_at, capture_state, metadata
)
select organization_id, conversation_id, session_id, lead_id, 'forged-marker', 'forged-marker', false,
       'inbound', 'text', 'forged', 'received', now(), 'captured',
       jsonb_build_object('whatsapp_event_binding_is_current', true, 'automation_reply_inbox_id', inbox_id::text)
from reply_waits where test_number = 2;

select is((select count(*)::integer from public.automation_event_outbox where organization_id = reply_fixture.organization_id
  and event_type = 'message_received' and payload->>'content' = 'forged'),
  0, 'marking an unrelated provider message does not authorize a reply event') from reply_fixture;

insert into public.whatsapp_messages (
  organization_id, conversation_id, session_id, lead_id, provider_message_id, message_id, from_me,
  direction, message_type, content, status, received_at, capture_state, metadata
)
select organization_id, conversation_id, session_id, lead_id, 'exact-reply', 'exact-reply', false,
       'inbound', 'text', 'timely reply', 'received', now(), 'captured',
       jsonb_build_object('whatsapp_event_binding_is_current', true, 'automation_reply_inbox_id', inbox_id::text)
from reply_waits where test_number = 2;

delete from private.whatsapp_automation_pending_replies
where organization_id = (select organization_id from reply_fixture) and provider_message_id = 'exact-reply';

select is(
  (select (event.payload->>'occurred_at')::timestamptz = wait.deadline - interval '1.5 seconds'
          and (event.payload->>'automation_reply_inbox_accepted_at')::timestamptz = wait.deadline - interval '1 second'
   from public.automation_event_outbox event
   where event.organization_id = wait.organization_id and event.lead_id = wait.lead_id
     and event.event_type = 'message_received' and event.payload->>'content' = 'timely reply'),
  true, 'promotion uses occurrence and durable admission rather than retry processing time'
) from reply_waits wait where wait.test_number = 2;

select is(
  public.resume_automation_delay(organization_id, execution_id, 'elapsed')->>'status',
  'reply_pending', 'persisted event keeps the same wait held after the candidate disappears'
) from reply_waits where test_number = 2;

select public.process_automation_inbound_message(
  organization_id, lead_id, conversation_id, aggregate_id,
  payload->>'message_type', payload->>'content', (payload->>'occurred_at')::timestamptz
)
from public.automation_event_outbox
where organization_id = (select organization_id from reply_fixture)
  and event_type = 'message_received' and payload->>'content' = 'timely reply';

select is(
  (select current_node_key from public.automation_executions where id = reply_waits.execution_id),
  'replied', 'a reply accepted before deadline still takes replied when processing ran later'
) from reply_waits where test_number = 2;

select * from finish();
rollback;
