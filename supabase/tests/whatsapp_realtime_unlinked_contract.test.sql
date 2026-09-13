begin;

create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values (
  '00000000-0000-0000-0000-000000000000',
  'a8100000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'wa-realtime-unlinked@example.test',
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
  'a8200000-0000-4000-8000-000000000001',
  'WhatsApp Unlinked Realtime Org',
  'whatsapp-unlinked-realtime-org',
  true
);

insert into public.users (id, organization_id, name, email, role, is_active)
values (
  'a8100000-0000-4000-8000-000000000001',
  'a8200000-0000-4000-8000-000000000001',
  'WhatsApp Realtime Owner',
  'wa-realtime-unlinked@example.test',
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
  'a8200000-0000-4000-8000-000000000001',
  'a8100000-0000-4000-8000-000000000001',
  'admin',
  true
)
on conflict (user_id, organization_id) do update
set role = excluded.role,
    is_active = excluded.is_active;

insert into public.leads (
  id, organization_id, assigned_user_id, name, phone, source
)
values (
  'a8300000-0000-4000-8000-000000000001',
  'a8200000-0000-4000-8000-000000000001',
  'a8100000-0000-4000-8000-000000000001',
  'WhatsApp Realtime Lead',
  '5511999991111',
  'whatsapp'
);

insert into public.whatsapp_sessions (
  id, organization_id, owner_user_id, instance_name, provider, status, is_active
)
values (
  'a8400000-0000-4000-8000-000000000001',
  'a8200000-0000-4000-8000-000000000001',
  'a8100000-0000-4000-8000-000000000001',
  'whatsapp-unlinked-realtime',
  'evolution_go',
  'connected',
  true
);

insert into public.whatsapp_conversations (
  id, organization_id, session_id, lead_id, assigned_user_id,
  remote_jid, contact_phone, contact_name, is_group
)
values (
  'a8500000-0000-4000-8000-000000000001',
  'a8200000-0000-4000-8000-000000000001',
  'a8400000-0000-4000-8000-000000000001',
  null,
  null,
  '5511999991111@s.whatsapp.net',
  '5511999991111',
  'Unlinked Contact',
  false
);

select ok(
  (
    select trigger_definition ilike '%lead_id%'
      and trigger_definition ilike '%status%'
      and trigger_definition ilike '%delivered_at%'
      and trigger_definition ilike '%read_at%'
      and trigger_definition ilike '%media_status%'
      and trigger_definition ilike '%media_url%'
      and trigger_definition ilike '%content%'
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
  'message broadcast reacts to lead linkage and retains every previous update column'
);

select ok(
  pg_get_functiondef('private.broadcast_whatsapp_message_change()'::regprocedure)
    ilike '%realtime.send(%'
  and pg_get_functiondef('private.broadcast_whatsapp_message_change()'::regprocedure)
    not ilike '%insert into realtime.messages%',
  'broadcast uses the supported Realtime API without writing its locked schema directly'
);

select ok(
  (
    select
      procedure.prosecdef
      and exists (
        select 1
        from unnest(coalesce(procedure.proconfig, array[]::text[])) as setting
        where setting = 'search_path=""'
      )
    from pg_catalog.pg_proc as procedure
    where procedure.oid =
      'private.broadcast_whatsapp_message_change()'::regprocedure
  ),
  'the trigger function remains SECURITY DEFINER with an empty search path'
);

select ok(
  has_function_privilege(
    'service_role',
    'private.broadcast_whatsapp_message_change()',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'private.broadcast_whatsapp_message_change()',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'private.broadcast_whatsapp_message_change()',
    'execute'
  ),
  'CREATE OR REPLACE preserves the service-role-only trigger function grant'
);

insert into public.whatsapp_messages (
  id, organization_id, conversation_id, session_id, lead_id,
  provider_message_id, message_id, from_me, direction,
  message_type, content, remote_jid, status
)
values (
  'a8600000-0000-4000-8000-000000000001',
  'a8200000-0000-4000-8000-000000000001',
  'a8500000-0000-4000-8000-000000000001',
  'a8400000-0000-4000-8000-000000000001',
  null,
  'provider-unlinked-realtime',
  'provider-unlinked-realtime',
  false,
  'inbound',
  'text',
  'Sensitive message body',
  '5511999991111@s.whatsapp.net',
  'received'
);

select is(
  (
    select count(*)::bigint
    from realtime.messages
    where topic = 'whatsapp:a8200000-0000-4000-8000-000000000001:inbox'
      and event = 'whatsapp.inbox.changed'
  ),
  1::bigint,
  'an INSERT without lead_id still wakes the organization inbox'
);

select ok(
  not exists (
    select 1
    from realtime.messages
    where topic = 'whatsapp:a8200000-0000-4000-8000-000000000001:inbox'
      and event = 'whatsapp.inbox.changed'
      and (
        payload - 'id' is distinct from '{"scope":"conversations"}'::jsonb
        or payload ?| array[
          'content', 'messageId', 'conversationId', 'clientMessageId',
          'phone', 'remoteJid', 'mediaUrl'
        ]
      )
  ),
  'the unlinked inbox wake is content-free and identifier-free'
);

select is(
  (
    select count(*)::bigint
    from realtime.messages
    where event = 'whatsapp.message.changed'
      and topic like 'whatsapp:a8200000-0000-4000-8000-000000000001:lead:%'
  ),
  0::bigint,
  'an unlinked message is not broadcast to any lead topic'
);

update public.whatsapp_conversations
set lead_id = 'a8300000-0000-4000-8000-000000000001',
    assigned_user_id = 'a8100000-0000-4000-8000-000000000001'
where id = 'a8500000-0000-4000-8000-000000000001';

update public.whatsapp_messages
set lead_id = 'a8300000-0000-4000-8000-000000000001'
where id = 'a8600000-0000-4000-8000-000000000001';

select is(
  (
    select lead_id
    from public.whatsapp_messages
    where id = 'a8600000-0000-4000-8000-000000000001'
  ),
  'a8300000-0000-4000-8000-000000000001'::uuid,
  'the canonical message accepts the reconciled lead link'
);

select is(
  (
    select count(*)::bigint
    from realtime.messages
    where topic = 'whatsapp:a8200000-0000-4000-8000-000000000001:inbox'
      and event = 'whatsapp.inbox.changed'
  ),
  2::bigint,
  'the lead_id UPDATE emits a second organization wake-up'
);

select ok(
  not exists (
    select 1
    from realtime.messages
    where topic = 'whatsapp:a8200000-0000-4000-8000-000000000001:inbox'
      and event = 'whatsapp.inbox.changed'
      and payload - 'id' is distinct from '{"scope":"conversations"}'::jsonb
  ),
  'every organization wake-up retains the minimal payload contract'
);

select is(
  (
    select count(*)::bigint
    from realtime.messages
    where topic = 'whatsapp:a8200000-0000-4000-8000-000000000001:lead:a8300000-0000-4000-8000-000000000001'
      and event = 'whatsapp.message.changed'
  ),
  1::bigint,
  'linking the message emits one detailed hint to the authorized lead topic'
);

select ok(
  exists (
    select 1
    from realtime.messages
    where topic = 'whatsapp:a8200000-0000-4000-8000-000000000001:lead:a8300000-0000-4000-8000-000000000001'
      and event = 'whatsapp.message.changed'
      and payload ->> 'operation' = 'UPDATE'
      and payload ->> 'messageId' = 'a8600000-0000-4000-8000-000000000001'
      and payload ->> 'conversationId' = 'a8500000-0000-4000-8000-000000000001'
      and not (
        payload ?| array[
          'content', 'phone', 'remoteJid', 'mediaUrl', 'mediaStoragePath'
        ]
      )
  ),
  'the lead-scoped hint contains identifiers/status only, never message content'
);

update public.whatsapp_conversations
set lead_id = null
where id = 'a8500000-0000-4000-8000-000000000001';

update public.whatsapp_messages
set lead_id = null
where id = 'a8600000-0000-4000-8000-000000000001';

select is(
  (
    select lead_id
    from public.whatsapp_messages
    where id = 'a8600000-0000-4000-8000-000000000001'
  ),
  null::uuid,
  'the fixture message is unlinked after its conversation is unlinked'
);

select is(
  (
    select count(*)::bigint
    from realtime.messages
    where topic = 'whatsapp:a8200000-0000-4000-8000-000000000001:inbox'
      and event = 'whatsapp.inbox.changed'
  ),
  3::bigint,
  'unlinking a message still wakes the organization inbox'
);

select is(
  (
    select count(*)::bigint
    from realtime.messages
    where topic = 'whatsapp:a8200000-0000-4000-8000-000000000001:lead:a8300000-0000-4000-8000-000000000001'
      and event = 'whatsapp.message.changed'
  ),
  2::bigint,
  'unlinking also wakes the previous lead topic so stale history can reconcile'
);

select ok(
  not exists (
    select 1
    from realtime.messages
    where event in ('whatsapp.inbox.changed', 'whatsapp.message.changed')
      and topic like 'whatsapp:a8200000-0000-4000-8000-000000000001:%'
      and payload ?| array[
        'content', 'phone', 'remoteJid', 'mediaUrl', 'mediaStoragePath'
      ]
  ),
  'neither inbox nor lead hints expose message or contact content'
);

select * from finish();
rollback;
