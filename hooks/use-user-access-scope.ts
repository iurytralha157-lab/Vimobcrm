import { useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useTeams } from '@/hooks/use-teams';
import { useAllTeamPipelines } from '@/hooks/use-team-pipelines';
import { useUserPermissions } from '@/hooks/use-user-permissions';
import { isTenantContextForOrganization } from '@/lib/access/tenant-navigation';

type TeamPipelineAccess = {
  team_id: string;
  pipeline_id: string | null;
};

export function useUserAccessScope() {
  const { profile, organization, tenantContext, isSuperAdmin, userOrganizations } = useAuth();
  const { hasPermission, isLoading: permissionsLoading } = useUserPermissions();
  const profileId = profile?.id;
  const activeOrganizationId = organization?.id || profile?.organization_id;
  const hasCurrentTenantContext = isTenantContextForOrganization(activeOrganizationId, tenantContext);
  const activeMemberRole = userOrganizations.find((org) => org.organization_id === activeOrganizationId)?.member_role;
  const isAdminProfile =
    isSuperAdmin ||
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
      isTeamLeader: hasCurrentTenantContext && tenantContext
        ? (tenantContext.isTeamLeader ?? ledTeams.length > 0)
        : ledTeams.length > 0,
      ledTeams,
      ledTeamIds,
      ledUserIds,
      ledPipelineIds,
      canViewAllLeads: isAdmin || hasPermission('lead_view_all'),
      canTransferAnyLead: isAdmin || (hasPermission('lead_view_all') && hasPermission('lead_operate')),
      isLoading: permissionsLoading || (shouldLoadTeams && teamsLoading) || (shouldLoadTeamPipelines && teamPipelinesLoading),
    };
  }, [hasCurrentTenantContext, hasPermission, isAdminProfile, permissionsLoading, profileId, shouldLoadTeamPipelines, shouldLoadTeams, teamPipelineRows, teamPipelinesLoading, teams, teamsLoading, tenantContext]);
}
