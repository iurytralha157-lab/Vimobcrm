"use client";

import { useDashboardQuery } from '@/hooks/dashboard/use-dashboard-query';
import { useCallback, useRef, useState } from "react";

import { useDashboardQueryScope } from "@/hooks/use-dashboard-stats";
import {
  getDashboardCreativeMedia,
  getDashboardFiltersQueryKey,
  type DashboardAPIFilters,
} from "@/lib/api/dashboard";

export const DASHBOARD_CREATIVE_MEDIA_STALE_TIME_MS = 1000 * 60 * 10;
export const DASHBOARD_CREATIVE_MEDIA_REFRESH_COOLDOWN_MS = 30_000;

type MediaRefreshAttempt = { version: string; at: number };

export function canRefreshDashboardCreativeMedia(
  previous: MediaRefreshAttempt | null,
  version: string,
  now: number,
  manual = false,
) {
  if (!previous) return true;
  const elapsed = now - previous.at;
  if (elapsed < DASHBOARD_CREATIVE_MEDIA_REFRESH_COOLDOWN_MS) return false;
  return manual || previous.version !== version || elapsed >= DASHBOARD_CREATIVE_MEDIA_STALE_TIME_MS;
}

export function useDashboardCreativeMedia(
  filters: DashboardAPIFilters,
  key: string,
  mediaVersion: string,
  rankingUpdatedAt = 0,
) {
  const { organizationId, currentUserId, accessSignature, isReady } =
    useDashboardQueryScope();

  const queryKey = [
    "dashboard-creative-media",
    organizationId,
    currentUserId,
    accessSignature,
    getDashboardFiltersQueryKey(filters),
    key,
    mediaVersion,
  ];
  const requestScope = JSON.stringify(queryKey);
  const accessScope = JSON.stringify([organizationId, currentUserId, accessSignature, getDashboardFiltersQueryKey(filters), key]);
  const [requestedScope, setRequestedScope] = useState<string | null>(null);
  const lastAttempt = useRef<{ scope: string; attempt: MediaRefreshAttempt } | null>(null);
  const query = useDashboardQuery({
    queryKey,
    enabled: isReady && requestedScope === requestScope,
    queryFn: ({ signal }) =>
      getDashboardCreativeMedia({ organizationId, filters, key, signal }),
    staleTime: DASHBOARD_CREATIVE_MEDIA_STALE_TIME_MS,
    retry: false,
  }, { accessSignature, isReady });
  const { isFetching, refetch } = query;

  const requestRefresh = useCallback((failedVersion: string, manual = false) => {
    if (!isReady || isFetching) return false;
    const previous = lastAttempt.current?.scope === accessScope ? lastAttempt.current.attempt : null;
    const now = Date.now();
    if (!canRefreshDashboardCreativeMedia(previous, failedVersion, now, manual)) return false;
    lastAttempt.current = { scope: accessScope, attempt: { version: failedVersion, at: now } };
    if (requestedScope !== requestScope) setRequestedScope(requestScope);
    // Expired media can still be in a fresh cache; enabling alone will not fetch it.
    void refetch({ cancelRefetch: false });
    return true;
  }, [accessScope, isReady, isFetching, refetch, requestScope, requestedScope]);

  return {
    ...query,
    // A freshly fetched ranking takes precedence over a historical media lookup.
    data: query.dataUpdatedAt >= rankingUpdatedAt ? query.data : undefined,
    requestRefresh,
  };
}
