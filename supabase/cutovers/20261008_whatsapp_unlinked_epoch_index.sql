-- Required prebuild for the controlled phase-B cutover. Run with an
-- autocommit-capable SQL client after phase A is present and before applying
-- 20261008_activate_whatsapp_unlinked_epoch.sql. Never run inside BEGIN.
-- This script does not drop the legacy full unique constraint or activate
-- prospective unlinked capture.

create unique index concurrently if not exists
  whatsapp_conversations_active_session_remote_jid_uidx
on public.whatsapp_conversations (session_id, remote_jid)
where retired_at is null;
