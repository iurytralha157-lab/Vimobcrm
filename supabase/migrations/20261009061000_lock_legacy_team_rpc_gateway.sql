-- The July production baseline revoked PUBLIC's implicit EXECUTE but retained
-- explicit anon/authenticated grants on these older public RPCs. In particular,
-- SECURITY DEFINER team/lead reads can bypass membership-generation checks,
-- and the orphan cleanup RPC can delete members outside the backend's admin gate.
-- The application now uses the Go API for these operations; its admin cleanup
-- endpoint and the retained Edge Function use the backend/service role.
-- Include every overload by name so a legacy signature cannot stay exposed.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

do $migration$
declare
  legacy_rpc record;
begin
  for legacy_rpc in
    select procedure.oid::regprocedure as signature
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.prokind = 'f'
      and procedure.proname in (
        'get_team_member_ids',
        'get_dashboard_team_lead_ids',
        'get_funnel_data',
        'get_lead_sources_data',
        'is_member_available',
        'is_user_available_for_distribution',
        'list_contacts_paginated',
        'move_lead_stage',
        'transfer_lead_assignee',
        'cleanup_orphan_members',
        'find_orphan_rr_members',
        'find_orphan_team_members'
      )
  loop
    execute format(
      'revoke execute on function %s from public, anon, authenticated',
      legacy_rpc.signature
    );
  end loop;
end
$migration$;

commit;
