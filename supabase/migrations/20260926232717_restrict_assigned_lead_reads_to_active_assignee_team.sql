-- An assigned lead follows the assignee's current active team memberships.
-- Its recorded team is a fallback only while the lead is unassigned.
-- Change only the recorded-team branch and three legacy global-read branches
-- of the existing private RLS helper. Production may have additional
-- restrictions that must not be overwritten by a copy of an older migration.
-- CREATE OR REPLACE keeps the function's owner and grants. Legacy
-- lead_transfer/settings permissions are operational grants, not
-- organization-wide lead read grants in the API permission catalog.
do $migration$
declare
  target_function regprocedure := to_regprocedure('private.can_read_lead(uuid,uuid,uuid)');
  function_definition text;
  compact_definition text;
  rewritten_definition text;
  legacy_grant text;
  old_branch constant text := 'led_team.id = target_team_id';
  new_branch constant text := '(target_assigned_user_id is null and led_team.id = target_team_id)';
  legacy_grants constant text[] := array[
    'or private.user_has_permission(''lead_transfer'', (select auth.uid()))',
    'or private.user_has_permission(''settings_teams'', (select auth.uid()))',
    'or private.user_has_permission(''settings_users'', (select auth.uid()))'
  ];
begin
  if target_function is null then
    raise exception 'lead_read_scope_preflight_failed: private.can_read_lead(uuid,uuid,uuid) is missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_language as lang on lang.oid = p.prolang
    where p.oid = target_function::oid
      and lang.lanname = 'sql'
      and p.provolatile = 's'
      and p.prosecdef = true
      and p.proconfig @> array['search_path=pg_catalog']::text[]
  ) or not exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'leads'
      and policyname = 'leads_select_active_broker_team'
      and cmd = 'SELECT'
      and permissive = 'PERMISSIVE'
  ) then
    raise exception 'lead_read_scope_preflight_failed: expected helper or SELECT policy is missing';
  end if;

  select pg_catalog.pg_get_functiondef(target_function::oid)
  into function_definition;
  compact_definition := pg_catalog.regexp_replace(
    function_definition, '[[:space:]]+', ' ', 'g'
  );

  if function_definition is null
    or pg_catalog.length(function_definition)
       - pg_catalog.length(pg_catalog.replace(function_definition, old_branch, ''))
       <> pg_catalog.length(old_branch)
    or pg_catalog.strpos(
      compact_definition,
      'led_team.id = target_team_id or ( target_assigned_user_id is not null'
    ) = 0
    or pg_catalog.strpos(function_definition, new_branch) > 0
  then
    raise exception 'lead_read_scope_preflight_failed: expected exactly one unguarded recorded-team branch';
  end if;

  rewritten_definition := pg_catalog.replace(function_definition, old_branch, new_branch);
  foreach legacy_grant in array legacy_grants loop
    if pg_catalog.length(function_definition)
       - pg_catalog.length(pg_catalog.replace(function_definition, legacy_grant, ''))
       <> pg_catalog.length(legacy_grant) then
      raise exception 'lead_read_scope_preflight_failed: expected exactly one % branch', legacy_grant;
    end if;
    rewritten_definition := pg_catalog.replace(rewritten_definition, legacy_grant, '');
  end loop;

  execute rewritten_definition;

  if pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(target_function::oid), new_branch
  ) = 0 then
    raise exception 'lead_read_scope_postcheck_failed: recorded-team guard was not installed';
  end if;
  foreach legacy_grant in array legacy_grants loop
    if pg_catalog.strpos(
      pg_catalog.pg_get_functiondef(target_function::oid), legacy_grant
    ) > 0 then
      raise exception 'lead_read_scope_postcheck_failed: % branch remains', legacy_grant;
    end if;
  end loop;
end;
$migration$;
