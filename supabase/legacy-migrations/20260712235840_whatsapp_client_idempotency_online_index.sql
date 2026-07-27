-- Online preflight for the durable WhatsApp foundation.
-- This runs before the transactional foundation so production writes are not
-- blocked while PostgreSQL scans the large legacy message table.
create unique index concurrently if not exists whatsapp_messages_org_session_client_message_uidx
  on public.whatsapp_messages(organization_id, session_id, client_message_id)
  where client_message_id is not null;
