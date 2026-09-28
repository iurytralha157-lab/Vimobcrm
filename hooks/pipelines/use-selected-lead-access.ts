'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';

import { leadsAPI } from '@/lib/api/leads';

export function useSelectedPipelineLeadAccess(params: {
  organizationId?: string | null;
  leadId?: string | null;
  selectionVersion: number;
  visibilityScopeKey: string;
  enabled: boolean;
}) {
  const { organizationId, leadId, selectionVersion, visibilityScopeKey, enabled } = params;
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: [
      'pipeline-selected-lead-access',
      organizationId,
      leadId,
      selectionVersion,
      visibilityScopeKey,
    ],
    enabled: enabled && Boolean(organizationId && leadId),
    queryFn: async ({ signal }) => {
      const { data, error } = await leadsAPI.getLead(leadId!, organizationId!, signal);
      if (error) throw error;
      if (!data) throw new Error('Lead indisponível');
      if (signal.aborted) throw new Error('Leitura cancelada');
      queryClient.setQueryData(['lead', organizationId, leadId], data);
      return true;
    },
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}
