import { useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useTeams } from '@/hooks/use-teams';

/**
 * Hook para verificar se o usuario pode editar cadencias e pipelines.
 * Retorna true para administradores, donos, super admins ou lideres de equipe.
 */
export function useCanEditCadences(options?: { enabled?: boolean }) {
  const { profile, organization, isSuperAdmin, userOrganizations } = useAuth();
  const activeOrganizationId = organization?.id || profile?.organization_id;
  const activeMemberRole = userOrganizations.find((org) => org.organization_id === activeOrganizationId)?.member_role;
  const canEditByRole = Boolean(
    isSuperAdmin ||
    activeMemberRole === 'admin' ||
    activeMemberRole === 'owner',
  );
  const shouldLoadTeams = !canEditByRole && (options?.enabled ?? true);
  const { data: teams = [] } = useTeams({ enabled: shouldLoadTeams });

  return useMemo(() => {
    if (canEditByRole) return true;
    if (!shouldLoadTeams) return false;

    return teams.some((team) =>
      team.members?.some((member) => member.user_id === profile?.id && member.is_leader),
    );
  }, [canEditByRole, profile?.id, shouldLoadTeams, teams]);
}
