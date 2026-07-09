type OrganizationRoleInput = string | null | undefined;

const MANAGER_PROFILE_ROLES = new Set(["admin", "super_admin"]);
const MANAGER_MEMBER_ROLES = new Set(["admin", "owner", "super_admin"]);

export function canManageOrganization(input: {
  isSuperAdmin?: boolean;
  profileRole?: OrganizationRoleInput;
  memberRole?: OrganizationRoleInput;
}) {
  return Boolean(
    input.isSuperAdmin ||
      MANAGER_PROFILE_ROLES.has(input.profileRole || "") ||
      MANAGER_MEMBER_ROLES.has(input.memberRole || ""),
  );
}
