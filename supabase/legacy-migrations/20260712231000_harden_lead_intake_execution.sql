-- Lead intake mutates assignments and must remain backend-owned even when the
-- function body is recreated by an out-of-order migration reconciliation.
revoke execute on function public.handle_lead_intake(uuid)
  from public, anon, authenticated;

grant execute on function public.handle_lead_intake(uuid)
  to service_role;
