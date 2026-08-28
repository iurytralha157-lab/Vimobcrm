import { useQuery } from "@tanstack/react-query";

import {
  getDashboardDealsEvolution,
  getDashboardFiltersQueryKey,
  getDashboardFunnel,
  getDashboardOptionalIdQueryKey,
  getDashboardSources,
  getDashboardStats,
  getDashboardTopBrokers,
  getDashboardUpcomingTasks,
  type DashboardDealsEvolutionPoint,
  type DashboardAPIFilters,
  type DashboardFunnelPoint,
  type DashboardStatsResponse,
  type DashboardTopBrokersResponse,
  type DashboardUpcomingTask,
} from "@/lib/api/dashboard";
import { performanceTracker } from "@/lib/performance";
import { useAuth } from "@/contexts/AuthContext";
import { isTenantContextForOrganization } from "@/lib/access/tenant-navigation";
import { createTenantQueryAccessSignature } from "@/lib/access/tenant-query-cache";
import { sourceLabels } from "./use-dashboard-filters";

const DASHBOARD_STALE_TIME_MS = 1000 * 60 * 10;
const DASHBOARD_SHORT_STALE_TIME_MS = 1000 * 60 * 5;

export function useDashboardQueryScope() {
  const {
    user,
    profile,
    organization,
    organizationsLoaded,
    isInitializingOrg,
    tenantContext,
    isSuperAdmin,
    impersonating,
  } = useAuth();
  const organizationId =
    organization?.id ??
    ((!organizationsLoaded || isInitializingOrg)
      ? undefined
      : profile?.organization_id || undefined);
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

export type DealsEvolutionPoint = DashboardDealsEvolutionPoint;

export interface DashboardStats {
  totalLeads: number;
  leadsInProgress: number;
  leadsClosed: number;
  leadsLost: number;
  leadsTrend: number;
  closedTrend: number;
}

export type EnhancedDashboardStats = DashboardStatsResponse;
export type WonConversionBucket = DashboardStatsResponse["wonConversionBuckets"][number];
export type WonDealDetail = DashboardStatsResponse["wonDeals"][number];
export type LostReasonBucket = DashboardStatsResponse["lostReasonBuckets"][number];
export type LostDealDetail = DashboardStatsResponse["lostDeals"][number];

export interface ChartDataPoint {
  name: string;
  meta: number;
  site: number;
}

export type FunnelDataPoint = DashboardFunnelPoint;

export interface SourceDataPoint {
  name: string;
  value: number;
  rawSource?: string;
}

function getDashboardSourceLabel(value: string) {
  return Object.prototype.hasOwnProperty.call(sourceLabels, value)
    ? sourceLabels[value]
    : undefined;
}

export type TopBroker = DashboardTopBrokersResponse["brokers"][number];
export type TopBrokersResult = DashboardTopBrokersResponse;
export type UpcomingTask = DashboardUpcomingTask;

export function useDashboardStats() {
  const { organizationId, currentUserId, accessSignature, isReady } =
    useDashboardQueryScope();

  return useQuery({
    queryKey: [
      "dashboard-stats",
      organizationId,
      currentUserId,
      accessSignature,
    ],
    enabled: isReady,
    queryFn: async ({ signal }): Promise<DashboardStats> => {
      const stats = await getDashboardStats({ organizationId, signal });
      return {
        totalLeads: stats.totalLeads,
        leadsInProgress: stats.leadsInProgress ?? stats.openLeads,
        leadsClosed: stats.leadsClosed ?? stats.closedLeads,
        leadsLost: stats.leadsLost ?? stats.lostLeads,
        leadsTrend: stats.leadsTrend,
        closedTrend: stats.closedTrend,
      };
    },
    staleTime: DASHBOARD_STALE_TIME_MS,
  });
}

export function useEnhancedDashboardStats(filters?: DashboardAPIFilters) {
  const { organizationId, currentUserId, accessSignature, isReady } =
    useDashboardQueryScope();
  const filterKey = getDashboardFiltersQueryKey(filters);

  return useQuery({
    queryKey: [
      "enhanced-dashboard-stats",
      organizationId,
      currentUserId,
      accessSignature,
      filterKey,
    ],
    enabled: isReady,
    queryFn: ({ signal }) =>
      performanceTracker.trackTimed("useEnhancedDashboardStats", () =>
        getDashboardStats({ organizationId, filters, signal }),
      ),
    staleTime: DASHBOARD_STALE_TIME_MS,
  });
}

export function useLeadsChartData() {
  const { organizationId, currentUserId, accessSignature, isReady } =
    useDashboardQueryScope();

  return useQuery({
    queryKey: [
      "leads-chart-data",
      organizationId,
      currentUserId,
      accessSignature,
    ],
    enabled: isReady,
    queryFn: async (): Promise<ChartDataPoint[]> => {
      return [];
    },
    staleTime: DASHBOARD_STALE_TIME_MS,
  });
}

export function useFunnelData(filters?: DashboardAPIFilters, pipelineId?: string | null) {
  const { organizationId, currentUserId, accessSignature, isReady } =
    useDashboardQueryScope();
  const filterKey = getDashboardFiltersQueryKey(filters);
  const pipelineKey = getDashboardOptionalIdQueryKey(pipelineId);

  return useQuery({
    queryKey: [
      "funnel-data",
      organizationId,
      currentUserId,
      accessSignature,
      filterKey,
      pipelineKey,
    ],
    enabled: isReady,
    queryFn: ({ signal }) =>
      getDashboardFunnel({ organizationId, filters, pipelineId, signal }),
    staleTime: DASHBOARD_STALE_TIME_MS,
  });
}

export function useLeadSourcesData(filters?: DashboardAPIFilters, pipelineId?: string | null) {
  const { organizationId, currentUserId, accessSignature, isReady } =
    useDashboardQueryScope();
  const filterKey = getDashboardFiltersQueryKey(filters);
  const pipelineKey = getDashboardOptionalIdQueryKey(pipelineId);

  return useQuery({
    queryKey: [
      "lead-sources-data",
      organizationId,
      currentUserId,
      accessSignature,
      filterKey,
      pipelineKey,
    ],
    enabled: isReady,
    queryFn: async ({ signal }): Promise<SourceDataPoint[]> => {
      const data = await getDashboardSources({
        organizationId,
        filters,
        pipelineId,
        signal,
      });
      return data.map((item) => ({
        name:
          getDashboardSourceLabel(item.rawSource) ||
          getDashboardSourceLabel(item.name) ||
          item.name ||
          "Outros",
        value: item.value,
        rawSource: item.rawSource,
      }));
    },
    staleTime: DASHBOARD_STALE_TIME_MS,
  });
}

export function useTopBrokers(filters?: DashboardAPIFilters) {
  const { organizationId, currentUserId, accessSignature, isReady } =
    useDashboardQueryScope();
  const filterKey = getDashboardFiltersQueryKey(filters);

  return useQuery({
    queryKey: [
      "top-brokers",
      organizationId,
      currentUserId,
      accessSignature,
      filterKey,
    ],
    enabled: isReady,
    queryFn: ({ signal }) =>
      getDashboardTopBrokers({ organizationId, filters, signal }),
    staleTime: DASHBOARD_STALE_TIME_MS,
  });
}

export function useUpcomingTasks() {
  const { organizationId, currentUserId, accessSignature, isReady } =
    useDashboardQueryScope();

  return useQuery({
    queryKey: [
      "upcoming-tasks",
      organizationId,
      currentUserId,
      accessSignature,
    ],
    enabled: isReady,
    queryFn: ({ signal }) =>
      getDashboardUpcomingTasks({ organizationId, limit: 5, signal }),
    staleTime: DASHBOARD_SHORT_STALE_TIME_MS,
  });
}

export function useDealsEvolutionData(filters?: DashboardAPIFilters) {
  const { organizationId, currentUserId, accessSignature, isReady } =
    useDashboardQueryScope();
  const dealsEvolutionFilters = {
    ...filters,
    granularity: isSingleDashboardDayRange(filters?.dateRange) ? ("hour" as const) : null,
  };
  const filterKey = getDashboardFiltersQueryKey(dealsEvolutionFilters);

  return useQuery({
    queryKey: [
      "deals-evolution",
      organizationId,
      currentUserId,
      accessSignature,
      filterKey,
    ],
    enabled: isReady,
    queryFn: ({ signal }) =>
      performanceTracker.trackTimed("useDealsEvolutionData", () =>
        getDashboardDealsEvolution({
          organizationId,
          filters: dealsEvolutionFilters,
          signal,
        }),
      ),
    staleTime: DASHBOARD_STALE_TIME_MS,
  });
}

function isSingleDashboardDayRange(dateRange?: DashboardAPIFilters["dateRange"]) {
  if (!dateRange?.from || !dateRange?.to) {
    return false;
  }

  const durationMs = dateRange.to.getTime() - dateRange.from.getTime();
  return durationMs > 0 && durationMs <= 24 * 60 * 60 * 1000;
}
