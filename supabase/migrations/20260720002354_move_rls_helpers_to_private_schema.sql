-- RLS helper functions must remain executable by authenticated because policy
-- expressions run as the caller. Moving the privileged implementations to the
-- unexposed private schema preserves policy dependencies while invoker wrappers
-- keep legacy names working without exposing SECURITY DEFINER RPC endpoints.

-- A newer private.can_access_lead(uuid, uuid) already exists with different
-- semantics (organization + assignee). Preserve the legacy helper OID under a
-- non-colliding name before moving it.
alter function public.can_access_lead(uuid, uuid) rename to can_access_lead_by_id;
alter function public.can_access_lead_by_id(uuid, uuid) set schema private;

do $move_helpers$
declare
  helper record;
begin
  for helper in
    select format(
      'public.%I(%s)',
      p.proname,
      pg_get_function_identity_arguments(p.oid)
    ) as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.proname = any(array[
        'can_access_schedule_event',
        'can_manage_round_robin_as_leader',
        'can_view_whatsapp_conversation',
        'get_user_led_pipeline_ids',
        'get_user_led_team_ids',
        'get_user_organization_id',
        'get_user_team_ids',
        'is_admin',
        'is_pipeline_in_led_team',
        'is_schedule_event_assignee',
        'is_super_admin_member_bypass',
        'is_team_leader',
        'is_user_in_led_team',
        'is_user_leader_of_team',
        'user_belongs_to_organization',
        'user_has_organization',
        'user_has_permission',
        'vimob_can_access_whatsapp_session',
        'vimob_user_has_active_org_membership',
        'vimob_users_share_active_org',
        'whatsapp_message_conversation_session_matches'
      ]::name[])
  loop
    execute format('alter function %s set schema private', helper.signature);
  end loop;
end;
$move_helpers$;

-- Compatibility wrappers. They remain callable from stored policy expressions
-- and old application code, but execute with the caller's privileges.
create function public.can_access_lead(p_lead_id uuid, p_user_id uuid default auth.uid())
returns boolean language sql stable security invoker set search_path = pg_catalog, private, pg_temp
as 'select private.can_access_lead_by_id(p_lead_id, p_user_id)';

create function public.can_access_schedule_event(p_event_id uuid, p_require_full_details boolean default true)
returns boolean language sql stable security invoker set search_path = pg_catalog, private, pg_temp
as 'select private.can_access_schedule_event(p_event_id, p_require_full_details)';

create function public.can_manage_round_robin_as_leader(p_round_robin_id uuid, p_user_id uuid default auth.uid())
returns boolean language sql stable security invoker set search_path = pg_catalog, private, pg_temp
as 'select private.can_manage_round_robin_as_leader(p_round_robin_id, p_user_id)';

create function public.can_view_whatsapp_conversation(p_conversation_id uuid)
returns boolean language sql stable security invoker set search_path = pg_catalog, private, pg_temp
as 'select private.can_view_whatsapp_conversation(p_conversation_id)';

create function public.get_user_led_pipeline_ids()
returns setof uuid language sql stable security invoker set search_path = pg_catalog, private, pg_temp
as 'select * from private.get_user_led_pipeline_ids()';

create function public.get_user_led_team_ids()
returns setof uuid language sql stable security invoker set search_path = pg_catalog, private, pg_temp
as 'select * from private.get_user_led_team_ids()';

create function public.get_user_organization_id()
returns uuid language sql stable security invoker set search_path = pg_catalog, private, pg_temp
as 'select private.get_user_organization_id()';

create function public.get_user_team_ids()
returns setof uuid language sql stable security invoker set search_path = pg_catalog, private, pg_temp
as 'select * from private.get_user_team_ids()';

create function public.is_admin()
returns boolean language sql stable security invoker set search_path = pg_catalog, private, pg_temp
as 'select private.is_admin()';

create function public.is_pipeline_in_led_team(p_pipeline_id uuid, p_user_id uuid default auth.uid())
returns boolean language sql stable security invoker set search_path = pg_catalog, private, pg_temp
as 'select private.is_pipeline_in_led_team(p_pipeline_id, p_user_id)';

create function public.is_schedule_event_assignee(p_event_id uuid, p_user_id uuid default auth.uid())
returns boolean language sql stable security invoker set search_path = pg_catalog, private, pg_temp
as 'select private.is_schedule_event_assignee(p_event_id, p_user_id)';

create or replace function public.is_super_admin()
returns boolean language sql stable security invoker set search_path = pg_catalog, private, pg_temp
as 'select private.is_super_admin()';

create function public.is_super_admin_member_bypass(p_user_id uuid)
returns boolean language sql stable security invoker set search_path = pg_catalog, private, pg_temp
as 'select private.is_super_admin_member_bypass(p_user_id)';

create function public.is_team_leader(check_user_id uuid default auth.uid())
returns boolean language sql stable security invoker set search_path = pg_catalog, private, pg_temp
as 'select private.is_team_leader(check_user_id)';

create function public.is_user_in_led_team(p_target_user_id uuid, p_user_id uuid default auth.uid())
returns boolean language sql stable security invoker set search_path = pg_catalog, private, pg_temp
as 'select private.is_user_in_led_team(p_target_user_id, p_user_id)';

create function public.is_user_leader_of_team(p_team_id uuid, p_user_id uuid default auth.uid())
returns boolean language sql stable security invoker set search_path = pg_catalog, private, pg_temp
as 'select private.is_user_leader_of_team(p_team_id, p_user_id)';

create function public.user_belongs_to_organization(org_id uuid)
returns boolean language sql stable security invoker set search_path = pg_catalog, private, pg_temp
as 'select private.user_belongs_to_organization(org_id)';

create function public.user_has_organization()
returns boolean language sql stable security invoker set search_path = pg_catalog, private, pg_temp
as 'select private.user_has_organization()';

create function public.user_has_permission(p_permission_key text, p_user_id uuid default auth.uid())
returns boolean language sql stable security invoker set search_path = pg_catalog, private, pg_temp
as 'select private.user_has_permission(p_permission_key, p_user_id)';

create function public.vimob_can_access_whatsapp_session(p_session_id uuid, p_permission text default 'view'::text)
returns boolean language sql stable security invoker set search_path = pg_catalog, private, pg_temp
as 'select private.vimob_can_access_whatsapp_session(p_session_id, p_permission)';

create function public.vimob_user_has_active_org_membership(p_org_id uuid)
returns boolean language sql stable security invoker set search_path = pg_catalog, private, pg_temp
as 'select private.vimob_user_has_active_org_membership(p_org_id)';

create function public.vimob_users_share_active_org(p_target_user_id uuid)
returns boolean language sql stable security invoker set search_path = pg_catalog, private, pg_temp
as 'select private.vimob_users_share_active_org(p_target_user_id)';

create function public.whatsapp_message_conversation_session_matches(p_conversation_id uuid, p_session_id uuid)
returns boolean language sql stable security invoker set search_path = pg_catalog, private, pg_temp
as 'select private.whatsapp_message_conversation_session_matches(p_conversation_id, p_session_id)';

grant usage on schema private to authenticated, service_role;

do $harden_private_helpers$
declare
  helper record;
begin
  for helper in
    select format(
      'private.%I(%s)',
      p.proname,
      pg_get_function_identity_arguments(p.oid)
    ) as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.prosecdef
      and p.proname = any(array[
        'can_access_lead',
        'can_access_lead_by_id',
        'can_access_schedule_event',
        'can_manage_round_robin_as_leader',
        'can_view_whatsapp_conversation',
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
        'vimob_user_has_active_org_membership',
        'vimob_users_share_active_org',
        'whatsapp_message_conversation_session_matches'
      ]::name[])
  loop
    execute format(
      'alter function %s set search_path = pg_catalog, public, private, extensions, pg_temp',
      helper.signature
    );
    execute format('revoke execute on function %s from public, anon', helper.signature);
    execute format('grant execute on function %s to authenticated, service_role', helper.signature);
  end loop;
end;
$harden_private_helpers$;

do $secure_public_wrappers$
declare
  helper record;
begin
  for helper in
    select format(
      'public.%I(%s)',
      p.proname,
      pg_get_function_identity_arguments(p.oid)
    ) as signature
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
  loop
    execute format('revoke all on function %s from public, anon', helper.signature);
    execute format('grant execute on function %s to authenticated, service_role', helper.signature);
  end loop;
end;
$secure_public_wrappers$;

comment on function public.is_super_admin() is
  'Non-privileged compatibility wrapper for the private RLS helper.';
