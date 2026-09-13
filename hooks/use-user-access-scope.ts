import { useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useTeams } from "@/hooks/use-teams";
import { useAllTeamPipelines } from "@/hooks/use-team-pipelines";
import { useUserPermissions } from "@/hooks/use-user-permissions";
import { isTenantContextForOrganization } from "@/lib/access/tenant-navigation";

type TeamPipelineAccess = {
  team_id: string;
  pipeline_id: string | null;
};

export function useUserAccessScope() {
  const {
    activeOrganization,
    profile,
    organization,
    tenantContext,
    isSuperAdmin,
    userOrganizations,
  } = useAuth();
  const { hasPermission, isLoading: permissionsLoading } = useUserPermissions();
  const profileId = profile?.id;
  const activeOrganizationId = activeOrganization.organizationId;
  const hasCurrentTenantContext = isTenantContextForOrganization(
    activeOrganizationId,
    tenantContext,
  );
  const activeMemberRole =
    userOrganizations.find(
      (org) => org.organization_id === activeOrganizationId,
    )?.member_role ||
    (hasCurrentTenantContext ? tenantContext?.memberRole : undefined);
  const isAdminProfile =
    isSuperAdmin ||
    activeMemberRole === "admin" ||
    activeMemberRole === "owner";
  const shouldLoadTeams = !isAdminProfile && hasPermission("team_view");
  const teamsQuery = useTeams({ enabled: shouldLoadTeams });
  const teams = useMemo(() => teamsQuery.data || [], [teamsQuery.data]);
  const teamsError = teamsQuery.error;
  const teamsLoading = teamsQuery.isLoading;
  const refetchTeams = teamsQuery.refetch;
  const shouldLoadTeamPipelines =
    shouldLoadTeams &&
    teams.some(
      (team) =>
        team.is_active !== false &&
        team.members?.some(
          (member) => member.user_id === profileId && member.is_leader,
        ),
    );
  const teamPipelinesQuery = useAllTeamPipelines({
    enabled: shouldLoadTeamPipelines,
  });
  const teamPipelines = useMemo(
    () => teamPipelinesQuery.data || [],
    [teamPipelinesQuery.data],
  );
  const teamPipelinesError = teamPipelinesQuery.error;
  const teamPipelinesLoading = teamPipelinesQuery.isLoading;
  const refetchTeamPipelines = teamPipelinesQuery.refetch;
  const teamPipelineRows = teamPipelines as TeamPipelineAccess[];

  return useMemo(() => {
    const isAdmin = isAdminProfile;
    const ledTeams = teams.filter(
      (team) =>
        team.is_active !== false &&
        team.members?.some(
          (member) => member.user_id === profileId && member.is_leader,
        ),
    );
    const tenantLedTeamIds = hasCurrentTenantContext
      ? tenantContext?.ledTeamIds || []
      : [];
    const ledTeamIds = Array.from(
      new Set([...tenantLedTeamIds, ...ledTeams.map((team) => team.id)]),
    );
    const ledTeamIdSet = new Set(ledTeamIds);
    const isTeamLeader = Boolean(
      (hasCurrentTenantContext && tenantContext?.isTeamLeader) ||
      ledTeamIds.length > 0,
    );
    const ledUserIds = Array.from(
      new Set([
        ...(hasCurrentTenantContext ? tenantContext?.ledUserIds || [] : []),
        ...ledTeams.flatMap(
          (team) => team.members?.map((member) => member.user_id) || [],
        ),
        ...(isTeamLeader && profileId ? [profileId] : []),
      ]),
    );
    const ledPipelineIds = Array.from(
      new Set([
        ...(hasCurrentTenantContext ? tenantContext?.ledPipelineIds || [] : []),
        ...teamPipelineRows
          .filter((item) => ledTeamIdSet.has(item.team_id))
          .map((item) => item.pipeline_id)
          .filter((pipelineId): pipelineId is string => !!pipelineId),
      ]),
    );
    const teamScopeError = shouldLoadTeams ? teamsError : null;
    const pipelineScopeError = shouldLoadTeamPipelines
      ? teamPipelinesError
      : null;

    return {
      isAdmin,
      memberRole: activeMemberRole,
      isTeamLeader,
      ledTeams,
      ledTeamIds,
      ledUserIds,
      ledPipelineIds,
      canViewAllLeads: isAdmin || hasPermission("lead_view_all"),
      canTransferAnyLead:
        isAdmin ||
        (hasPermission("lead_view_all") && hasPermission("lead_operate")),
      isLoading:
        permissionsLoading ||
        (shouldLoadTeams && teamsLoading) ||
        (shouldLoadTeamPipelines && teamPipelinesLoading),
      isError: Boolean(teamScopeError || pipelineScopeError),
      error: teamScopeError || pipelineScopeError,
      hasTenantTeamScope: Boolean(hasCurrentTenantContext && tenantContext),
      refetch: async () => {
        const requests: Promise<unknown>[] = [];
        if (shouldLoadTeams) requests.push(refetchTeams());
        if (shouldLoadTeamPipelines) requests.push(refetchTeamPipelines());
        await Promise.all(requests);
      },
    };
  }, [
    activeMemberRole,
    hasCurrentTenantContext,
    hasPermission,
    isAdminProfile,
    permissionsLoading,
    profileId,
    refetchTeamPipelines,
    refetchTeams,
    shouldLoadTeamPipelines,
    shouldLoadTeams,
    teamPipelineRows,
    teamPipelinesError,
    teamPipelinesLoading,
    teams,
    teamsError,
    teamsLoading,
    tenantContext,
  ]);
}
