import { useQuery } from '@tanstack/react-query'

import { leadCadenceStateAPI } from '@/lib/api/lead-cadence-state'

export const leadCadenceStateQueryKey = (
  organizationId?: string | null,
  leadId?: string | null,
  stageId?: string | null,
) => [
  'lead-cadence-state',
  organizationId || null,
  leadId || null,
  stageId || null,
] as const

export function useLeadCadenceState(
  leadId?: string | null,
  organizationId?: string | null,
  stageId?: string | null,
) {
  return useQuery({
    queryKey: leadCadenceStateQueryKey(organizationId, leadId, stageId),
    queryFn: () => leadCadenceStateAPI.get(leadId!, organizationId),
    enabled: Boolean(leadId),
    staleTime: 15_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  })
}
