export type DevelopmentMaintenanceScope = {
  userId: string | null;
  tenantUserId: string | null;
  organizationId: string | null;
  tenantOrganizationId: string | null;
  accessSignature: string;
  ready: boolean;
  canManage: boolean;
};

/** A draft belongs to the identity and authorization that opened it. */
export function isDevelopmentMaintenanceScopeCurrent(
  initial: DevelopmentMaintenanceScope,
  current: DevelopmentMaintenanceScope,
  expectedOrganizationId: string,
) {
  return Boolean(
    initial.ready &&
    current.ready &&
    initial.canManage &&
    current.canManage &&
    initial.userId &&
    initial.userId === current.userId &&
    initial.tenantUserId === initial.userId &&
    current.tenantUserId === current.userId &&
    initial.organizationId === expectedOrganizationId &&
    current.organizationId === expectedOrganizationId &&
    current.tenantOrganizationId === expectedOrganizationId &&
    initial.accessSignature === current.accessSignature,
  );
}

export function nextDevelopmentMaintenanceInvalidation(
  invalidated: boolean,
  initial: DevelopmentMaintenanceScope,
  current: DevelopmentMaintenanceScope,
  expectedOrganizationId: string,
) {
  return (
    invalidated ||
    !isDevelopmentMaintenanceScopeCurrent(
      initial,
      current,
      expectedOrganizationId,
    )
  );
}
