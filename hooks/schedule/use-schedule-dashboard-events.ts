"use client";

import { useInfiniteQuery } from "@tanstack/react-query";

import {
  getScheduleDashboardEventsQueryKey,
  scheduleDashboardAPI,
} from "@/lib/api/schedule-dashboard";
import { VimobAPIError } from "@/lib/api/vimob-error";
import { DomainValidationError } from "@/lib/validation/common";
import type { ScheduleDashboardQueryInput } from "@/lib/validation/schedule-dashboard";

import { useScheduleDashboardQueryScope } from "./use-schedule-dashboard";

export const SCHEDULE_DASHBOARD_EVENTS_PAGE_SIZE = 20;

const SCHEDULE_DASHBOARD_EVENTS_STALE_TIME_MS = 30 * 1_000;

export const scheduleDashboardEventsQueryKeys = {
  all: ["schedule-dashboard", "events"] as const,
  list: (
    organizationId: string | undefined,
    currentUserId: string | undefined,
    accessSignature: string,
    query: ScheduleDashboardQueryInput,
    lifecycleRevision = 0,
  ) => [
    ...scheduleDashboardEventsQueryKeys.all,
    organizationId,
    currentUserId,
    accessSignature,
    ...getScheduleDashboardEventsQueryKey(
      query,
      SCHEDULE_DASHBOARD_EVENTS_PAGE_SIZE,
    ),
    lifecycleRevision,
  ],
};

export function useScheduleDashboardEvents(
  query: ScheduleDashboardQueryInput,
  options: { enabled?: boolean; lifecycleRevision?: number } = {},
) {
  const { organizationId, currentUserId, accessSignature, isReady } =
    useScheduleDashboardQueryScope();

  return useInfiniteQuery({
    queryKey: scheduleDashboardEventsQueryKeys.list(
      organizationId,
      currentUserId,
      accessSignature,
      query,
      options.lifecycleRevision,
    ),
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      scheduleDashboardAPI.getEvents(
        {
          ...query,
          limit: SCHEDULE_DASHBOARD_EVENTS_PAGE_SIZE,
          offset: pageParam,
        },
        {
          organizationId,
          signal,
        },
      ),
    getNextPageParam: (lastPage) => {
      if (!lastPage.has_more || lastPage.items.length === 0) return undefined;
      return lastPage.offset + lastPage.items.length;
    },
    enabled: isReady && options.enabled !== false,
    staleTime: SCHEDULE_DASHBOARD_EVENTS_STALE_TIME_MS,
    gcTime: 5 * 60 * 1_000,
    refetchOnWindowFocus: true,
    retry: (failureCount, error) => {
      if (error instanceof DomainValidationError) return false;
      if (
        error instanceof VimobAPIError &&
        error.status >= 400 &&
        error.status < 500
      ) {
        return false;
      }
      return failureCount < 2;
    },
  });
}
