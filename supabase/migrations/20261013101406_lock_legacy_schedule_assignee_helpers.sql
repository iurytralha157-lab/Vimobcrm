-- Agenda reads and commands belong to the backend gateway since the 2026-09-12
-- cutover. The boolean helper is still used by legacy security-definer routines
-- and dormant RLS policies, so retain its definition and service-role access.
-- Remove both direct grants and inherited PUBLIC execution: a browser must not
-- use arbitrary event/user UUIDs to infer participants across organizations.
-- No row changes, function drops or table locks. Compatible with both API
-- versions during replica replacement. Rollback should retain this restriction;
-- restoring the obsolete browser grant would reopen the oracle.
begin;

revoke execute on function public.is_schedule_event_assignee(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function private.is_schedule_event_assignee(uuid, uuid)
  from public, anon, authenticated;

commit;
