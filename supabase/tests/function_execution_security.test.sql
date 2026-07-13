begin;

create extension if not exists pgtap with schema extensions;
select plan(5);

select is(
  (
    select count(*)
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.prosecdef
      and has_function_privilege('anon', procedure.oid, 'execute')
  ),
  0::bigint,
  'anonymous clients cannot execute SECURITY DEFINER functions'
);

select is(
  (
    select count(*)
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.prosecdef
      and has_function_privilege('authenticated', procedure.oid, 'execute')
      and procedure.proname <> all(array[
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
  ),
  0::bigint,
  'authenticated clients can execute only RLS helper functions'
);

select is(
  (
    select count(*)
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.prosecdef
      and not has_function_privilege('service_role', procedure.oid, 'execute')
  ),
  0::bigint,
  'service role retains access to backend functions'
);

select is(
  (
    select count(*)
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
      and not exists (
        select 1
        from unnest(coalesce(procedure.proconfig, array[]::text[])) as setting
        where setting like 'search_path=%'
      )
  ),
  0::bigint,
  'advisor-reported functions have an immutable search_path'
);

select is(
  (
    select count(*)
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
      and not has_function_privilege('authenticated', procedure.oid, 'execute')
  ),
  0::bigint,
  'authenticated RLS helpers remain executable'
);

select * from finish();
rollback;
