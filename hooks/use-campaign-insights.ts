import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import type { DashboardFilters } from "@/hooks/use-dashboard-filters";
import { analyticsAPI } from "@/lib/api/analytics";
import { integrationsAPI } from "@/lib/api/integrations";

export interface CampaignAggregated {
  campaign_id: string;
  campaign_name: string;
  spend: number | null;
  impressions: number | null;
  reach: number | null;
  leads_count: number;
  conversations_count: number;
  won_count: number;
  revenue: number;
  cpl: number | null;
  ctr: number | null;
  hook_rate: number | null;
  status: string | null;
  budget: number | null;
  budget_type: string | null;
  objective: string | null;
  adsets: AdsetAggregated[];
}

export interface AdsetAggregated {
  adset_id: string;
  adset_name: string;
  spend: number | null;
  impressions: number | null;
  reach: number | null;
  leads_count: number;
  won_count: number;
  revenue: number;
  cpl: number | null;
  ctr: number | null;
  hook_rate: number | null;
  ads: AdAggregated[];
}

export interface AdAggregated {
  ad_id: string;
  ad_name: string;
  spend: number | null;
  impressions: number | null;
  reach: number | null;
  leads_count: number;
  won_count: number;
  revenue: number;
  cpl: number | null;
  ctr: number | null;
  hook_rate: number | null;
  creative_url: string | null;
  creative_video_url: string | null;
  creative_permalink_url: string | null;
}

export interface TopCreative {
  ad_id: string;
  ad_name: string;
  campaign_name: string;
  leads_count: number;
  won_count: number;
  revenue: number;
  score: number;
  creative_url: string | null;
  creative_video_url: string | null;
  creative_permalink_url: string | null;
  spend: number | null;
  cpl: number | null;
  ctr: number | null;
  hook_rate: number | null;
}

export function useCampaignInsights(filters: DashboardFilters) {
  const { profile } = useAuth();
  const dateFrom = filters.dateRange.from.toISOString();
  const dateTo = filters.dateRange.to.toISOString();

  return useQuery({
    queryKey: ["campaign-insights", profile?.organization_id, dateFrom, dateTo, filters.teamId, filters.userId, filters.source],
    queryFn: async () => {
      if (!profile?.organization_id) return emptyResult();

      return analyticsAPI.campaignInsights<ReturnType<typeof emptyResult>>({
        dateFrom,
        dateTo,
        teamId: filters.teamId,
        userId: filters.userId,
        source: filters.source,
      });
    },
    enabled: !!profile?.organization_id,
    staleTime: 5 * 60 * 1000,
  });
}

function emptyResult() {
  return {
    campaigns: [] as CampaignAggregated[],
    topCreatives: [] as TopCreative[],
    dailyData: [] as Array<{ date: string; leads: number; conversations: number; total: number }>,
    summary: {
      totalLeads: 0,
      totalWon: 0,
      totalRevenue: 0,
      totalCampaigns: 0,
      totalAdsets: 0,
      totalAds: 0,
      totalSpend: null as number | null,
      avgCpl: null as number | null,
      totalImpressions: null as number | null,
      totalReach: null as number | null,
      conversations_count: 0,
    },
    lastSync: null as string | null,
    hasSpendData: false,
  };
}

export function useSyncCampaignInsights() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ dateStart, dateStop }: { dateStart: string; dateStop: string }) => {
      return integrationsAPI.invokeFunction<{ synced?: number }>("meta-campaign-insights", {
        date_start: dateStart,
        date_stop: dateStop,
      });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["campaign-insights"] });
      toast.success(`${data.synced || 0} registros sincronizados do Meta Ads`);
    },
    onError: (error: Error) => {
      toast.error(`Erro ao sincronizar: ${error.message}`);
    },
  });
}
