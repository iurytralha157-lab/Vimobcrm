-- Team-pipeline mutations must pass through the authenticated Go API, which
-- checks pipeline_manage and the team scope. The legacy Data API policy also
-- accepts settings_teams, so table grants alone must not allow client writes.
--
-- Keep authenticated SELECT: the existing public.pipelines SELECT policy reads
-- this table. Leave service_role and the backend database owner untouched.
-- Reapplying this migration is safe. A rollback must not restore client writes;
-- use a forward repair if a read dependency is discovered during rollout.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '1min';

revoke all privileges on table public.team_pipelines
  from public, anon, authenticated;

grant select on table public.team_pipelines to authenticated;

commit;
