-- The session-scoped replacement must be verified before this file runs.
-- Intentionally outside an explicit transaction for a low-lock production drop.
drop index concurrently if exists public.uq_whatsapp_conversations_org_lead_active;
