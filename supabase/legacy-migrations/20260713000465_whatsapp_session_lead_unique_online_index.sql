-- Intentionally outside an explicit transaction. Apply with an online-index
-- capable runner because CREATE INDEX CONCURRENTLY cannot run in a transaction.
create unique index concurrently if not exists uq_whatsapp_conversations_org_session_lead_active
  on public.whatsapp_conversations (organization_id, session_id, lead_id)
  where lead_id is not null
    and session_id is not null
    and deleted_at is null
    and is_group is not true;
