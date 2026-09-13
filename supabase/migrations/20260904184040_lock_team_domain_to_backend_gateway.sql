-- Team mutations are served exclusively by the authenticated Go API. Keep the
-- two read grants still required by legacy cross-domain RLS expressions on
-- leads and team_pipelines; both tables remain tenant-filtered by RLS.
--
-- REVOKE/GRANT are intentionally idempotent and do not alter the privileges of
-- postgres, service_role, or other backend roles.
revoke all privileges on table public.teams from public, anon, authenticated;
revoke all privileges on table public.team_members from public, anon, authenticated;
revoke all privileges on table public.member_availability from public, anon, authenticated;

grant select on table public.teams to authenticated;
grant select on table public.team_members to authenticated;
