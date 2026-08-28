begin;

create extension if not exists pgtap with schema extensions;
select plan(4);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values (
  '00000000-0000-0000-0000-000000000000',
  'c8100000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'wa-context@example.test', '', now(),
  '{}', '{}', now(), now(), '', '', '', ''
);

insert into public.organizations (id, name, slug, is_active)
values ('c8200000-0000-4000-8000-000000000001', 'WhatsApp Context Org', 'whatsapp-context-org', true);

insert into public.users (id, organization_id, name, email, role, is_active)
values (
  'c8100000-0000-4000-8000-000000000001',
  'c8200000-0000-4000-8000-000000000001',
  'Context Broker', 'wa-context@example.test', 'user', true
)
on conflict (id) do update
set organization_id = excluded.organization_id,
    name = excluded.name,
    email = excluded.email,
    role = excluded.role,
    is_active = excluded.is_active;

insert into public.organization_members (organization_id, user_id, role, is_active)
values (
  'c8200000-0000-4000-8000-000000000001',
  'c8100000-0000-4000-8000-000000000001',
  'user', true
)
on conflict (user_id, organization_id) do update
set role = excluded.role,
    is_active = excluded.is_active;

insert into public.leads (id, organization_id, assigned_user_id, name, source)
values (
  'c8300000-0000-4000-8000-000000000001',
  'c8200000-0000-4000-8000-000000000001',
  'c8100000-0000-4000-8000-000000000001',
  'Context Lead', 'meta_ads'
);

insert into public.whatsapp_sessions (
  id, organization_id, owner_user_id, instance_name, provider, status, is_active
)
values
  (
    'c8400000-0000-4000-8000-000000000001',
    'c8200000-0000-4000-8000-000000000001',
    'c8100000-0000-4000-8000-000000000001',
    'whatsapp-context-original', 'evolution_go', 'connected', true
  ),
  (
    'c8400000-0000-4000-8000-000000000002',
    'c8200000-0000-4000-8000-000000000001',
    'c8100000-0000-4000-8000-000000000001',
    'whatsapp-context-current', 'evolution_go', 'connected', true
  );

insert into public.whatsapp_conversations (
  id, organization_id, session_id, remote_jid, contact_name
)
values (
  'c8500000-0000-4000-8000-000000000001',
  'c8200000-0000-4000-8000-000000000001',
  'c8400000-0000-4000-8000-000000000001',
  '5511999900100@s.whatsapp.net', 'Context Contact'
);

-- The cutover test database may already have removed the legacy trigger. Add
-- it transactionally so this migration's compatibility behavior is exercised
-- both before and after the eventual Edge retirement.
do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.whatsapp_messages'::regclass
      and tgname = 'set_whatsapp_message_context_before_write'
      and not tgisinternal
  ) then
    create trigger set_whatsapp_message_context_before_write
    before insert or update of conversation_id, session_id, organization_id, lead_id, remote_jid
    on public.whatsapp_messages
    for each row execute function public.set_whatsapp_message_context();
  end if;
end;
$$;

insert into public.whatsapp_messages (
  id, organization_id, conversation_id, session_id, lead_id,
  provider_message_id, message_id, from_me, direction,
  message_type, content, remote_jid, status
)
values (
  'c8600000-0000-4000-8000-000000000001',
  'c8200000-0000-4000-8000-000000000001',
  'c8500000-0000-4000-8000-000000000001',
  'c8400000-0000-4000-8000-000000000001',
  null,
  'provider-context-original', 'provider-context-original',
  false, 'inbound', 'text', 'Original historical message',
  '5511999900100@s.whatsapp.net', 'received'
);

update public.whatsapp_conversations
set session_id = 'c8400000-0000-4000-8000-000000000002'
where id = 'c8500000-0000-4000-8000-000000000001';

select lives_ok(
  $$
    update public.whatsapp_messages
    set lead_id = 'c8300000-0000-4000-8000-000000000001'
    where id = 'c8600000-0000-4000-8000-000000000001'
  $$,
  'linking a lead after conversation rebind remains valid'
);
select is(
  (select session_id from public.whatsapp_messages where id = 'c8600000-0000-4000-8000-000000000001'),
  'c8400000-0000-4000-8000-000000000001'::uuid,
  'linking a lead does not rewrite historical session provenance'
);

select lives_ok(
  $$
    insert into public.whatsapp_messages (
      id, organization_id, conversation_id, session_id, lead_id,
      provider_message_id, message_id, from_me, direction,
      message_type, content, remote_jid, status
    ) values (
      'c8600000-0000-4000-8000-000000000002',
      'c8200000-0000-4000-8000-000000000001',
      'c8500000-0000-4000-8000-000000000001',
      'c8400000-0000-4000-8000-000000000001',
      null,
      'provider-context-explicit', 'provider-context-explicit',
      false, 'inbound', 'text', 'Explicit provider session',
      '5511999900100@s.whatsapp.net', 'received'
    )
  $$,
  'an explicit same-tenant provider session remains valid on insert'
);
select is(
  (select session_id from public.whatsapp_messages where id = 'c8600000-0000-4000-8000-000000000002'),
  'c8400000-0000-4000-8000-000000000001'::uuid,
  'insert does not overwrite an explicit provider session'
);

select * from finish();
rollback;
