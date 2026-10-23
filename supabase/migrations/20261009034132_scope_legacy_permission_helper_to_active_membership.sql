-- Legacy RLS and RPC consumers still call user_has_permission. Keep their
-- alias-based permissions, but resolve them only through a live membership,
-- assignment and role in the requested organization.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

create or replace function private.user_has_permission_in_organization(
  p_permission_key text,
  p_user_id uuid,
  p_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select private.is_super_admin()
    or (
      p_organization_id is not null
      and nullif(pg_catalog.btrim(p_permission_key), '') is not null
      and exists (
        select 1
        from public.users as app_user
        join public.organization_members as member
          on member.user_id = app_user.id
         and member.organization_id = p_organization_id
        join public.organizations as organization
          on organization.id = member.organization_id
        where app_user.id = p_user_id
          and coalesce(app_user.is_active, false) = true
          and coalesce(member.is_active, false) = true
          and member.deleted_at is null
          and coalesce(organization.is_active, true) = true
          and (
            member.role in ('owner', 'admin')
            or exists (
              select 1
              from public.user_organization_roles as assignment
              join public.organization_roles as role
                on role.id = assignment.role_id
               and role.organization_id = assignment.organization_id
              join public.organization_role_permissions as role_permission
                on role_permission.role_id = role.id
               and role_permission.organization_id = role.organization_id
              where assignment.user_id = app_user.id
                and assignment.organization_id = p_organization_id
                and coalesce(assignment.is_active, false) = true
                and coalesce(role.is_active, false) = true
                and pg_catalog.lower(pg_catalog.btrim(role_permission.permission_key))
                    = pg_catalog.lower(pg_catalog.btrim(p_permission_key))
            )
          )
      )
    );
$function$;

revoke all on function private.user_has_permission_in_organization(text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.user_has_permission_in_organization(text, uuid, uuid)
  to service_role;

-- The two-argument legacy helper has no organization parameter. Bind it to
-- the user's selected organization rather than accepting a grant from any
-- organization where that user once had a role.
create or replace function private.user_has_permission(
  p_permission_key text,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select private.user_has_permission_in_organization(
    p_permission_key,
    p_user_id,
    (select app_user.organization_id from public.users as app_user where app_user.id = p_user_id)
  );
$function$;

-- The manager default and both custom-role paths grant all-lead read only
-- when no explicit lead_view_all denial exists. Owner/admin still have their
-- implicit access, matching the API resolver.
create or replace function private.lead_view_all_granted(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select private.has_org_role(p_organization_id, array['owner', 'admin']::text[])
    or (
      not exists (
        select 1
        from public.user_permission_overrides as denied
        where denied.organization_id = p_organization_id
          and denied.user_id = (select auth.uid())
          and pg_catalog.lower(pg_catalog.btrim(denied.permission_key)) = 'lead_view_all'
          and denied.allowed = false
      )
      and (
        private.has_org_role(p_organization_id, array['manager']::text[])
        or private.has_permission(p_organization_id, 'lead_view_all')
        or private.user_has_permission_in_organization(
          'lead_edit_all', (select auth.uid()), p_organization_id
        )
      )
    );
$function$;

revoke all on function private.lead_view_all_granted(uuid)
  from public, anon, authenticated;
grant execute on function private.lead_view_all_granted(uuid)
  to service_role;

-- Leads can be read for any active membership, not just the selected one.
-- Replace only the three all-lead branches; keep assignment/team rules intact.
do $migration$
declare
  target_function regprocedure := to_regprocedure('private.can_read_lead(uuid,uuid,uuid)');
  function_definition text;
  rewritten_definition text;
  old_role_branch constant text := 'private.has_org_role(target_organization_id, array[''owner'', ''admin'', ''manager'']::text[])';
  old_canonical_branch constant text := 'or private.has_permission(target_organization_id, ''lead_view_all'')';
  old_legacy_branch constant text := 'or private.user_has_permission(''lead_edit_all'', (select auth.uid()))';
  new_branch constant text := 'private.lead_view_all_granted(target_organization_id)';
begin
  if target_function is null then
    raise exception 'legacy_permission_scope_preflight_failed: can_read_lead is missing';
  end if;
  select pg_catalog.pg_get_functiondef(target_function::oid)
  into function_definition;
  if function_definition is null
    or pg_catalog.length(function_definition)
       - pg_catalog.length(pg_catalog.replace(function_definition, old_role_branch, ''))
       <> pg_catalog.length(old_role_branch)
    or pg_catalog.length(function_definition)
       - pg_catalog.length(pg_catalog.replace(function_definition, old_canonical_branch, ''))
       <> pg_catalog.length(old_canonical_branch)
    or pg_catalog.length(function_definition)
       - pg_catalog.length(pg_catalog.replace(function_definition, old_legacy_branch, ''))
       <> pg_catalog.length(old_legacy_branch)
  then
    raise exception 'legacy_permission_scope_preflight_failed: expected three all-lead branches';
  end if;
  rewritten_definition := pg_catalog.replace(function_definition, old_role_branch, new_branch);
  rewritten_definition := pg_catalog.replace(rewritten_definition, old_canonical_branch, '');
  rewritten_definition := pg_catalog.replace(rewritten_definition, old_legacy_branch, '');
  execute rewritten_definition;
  if pg_catalog.strpos(pg_catalog.pg_get_functiondef(target_function::oid), new_branch) = 0
    or pg_catalog.strpos(pg_catalog.pg_get_functiondef(target_function::oid), old_role_branch) > 0
    or pg_catalog.strpos(pg_catalog.pg_get_functiondef(target_function::oid), old_canonical_branch) > 0
    or pg_catalog.strpos(pg_catalog.pg_get_functiondef(target_function::oid), old_legacy_branch) > 0
  then
    raise exception 'legacy_permission_scope_postcheck_failed: old all-lead branches remain';
  end if;
end;
$migration$;

commit;
