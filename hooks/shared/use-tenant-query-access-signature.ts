"use client";

import { useAuth } from "@/contexts/AuthContext";
import { createTenantQueryAccessSignature } from "@/lib/access/tenant-query-cache";

/** Scope retained query data by the current authenticated access context. */
export function useTenantQueryAccessSignature(): string {
  const {
    user,
    organization,
    activeOrganization,
    tenantContext,
    isSuperAdmin,
    impersonating,
  } = useAuth();

  return createTenantQueryAccessSignature({
    // A stale profile must not retain authenticated data during sign out.
    userId: user?.id,
    organizationId: activeOrganization.organizationId,
    memberRole: tenantContext?.memberRole,
    permissions: tenantContext?.permissions,
    enabledModules: tenantContext?.enabledModules,
    isTeamLeader: tenantContext?.isTeamLeader,
    ledTeamIds: tenantContext?.ledTeamIds,
    ledUserIds: tenantContext?.ledUserIds,
    ledPipelineIds: tenantContext?.ledPipelineIds,
    isSuperAdmin: tenantContext?.isSuperAdmin ?? isSuperAdmin,
    impersonatedOrganizationId: impersonating?.orgId,
    propertyEditPolicy: organization?.property_edit_policy,
    propertyOwnerContactVisibility: organization?.property_owner_contact_visibility,
  });
}
