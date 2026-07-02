-- Keep Vimob AI auto-reply opt-in per WhatsApp connection.
-- The backend only replies when this flag is explicitly enabled for the
-- selected session inside the active organization.
update public.whatsapp_sessions
set advanced_settings = coalesce(advanced_settings, '{}'::jsonb) || jsonb_build_object('ai_auto_reply_enabled', false),
    updated_at = now()
where provider = 'evolution_go'
  and coalesce(status, '') <> 'deleted';
