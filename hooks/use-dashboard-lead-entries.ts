import { useInfiniteQuery } from '@tanstack/react-query'

import { getDashboardLeadEntries } from '@/lib/api/dashboard-lead-entries'
import { getDashboardFiltersQueryKey, type DashboardAPIFilters } from '@/lib/api/dashboard'
import { useDashboardQueryScope } from '@/hooks/use-dashboard-stats'

export function useDashboardLeadEntries(filters?: DashboardAPIFilters, enabled = false) {
  const { organizationId, currentUserId, accessSignature, isReady } = useDashboardQueryScope()
  const filterKey = getDashboardFiltersQueryKey(filters)

  return useInfiniteQuery({
    queryKey: ['dashboard-lead-entries', organizationId, currentUserId, accessSignature, filterKey],
    enabled: isReady && enabled,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => getDashboardLeadEntries({
      organizationId,
      filters,
      cursor: pageParam,
      limit: 25,
      signal,
    }),
    getNextPageParam: (page) => page.hasMore ? page.nextCursor ?? undefined : undefined,
    staleTime: 60_000,
  })
}
