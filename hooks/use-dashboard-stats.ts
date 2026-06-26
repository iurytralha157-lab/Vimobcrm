import { useQuery } from "@tanstack/react-query";

import {
  getDashboardDealsEvolution,
  getDashboardFunnel,
  getDashboardSources,
  getDashboardStats,
  getDashboardTopBrokers,
  getDashboardUpcomingTasks,
} from "@/lib/api/dashboard";
import { performanceTracker } from "@/lib/performance";
import { useAuth } from "@/contexts/AuthContext";
import { DashboardFilters, sourceLabels } from "./use-dashboard-filters";

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
  const { organization, user } = useAuth();
  const organizationId = organization?.id;

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
    staleTime: 1000 * 60 * 5,
  });
}

export function useEnhancedDashboardStats(filters?: DashboardFilters) {
  const { user, organization } = useAuth();
  const currentUserId = user?.id;
  const organizationId = organization?.id;

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
    staleTime: 1000 * 60 * 5,
  });
}

export function useLeadsChartData() {
  const { user, organization } = useAuth();

  return useQuery({
    queryKey: ["leads-chart-data", user?.id, organization?.id],
    enabled: !!user?.id && !!organization?.id,
    queryFn: async (): Promise<ChartDataPoint[]> => {
      return [];
    },
    staleTime: 1000 * 60 * 5,
  });
}

export function useFunnelData(filters?: DashboardFilters, pipelineId?: string | null) {
  const { user, organization } = useAuth();
  const organizationId = organization?.id;

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
    staleTime: 1000 * 60 * 5,
  });
}

export function useLeadSourcesData(filters?: DashboardFilters, pipelineId?: string | null) {
  const { user, organization } = useAuth();
  const organizationId = organization?.id;

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
    staleTime: 1000 * 60 * 5,
  });
}

export function useTopBrokers(filters?: DashboardFilters) {
  const { user, organization } = useAuth();
  const currentUserId = user?.id;
  const organizationId = organization?.id;

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
    staleTime: 1000 * 60 * 5,
  });
}

export function useUpcomingTasks() {
  const { user, organization } = useAuth();
  const currentUserId = user?.id;
  const organizationId = organization?.id;

  return useQuery({
    queryKey: ["upcoming-tasks", currentUserId, organizationId],
    enabled: !!currentUserId && !!organizationId,
    queryFn: () => getDashboardUpcomingTasks({ organizationId, limit: 5 }) as Promise<UpcomingTask[]>,
    staleTime: 1000 * 60 * 2,
  });
}

export function useDealsEvolutionData(filters?: DashboardFilters) {
  const { user, organization } = useAuth();
  const currentUserId = user?.id;
  const organizationId = organization?.id;

  return useQuery({
    queryKey: [
      "deals-evolution",
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
      performanceTracker.trackTimed("useDealsEvolutionData", () =>
        getDashboardDealsEvolution({ organizationId, filters }) as Promise<DealsEvolutionPoint[]>,
      ),
    staleTime: 1000 * 60 * 5,
  });
}
