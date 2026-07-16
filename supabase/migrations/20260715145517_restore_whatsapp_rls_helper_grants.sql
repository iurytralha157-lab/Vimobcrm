-- Restore EXECUTE grants for WhatsApp RLS helper functions after the global
-- SECURITY DEFINER hardening pass. These helpers are referenced directly by
-- authenticated policies, so authenticated users need EXECUTE while public/anon
-- remain revoked.

revoke execute on function public.vimob_can_access_whatsapp_session(uuid, text) from public, anon;
revoke execute on function public.vimob_can_view_whatsapp_lead(uuid, uuid) from public, anon;
revoke execute on function public.can_view_whatsapp_conversation(uuid) from public, anon;
revoke execute on function public.whatsapp_message_conversation_session_matches(uuid, uuid) from public, anon;

grant execute on function public.vimob_can_access_whatsapp_session(uuid, text) to authenticated, service_role;
grant execute on function public.vimob_can_view_whatsapp_lead(uuid, uuid) to authenticated, service_role;
grant execute on function public.can_view_whatsapp_conversation(uuid) to authenticated, service_role;
grant execute on function public.whatsapp_message_conversation_session_matches(uuid, uuid) to authenticated, service_role;
