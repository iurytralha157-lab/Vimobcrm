import type { QueryClient } from '@tanstack/react-query';

export function removeCachedPipelineLeadDetail(
  queryClient: QueryClient,
  organizationId: string,
  leadId: string,
) {
  queryClient.removeQueries({
    queryKey: ['lead', organizationId, leadId],
    exact: true,
  });
}

export function handlePipelineSelectedLeadAccessFailure(params: {
  queryClient: QueryClient;
  organizationId: string;
  leadId: string;
  status?: number;
  closeDetail: () => void;
}) {
  const { queryClient, organizationId, leadId, status, closeDetail } = params;
  const accessRevoked = status === 403 || status === 404;
  if (accessRevoked) {
    removeCachedPipelineLeadDetail(queryClient, organizationId, leadId);
  }
  closeDetail();
  return accessRevoked;
}
