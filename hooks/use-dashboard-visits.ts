import { useQuery } from '@tanstack/react-query'

import { useDashboardQueryScope } from '@/hooks/use-dashboard-stats'
import { getDashboardVisits } from '@/lib/api/dashboard-visits'
import { getDashboardFiltersQueryKey, type DashboardAPIFilters } from '@/lib/api/dashboard'

export function useDashboardVisits(filters: DashboardAPIFilters | undefined, enabled: boolean) {
  const { organizationId, currentUserId, accessSignature, isReady } = useDashboardQueryScope()

  return useQuery({
    queryKey: [
      'dashboard-visits',
      organizationId,
      currentUserId,
      accessSignature,
      getDashboardFiltersQueryKey(filters),
    ],
    enabled: enabled && isReady,
    queryFn: ({ signal }) => getDashboardVisits({ organizationId, filters, signal }),
    staleTime: 30_000,
  })
}
