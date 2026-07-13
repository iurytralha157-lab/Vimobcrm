-- Online keyset index for message history. The foundation repeats this with
-- IF NOT EXISTS only as a fresh-database fallback.
create index concurrently if not exists whatsapp_messages_org_conversation_timeline_idx
  on public.whatsapp_messages(
    organization_id,
    conversation_id,
    (coalesce(sent_at, created_at)) desc,
    id desc
  );
