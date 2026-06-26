import { useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useTeams } from '@/hooks/use-teams';

/**
 * Hook para verificar se o usuário pode editar cadências e pipelines
 * Retorna true se:
 * - Usuário é admin (role = 'admin')
 * - Usuário é líder de alguma equipe (is_leader = true)
 */
export function useCanEditCadences() {
  const { profile, organization, isSuperAdmin, userOrganizations } = useAuth();
  const { data: teams = [] } = useTeams();

  const canEdit = useMemo(() => {
    // Admin sempre pode editar
    const activeOrganizationId = organization?.id || profile?.organization_id;
    const activeMemberRole = userOrganizations.find((org) => org.organization_id === activeOrganizationId)?.member_role;
    if (
      isSuperAdmin ||
      profile?.role === 'admin' ||
      activeMemberRole === 'admin' ||
      activeMemberRole === 'owner'
    ) {
      return true;
    }

    // Verificar se é líder de alguma equipe
    const isTeamLeader = teams.some(team =>
      team.members?.some(member =>
        member.user_id === profile?.id && member.is_leader
      )
    );

    return isTeamLeader;
  }, [isSuperAdmin, organization?.id, profile?.id, profile?.organization_id, profile?.role, teams, userOrganizations]);

  return canEdit;
}
