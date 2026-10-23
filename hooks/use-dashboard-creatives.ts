"use client";

import { useDashboardQuery } from '@/hooks/dashboard/use-dashboard-query';

import { useDashboardQueryScope } from "@/hooks/use-dashboard-stats";
import {
  getDashboardCreatives,
  getDashboardFiltersQueryKey,
  type DashboardAPIFilters,
} from "@/lib/api/dashboard";

const DASHBOARD_CREATIVES_STALE_TIME_MS = 1000 * 60;

export function useDashboardCreatives(
  filters: DashboardAPIFilters,
  options: { enabled?: boolean } = {},
) {
  const { organizationId, currentUserId, accessSignature, isReady } =
    useDashboardQueryScope();
  const filterKey = getDashboardFiltersQueryKey(filters);

  return useDashboardQuery({
    queryKey: [
      "dashboard-creatives",
      organizationId,
      currentUserId,
      accessSignature,
      filterKey,
    ],
    enabled: isReady && options.enabled !== false,
    queryFn: ({ signal }) =>
      getDashboardCreatives({ organizationId, filters, signal }),
    staleTime: DASHBOARD_CREATIVES_STALE_TIME_MS,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  }, { accessSignature, isReady });
}
