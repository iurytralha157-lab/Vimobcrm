import { useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { isTenantContextForOrganization } from '@/lib/access/tenant-navigation';

/**
 * Hook para verificar se o usuario pode editar cadencias e pipelines.
 * Retorna true para administradores, donos, super admins ou lideres de equipe.
 */
export function useCanEditCadences(options?: { enabled?: boolean }) {
  const { profile, organization, tenantContext, isSuperAdmin, userOrganizations } = useAuth();
  const activeOrganizationId = organization?.id || profile?.organization_id;
  const activeMemberRole = userOrganizations.find((org) => org.organization_id === activeOrganizationId)?.member_role;
  const canEditByRole = Boolean(
    isSuperAdmin ||
    activeMemberRole === 'admin' ||
    activeMemberRole === 'owner',
  );
  const isTeamLeader = isTenantContextForOrganization(activeOrganizationId, tenantContext) &&
    Boolean(tenantContext?.isTeamLeader);

  return useMemo(() => {
    if (canEditByRole) return true;
    if (!(options?.enabled ?? true)) return false;
    return isTeamLeader;
  }, [canEditByRole, isTeamLeader, options?.enabled]);
}
