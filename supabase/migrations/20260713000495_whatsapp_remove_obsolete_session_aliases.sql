-- Keep fresh/local schemas on the production WhatsApp session contract. The
-- canonical backend fields are instance_name and owner_user_id; the historical
-- name/created_by aliases no longer exist in production and masked invalid test
-- fixtures when they remained in local databases.
begin;
set local lock_timeout = '5s';

alter table public.whatsapp_sessions
  drop column if exists name;

alter table public.whatsapp_sessions
  drop column if exists created_by;

commit;
