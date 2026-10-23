import type { QueryClient } from '@tanstack/react-query';

export function isPipelineLeadAccessDenied(status?: number) {
  return status === 401 || status === 403 || status === 404;
}

export function canRetainPipelineLeadDraft(hasVerifiedRead: boolean, status?: number) {
  return hasVerifiedRead && !isPipelineLeadAccessDenied(status);
}

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
  const accessRevoked = isPipelineLeadAccessDenied(status);
  if (accessRevoked) {
    removeCachedPipelineLeadDetail(queryClient, organizationId, leadId);
  }
  if (accessRevoked) closeDetail();
  return accessRevoked;
}
