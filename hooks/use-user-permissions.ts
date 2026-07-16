import { useAuth } from '@/contexts/AuthContext';
import {
  getTenantPermissions,
  isTenantContextForOrganization,
} from '@/lib/access/tenant-navigation';

interface UserPermissions {
  permissions: string[];
  isLoading: boolean;
  hasPermission: (key: string) => boolean;
}

/**
 * Hook to fetch all permissions for the current user.
 * Returns a helper function to check if user has a specific permission.
 * Admins and super admins always have all permissions.
 */
export function useUserPermissions(): UserPermissions {
  const { profile, organization, tenantContext, isSuperAdmin, loading } = useAuth();
  const organizationId = organization?.id || profile?.organization_id;
  const hasCurrentTenantContext = isTenantContextForOrganization(organizationId, tenantContext);
  const permissions = hasCurrentTenantContext && tenantContext
    ? getTenantPermissions(tenantContext)
    : isSuperAdmin
      ? ['*']
      : [];
  const isLoading = loading || !profile?.id || (!isSuperAdmin && !hasCurrentTenantContext);

  const hasPermission = (key: string): boolean => {
    // Super admin always has permission
    if (isSuperAdmin) return true;

    // Admin always has permission
    // Still loading - return false to prevent unauthorized access
    // This is safer than returning true during load
    if (isLoading) return false;

    // Wildcard means all permissions
    if (permissions.includes('*')) return true;

    return permissions.includes(key);
  };

  return {
    permissions,
    isLoading,
    hasPermission,
  };
}
