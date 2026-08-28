begin;

create extension if not exists pgtap with schema extensions;
select plan(85);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  ('00000000-0000-0000-0000-000000000000', 'c1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'wa-assigned@example.test', crypt('test-password', gen_salt('bf', 4)), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'c1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'wa-other@example.test', crypt('test-password', gen_salt('bf', 4)), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'c1000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'wa-admin@example.test', crypt('test-password', gen_salt('bf', 4)), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'c1000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'wa-cross@example.test', crypt('test-password', gen_salt('bf', 4)), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');

insert into public.organizations (id, name, slug, is_active)
values
  ('c2000000-0000-4000-8000-000000000001', 'WhatsApp Durable Org A', 'whatsapp-durable-org-a', true),
  ('c2000000-0000-4000-8000-000000000002', 'WhatsApp Durable Org B', 'whatsapp-durable-org-b', true);

insert into public.users (id, organization_id, name, email, role, is_active)
values
  ('c1000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'Assigned Broker', 'wa-assigned@example.test', 'user', true),
  ('c1000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000001', 'Other Broker', 'wa-other@example.test', 'user', true),
  ('c1000000-0000-4000-8000-000000000003', 'c2000000-0000-4000-8000-000000000001', 'Org Admin', 'wa-admin@example.test', 'admin', true),
  ('c1000000-0000-4000-8000-000000000004', 'c2000000-0000-4000-8000-000000000002', 'Cross Org Broker', 'wa-cross@example.test', 'user', true)
on conflict (id) do update
set organization_id = excluded.organization_id,
    name = excluded.name,
    email = excluded.email,
    role = excluded.role,
    is_active = excluded.is_active;

insert into public.organization_members (organization_id, user_id, role, is_active)
values
  ('c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'user', true),
  ('c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002', 'user', true),
  ('c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000003', 'admin', true),
  ('c2000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000004', 'user', true)
on conflict (user_id, organization_id) do update
set role = excluded.role,
    is_active = excluded.is_active;

insert into public.leads (id, organization_id, assigned_user_id, name, source)
values
  ('c3000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'WhatsApp Lead A', 'meta_ads'),
  ('c3000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000004', 'WhatsApp Lead B', 'meta_ads');

insert into public.whatsapp_sessions (
  id, organization_id, owner_user_id, instance_name, provider, status, is_active
)
values
  ('c4000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'whatsapp-durable-a', 'evolution_go', 'connected', true),
  ('c4000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000004', 'whatsapp-durable-b', 'evolution_go', 'connected', true),
  ('c4000000-0000-4000-8000-000000000003', 'c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'whatsapp-durable-a2', 'evolution_go', 'connected', true);

insert into public.whatsapp_conversations (
  id, organization_id, session_id, lead_id, assigned_user_id, remote_jid, contact_name
)
values
  ('c5000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', '5511999990001@s.whatsapp.net', 'Lead A'),
  ('c5000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001', null, null, '5511999990099@s.whatsapp.net', 'Quarantine'),
  ('c5000000-0000-4000-8000-000000000003', 'c2000000-0000-4000-8000-000000000002', 'c4000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000004', '5511999990002@s.whatsapp.net', 'Lead B');

insert into public.whatsapp_messages (
  id, organization_id, conversation_id, session_id, lead_id,
  provider_message_id, message_id, client_message_id, from_me, direction,
  message_type, content, remote_jid, status
)
values
  ('c6000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001', null, 'canonical-client-a', 'canonical-client-a', true, 'outbound', 'text', 'Mensagem A', '5511999990001@s.whatsapp.net', 'pending'),
  ('c6000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001', null, 'canonical-client-a-2', 'canonical-client-a-2', true, 'outbound', 'text', 'Mensagem A2', '5511999990001@s.whatsapp.net', 'pending'),
  ('c6000000-0000-4000-8000-000000000003', 'c2000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000002', 'c4000000-0000-4000-8000-000000000001', null, 'provider-quarantine', 'provider-quarantine', null, false, 'inbound', 'text', 'Mensagem em quarentena', '5511999990099@s.whatsapp.net', 'received'),
  ('c6000000-0000-4000-8000-000000000004', 'c2000000-0000-4000-8000-000000000002', 'c5000000-0000-4000-8000-000000000003', 'c4000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000002', 'provider-b', 'provider-b', null, false, 'inbound', 'text', 'Mensagem B', '5511999990002@s.whatsapp.net', 'received');

create temporary table whatsapp_durable_test_ids (
  key text primary key,
  id uuid not null
);

select has_table('public', 'whatsapp_webhook_inbox', 'durable webhook inbox exists');
select has_table('public', 'whatsapp_outbox', 'durable WhatsApp outbox exists');
select has_table('public', 'whatsapp_message_reactions', 'normalized reaction table exists');
select has_column('public', 'whatsapp_messages', 'updated_at', 'message status updates have an updated_at contract');
select has_index('public', 'whatsapp_messages', 'whatsapp_messages_org_session_client_message_uidx', 'canonical client message idempotency index exists');
select has_index('public', 'whatsapp_messages', 'whatsapp_messages_org_conversation_timeline_idx', 'conversation timeline has a tenant-scoped keyset index');
select has_index('public', 'whatsapp_webhook_inbox', 'whatsapp_webhook_inbox_expiry_idx', 'processed webhook retention cleanup has an expiry index');
select has_index('public', 'whatsapp_outbox', 'whatsapp_outbox_terminal_retention_idx', 'terminal outbox retention has a bounded cleanup index');
select ok(
  (
    select trigger_definition ilike '%content%'
      and trigger_definition ilike '%message_type%'
      and trigger_definition ilike '%reaction_emoji%'
      and trigger_definition ilike '%reaction_to_message_id%'
    from (
      select pg_get_triggerdef(oid) as trigger_definition
      from pg_trigger
      where tgrelid = 'public.whatsapp_messages'::regclass
        and tgname = 'whatsapp_message_private_broadcast'
        and not tgisinternal
    ) as trigger_contract
  ),
  'private message broadcast covers edit, delete-shape and reaction fields'
);
select ok(
  pg_get_functiondef('private.broadcast_whatsapp_message_change()'::regprocedure) ilike '%exception when others%',
  'private Realtime hint failures are caught inside the trigger function'
);

savepoint before_whatsapp_realtime_forced_failure;
create or replace function private.broadcast_whatsapp_message_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    raise exception 'forced WhatsApp Realtime failure';
  exception when others then
    return null;
  end;
end;
$$;
select lives_ok(
  $$
    insert into public.whatsapp_messages (
      id, organization_id, conversation_id, session_id, lead_id,
      provider_message_id, message_id, from_me, direction,
      message_type, content, remote_jid, status
    ) values (
      'c6000000-0000-4000-8000-000000000005',
      'c2000000-0000-4000-8000-000000000001',
      'c5000000-0000-4000-8000-000000000001',
      'c4000000-0000-4000-8000-000000000001',
      'c3000000-0000-4000-8000-000000000001',
      'provider-realtime-failure-test', 'provider-realtime-failure-test',
      false, 'inbound', 'text', 'Canonical survives Realtime failure',
      '5511999990001@s.whatsapp.net', 'received'
    )
  $$,
  'canonical message insert survives a forced Realtime broadcast failure'
);
select ok(
  exists (
    select 1 from public.whatsapp_messages
    where id = 'c6000000-0000-4000-8000-000000000005'
      and content = 'Canonical survives Realtime failure'
  ),
  'canonical message remains committed after the Realtime hint fails'
);
rollback to savepoint before_whatsapp_realtime_forced_failure;

select is((select relrowsecurity from pg_class where oid = 'public.whatsapp_webhook_inbox'::regclass), true, 'inbox has RLS enabled');
select is((select relrowsecurity from pg_class where oid = 'public.whatsapp_outbox'::regclass), true, 'outbox has RLS enabled');
select is((select relrowsecurity from pg_class where oid = 'public.whatsapp_message_reactions'::regclass), true, 'reactions have RLS enabled');

select is(has_table_privilege('authenticated', 'public.whatsapp_webhook_inbox', 'select'), false, 'authenticated cannot read raw webhook payloads');
select is(has_table_privilege('authenticated', 'public.whatsapp_outbox', 'select'), false, 'authenticated cannot read worker outbox state');
select is(has_table_privilege('authenticated', 'public.whatsapp_message_reactions', 'select'), false, 'authenticated cannot bypass message authorization through reactions');
select is(has_table_privilege('service_role', 'public.whatsapp_webhook_inbox', 'select'), true, 'service role can process webhook inbox');
select is(has_table_privilege('service_role', 'public.whatsapp_outbox', 'select'), true, 'service role can process outbox');
select is(has_table_privilege('service_role', 'public.whatsapp_message_reactions', 'select'), true, 'service role can process normalized reactions');
select is(has_function_privilege('authenticated', 'private.claim_whatsapp_webhook_inbox(text,integer,interval)', 'execute'), false, 'authenticated cannot claim webhook jobs');
select is(has_function_privilege('authenticated', 'private.claim_whatsapp_outbox(text,integer,interval)', 'execute'), false, 'authenticated cannot claim outbound jobs');
select is(has_function_privilege('service_role', 'private.enqueue_whatsapp_webhook_event(uuid,uuid,text,text,text,text,jsonb,integer)', 'execute'), true, 'service role can durably enqueue webhooks');
select is(has_function_privilege('service_role', 'private.enqueue_whatsapp_outbox(uuid,uuid,uuid,uuid,text,text,text,jsonb,integer)', 'execute'), true, 'service role can transactionally enqueue outbound delivery');

select ok(
  not has_table_privilege('authenticated', 'public.whatsapp_sessions', 'insert')
  and not has_table_privilege('authenticated', 'public.whatsapp_sessions', 'update')
  and not has_table_privilege('authenticated', 'public.whatsapp_sessions', 'delete'),
  'authenticated cannot mutate WhatsApp sessions directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.whatsapp_conversations', 'insert')
  and not has_table_privilege('authenticated', 'public.whatsapp_conversations', 'update')
  and not has_table_privilege('authenticated', 'public.whatsapp_conversations', 'delete'),
  'authenticated cannot bypass the backend to mutate conversations'
);
select ok(
  not has_table_privilege('authenticated', 'public.whatsapp_messages', 'insert')
  and not has_table_privilege('authenticated', 'public.whatsapp_messages', 'update')
  and not has_table_privilege('authenticated', 'public.whatsapp_messages', 'delete'),
  'authenticated cannot bypass the durable outbox to mutate messages'
);
select ok(
  not has_table_privilege('anon', 'public.whatsapp_sessions', 'select')
  and not has_table_privilege('anon', 'public.whatsapp_sessions', 'insert')
  and not has_table_privilege('anon', 'public.whatsapp_sessions', 'update')
  and not has_table_privilege('anon', 'public.whatsapp_sessions', 'delete')
  and not has_table_privilege('anon', 'public.whatsapp_conversations', 'select')
  and not has_table_privilege('anon', 'public.whatsapp_conversations', 'insert')
  and not has_table_privilege('anon', 'public.whatsapp_conversations', 'update')
  and not has_table_privilege('anon', 'public.whatsapp_conversations', 'delete')
  and not has_table_privilege('anon', 'public.whatsapp_messages', 'select')
  and not has_table_privilege('anon', 'public.whatsapp_messages', 'insert')
  and not has_table_privilege('anon', 'public.whatsapp_messages', 'update')
  and not has_table_privilege('anon', 'public.whatsapp_messages', 'delete'),
  'anonymous clients have no direct access to raw WhatsApp aggregates'
);
select ok(
  has_table_privilege('service_role', 'public.whatsapp_sessions', 'select')
  and has_table_privilege('service_role', 'public.whatsapp_sessions', 'insert')
  and has_table_privilege('service_role', 'public.whatsapp_sessions', 'update')
  and has_table_privilege('service_role', 'public.whatsapp_sessions', 'delete')
  and has_table_privilege('service_role', 'public.whatsapp_conversations', 'select')
  and has_table_privilege('service_role', 'public.whatsapp_conversations', 'insert')
  and has_table_privilege('service_role', 'public.whatsapp_conversations', 'update')
  and has_table_privilege('service_role', 'public.whatsapp_conversations', 'delete')
  and has_table_privilege('service_role', 'public.whatsapp_messages', 'select')
  and has_table_privilege('service_role', 'public.whatsapp_messages', 'insert')
  and has_table_privilege('service_role', 'public.whatsapp_messages', 'update')
  and has_table_privilege('service_role', 'public.whatsapp_messages', 'delete'),
  'service role retains raw WhatsApp CRUD for the Go API'
);
select is(
  has_table_privilege('authenticated', 'public.whatsapp_sessions', 'select'),
  false,
  'authenticated has no table-wide session SELECT grant'
);
select ok(
  not has_column_privilege('authenticated', 'public.whatsapp_sessions', 'advanced_settings', 'select')
  and not has_column_privilege('authenticated', 'public.whatsapp_sessions', 'qr_code', 'select')
  and not has_column_privilege('authenticated', 'public.whatsapp_sessions', 'last_error', 'select')
  and not has_column_privilege('authenticated', 'public.whatsapp_sessions', 'instance_id', 'select')
  and not has_column_privilege('authenticated', 'public.whatsapp_conversations', 'metadata', 'select')
  and not has_column_privilege('authenticated', 'public.whatsapp_messages', 'metadata', 'select')
  and not has_column_privilege('authenticated', 'public.whatsapp_messages', 'media_storage_path', 'select')
  and not has_column_privilege('authenticated', 'public.whatsapp_messages', 'media_error', 'select'),
  'provider metadata, media internals and session diagnostics are hidden from PostgREST clients'
);
select ok(
  not has_column_privilege('authenticated', 'public.whatsapp_sessions', 'id', 'select')
  and not has_column_privilege('authenticated', 'public.whatsapp_sessions', 'status', 'select')
  and not has_column_privilege('authenticated', 'public.whatsapp_sessions', 'phone_number', 'select'),
  'authenticated cannot query even safe session columns outside the authorized Go API'
);
select is(has_table_privilege('authenticated', 'public.whatsapp_conversations', 'select'), false, 'authenticated cannot query raw conversations through PostgREST');
select is(has_table_privilege('authenticated', 'public.whatsapp_messages', 'select'), false, 'authenticated cannot query raw message history through PostgREST');
select is(
  (
    select count(*)::bigint
    from pg_policies
    where schemaname = 'public'
      and tablename in ('whatsapp_sessions', 'whatsapp_conversations', 'whatsapp_messages')
  ),
  0::bigint,
  'browser-facing WhatsApp tables expose no direct PostgREST policies'
);

insert into whatsapp_durable_test_ids (key, id)
select 'event', private.enqueue_whatsapp_webhook_event(
  'c2000000-0000-4000-8000-000000000001',
  'c4000000-0000-4000-8000-000000000001',
  'evolution_go', 'instance-a', 'evolution_go:c400:event-1', 'messages.upsert',
  '{"message":{"id":"provider-inbound-a"}}'::jsonb, 12
);

select ok((select id is not null from whatsapp_durable_test_ids where key = 'event'), 'webhook event gets a durable id');
select is(
  private.enqueue_whatsapp_webhook_event(
    'c2000000-0000-4000-8000-000000000001',
    'c4000000-0000-4000-8000-000000000001',
    'evolution_go', 'instance-a', 'evolution_go:c400:event-1', 'messages.upsert',
    '{"message":{"id":"provider-inbound-a"}}'::jsonb, 12
  ),
  (select id from whatsapp_durable_test_ids where key = 'event'),
  'duplicate webhook delivery resolves to the canonical inbox row'
);
select is((select count(*)::bigint from public.whatsapp_webhook_inbox where event_key = 'evolution_go:c400:event-1'), 1::bigint, 'duplicate webhook is persisted exactly once');
select throws_ok(
  $$select private.enqueue_whatsapp_webhook_event('c2000000-0000-4000-8000-000000000002', 'c4000000-0000-4000-8000-000000000002', 'evolution_go', 'instance-b', 'evolution_go:c400:event-1', 'messages.upsert', '{}'::jsonb, 12)$$,
  '23505',
  'whatsapp webhook event_key collision across provider or tenant',
  'an event key cannot collide across tenants'
);
select results_eq(
  $$select count(*)::bigint from private.claim_whatsapp_webhook_inbox('inbox-worker', 10, interval '5 minutes')$$,
  array[1::bigint],
  'worker atomically claims one due webhook event'
);
select ok((select status = 'processing' and attempts = 1 and locked_by = 'inbox-worker' from public.whatsapp_webhook_inbox where event_key = 'evolution_go:c400:event-1'), 'claim records processing lease and attempt');
select ok(private.complete_whatsapp_webhook_event((select id from whatsapp_durable_test_ids where key = 'event'), 'inbox-worker'), 'lease owner completes webhook event');
select is((select status from public.whatsapp_webhook_inbox where event_key = 'evolution_go:c400:event-1'), 'processed', 'completed webhook remains auditable');

insert into whatsapp_durable_test_ids (key, id)
select 'outbox', private.enqueue_whatsapp_outbox(
  'c2000000-0000-4000-8000-000000000001',
  'c4000000-0000-4000-8000-000000000001',
  'c5000000-0000-4000-8000-000000000001',
  'c6000000-0000-4000-8000-000000000001',
  'outbox-client-a', '5511999990001@s.whatsapp.net', 'text',
  '{"content":"Mensagem A"}'::jsonb, 12
);

select ok((select id is not null from whatsapp_durable_test_ids where key = 'outbox'), 'outbound delivery gets a durable id');
select is(
  private.enqueue_whatsapp_outbox(
    'c2000000-0000-4000-8000-000000000001',
    'c4000000-0000-4000-8000-000000000001',
    'c5000000-0000-4000-8000-000000000001',
    'c6000000-0000-4000-8000-000000000001',
    'outbox-client-a', '5511999990001@s.whatsapp.net', 'text',
    '{"content":"Mensagem A"}'::jsonb, 12
  ),
  (select id from whatsapp_durable_test_ids where key = 'outbox'),
  'outbound retry resolves to the same outbox row'
);
select is((select count(*)::bigint from public.whatsapp_outbox where client_message_id = 'outbox-client-a'), 1::bigint, 'outbound request is persisted exactly once');
select throws_ok(
  $$select private.enqueue_whatsapp_outbox('c2000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', 'c6000000-0000-4000-8000-000000000002', 'outbox-client-a', '5511999990001@s.whatsapp.net', 'text', '{}'::jsonb, 12)$$,
  '23505',
  'whatsapp client_message_id collision with a different message',
  'one client id cannot be rebound to another message'
);
select throws_ok(
  $$select private.enqueue_whatsapp_outbox('c2000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', 'c6000000-0000-4000-8000-000000000004', 'cross-tenant-outbox', '5511999990001@s.whatsapp.net', 'text', '{}'::jsonb, 12)$$,
  '23514',
  'WhatsApp worker row crosses organization, session, conversation, or message boundaries',
  'outbox cannot bind a message from another tenant'
);
select results_eq(
  $$select count(*)::bigint from private.claim_whatsapp_outbox('outbox-worker', 10, interval '5 minutes')$$,
  array[1::bigint],
  'worker atomically claims one due outbound delivery'
);
select ok((select status = 'processing' and attempts = 1 and locked_by = 'outbox-worker' from public.whatsapp_outbox where client_message_id = 'outbox-client-a'), 'outbox claim records processing lease and attempt');
select ok(private.mark_whatsapp_outbox_sent((select id from whatsapp_durable_test_ids where key = 'outbox'), 'outbox-worker', 'provider-outbound-a', now()), 'lease owner records provider acknowledgement');
select ok((select status = 'sent' and provider_message_id = 'provider-outbound-a' and sent_at is not null from public.whatsapp_outbox where client_message_id = 'outbox-client-a'), 'provider acknowledgement is durable');
select lives_ok(
  $$update public.whatsapp_conversations set session_id = 'c4000000-0000-4000-8000-000000000003' where id = 'c5000000-0000-4000-8000-000000000001'$$,
  'historical outbox does not prevent a future conversation session rebind'
);
select is(
  (select session_id from public.whatsapp_outbox where client_message_id = 'outbox-client-a'),
  'c4000000-0000-4000-8000-000000000001'::uuid,
  'historical outbox keeps the session snapshot used for delivery'
);
update public.whatsapp_conversations
set session_id = 'c4000000-0000-4000-8000-000000000001'
where id = 'c5000000-0000-4000-8000-000000000001';

select throws_ok(
  $$insert into public.whatsapp_messages (organization_id, conversation_id, session_id, lead_id, message_id, client_message_id, from_me, direction, message_type, content, status) values ('c2000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001', 'duplicate-client-message-id', 'canonical-client-a', true, 'outbound', 'text', 'duplicate', 'pending')$$,
  '23505',
  null,
  'canonical message history rejects duplicate client ids in one organization/session'
);

insert into public.whatsapp_message_reactions (
  organization_id, session_id, conversation_id, target_message_id,
  target_provider_message_id, provider_reaction_message_id,
  actor_jid, emoji, status
)
values (
  'c2000000-0000-4000-8000-000000000001',
  'c4000000-0000-4000-8000-000000000001',
  'c5000000-0000-4000-8000-000000000001',
  'c6000000-0000-4000-8000-000000000001',
  'provider-outbound-a', 'provider-reaction-a', '5511888880001@s.whatsapp.net',
  '👍', 'active'
);

select is((select count(*)::bigint from public.whatsapp_message_reactions where target_provider_message_id = 'provider-outbound-a'), 1::bigint, 'normalized reaction is stored once');
select throws_ok(
  $$insert into public.whatsapp_message_reactions (organization_id, session_id, conversation_id, target_message_id, target_provider_message_id, actor_jid, emoji, status) values ('c2000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', 'c6000000-0000-4000-8000-000000000001', 'provider-outbound-a', '5511888880001@s.whatsapp.net', '❤️', 'active')$$,
  '23505',
  null,
  'same actor reaction must be updated instead of duplicated'
);
select throws_ok(
  $$insert into public.whatsapp_message_reactions (organization_id, session_id, conversation_id, target_message_id, target_provider_message_id, actor_jid, emoji, status) values ('c2000000-0000-4000-8000-000000000002', 'c4000000-0000-4000-8000-000000000002', 'c5000000-0000-4000-8000-000000000003', 'c6000000-0000-4000-8000-000000000001', 'provider-outbound-a', '5511888880002@s.whatsapp.net', '👍', 'active')$$,
  '23514',
  'WhatsApp worker row crosses organization, session, conversation, or message boundaries',
  'reaction cannot bind a target message from another tenant'
);

select throws_ok(
  $$insert into public.whatsapp_webhook_inbox (organization_id, session_id, event_key, event_type, payload) values ('c2000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000002', 'cross-tenant-inbox', 'message', '{}'::jsonb)$$,
  '23514',
  'WhatsApp worker row crosses organization, session, conversation, or message boundaries',
  'webhook inbox cannot bind a session from another tenant'
);

insert into whatsapp_durable_test_ids (key, id)
select 'dead-event', private.enqueue_whatsapp_webhook_event(
  'c2000000-0000-4000-8000-000000000001',
  'c4000000-0000-4000-8000-000000000001',
  'evolution_go', 'instance-a', 'evolution_go:c400:dead-event', 'messages.upsert',
  '{}'::jsonb, 1
);
select results_eq(
  $$select count(*)::bigint from private.claim_whatsapp_webhook_inbox('dead-worker', 10, interval '5 minutes')$$,
  array[1::bigint],
  'final allowed attempt can be claimed'
);
select ok(private.fail_whatsapp_webhook_event((select id from whatsapp_durable_test_ids where key = 'dead-event'), 'dead-worker', 'permanent test failure', now()), 'failed final attempt is recorded');
select ok((select status = 'dead' and dead_lettered_at is not null and last_error = 'permanent test failure' from public.whatsapp_webhook_inbox where event_key = 'evolution_go:c400:dead-event'), 'retry exhaustion enters dead-letter state');

select ok(
  not private.can_receive_whatsapp_broadcast('whatsapp:c2000000-0000-4000-8000-000000000001:inbox'),
  'anonymous request cannot subscribe to an organization inbox topic'
);
select ok(
  exists (
    select 1
    from realtime.messages
    where topic = 'whatsapp:c2000000-0000-4000-8000-000000000001:inbox'
      and event = 'whatsapp.inbox.changed'
  )
  and not exists (
    select 1
    from realtime.messages
    where topic = 'whatsapp:c2000000-0000-4000-8000-000000000001:inbox'
      and event = 'whatsapp.inbox.changed'
      and payload is distinct from '{"scope":"conversations"}'::jsonb
  ),
  'organization inbox broadcasts carry only the content-free conversations wake-up signal'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000001', true);

select ok(private.can_receive_whatsapp_broadcast('whatsapp:c2000000-0000-4000-8000-000000000001:inbox'), 'assigned broker can subscribe to its organization inbox topic');
set local role service_role;
select ok(public.vimob_can_view_whatsapp_lead('c2000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001'), 'assigned broker is authorized for its lead');
set local role authenticated;
select ok(public.can_view_whatsapp_conversation('c5000000-0000-4000-8000-000000000001'), 'assigned broker is authorized for its linked lead conversation');
select ok(not public.can_view_whatsapp_conversation('c5000000-0000-4000-8000-000000000002'), 'session owner cannot authorize unlinked quarantine');
select throws_ok($$select count(*) from public.whatsapp_messages$$, '42501', null, 'assigned broker cannot bypass the Go API for raw messages');

select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000002', true);
select ok(private.can_receive_whatsapp_broadcast('whatsapp:c2000000-0000-4000-8000-000000000001:inbox'), 'unassigned same-organization broker can receive the content-free inbox wake-up signal');
set local role service_role;
select ok(not public.vimob_can_view_whatsapp_lead('c2000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001'), 'unassigned broker is denied the lead');
set local role authenticated;
select ok(not public.can_view_whatsapp_conversation('c5000000-0000-4000-8000-000000000001'), 'unassigned broker is denied the conversation helper');
select throws_ok($$select count(*) from public.whatsapp_messages$$, '42501', null, 'unassigned broker cannot query raw message history');

select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000003', true);
select ok(private.can_receive_whatsapp_broadcast('whatsapp:c2000000-0000-4000-8000-000000000001:inbox'), 'same-organization admin can subscribe to the organization inbox topic');
set local role service_role;
select ok(public.vimob_can_view_whatsapp_lead('c2000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001'), 'same-organization admin can access the lead');
set local role authenticated;
select ok(public.can_view_whatsapp_conversation('c5000000-0000-4000-8000-000000000001'), 'same-organization admin is authorized for the linked conversation');
select ok(not public.can_view_whatsapp_conversation('c5000000-0000-4000-8000-000000000002'), 'same-organization admin still cannot authorize quarantine');
select throws_ok($$select count(*) from public.whatsapp_conversations$$, '42501', null, 'same-organization admin cannot query raw conversations outside the Go API');

select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000004', true);
select ok(not private.can_receive_whatsapp_broadcast('whatsapp:c2000000-0000-4000-8000-000000000001:inbox'), 'cross-organization user cannot subscribe to Org A inbox topic');
select ok(private.can_receive_whatsapp_broadcast('whatsapp:c2000000-0000-4000-8000-000000000002:inbox'), 'cross-organization user can subscribe only to its own organization inbox topic');
set local role service_role;
select ok(not public.vimob_can_view_whatsapp_lead('c2000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001'), 'cross-organization user is denied Org A lead');
set local role authenticated;
select ok(public.can_view_whatsapp_conversation('c5000000-0000-4000-8000-000000000003'), 'cross-organization user is authorized only for its own linked conversation');
select ok(not public.can_view_whatsapp_conversation('c5000000-0000-4000-8000-000000000001'), 'cross-organization user cannot authorize an Org A conversation by id');
select throws_ok($$select count(*) from public.whatsapp_messages$$, '42501', null, 'cross-organization user cannot query raw message history');

reset role;

select * from finish();
rollback;
