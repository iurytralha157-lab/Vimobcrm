-- Role and permission mutations must pass through the authenticated Go API,
-- which enforces active session, tenant scope, hierarchy and audit rules.
-- Legacy browser reads remain available under the existing RLS policies.
-- The Go database role and service_role are deliberately unaffected, so this
-- grant change also works while older API replicas are being replaced.
--
-- Rollback, only after an explicit access review: restore the former client
-- grants on these five tables. That reopens the direct-write bypass, so a
-- forward repair is preferable to granting write access again.

revoke all privileges on table
  public.organization_roles,
  public.organization_role_permissions,
  public.user_organization_roles,
  public.user_permissions,
  public.permissions
from public, anon, authenticated;

grant select on table
  public.organization_roles,
  public.organization_role_permissions,
  public.user_organization_roles,
  public.permissions
to anon, authenticated;

-- The earlier auth hotfix deliberately allowed a user to read their own
-- legacy permission rows. Keep that read, with its existing RLS restriction.
grant select on table public.user_permissions to authenticated;
