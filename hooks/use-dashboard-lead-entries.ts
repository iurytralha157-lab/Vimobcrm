import { useInfiniteQuery } from '@tanstack/react-query'
import { useQueryDataTrust } from '@/hooks/shared/use-query-data-trust'

import { getDashboardLeadEntries } from '@/lib/api/dashboard-lead-entries'
import { getDashboardFiltersQueryKey, type DashboardAPIFilters } from '@/lib/api/dashboard'
import { useDashboardQueryScope } from '@/hooks/use-dashboard-stats'

export function useDashboardLeadEntries(filters?: DashboardAPIFilters, enabled = false) {
  const { organizationId, currentUserId, accessSignature, isReady } = useDashboardQueryScope()
  const filterKey = getDashboardFiltersQueryKey(filters)

  const queryKey = ['dashboard-lead-entries', organizationId, currentUserId, accessSignature, filterKey]
  const query = useInfiniteQuery({
    queryKey,
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
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  })
  const trust = useQueryDataTrust(queryKey, query, { accessSignature, isReady })
  return { ...query, data: trust.canDisplayData ? query.data : undefined, isAccessBlocked: trust.isAccessBlocked }
}
