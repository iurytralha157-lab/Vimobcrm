-- SECURITY DEFINER functions inherit table privileges from their owner, so they
-- must not keep PostgreSQL's default EXECUTE grant to PUBLIC. The application
-- talks to these functions through the backend/service role; authenticated
-- clients only need the helpers referenced by RLS policies.
do $security_definer_grants$
declare
  fn record;
begin
  for fn in
    select
      format(
        '%I.%I(%s)',
        namespace.nspname,
        procedure.proname,
        pg_get_function_identity_arguments(procedure.oid)
      ) as signature
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.prosecdef
  loop
    execute format(
      'revoke execute on function %s from public, anon, authenticated',
      fn.signature
    );
    execute format(
      'grant execute on function %s to service_role',
      fn.signature
    );
  end loop;
end;
$security_definer_grants$;

-- These functions are evaluated by authenticated RLS policies. Keep the list
-- explicit so a new SECURITY DEFINER function is private by default. The loop
-- tolerates schema variants while local and production migration histories are
-- being reconciled.
do $rls_helper_grants$
declare
  fn record;
begin
  for fn in
    select
      format(
        '%I.%I(%s)',
        namespace.nspname,
        procedure.proname,
        pg_get_function_identity_arguments(procedure.oid)
      ) as signature
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.prosecdef
      and procedure.proname = any(array[
        'can_access_lead',
        'can_access_schedule_event',
        'can_manage_round_robin_as_leader',
        'can_view_whatsapp_conversation',
        'check_storage_org_access',
        'get_user_led_pipeline_ids',
        'get_user_led_team_ids',
        'get_user_organization_id',
        'get_user_team_ids',
        'is_admin',
        'is_pipeline_in_led_team',
        'is_schedule_event_assignee',
        'is_super_admin_member_bypass',
        'is_super_admin',
        'is_team_leader',
        'is_user_in_led_team',
        'is_user_leader_of_team',
        'user_belongs_to_organization',
        'user_has_organization',
        'user_has_permission',
        'vimob_can_access_whatsapp_session',
        'vimob_can_view_whatsapp_lead',
        'vimob_user_has_active_org_membership',
        'vimob_users_share_active_org',
        'whatsapp_message_conversation_session_matches'
      ]::name[])
  loop
    execute format(
      'grant execute on function %s to authenticated',
      fn.signature
    );
  end loop;
end;
$rls_helper_grants$;

-- Pin every advisor-reported mutable search_path without rewriting function
-- bodies. pg_catalog is first and application/extension schemas are explicit.
do $fixed_search_paths$
declare
  fn record;
begin
  for fn in
    select
      format(
        '%I.%I(%s)',
        namespace.nspname,
        procedure.proname,
        pg_get_function_identity_arguments(procedure.oid)
      ) as signature
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where (namespace.nspname, procedure.proname) in (
      ('public', 'get_my_org_id'),
      ('public', 'gamification_xp_for_level'),
      ('public', 'gamification_level_for_xp'),
      ('public', 'gamification_rank_tier'),
      ('public', 'check_whatsapp_conversation_insert'),
      ('public', 'register_lead_reentry'),
      ('public', 'on_lead_created_entry_event'),
      ('public', 'ensure_organization_membership'),
      ('public', 'handle_prospecting_report_gamification'),
      ('public', 'check_ranking_overtake'),
      ('public', 'try_acquire_execution_step_lock'),
      ('public', 'release_execution_step_lock'),
      ('public', 'recover_stuck_executions'),
      ('public', 'generate_organization_api_key'),
      ('public', 'fn_update_construction_project_progress'),
      ('public', 'fn_update_construction_financial_progress'),
      ('public', 'execute_stage_operational_actions'),
      ('public', 'handle_gamification_event'),
      ('public', 'sync_user_level_and_xp'),
      ('public', 'handle_updated_at'),
      ('private', 'set_updated_at'),
      ('public', 'whatsapp_webhook_has_lead_creation_context')
    )
  loop
    execute format(
      'alter function %s set search_path = pg_catalog, public, private, extensions, pg_temp',
      fn.signature
    );
  end loop;
end;
$fixed_search_paths$;
