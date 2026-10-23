"use client";

import { useDashboardQuery } from '@/hooks/dashboard/use-dashboard-query';

import {
  getDashboardCampaigns,
  getDashboardFiltersQueryKey,
  type DashboardAPIFilters,
} from "@/lib/api/dashboard";
import { useDashboardQueryScope } from "@/hooks/use-dashboard-stats";

const DASHBOARD_CAMPAIGNS_STALE_TIME_MS = 1000 * 60;

export function useDashboardCampaigns(
  filters: DashboardAPIFilters,
  options: { enabled?: boolean } = {},
) {
  const { organizationId, currentUserId, accessSignature, isReady } =
    useDashboardQueryScope();
  const filterKey = getDashboardFiltersQueryKey(filters);

  return useDashboardQuery({
    queryKey: [
      "dashboard-campaigns",
      organizationId,
      currentUserId,
      accessSignature,
      filterKey,
    ],
    enabled: isReady && options.enabled !== false,
    queryFn: ({ signal }) =>
      getDashboardCampaigns({ organizationId, filters, signal }),
    staleTime: DASHBOARD_CAMPAIGNS_STALE_TIME_MS,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  }, { accessSignature, isReady });
}
