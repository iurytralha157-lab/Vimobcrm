'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';

import { leadsAPI } from '@/lib/api/leads';
import type { Lead } from '@/hooks/use-leads';
import type { VerifiedLeadRead } from '@/lib/lead-read-snapshot';
import { readConsistentLeadSnapshot, reconcileLeadReadCache } from '@/lib/lead-read-consistency';

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
      const data = await readConsistentLeadSnapshot<Lead>({
        organizationId: organizationId!, leadId: leadId!, signal,
        read: async () => {
          const result = await leadsAPI.getLead(leadId!, organizationId!, signal, { retry: false });
          if (result.error) throw result.error;
          return result.data as Lead | null;
        },
        getCached: () => queryClient.getQueryData<Lead>(['lead', organizationId, leadId]),
      });
      if (!data) throw new Error('Lead indisponível');
      if (signal.aborted) throw new Error('Leitura cancelada');
      // The cache may advance in the microtask between the helper and this commit.
      reconcileLeadReadCache(queryClient.getQueryData<Lead>(['lead', organizationId, leadId]), data);
      const confirmedAt = Date.now();
      queryClient.setQueryData(['lead', organizationId, leadId], data, { updatedAt: confirmedAt });
      return {
        data: data as Lead,
        organizationId: organizationId!,
        selectionVersion,
        visibilityScopeKey,
        confirmedAt,
      } satisfies VerifiedLeadRead<Lead>;
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
