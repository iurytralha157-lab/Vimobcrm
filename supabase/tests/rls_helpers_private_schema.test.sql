begin;

create extension if not exists pgtap with schema extensions;
select plan(10);

select is(
  (
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and has_function_privilege('authenticated', p.oid, 'execute')
  ),
  0::bigint,
  'Authenticated cannot execute SECURITY DEFINER functions in the public schema'
);

select is(
  (
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.prosecdef
      and p.proname = any(array[
        'can_access_lead','can_access_lead_by_id','can_access_schedule_event',
        'can_manage_round_robin_as_leader','can_view_whatsapp_conversation',
        'get_user_led_pipeline_ids','get_user_led_team_ids','get_user_organization_id',
        'get_user_team_ids','is_admin','is_pipeline_in_led_team','is_schedule_event_assignee',
        'is_super_admin_member_bypass','is_super_admin','is_team_leader','is_user_in_led_team',
        'is_user_leader_of_team','user_belongs_to_organization','user_has_organization',
        'user_has_permission','vimob_can_access_whatsapp_session',
        'vimob_user_has_active_org_membership','vimob_users_share_active_org',
        'whatsapp_message_conversation_session_matches'
      ]::name[])
  ),
  24::bigint,
  'All 24 privileged RLS helper implementations live in private'
);

select is(
  (
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not p.prosecdef
      and p.proname = any(array[
        'can_access_lead','can_access_schedule_event','can_manage_round_robin_as_leader',
        'can_view_whatsapp_conversation','get_user_led_pipeline_ids','get_user_led_team_ids',
        'get_user_organization_id','get_user_team_ids','is_admin','is_pipeline_in_led_team',
        'is_schedule_event_assignee','is_super_admin_member_bypass','is_super_admin','is_team_leader',
        'is_user_in_led_team','is_user_leader_of_team','user_belongs_to_organization',
        'user_has_organization','user_has_permission','vimob_can_access_whatsapp_session',
        'vimob_user_has_active_org_membership','vimob_users_share_active_org',
        'whatsapp_message_conversation_session_matches'
      ]::name[])
  ),
  23::bigint,
  'All 23 legacy names remain as security-invoker wrappers'
);

select ok(
  not (select prosecdef from pg_proc where oid = 'public.is_super_admin()'::regprocedure),
  'Public is_super_admin compatibility wrapper is security invoker'
);

select ok(
  has_function_privilege('authenticated', 'public.is_super_admin()', 'execute'),
  'Authenticated policies can execute the public compatibility wrapper'
);

select is(
  (
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.prosecdef
      and p.proname = any(array[
        'can_access_lead','can_access_lead_by_id','can_access_schedule_event',
        'can_manage_round_robin_as_leader','can_view_whatsapp_conversation',
        'get_user_led_pipeline_ids','get_user_led_team_ids','get_user_organization_id',
        'get_user_team_ids','is_admin','is_pipeline_in_led_team','is_schedule_event_assignee',
        'is_super_admin_member_bypass','is_super_admin','is_team_leader','is_user_in_led_team',
        'is_user_leader_of_team','user_belongs_to_organization','user_has_organization',
        'user_has_permission','vimob_can_access_whatsapp_session',
        'vimob_user_has_active_org_membership','vimob_users_share_active_org',
        'whatsapp_message_conversation_session_matches'
      ]::name[])
      and not has_function_privilege('authenticated', p.oid, 'execute')
  ),
  0::bigint,
  'Authenticated retains execution required by RLS policies'
);

select is(
  (
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.prosecdef
      and p.proname = any(array[
        'can_access_lead','can_access_lead_by_id','can_access_schedule_event',
        'can_manage_round_robin_as_leader','can_view_whatsapp_conversation',
        'get_user_led_pipeline_ids','get_user_led_team_ids','get_user_organization_id',
        'get_user_team_ids','is_admin','is_pipeline_in_led_team','is_schedule_event_assignee',
        'is_super_admin_member_bypass','is_super_admin','is_team_leader','is_user_in_led_team',
        'is_user_leader_of_team','user_belongs_to_organization','user_has_organization',
        'user_has_permission','vimob_can_access_whatsapp_session',
        'vimob_user_has_active_org_membership','vimob_users_share_active_org',
        'whatsapp_message_conversation_session_matches'
      ]::name[])
      and has_function_privilege('anon', p.oid, 'execute')
  ),
  0::bigint,
  'Anonymous cannot execute privileged RLS helpers'
);

select is(
  (
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.prosecdef
      and p.proname = any(array[
        'can_access_lead','can_access_lead_by_id','can_access_schedule_event',
        'can_manage_round_robin_as_leader','can_view_whatsapp_conversation',
        'get_user_led_pipeline_ids','get_user_led_team_ids','get_user_organization_id',
        'get_user_team_ids','is_admin','is_pipeline_in_led_team','is_schedule_event_assignee',
        'is_super_admin_member_bypass','is_super_admin','is_team_leader','is_user_in_led_team',
        'is_user_leader_of_team','user_belongs_to_organization','user_has_organization',
        'user_has_permission','vimob_can_access_whatsapp_session',
        'vimob_user_has_active_org_membership','vimob_users_share_active_org',
        'whatsapp_message_conversation_session_matches'
      ]::name[])
      and not coalesce(array_to_string(p.proconfig, ',') ilike '%search_path=pg_catalog%', false)
  ),
  0::bigint,
  'Every privileged RLS helper has a fixed search path'
);

select lives_ok(
  $$select public.is_super_admin()$$,
  'Public compatibility wrapper remains callable by stored policies'
);

select lives_ok(
  $$select public.can_access_lead(gen_random_uuid())$$,
  'Legacy lead helper wrapper remains callable with its default user argument'
);

select * from finish();
rollback;
