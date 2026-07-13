type OrganizationRoleInput = string | null | undefined;

const MANAGER_MEMBER_ROLES = new Set(["admin", "owner", "super_admin"]);

export function canManageOrganization(input: {
  isSuperAdmin?: boolean;
  memberRole?: OrganizationRoleInput;
}) {
  return Boolean(
    input.isSuperAdmin ||
      MANAGER_MEMBER_ROLES.has(input.memberRole || ""),
  );
}
