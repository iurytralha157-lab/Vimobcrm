create index if not exists idx_whatsapp_conversations_org_recent
  on public.whatsapp_conversations (
    organization_id,
    last_message_at desc nulls last,
    created_at desc,
    id desc
  )
  where deleted_at is null;

create index if not exists idx_whatsapp_conversations_org_session_recent
  on public.whatsapp_conversations (
    organization_id,
    session_id,
    last_message_at desc nulls last,
    created_at desc,
    id desc
  )
  where deleted_at is null;
