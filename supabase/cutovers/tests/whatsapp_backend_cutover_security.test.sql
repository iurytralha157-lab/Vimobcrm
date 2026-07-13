begin;

create extension if not exists pgtap with schema extensions;
select plan(10);

select is(
  (
    select count(*)
    from unnest(array[
      'public.vimob_can_view_whatsapp_lead(uuid,uuid)',
      'public.can_view_whatsapp_conversation(uuid)',
      'public.vimob_can_access_whatsapp_session(uuid,text)',
      'public.whatsapp_message_conversation_session_matches(uuid,uuid)'
    ]) as helper(signature)
    where has_function_privilege('authenticated', helper.signature, 'execute')
  ),
  0::bigint,
  'authenticated cannot execute backend-only WhatsApp helpers after cutover'
);

select is(
  (
    select count(*)
    from unnest(array[
      'public.vimob_can_view_whatsapp_lead(uuid,uuid)',
      'public.can_view_whatsapp_conversation(uuid)',
      'public.vimob_can_access_whatsapp_session(uuid,text)',
      'public.whatsapp_message_conversation_session_matches(uuid,uuid)'
    ]) as helper(signature)
    where has_function_privilege('anon', helper.signature, 'execute')
  ),
  0::bigint,
  'anonymous cannot execute backend-only WhatsApp helpers after cutover'
);

select is(
  (
    select count(*)
    from unnest(array[
      'public.vimob_can_view_whatsapp_lead(uuid,uuid)',
      'public.can_view_whatsapp_conversation(uuid)',
      'public.vimob_can_access_whatsapp_session(uuid,text)',
      'public.whatsapp_message_conversation_session_matches(uuid,uuid)'
    ]) as helper(signature)
    where has_function_privilege('service_role', helper.signature, 'execute')
  ),
  4::bigint,
  'service role retains every backend-only WhatsApp helper'
);

select is(
  (
    select count(*)
    from unnest(array[
      'public.whatsapp_sessions',
      'public.whatsapp_conversations',
      'public.whatsapp_messages'
    ]) as relation(name)
    where has_table_privilege('authenticated', relation.name, 'select,insert,update,delete')
  ),
  0::bigint,
  'authenticated has no raw WhatsApp table privileges after cutover'
);

select is(
  (
    select count(*)
    from unnest(array[
      'public.whatsapp_sessions',
      'public.whatsapp_conversations',
      'public.whatsapp_messages'
    ]) as relation(name)
    where has_table_privilege('anon', relation.name, 'select,insert,update,delete')
  ),
  0::bigint,
  'anonymous has no raw WhatsApp table privileges after cutover'
);

select is(
  (
    select count(*)
    from unnest(array[
      'public.whatsapp_sessions',
      'public.whatsapp_conversations',
      'public.whatsapp_messages'
    ]) as relation(name)
    where has_table_privilege('service_role', relation.name, 'select,insert,update,delete')
  ),
  3::bigint,
  'service role retains CRUD on canonical WhatsApp tables'
);

select is(
  (
    select count(*) from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename in ('whatsapp_sessions', 'whatsapp_conversations', 'whatsapp_messages')
  ),
  0::bigint,
  'legacy browser policies are absent after cutover'
);

select ok(
  exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.whatsapp_messages'::regclass
      and tgname = 'whatsapp_message_private_broadcast'
      and not tgisinternal
  ),
  'private WhatsApp message broadcast trigger remains installed'
);

select ok(
  exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'realtime'
      and tablename = 'messages'
      and policyname = 'whatsapp_authorized_private_broadcast'
  ),
  'private Realtime authorization policy remains installed'
);

select ok(
  has_function_privilege('authenticated', 'private.can_receive_whatsapp_broadcast(text)', 'execute'),
  'authenticated clients retain only the content-free private Realtime gate'
);

select * from finish();
rollback;
