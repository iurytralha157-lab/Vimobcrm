-- Additive pre-deploy Realtime foundation for WhatsApp.
--
-- This migration is deliberately separate from the backend cutover. It does
-- not change grants or policies on whatsapp_sessions, whatsapp_conversations
-- or whatsapp_messages, so the currently deployed browser/Edge flow keeps
-- working while the new frontend is rolled out. The browser receives only a
-- content-free organization wake-up and lead-scoped identifiers/status, then
-- fetches the canonical DTO through the authorized Go API.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function private.can_receive_whatsapp_broadcast(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  topic_organization_id uuid;
  topic_lead_id uuid;
begin
  if split_part(p_topic, ':', 1) <> 'whatsapp' then
    return false;
  end if;

  topic_organization_id := private.safe_uuid(split_part(p_topic, ':', 2));
  if topic_organization_id is null then
    return false;
  end if;

  if split_part(p_topic, ':', 3) = 'inbox' then
    return p_topic = 'whatsapp:' || topic_organization_id::text || ':inbox'
      and private.is_org_member(topic_organization_id);
  end if;

  if split_part(p_topic, ':', 3) <> 'lead' then
    return false;
  end if;

  topic_lead_id := private.safe_uuid(split_part(p_topic, ':', 4));
  if topic_lead_id is null
     or p_topic <> 'whatsapp:' || topic_organization_id::text || ':lead:' || topic_lead_id::text then
    return false;
  end if;

  return exists (
    select 1
    from public.leads as lead
    where lead.id = topic_lead_id
      and lead.organization_id = topic_organization_id
      and private.can_access_lead(lead.organization_id, lead.assigned_user_id)
  );
end;
$$;

revoke all on function private.can_receive_whatsapp_broadcast(text)
  from public, anon;
grant execute on function private.can_receive_whatsapp_broadcast(text)
  to authenticated, service_role;

alter table realtime.messages enable row level security;
drop policy if exists whatsapp_authorized_lead_broadcast on realtime.messages;
drop policy if exists whatsapp_authorized_private_broadcast on realtime.messages;
create policy whatsapp_authorized_private_broadcast
on realtime.messages
for select
to authenticated
using (
  extension = 'broadcast'
  and private.can_receive_whatsapp_broadcast((select realtime.topic()))
);

create or replace function private.broadcast_whatsapp_message_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  message_row public.whatsapp_messages;
begin
  message_row := case when tg_op = 'DELETE' then old else new end;
  if message_row.lead_id is null then
    return null;
  end if;

  -- Realtime is only a low-latency hint. A Realtime outage, schema drift or
  -- transient insert failure must never roll back the canonical message write;
  -- the frontend reconciles from the authorized API on subscribe/refocus.
  begin
    -- Insert directly because realtime.send adds a generated `id` field to the
    -- payload. The organization wake-up must remain exactly content-free.
    insert into realtime.messages (payload, event, topic, private, extension)
    values (
      jsonb_build_object('scope', 'conversations'),
      'whatsapp.inbox.changed',
      'whatsapp:' || message_row.organization_id::text || ':inbox',
      true,
      'broadcast'
    );

    perform realtime.send(
      jsonb_build_object(
        'operation', tg_op,
        'messageId', message_row.id,
        'conversationId', message_row.conversation_id,
        'clientMessageId', message_row.client_message_id,
        'status', message_row.status,
        'sentAt', message_row.sent_at
      ),
      'whatsapp.message.changed',
      'whatsapp:' || message_row.organization_id::text || ':lead:' || message_row.lead_id::text,
      true
    );
  exception when others then
    return null;
  end;
  return null;
end;
$$;

revoke all on function private.broadcast_whatsapp_message_change()
  from public, anon, authenticated;
grant execute on function private.broadcast_whatsapp_message_change()
  to service_role;

drop trigger if exists whatsapp_message_private_broadcast on public.whatsapp_messages;
create trigger whatsapp_message_private_broadcast
after insert or update of status, delivered_at, read_at, media_status, media_url,
  content, message_type, reaction_emoji, reaction_to_message_id
on public.whatsapp_messages
for each row execute function private.broadcast_whatsapp_message_change();

commit;
