type PipelineAccess = {
  isAdmin: boolean;
  isTeamLeader: boolean;
  ledTeamIds: readonly string[];
  hasPipelinePermission: boolean;
};

export function canManageTeamPipeline(access: PipelineAccess, teamId: string) {
  return access.isAdmin || (access.hasPipelinePermission && (
    !access.isTeamLeader || access.ledTeamIds.includes(teamId)
  ));
}

type ManagementQueryState = { isPending: boolean; isError: boolean };

export function getTeamPipelineQueryState(queries: readonly ManagementQueryState[]) {
  if (queries.some((query) => query.isError)) return 'error';
  if (queries.some((query) => query.isPending)) return 'loading';
  return 'ready';
}
