begin;

create extension if not exists pgtap with schema extensions;
select plan(3);

select is(
  (
    select count(distinct procedure.proname)::integer
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
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
  ),
  12,
  'all audited legacy team and lead RPC families are present'
);

select ok(
  not exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
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
      and (
        has_function_privilege('anon', procedure.oid, 'execute')
        or has_function_privilege('authenticated', procedure.oid, 'execute')
      )
  ),
  'anon and authenticated cannot execute any audited legacy overload'
);

select ok(
  not exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'cleanup_orphan_members',
        'find_orphan_rr_members',
        'find_orphan_team_members'
      )
      and not has_function_privilege('service_role', procedure.oid, 'execute')
  ),
  'service_role retains existing EXECUTE on admin orphan helpers'
);

select * from finish();
rollback;
