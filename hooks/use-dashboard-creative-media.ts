"use client";

import { useQuery } from "@tanstack/react-query";

import { useDashboardQueryScope } from "@/hooks/use-dashboard-stats";
import {
  getDashboardCreativeMedia,
  getDashboardFiltersQueryKey,
  type DashboardAPIFilters,
} from "@/lib/api/dashboard";

export function useDashboardCreativeMedia(
  filters: DashboardAPIFilters,
  key: string,
  enabled: boolean,
) {
  const { organizationId, currentUserId, accessSignature, isReady } =
    useDashboardQueryScope();

  return useQuery({
    queryKey: [
      "dashboard-creative-media",
      organizationId,
      currentUserId,
      accessSignature,
      getDashboardFiltersQueryKey(filters),
      key,
    ],
    enabled: isReady && enabled,
    queryFn: ({ signal }) =>
      getDashboardCreativeMedia({ organizationId, filters, key, signal }),
    staleTime: 1000 * 60 * 10,
    retry: false,
  });
}
