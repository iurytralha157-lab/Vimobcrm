import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import type { DashboardFilters } from "@/hooks/use-dashboard-filters";
import { analyticsAPI } from "@/lib/api/analytics";
import { integrationsAPI } from "@/lib/api/integrations";
import { VimobAPIError } from "@/lib/api/vimob-error";
import {
  DomainValidationError,
  type MetaMarketingSyncResponse,
} from "@/lib/validation";

export interface CampaignAggregated {
  campaign_id: string;
  campaign_name: string;
  spend: number | null;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  link_clicks: number | null;
  leads_reported: number;
  leads_count: number;
  contacted_count: number;
  responded_count: number;
  qualified_count: number;
  conversations_count: number;
  won_count: number;
  lost_count: number;
  open_count: number;
  revenue: number;
  cpl: number | null;
  reported_cpl: number | null;
  cpql: number | null;
  cac: number | null;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  frequency: number | null;
  hook_rate: number | null;
  status: string | null;
  budget: number | null;
  budget_type: string | null;
  objective: string | null;
  currency: string | null;
  adsets: AdsetAggregated[];
}

export interface AdsetAggregated {
  adset_id: string;
  adset_name: string;
  spend: number | null;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  link_clicks: number | null;
  leads_reported: number;
  leads_count: number;
  contacted_count: number;
  responded_count: number;
  qualified_count: number;
  won_count: number;
  lost_count: number;
  open_count: number;
  revenue: number;
  cpl: number | null;
  ctr: number | null;
  cpc: number | null;
  hook_rate: number | null;
  currency: string | null;
  ads: AdAggregated[];
}

export interface AdAggregated {
  ad_id: string;
  ad_name: string;
  spend: number | null;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  link_clicks: number | null;
  leads_reported: number;
  leads_count: number;
  contacted_count: number;
  responded_count: number;
  qualified_count: number;
  won_count: number;
  lost_count: number;
  open_count: number;
  revenue: number;
  cpl: number | null;
  ctr: number | null;
  cpc: number | null;
  hook_rate: number | null;
  creative_url: string | null;
  creative_video_url: string | null;
  creative_permalink_url: string | null;
  thumbnail_url: string | null;
  currency: string | null;
}

export interface TopCreative {
  ad_id: string;
  ad_name: string;
  campaign_name: string;
  leads_count: number;
  leads_reported: number;
  contacted_count: number;
  responded_count: number;
  qualified_count: number;
  won_count: number;
  lost_count: number;
  revenue: number;
  score: number;
  creative_url: string | null;
  creative_video_url: string | null;
  creative_permalink_url: string | null;
  thumbnail_url: string | null;
  spend: number | null;
  cpl: number | null;
  ctr: number | null;
  cpc: number | null;
  hook_rate: number | null;
  currency: string | null;
}

export interface MarketingDailyPerformance {
  date: string;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  linkClicks: number;
  leadsReported: number;
  leads: number;
  contacted: number;
  responded: number;
  qualified: number;
  won: number;
  lost: number;
  revenue: number;
  conversations: number;
  total: number;
}

export interface MarketingMediaAsset {
  id: string;
  provider: string;
  source_kind: "paid" | "organic";
  external_media_id: string;
  media_type: string | null;
  title: string | null;
  caption: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  ad_id: string | null;
  ad_name: string | null;
  creative_id: string | null;
  thumbnail_url: string | null;
  media_url: string | null;
  video_url: string | null;
  permalink_url: string | null;
  published_at: string | null;
  metrics: Record<string, unknown>;
  last_synced_at: string;
}

function parseCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Período de sincronização inválido");
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("Período de sincronização inválido");
  }
  return date;
}

function formatUTCDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function formatMarketingCalendarDate(value: Date) {
  return Number.isFinite(value.getTime()) ? format(value, "yyyy-MM-dd") : "";
}

export function splitMarketingSyncRange(dateStart: string, dateStop: string) {
  const start = parseCalendarDate(dateStart);
  const stop = parseCalendarDate(dateStop);
  if (stop < start) throw new Error("Período de sincronização inválido");
  if (stop.getTime() - start.getTime() > 365 * 24 * 60 * 60 * 1_000) {
    throw new Error("O período de sincronização não pode ultrapassar 366 dias");
  }

  const windows: Array<{ dateStart: string; dateStop: string }> = [];
  let cursor = start;
  while (cursor <= stop) {
    const windowEnd = new Date(cursor);
    windowEnd.setUTCDate(windowEnd.getUTCDate() + 89);
    if (windowEnd > stop) windowEnd.setTime(stop.getTime());
    windows.push({
      dateStart: formatUTCDate(cursor),
      dateStop: formatUTCDate(windowEnd),
    });
    cursor = new Date(windowEnd);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return windows;
}

export function useCampaignInsights(filters: DashboardFilters) {
  const { profile, organization } = useAuth();
  const organizationId = organization?.id || profile?.organization_id;
  const dateFrom = formatMarketingCalendarDate(filters.dateRange.from);
  const dateTo = formatMarketingCalendarDate(filters.dateRange.to);

  return useQuery({
    queryKey: [
      "campaign-insights",
      organizationId,
      dateFrom,
      dateTo,
      filters.teamId,
      filters.userId,
      filters.source,
      filters.campaignId,
      filters.adSetId,
      filters.adId,
      filters.tagId,
      filters.dealStatus,
    ],
    queryFn: async ({ signal }) => {
      if (!organizationId) return emptyResult();

      return analyticsAPI.campaignInsights(
        {
          dateFrom,
          dateTo,
          teamId: filters.teamId,
          userId: filters.userId,
          source: filters.source,
          campaignId: filters.campaignId,
          adSetId: filters.adSetId,
          adId: filters.adId,
          tagId: filters.tagId,
          dealStatus: filters.dealStatus,
        },
        { organizationId, signal },
      );
    },
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
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

function emptyResult() {
  return {
    campaigns: [] as CampaignAggregated[],
    topCreatives: [] as TopCreative[],
    dailyData: [] as MarketingDailyPerformance[],
    media: [] as MarketingMediaAsset[],
    social: {
      provider: null as string | null,
      profileName: null as string | null,
      profileCount: 0,
      followers: null as number | null,
      followerGrowth: 0,
      posts: 0,
      impressions: 0,
      reach: 0,
      interactions: 0,
      likes: 0,
      comments: 0,
      saves: 0,
      shares: 0,
      profileViews: 0,
      websiteClicks: 0,
      videoViews: 0,
      lastSync: null as string | null,
    },
    summary: {
      totalLeads: 0,
      reportedLeads: 0,
      totalContacted: 0,
      totalResponded: 0,
      totalQualified: 0,
      totalWon: 0,
      totalLost: 0,
      totalOpen: 0,
      totalRevenue: 0,
      totalCampaigns: 0,
      totalAdsets: 0,
      totalAds: 0,
      totalSpend: null as number | null,
      currency: null as string | null,
      currencyBreakdown: [] as Array<{ currency: string; spend: number }>,
      avgCpl: null as number | null,
      totalImpressions: null as number | null,
      totalReach: null as number | null,
      totalClicks: null as number | null,
      totalLinkClicks: null as number | null,
      conversations_count: 0,
      reportedCpl: null as number | null,
      cpql: null as number | null,
      cac: null as number | null,
      ctr: null as number | null,
      cpc: null as number | null,
      cpm: null as number | null,
      responseRate: null as number | null,
      qualificationRate: null as number | null,
      conversionRate: null as number | null,
      roas: null as number | null,
    },
    connection: {
      isConnected: false,
      connectedPages: 0,
      adAccounts: 0,
      instagramAccounts: 0,
      lastIntegrationSync: null as string | null,
    },
    dataQuality: {
      model: "daily_facts_v1",
      attribution: "last_meta_touch_in_entry_cohort",
      qualification: "qualified_stage_history",
      hasDailyFacts: false,
      hasAccountFacts: false,
      hasCRMAttribution: false,
      hasCRMEvents: false,
      hasCRMScopedFilters: false,
      coverageFrom: null as string | null,
      coverageTo: null as string | null,
      reportTimezone: "America/Sao_Paulo",
      socialProfileCount: 0,
      reachAggregation: "sum_of_daily_scope_reach",
      reachIsUniqueAcrossPeriod: false,
      multipleCurrencies: false,
      currencyBreakdown: [] as Array<{ currency: string; spend: number }>,
      summaryLevel: "campaign_fallback",
      legacyRowsIgnored: 0,
    },
    lastSync: null as string | null,
    hasSpendData: false,
  };
}

export function useSyncCampaignInsights() {
  const queryClient = useQueryClient();
  const { profile, organization } = useAuth();
  const organizationId = organization?.id || profile?.organization_id;

  return useMutation({
    mutationFn: async ({ dateStart, dateStop }: { dateStart: string; dateStop: string }) => {
      const aggregate: MetaMarketingSyncResponse = {
        success: true,
        synced: 0,
        media_synced: 0,
        social_synced: 0,
        errors: [],
      };
      for (const window of splitMarketingSyncRange(dateStart, dateStop)) {
        const result = await integrationsAPI.syncMetaMarketing({
          date_start: window.dateStart,
          date_stop: window.dateStop,
        }, organizationId);
        aggregate.success = aggregate.success && result.success !== false;
        aggregate.synced = (aggregate.synced ?? 0) + (result.synced ?? 0);
        aggregate.media_synced =
          (aggregate.media_synced ?? 0) + (result.media_synced ?? 0);
        aggregate.social_synced =
          (aggregate.social_synced ?? 0) + (result.social_synced ?? 0);
        aggregate.errors?.push(...(result.errors ?? []));
      }
      return aggregate;
    },
    onSuccess: (data) => {
      if (data.errors?.length) {
        toast.warning(
          `${data.synced || 0} registros sincronizados; ${data.errors.length} fonte(s) exigem atenção`,
        );
        return;
      }
      toast.success(`${data.synced || 0} registros sincronizados do Meta Ads`);
    },
    onError: (error: Error) => {
      toast.error(`Erro ao sincronizar: ${error.message}`);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: ["campaign-insights", organizationId],
      });
    },
  });
}
