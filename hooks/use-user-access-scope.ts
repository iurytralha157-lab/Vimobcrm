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
  const { profile, organization, isSuperAdmin, userOrganizations } = useAuth();
  const { hasPermission, isLoading: permissionsLoading } = useUserPermissions();
  const profileId = profile?.id;
  const profileRole = profile?.role;
  const activeOrganizationId = organization?.id || profile?.organization_id;
  const activeMemberRole = userOrganizations.find((org) => org.organization_id === activeOrganizationId)?.member_role;
  const isAdminProfile =
    isSuperAdmin ||
    profileRole === 'admin' ||
    profileRole === 'super_admin' ||
    activeMemberRole === 'admin' ||
    activeMemberRole === 'owner';
  const shouldLoadTeams = !isAdminProfile;
  const { data: teams = [], isLoading: teamsLoading } = useTeams({ enabled: shouldLoadTeams });
  const shouldLoadTeamPipelines =
    shouldLoadTeams &&
    teams.some((team) =>
      team.is_active !== false &&
      team.members?.some((member) => member.user_id === profileId && member.is_leader),
    );
  const { data: teamPipelines = [], isLoading: teamPipelinesLoading } = useAllTeamPipelines({
    enabled: shouldLoadTeamPipelines,
  });
  const teamPipelineRows = teamPipelines as TeamPipelineAccess[];

  return useMemo(() => {
    const isAdmin = isAdminProfile;
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
      isLoading: permissionsLoading || (shouldLoadTeams && teamsLoading) || (shouldLoadTeamPipelines && teamPipelinesLoading),
    };
  }, [hasPermission, isAdminProfile, permissionsLoading, profileId, shouldLoadTeamPipelines, shouldLoadTeams, teamPipelineRows, teamPipelinesLoading, teams, teamsLoading]);
}
