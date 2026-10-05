begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

select has_function(
  'public',
  'start_automation_execution_from_event',
  array['uuid', 'uuid', 'uuid', 'uuid', 'uuid', 'text', 'jsonb'],
  'the automation start RPC retains its existing signature'
);

select ok(
  pg_catalog.obj_description(
    'public.start_automation_execution_from_event(uuid,uuid,uuid,uuid,uuid,text,jsonb)'::regprocedure,
    'pg_proc'
  ) like 'recorded_inbound_reply_only_v1:%',
  'the reviewed reply-only start fence is installed'
);

select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'public.start_automation_execution_from_event(uuid,uuid,uuid,uuid,uuid,text,jsonb)'::regprocedure
    ),
    $$message.capture_state = 'recorded'$$
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'public.start_automation_execution_from_event(uuid,uuid,uuid,uuid,uuid,text,jsonb)'::regprocedure
    ),
    $$'status', 'reply_only'$$
  ) > 0,
  'only a recorded inbound reply returns reply_only'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.start_automation_execution_from_event(uuid,uuid,uuid,uuid,uuid,text,jsonb)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.start_automation_execution_from_event(uuid,uuid,uuid,uuid,uuid,text,jsonb)',
    'execute'
  ),
  'only backend code can request automation startup'
);

-- Use isolated, rolled-back rows. No production data is read or changed.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  'ba000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'recorded-reply-test@example.test',
  crypt('test-password', gen_salt('bf', 4)), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now(),
  '', '', '', ''
);

insert into public.organizations (id, name, slug, is_active)
values (
  'ba100000-0000-4000-8000-000000000001',
  'Recorded reply-only contract',
  'recorded-reply-only-contract',
  true
);

insert into public.users (id, organization_id, name, email, role, is_active)
values (
  'ba000000-0000-4000-8000-000000000001',
  'ba100000-0000-4000-8000-000000000001',
  'Recorded Reply Owner',
  'recorded-reply-test@example.test',
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
  'ba100000-0000-4000-8000-000000000001',
  'ba000000-0000-4000-8000-000000000001',
  'admin',
  true
)
on conflict (user_id, organization_id) do update
set role = excluded.role,
    is_active = excluded.is_active;

insert into public.leads (id, organization_id, assigned_user_id, name, phone, source)
values (
  'ba200000-0000-4000-8000-000000000001',
  'ba100000-0000-4000-8000-000000000001',
  'ba000000-0000-4000-8000-000000000001',
  'Recorded Reply Lead',
  '5511988877001',
  'manual'
);

insert into public.whatsapp_sessions (
  id, organization_id, owner_user_id, instance_name, provider, status, is_active
) values (
  'ba300000-0000-4000-8000-000000000001',
  'ba100000-0000-4000-8000-000000000001',
  'ba000000-0000-4000-8000-000000000001',
  'recorded-reply-test-session',
  'evolution_go',
  'connected',
  true
);

insert into public.whatsapp_conversations (
  id, organization_id, session_id, lead_id, remote_jid, assigned_user_id
) values (
  'ba400000-0000-4000-8000-000000000001',
  'ba100000-0000-4000-8000-000000000001',
  'ba300000-0000-4000-8000-000000000001',
  'ba200000-0000-4000-8000-000000000001',
  '5511988877001@s.whatsapp.net',
  'ba000000-0000-4000-8000-000000000001'
);

select public.activate_whatsapp_conversation_lead_binding(
  'ba100000-0000-4000-8000-000000000001',
  'ba400000-0000-4000-8000-000000000001',
  'ba200000-0000-4000-8000-000000000001',
  null
);

insert into public.whatsapp_messages (
  id, organization_id, conversation_id, session_id, lead_id,
  provider_message_id, message_id, from_me, direction,
  message_type, content, status, capture_state, metadata
) values (
  'ba700000-0000-4000-8000-000000000001',
  'ba100000-0000-4000-8000-000000000001',
  'ba400000-0000-4000-8000-000000000001',
  'ba300000-0000-4000-8000-000000000001',
  'ba200000-0000-4000-8000-000000000001',
  'recorded-reply-provider-id',
  'recorded-reply-provider-id',
  false, 'inbound', 'text', 'Resposta registrada',
  'received', 'recorded', '{}'::jsonb
);

insert into public.automation_event_outbox (
  id, organization_id, event_type, aggregate_type, aggregate_id,
  lead_id, conversation_id, dedupe_key, payload, status
) values (
  'ba800000-0000-4000-8000-000000000001',
  'ba100000-0000-4000-8000-000000000001',
  'message_received', 'whatsapp_message',
  'ba700000-0000-4000-8000-000000000001',
  'ba200000-0000-4000-8000-000000000001',
  'ba400000-0000-4000-8000-000000000001',
  'recorded-reply-only-test-event',
  '{}'::jsonb,
  'processing'
);

create temporary table recorded_reply_start_result as
select public.start_automation_execution_from_event(
  'ba800000-0000-4000-8000-000000000001',
  'ba500000-0000-4000-8000-000000000001',
  'ba600000-0000-4000-8000-000000000001',
  'ba200000-0000-4000-8000-000000000001',
  'ba400000-0000-4000-8000-000000000001',
  'send',
  '{}'::jsonb
) as value;

select is(
  (select value->>'status' from recorded_reply_start_result),
  'reply_only',
  'recorded inbound is acknowledged without starting a new automation'
);

select is(
  (
    select count(*)::integer
    from public.automation_executions
    where trigger_event_id = 'ba800000-0000-4000-8000-000000000001'
  ),
  0,
  'reply-only acknowledgement creates no automation execution'
);

select is(
  (
    select count(*)::integer
    from public.automation_circuit_breakers
    where organization_id = 'ba100000-0000-4000-8000-000000000001'
  ),
  0,
  'reply-only acknowledgement does not consume an automation circuit breaker'
);

select * from finish();
rollback;
