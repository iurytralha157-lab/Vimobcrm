import { useQuery } from "@tanstack/react-query";

import {
  getDashboardDealsEvolution,
  getDashboardFunnel,
  getDashboardSources,
  getDashboardStats,
  getDashboardTopBrokers,
  getDashboardUpcomingTasks,
  type DashboardAPIFilters,
} from "@/lib/api/dashboard";
import { performanceTracker } from "@/lib/performance";
import { useAuth } from "@/contexts/AuthContext";
import { sourceLabels } from "./use-dashboard-filters";

const DASHBOARD_STALE_TIME_MS = 1000 * 60 * 10;
const DASHBOARD_SHORT_STALE_TIME_MS = 1000 * 60 * 5;

export interface DealsEvolutionPoint {
  date: string;
  ganhos: number;
  perdas: number;
  abertos: number;
}

export interface DashboardStats {
  totalLeads: number;
  leadsInProgress: number;
  leadsClosed: number;
  leadsLost: number;
  leadsTrend: number;
  closedTrend: number;
}

export interface EnhancedDashboardStats {
  totalLeads: number;
  openLeads: number;
  lostLeads: number;
  conversionRate: number;
  closedLeads: number;
  wonAverageConversionDays: number | null;
  wonConversionBuckets: WonConversionBucket[];
  wonDeals: WonDealDetail[];
  lostReasonBuckets: LostReasonBucket[];
  lostDeals: LostDealDetail[];
  avgResponseTime: string;
  totalSalesValue: number;
  pendingCommissions: number;
  leadsTrend: number;
  openTrend: number;
  lostTrend: number;
  conversionTrend: number;
  closedTrend: number;
  totalReceivables: number;
  totalPayables: number;
  overdueReceivables: number;
  overduePayables: number;
  paidCommissions: number;
}

export interface WonConversionBucket {
  key: string;
  label: string;
  count: number;
  percentage: number;
  value: number;
  color: string;
}

export interface WonDealDetail {
  id: string;
  name: string;
  phone: string | null;
  source: string | null;
  value: number;
  createdAt: string | null;
  wonAt: string | null;
  conversionDays: number | null;
  assignedUserName: string;
}

export interface LostReasonBucket {
  key: string;
  label: string;
  count: number;
  percentage: number;
  color: string;
}

export interface LostDealDetail {
  id: string;
  name: string;
  phone: string | null;
  source: string | null;
  lostReason: string;
  lostReasonGroup: string;
  createdAt: string | null;
  lostAt: string | null;
  assignedUserName: string;
}

export interface ChartDataPoint {
  name: string;
  meta: number;
  site: number;
}

export interface FunnelDataPoint {
  name: string;
  value: number;
  percentage: number;
  stage_key: string;
}

export interface SourceDataPoint {
  name: string;
  value: number;
  rawSource?: string;
}

export interface TopBroker {
  id: string;
  name: string;
  avatar_url: string | null;
  closedLeads: number;
  salesValue: number;
  totalCommissions: number;
}

export interface TopBrokersResult {
  brokers: TopBroker[];
  isFallbackMode: boolean;
}

export interface UpcomingTask {
  id: string;
  title: string;
  type: "call" | "email" | "meeting" | "message" | "task";
  due_date: string;
  lead_name: string;
  lead_id: string;
}

export function useDashboardStats() {
  const { organization, profile, user } = useAuth();
  const organizationId = organization?.id ?? profile?.organization_id;

  return useQuery({
    queryKey: ["dashboard-stats", organizationId, user?.id],
    enabled: !!user?.id,
    queryFn: async (): Promise<DashboardStats> => {
      const stats = await getDashboardStats({ organizationId });
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
  const { user, organization, profile } = useAuth();
  const currentUserId = user?.id;
  const organizationId = organization?.id ?? profile?.organization_id;

  return useQuery({
    queryKey: [
      "enhanced-dashboard-stats",
      currentUserId,
      organizationId,
      filters?.dateRange?.from?.toISOString(),
      filters?.dateRange?.to?.toISOString(),
      filters?.teamId,
      filters?.userId,
      filters?.source,
      filters?.campaignId,
      filters?.adSetId,
      filters?.adId,
      filters?.tagId,
      filters?.dealStatus,
      filters?.searchQuery,
    ],
    enabled: !!currentUserId && !!organizationId,
    queryFn: () =>
      performanceTracker.trackTimed("useEnhancedDashboardStats", () =>
        getDashboardStats({ organizationId, filters }) as Promise<EnhancedDashboardStats>,
      ),
    staleTime: DASHBOARD_STALE_TIME_MS,
  });
}

export function useLeadsChartData() {
  const { user, organization, profile } = useAuth();
  const organizationId = organization?.id ?? profile?.organization_id;

  return useQuery({
    queryKey: ["leads-chart-data", user?.id, organizationId],
    enabled: !!user?.id && !!organizationId,
    queryFn: async (): Promise<ChartDataPoint[]> => {
      return [];
    },
    staleTime: DASHBOARD_STALE_TIME_MS,
  });
}

export function useFunnelData(filters?: DashboardAPIFilters, pipelineId?: string | null) {
  const { user, organization, profile } = useAuth();
  const organizationId = organization?.id ?? profile?.organization_id;

  return useQuery({
    queryKey: [
      "funnel-data",
      organizationId,
      filters?.dateRange?.from?.toISOString(),
      filters?.dateRange?.to?.toISOString(),
      filters?.teamId,
      filters?.userId,
      filters?.source,
      filters?.campaignId,
      filters?.adSetId,
      filters?.adId,
      filters?.tagId,
      filters?.dealStatus,
      filters?.searchQuery,
      pipelineId,
      user?.id,
    ],
    enabled: !!user?.id && !!organizationId,
    queryFn: () => getDashboardFunnel({ organizationId, filters, pipelineId }) as Promise<FunnelDataPoint[]>,
    staleTime: DASHBOARD_STALE_TIME_MS,
  });
}

export function useLeadSourcesData(filters?: DashboardAPIFilters, pipelineId?: string | null) {
  const { user, organization, profile } = useAuth();
  const organizationId = organization?.id ?? profile?.organization_id;

  return useQuery({
    queryKey: [
      "lead-sources-data",
      organizationId,
      filters?.dateRange?.from?.toISOString(),
      filters?.dateRange?.to?.toISOString(),
      filters?.teamId,
      filters?.userId,
      filters?.source,
      filters?.campaignId,
      filters?.adSetId,
      filters?.adId,
      filters?.tagId,
      filters?.dealStatus,
      filters?.searchQuery,
      pipelineId,
      user?.id,
    ],
    enabled: !!user?.id && !!organizationId,
    queryFn: async (): Promise<SourceDataPoint[]> => {
      const data = await getDashboardSources({ organizationId, filters, pipelineId });
      return data.map((item) => ({
        name: sourceLabels[item.rawSource] || sourceLabels[item.name] || item.name || "Outros",
        value: item.value,
        rawSource: item.rawSource,
      }));
    },
    staleTime: DASHBOARD_STALE_TIME_MS,
  });
}

export function useTopBrokers(filters?: DashboardAPIFilters) {
  const { user, organization, profile } = useAuth();
  const currentUserId = user?.id;
  const organizationId = organization?.id ?? profile?.organization_id;

  return useQuery({
    queryKey: [
      "top-brokers",
      currentUserId,
      organizationId,
      filters?.dateRange?.from?.toISOString(),
      filters?.dateRange?.to?.toISOString(),
      filters?.teamId,
      filters?.userId,
      filters?.source,
      filters?.campaignId,
      filters?.adSetId,
      filters?.adId,
      filters?.tagId,
      filters?.dealStatus,
      filters?.searchQuery,
    ],
    enabled: !!currentUserId && !!organizationId,
    queryFn: () => getDashboardTopBrokers({ organizationId, filters }) as Promise<TopBrokersResult>,
    staleTime: DASHBOARD_STALE_TIME_MS,
  });
}

export function useUpcomingTasks() {
  const { user, organization, profile } = useAuth();
  const currentUserId = user?.id;
  const organizationId = organization?.id ?? profile?.organization_id;

  return useQuery({
    queryKey: ["upcoming-tasks", currentUserId, organizationId],
    enabled: !!currentUserId && !!organizationId,
    queryFn: () => getDashboardUpcomingTasks({ organizationId, limit: 5 }) as Promise<UpcomingTask[]>,
    staleTime: DASHBOARD_SHORT_STALE_TIME_MS,
  });
}

export function useDealsEvolutionData(filters?: DashboardAPIFilters) {
  const { user, organization, profile } = useAuth();
  const currentUserId = user?.id;
  const organizationId = organization?.id ?? profile?.organization_id;
  const dealsEvolutionFilters = {
    ...filters,
    granularity: isSingleDashboardDayRange(filters?.dateRange) ? ("hour" as const) : null,
  };

  return useQuery({
    queryKey: [
      "deals-evolution",
      currentUserId,
      organizationId,
      dealsEvolutionFilters.dateRange?.from?.toISOString(),
      dealsEvolutionFilters.dateRange?.to?.toISOString(),
      dealsEvolutionFilters.granularity,
      filters?.teamId,
      filters?.userId,
      filters?.source,
      filters?.campaignId,
      filters?.adSetId,
      filters?.adId,
      filters?.tagId,
      filters?.dealStatus,
      filters?.searchQuery,
    ],
    enabled: !!currentUserId && !!organizationId,
    queryFn: () =>
      performanceTracker.trackTimed("useDealsEvolutionData", () =>
        getDashboardDealsEvolution({ organizationId, filters: dealsEvolutionFilters }) as Promise<DealsEvolutionPoint[]>,
      ),
    staleTime: DASHBOARD_STALE_TIME_MS,
  });
}

function isSingleDashboardDayRange(dateRange?: DashboardAPIFilters["dateRange"]) {
  if (!dateRange?.from || !dateRange?.to) {
    return false;
  }

  const durationMs = Math.abs(dateRange.to.getTime() - dateRange.from.getTime());
  return durationMs > 0 && durationMs <= 24 * 60 * 60 * 1000;
}
