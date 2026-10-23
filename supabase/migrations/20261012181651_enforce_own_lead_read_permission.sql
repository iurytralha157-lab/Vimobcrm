-- Match the Go permission contract on direct Supabase reads. LeadViewOwn is
-- inherited by every active ordinary member (custom roles are additive), but
-- an explicit individual denial removes that branch. All-lead and current-team
-- grants remain independent, just as in leadscope.VisibilitySQL.
-- Apply membership_access_generation and whatsapp_team_generation_read_scope
-- first. This does not add session checks to global RLS helpers or change their
-- grants. Legacy aggregate RPCs have no application consumers and must not
-- offer a second path around the API's lead and session permissions.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

do $migration$
declare
  target_function regprocedure := pg_catalog.to_regprocedure('private.can_read_lead(uuid,uuid,uuid)');
  original_definition text;
  rewritten_definition text;
  old_branch constant text := 'or target_assigned_user_id = (select auth.uid())';
  new_branch constant text := $branch$or (
          target_assigned_user_id = (select auth.uid())
          and not exists (
            select 1
            from public.user_permission_overrides as denied_own_permission
            where denied_own_permission.organization_id = target_organization_id
              and denied_own_permission.user_id = (select auth.uid())
              and pg_catalog.lower(pg_catalog.btrim(denied_own_permission.permission_key)) = 'lead_view_own'
              and denied_own_permission.allowed = false
          )
        )$branch$;
begin
  if target_function is null then
    raise exception 'own_lead_read_preflight_failed: can_read_lead is missing';
  end if;
  select pg_catalog.pg_get_functiondef(target_function::oid) into original_definition;
  if pg_catalog.strpos(original_definition, 'private.is_org_member(target_organization_id)') = 0
     or pg_catalog.strpos(original_definition, 'private.lead_view_all_granted(target_organization_id)') = 0
     or pg_catalog.strpos(original_definition, 'leader_membership.membership_generation = leader.membership_generation') = 0
     or pg_catalog.strpos(original_definition, 'broker_organization_member.membership_generation = broker_member.membership_generation') = 0
     or pg_catalog.strpos(original_definition, 'broker_organization_member.deleted_at is null') = 0
     or pg_catalog.length(original_definition)
        - pg_catalog.length(pg_catalog.replace(original_definition, old_branch, ''))
        <> pg_catalog.length(old_branch)
     or pg_catalog.has_function_privilege('anon', target_function::oid, 'execute')
  then
    raise exception 'own_lead_read_preflight_failed: apply the generation-fenced read helper first and review grants or contract drift';
  end if;
  rewritten_definition := pg_catalog.replace(original_definition, old_branch, new_branch);
  execute rewritten_definition;
  if pg_catalog.strpos(pg_catalog.pg_get_functiondef(target_function::oid), new_branch) = 0
     or pg_catalog.has_function_privilege('anon', target_function::oid, 'execute')
  then
    raise exception 'own_lead_read_postcheck_failed: own permission denial or minimal grants did not hold';
  end if;
end;
$migration$;

-- Reassert the client boundary even when an older installation retained an
-- explicit grant after PUBLIC was revoked. Cover every overload without
-- removing the functions or their service_role/administrative grants.
do $legacy_dashboard_rpcs$
declare
  legacy_rpc record;
begin
  for legacy_rpc in
    select procedure.oid::regprocedure as signature
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.prokind = 'f'
      and procedure.proname in (
        'get_dashboard_stats',
        'get_dashboard_team_lead_ids',
        'get_funnel_data',
        'get_lead_sources_data'
      )
  loop
    execute pg_catalog.format(
      'revoke execute on function %s from public, anon, authenticated',
      legacy_rpc.signature
    );
  end loop;
end;
$legacy_dashboard_rpcs$;

commit;
