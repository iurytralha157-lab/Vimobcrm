"use client";

import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/contexts/AuthContext";
import { isTenantContextForOrganization } from "@/lib/access/tenant-navigation";
import { createTenantQueryAccessSignature } from "@/lib/access/tenant-query-cache";
import {
  getScheduleDashboardQueryKey,
  scheduleDashboardAPI,
} from "@/lib/api/schedule-dashboard";
import { VimobAPIError } from "@/lib/api/vimob-error";
import { DomainValidationError } from "@/lib/validation/common";
import type { ScheduleDashboardQueryInput } from "@/lib/validation/schedule-dashboard";

const SCHEDULE_DASHBOARD_STALE_TIME_MS = 30 * 1_000;
const SCHEDULE_DASHBOARD_REFRESH_INTERVAL_MS = 60 * 1_000;

export function useScheduleDashboardQueryScope() {
  const {
    activeOrganization,
    user,
    profile,
    tenantContext,
    isSuperAdmin,
    impersonating,
  } = useAuth();
  const organizationId = activeOrganization.organizationId || undefined;
  const currentUserId = user?.id ?? profile?.id;
  const hasCurrentTenantContext = isTenantContextForOrganization(
    organizationId,
    tenantContext,
  );
  const currentTenantContext = hasCurrentTenantContext ? tenantContext : null;

  return {
    organizationId,
    currentUserId,
    isReady: Boolean(
      organizationId && currentUserId && hasCurrentTenantContext,
    ),
    accessSignature: createTenantQueryAccessSignature({
      userId: currentUserId,
      organizationId,
      memberRole: currentTenantContext?.memberRole,
      permissions: currentTenantContext?.permissions,
      enabledModules: currentTenantContext?.enabledModules,
      isTeamLeader: currentTenantContext?.isTeamLeader,
      ledTeamIds: currentTenantContext?.ledTeamIds,
      ledUserIds: currentTenantContext?.ledUserIds,
      ledPipelineIds: currentTenantContext?.ledPipelineIds,
      isSuperAdmin: currentTenantContext?.isSuperAdmin ?? isSuperAdmin,
      impersonatedOrganizationId: impersonating?.orgId,
    }),
  };
}

export const scheduleDashboardQueryKeys = {
  all: ["schedule-dashboard"] as const,
  report: (
    organizationId: string | undefined,
    currentUserId: string | undefined,
    accessSignature: string,
    query: ScheduleDashboardQueryInput,
  ) =>
    [
      ...scheduleDashboardQueryKeys.all,
      organizationId,
      currentUserId,
      accessSignature,
      ...getScheduleDashboardQueryKey(query),
    ] as const,
};

export function useScheduleDashboard(
  query: ScheduleDashboardQueryInput,
  options: { enabled?: boolean } = {},
) {
  const { organizationId, currentUserId, accessSignature, isReady } =
    useScheduleDashboardQueryScope();

  return useQuery({
    queryKey: scheduleDashboardQueryKeys.report(
      organizationId,
      currentUserId,
      accessSignature,
      query,
    ),
    queryFn: ({ signal }) =>
      scheduleDashboardAPI.getDashboard(query, {
        organizationId,
        signal,
      }),
    enabled: isReady && options.enabled !== false,
    staleTime: SCHEDULE_DASHBOARD_STALE_TIME_MS,
    refetchInterval: SCHEDULE_DASHBOARD_REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: false,
    placeholderData: (previousData, previousQuery) => {
      const previousKey = previousQuery?.queryKey;

      if (
        !previousKey ||
        previousKey[0] !== scheduleDashboardQueryKeys.all[0] ||
        previousKey[1] !== organizationId ||
        previousKey[2] !== currentUserId ||
        previousKey[3] !== accessSignature
      ) {
        return undefined;
      }

      return previousData;
    },
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
