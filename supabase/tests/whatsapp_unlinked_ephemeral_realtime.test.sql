begin;

create extension if not exists pgtap with schema extensions;
select plan(20);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values (
  '00000000-0000-0000-0000-000000000000',
  'b9100000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'wa-unlinked-ephemeral@example.test',
  crypt('test-password', gen_salt('bf', 4)),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{}',
  now(),
  now(),
  '',
  '',
  '',
  ''
);

insert into public.organizations (id, name, slug, is_active)
values (
  'b9200000-0000-4000-8000-000000000001',
  'WhatsApp Ephemeral Realtime Org',
  'whatsapp-ephemeral-realtime-org',
  true
);

insert into public.users (id, organization_id, name, email, role, is_active)
values (
  'b9100000-0000-4000-8000-000000000001',
  'b9200000-0000-4000-8000-000000000001',
  'WhatsApp Ephemeral Owner',
  'wa-unlinked-ephemeral@example.test',
  'admin',
  true
)
on conflict (id) do update
set organization_id = excluded.organization_id,
    name = excluded.name,
    email = excluded.email,
    role = excluded.role,
    is_active = excluded.is_active;

insert into public.organization_members (organization_id, user_id, role, is_active)
values (
  'b9200000-0000-4000-8000-000000000001',
  'b9100000-0000-4000-8000-000000000001',
  'admin',
  true
)
on conflict (user_id, organization_id) do update
set role = excluded.role,
    is_active = excluded.is_active;

insert into public.whatsapp_sessions (
  id, organization_id, owner_user_id, instance_name, provider, status, is_active
)
values (
  'b9400000-0000-4000-8000-000000000001',
  'b9200000-0000-4000-8000-000000000001',
  'b9100000-0000-4000-8000-000000000001',
  'whatsapp-unlinked-ephemeral-realtime',
  'evolution_go',
  'connected',
  true
);

insert into public.whatsapp_conversations (
  id, organization_id, session_id, lead_id, assigned_user_id,
  remote_jid, contact_phone, contact_name, is_group
)
values (
  'b9500000-0000-4000-8000-000000000001',
  'b9200000-0000-4000-8000-000000000001',
  'b9400000-0000-4000-8000-000000000001',
  null,
  null,
  '5511999992222@s.whatsapp.net',
  '5511999992222',
  'Unlinked Ephemeral Contact',
  false
);

select ok(
  exists (
    select 1
    from information_schema.columns as column_state
    where column_state.table_schema = 'public'
      and column_state.table_name = 'whatsapp_messages'
      and column_state.column_name = 'capture_state'
      and column_state.column_default = '''suppressed''::text'
  ),
  'old API writes still default to suppressed'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint as constraint_state
    where constraint_state.conrelid = 'public.whatsapp_messages'::regclass
      and constraint_state.conname = 'whatsapp_messages_capture_state_check'
      and constraint_state.contype = 'c'
      and not constraint_state.convalidated
      and lower(pg_catalog.pg_get_constraintdef(constraint_state.oid, true))
        like '%unlinked_ephemeral%'
      and lower(pg_catalog.pg_get_constraintdef(constraint_state.oid, true))
        like '%lead_id is null%'
      and lower(pg_catalog.pg_get_constraintdef(constraint_state.oid, true))
        like '%not from_me%'
      and lower(pg_catalog.pg_get_constraintdef(constraint_state.oid, true))
        like '%direction = ''inbound''%'
      and lower(pg_catalog.pg_get_constraintdef(constraint_state.oid, true))
        like '%from_me%'
      and lower(pg_catalog.pg_get_constraintdef(constraint_state.oid, true))
        like '%direction = ''outbound''%'
  ),
  'new state accepts inbound or observed external outbound without a lead'
);

select is(
  (
    select count(*)::bigint
    from pg_catalog.pg_trigger as trigger_state
    where trigger_state.tgrelid = 'public.whatsapp_messages'::regclass
      and not trigger_state.tgisinternal
      and trigger_state.tgname = any (array[
        'gamification_canonical_whatsapp_insert_enqueue',
        'gamification_canonical_whatsapp_status_enqueue',
        'trg_capture_whatsapp_attention_fact',
        'zz_automation_human_outbound_handoff',
        'zz_automation_inbound_message',
        'enqueue_whatsapp_avatar_after_message'
      ]::name[])
      and lower(pg_catalog.pg_get_triggerdef(trigger_state.oid, true))
        like '%new.capture_state is distinct from ''suppressed''::text%'
      and lower(pg_catalog.pg_get_triggerdef(trigger_state.oid, true))
        like '%new.capture_state is distinct from ''unlinked_ephemeral''::text%'
  ),
  6::bigint,
  'all lead, automation, gamification and avatar trigger lanes exclude the new state'
);

select is(
  (
    select count(*)::bigint
    from pg_catalog.pg_trigger as trigger_state
    where trigger_state.tgrelid = 'public.whatsapp_messages'::regclass
      and not trigger_state.tgisinternal
      and trigger_state.tgname = any (array[
        'trg_touch_whatsapp_conversation_received_at',
        'whatsapp_message_private_broadcast'
      ]::name[])
      and lower(pg_catalog.pg_get_triggerdef(trigger_state.oid, true))
        like '%new.capture_state is distinct from ''suppressed''::text%'
      and lower(pg_catalog.pg_get_triggerdef(trigger_state.oid, true))
        not like '%unlinked_ephemeral%'
  ),
  2::bigint,
  'conversation touch and private Broadcast remain active for the new state'
);

select ok(
  pg_get_functiondef('private.broadcast_whatsapp_message_change()'::regprocedure)
    like '%jsonb_build_object(''scope'', ''conversations'')%'
  and pg_get_functiondef('private.broadcast_whatsapp_message_change()'::regprocedure)
    like '%''whatsapp.inbox.changed''%'
  and pg_get_functiondef('private.broadcast_whatsapp_message_change()'::regprocedure)
    like '%if message_row.lead_id is not null then%',
  'the existing broadcaster uses a minimal organization wake and gates lead hints'
);

select ok(
  not has_table_privilege('authenticated', 'public.whatsapp_messages', 'select')
  and not has_table_privilege('authenticated', 'public.whatsapp_messages', 'insert')
  and not has_table_privilege('authenticated', 'public.whatsapp_messages', 'update'),
  'authenticated clients cannot bypass the owner-scoped backend'
);

select ok(
  not has_table_privilege('anon', 'public.whatsapp_messages', 'select')
  and not has_table_privilege('anon', 'public.whatsapp_messages', 'insert')
  and not has_table_privilege('anon', 'public.whatsapp_messages', 'update'),
  'anonymous clients cannot read or forge unlinked messages'
);

insert into public.whatsapp_messages (
  id, organization_id, conversation_id, session_id, lead_id,
  provider_message_id, message_id, from_me, direction,
  message_type, content, remote_jid, status, capture_state
)
values (
  'b9600000-0000-4000-8000-000000000001',
  'b9200000-0000-4000-8000-000000000001',
  'b9500000-0000-4000-8000-000000000001',
  'b9400000-0000-4000-8000-000000000001',
  null,
  'provider-unlinked-ephemeral-realtime',
  'provider-unlinked-ephemeral-realtime',
  false,
  'inbound',
  'text',
  'Synthetic test message body',
  '5511999992222@s.whatsapp.net',
  'received',
  'unlinked_ephemeral'
);

select is(
  (select capture_state from public.whatsapp_messages
   where id = 'b9600000-0000-4000-8000-000000000001'),
  'unlinked_ephemeral'::text,
  'trusted backend can persist the new state'
);

select is(
  (select lead_id from public.whatsapp_messages
   where id = 'b9600000-0000-4000-8000-000000000001'),
  null::uuid,
  'message remains unlinked after context derivation'
);

select ok(
  (select unlinked_retention_v1 and retired_at is null
   from public.whatsapp_conversations
   where id = 'b9500000-0000-4000-8000-000000000001'),
  'inserting the visible unlinked message atomically marks its seven-day conversation clock'
);

select ok(
  (select last_message_received_at is not null
   from public.whatsapp_conversations
   where id = 'b9500000-0000-4000-8000-000000000001'),
  'inbound message advances the conversation timestamp'
);

select is(
  (select count(*)::bigint from realtime.messages
   where topic = 'whatsapp:b9200000-0000-4000-8000-000000000001:inbox'
     and event = 'whatsapp.inbox.changed'),
  1::bigint,
  'new unlinked message emits one organization inbox wake'
);

select ok(
  not exists (
    select 1 from realtime.messages
    where topic = 'whatsapp:b9200000-0000-4000-8000-000000000001:inbox'
      and event = 'whatsapp.inbox.changed'
      and payload - 'id' is distinct from '{"scope":"conversations"}'::jsonb
  ),
  'organization wake contains no message or contact data'
);

select is(
  (select count(*)::bigint from realtime.messages
   where topic like 'whatsapp:b9200000-0000-4000-8000-000000000001:lead:%'
     and event = 'whatsapp.message.changed'),
  0::bigint,
  'unlinked message emits no lead-topic hint'
);

select is(
  (select count(*)::bigint from public.automation_event_outbox
   where organization_id = 'b9200000-0000-4000-8000-000000000001'),
  0::bigint,
  'new state creates no automation event'
);

select is(
  (select count(*)::bigint from public.gamification_outbox
   where organization_id = 'b9200000-0000-4000-8000-000000000001'),
  0::bigint,
  'new state creates no gamification event'
);

select is(
  (select count(*)::bigint from public.lead_action_facts
   where organization_id = 'b9200000-0000-4000-8000-000000000001'),
  0::bigint,
  'new state creates no lead attention fact'
);

select is(
  (select count(*)::bigint from private.whatsapp_avatar_jobs
   where organization_id = 'b9200000-0000-4000-8000-000000000001'),
  0::bigint,
  'new state creates no lead avatar job'
);

update public.whatsapp_messages
set status = 'delivered'
where id = 'b9600000-0000-4000-8000-000000000001';

select is(
  (select count(*)::bigint from realtime.messages
   where topic = 'whatsapp:b9200000-0000-4000-8000-000000000001:inbox'
     and event = 'whatsapp.inbox.changed'),
  2::bigint,
  'status updates also wake the inbox in real time'
);

select ok(
  not exists (
    select 1 from realtime.messages
    where topic = 'whatsapp:b9200000-0000-4000-8000-000000000001:inbox'
      and event = 'whatsapp.inbox.changed'
      and payload - 'id' is distinct from '{"scope":"conversations"}'::jsonb
  )
  and not exists (
    select 1 from public.automation_event_outbox
    where organization_id = 'b9200000-0000-4000-8000-000000000001'
  )
  and not exists (
    select 1 from public.gamification_outbox
    where organization_id = 'b9200000-0000-4000-8000-000000000001'
  ),
  'status update remains content-free and has no automation/gamification effects'
);

select * from finish();
rollback;
