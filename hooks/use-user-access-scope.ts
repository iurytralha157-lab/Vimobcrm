import { useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useTeams } from '@/hooks/use-teams';
import { useAllTeamPipelines } from '@/hooks/use-team-pipelines';
import { useUserPermissions } from '@/hooks/use-user-permissions';

type TeamPipelineAccess = {
  team_id: string;
  pipeline_id: string | null;
};

export function useUserAccessScope() {
  const { profile, isSuperAdmin } = useAuth();
  const { hasPermission, isLoading: permissionsLoading } = useUserPermissions();
  const { data: teams = [], isLoading: teamsLoading } = useTeams({ includeInactive: true });
  const { data: teamPipelines = [], isLoading: teamPipelinesLoading } = useAllTeamPipelines();
  const profileId = profile?.id;
  const profileRole = profile?.role;
  const teamPipelineRows = teamPipelines as TeamPipelineAccess[];

  return useMemo(() => {
    const isAdmin = isSuperAdmin || profileRole === 'admin' || profileRole === 'super_admin';
    const ledTeams = teams.filter((team) =>
      team.is_active !== false &&
      team.members?.some((member) => member.user_id === profileId && member.is_leader)
    );
    const ledTeamIds = ledTeams.map((team) => team.id);
    const ledTeamIdSet = new Set(ledTeamIds);
    const ledUserIds = Array.from(new Set(
      ledTeams.flatMap((team) => team.members?.map((member) => member.user_id) || []).concat(profileId ? [profileId] : [])
    ));
    const ledPipelineIds = Array.from(new Set(
      teamPipelineRows
        .filter((item) => ledTeamIdSet.has(item.team_id))
        .map((item) => item.pipeline_id)
        .filter((pipelineId): pipelineId is string => !!pipelineId)
    ));

    return {
      isAdmin,
      isTeamLeader: ledTeams.length > 0,
      ledTeams,
      ledTeamIds,
      ledUserIds,
      ledPipelineIds,
      canViewAllLeads: isAdmin || hasPermission('lead_view_all'),
      canTransferAnyLead: isAdmin || hasPermission('lead_transfer') || hasPermission('lead_edit_all'),
      isLoading: permissionsLoading || teamsLoading || teamPipelinesLoading,
    };
  }, [hasPermission, isSuperAdmin, permissionsLoading, profileId, profileRole, teamPipelineRows, teamPipelinesLoading, teams, teamsLoading]);
}
