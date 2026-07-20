-- This legacy WhatsApp visibility helper no longer participates in any active
-- policy, trigger, view, or function. Keep it available to the backend while
-- removing the exposed PostgREST RPC surface for signed-in clients.
revoke execute on function public.vimob_can_view_whatsapp_lead(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.vimob_can_view_whatsapp_lead(uuid, uuid)
  to service_role;
