"use client";

import { useCallback, useMemo } from "react";
import { format } from "date-fns";

import { useAuth } from "@/contexts/AuthContext";
import {
  type CampaignAggregated,
  type MarketingMediaAsset,
  type TopCreative,
  useCampaignInsights,
  useSyncCampaignInsights,
} from "@/hooks/use-campaign-insights";
import {
  type MetaIntegration,
  useMetaIntegrations,
} from "@/hooks/use-meta-integration";
import type { SharedFilters } from "@/hooks/use-shared-filters";
import { useUserPermissions } from "@/hooks/use-user-permissions";

type NumberRecord = Record<string, unknown>;

export interface MarketingCreative {
  id: string;
  ad_id: string | null;
  ad_name: string;
  campaign_name: string | null;
  adset_name: string | null;
  leads_count: number | null;
  won_count: number | null;
  revenue: number | null;
  score: number;
  creative_url: string | null;
  creative_video_url: string | null;
  creative_permalink_url: string | null;
  thumbnail_url: string | null;
  spend: number | null;
  cpl: number | null;
  currency: string | null;
  ctr: number | null;
  hook_rate: number | null;
  impressions: number | null;
  reach: number | null;
  interactions: number | null;
  source_kind: "paid" | "organic";
  provider: string;
  published_at: string | null;
}

export interface MarketingOptionalMetrics {
  clicks: number | null;
  qualified: number | null;
  responded: number | null;
  lost: number | null;
  organicReach: number | null;
  profileVisits: number | null;
  followers: number | null;
}

function readNumber(source: unknown, keys: readonly string[]): number | null {
  if (!source || typeof source !== "object") return null;
  const record = source as NumberRecord;

  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }

  return null;
}

function selectedAdAccountCount(value: unknown) {
  if (Array.isArray(value)) {
    return new Set(
      value
        .map((item) => {
          if (typeof item === "string") return item;
          if (!item || typeof item !== "object") return null;
          const record = item as NumberRecord;
          const id = record.id ?? record.account_id ?? record.accountId;
          return typeof id === "string" ? id : null;
        })
        .filter((item): item is string => Boolean(item)),
    ).size;
  }

  return 0;
}

function latestIsoDate(values: Array<string | null | undefined>) {
  const timestamps = values
    .map((value) => {
      if (!value) return null;
      const timestamp = new Date(value).getTime();
      return Number.isFinite(timestamp) ? { value, timestamp } : null;
    })
    .filter((item): item is { value: string; timestamp: number } => Boolean(item));

  return timestamps.sort((left, right) => right.timestamp - left.timestamp)[0]?.value ?? null;
}

function formatCalendarDate(value: Date) {
  return Number.isFinite(value.getTime()) ? format(value, "yyyy-MM-dd") : "";
}

function collectCreatives(
  campaigns: CampaignAggregated[],
  topCreatives: TopCreative[],
  media: MarketingMediaAsset[],
  hasCRMAttribution: boolean,
) {
  const creatives = new Map<string, MarketingCreative>();

  media.forEach((asset) => {
    const key = asset.ad_id ? `ad:${asset.ad_id}` : `media:${asset.id}`;
    creatives.set(key, {
      id: asset.id,
      ad_id: asset.ad_id,
      ad_name: asset.ad_name || asset.title || "Mídia sem título",
      campaign_name: asset.campaign_name,
      adset_name: asset.adset_name,
      leads_count: readNumber(asset.metrics, ["leads", "leads_count", "results"]),
      won_count: hasCRMAttribution
        ? readNumber(asset.metrics, ["won", "won_count", "sales"])
        : null,
      revenue: hasCRMAttribution
        ? readNumber(asset.metrics, ["revenue", "attributed_revenue"])
        : null,
      score: readNumber(asset.metrics, ["score"]) ?? 0,
      creative_url: asset.media_url,
      creative_video_url: asset.video_url,
      creative_permalink_url: asset.permalink_url,
      thumbnail_url: asset.thumbnail_url,
      spend: readNumber(asset.metrics, ["spend", "investment"]),
      cpl: readNumber(asset.metrics, ["cpl", "cost_per_lead"]),
      currency: null,
      ctr: readNumber(asset.metrics, ["ctr"]),
      hook_rate: readNumber(asset.metrics, ["hook_rate", "hookRate"]),
      impressions: readNumber(asset.metrics, ["impressions"]),
      reach: readNumber(asset.metrics, ["reach"]),
      interactions: readNumber(asset.metrics, [
        "interactions",
        "engagement",
        "total_interactions",
      ]),
      source_kind: asset.source_kind,
      provider: asset.provider,
      published_at: asset.published_at,
    });
  });

  topCreatives.forEach((creative) => {
    const key = `ad:${creative.ad_id}`;
    const existing = creatives.get(key);
    creatives.set(key, {
      id: existing?.id ?? creative.ad_id,
      ad_id: creative.ad_id,
      ad_name: creative.ad_name,
      campaign_name: creative.campaign_name,
      adset_name: existing?.adset_name ?? null,
      leads_count: hasCRMAttribution ? creative.leads_count : null,
      won_count: hasCRMAttribution ? creative.won_count : null,
      revenue: hasCRMAttribution ? creative.revenue : null,
      score: creative.score,
      creative_url: creative.creative_url ?? existing?.creative_url ?? null,
      creative_video_url:
        creative.creative_video_url ?? existing?.creative_video_url ?? null,
      creative_permalink_url:
        creative.creative_permalink_url ?? existing?.creative_permalink_url ?? null,
      thumbnail_url: creative.thumbnail_url ?? existing?.thumbnail_url ?? null,
      spend: creative.spend,
      cpl: creative.cpl,
      currency: creative.currency ?? existing?.currency ?? null,
      ctr: creative.ctr,
      hook_rate: creative.hook_rate,
      impressions: existing?.impressions ?? null,
      reach: existing?.reach ?? null,
      interactions: existing?.interactions ?? null,
      source_kind: "paid",
      provider: existing?.provider ?? "meta",
      published_at: existing?.published_at ?? null,
    });
  });

  campaigns.forEach((campaign) => {
    campaign.adsets.forEach((adset) => {
      adset.ads.forEach((ad) => {
        const key = `ad:${ad.ad_id}`;
        const existing = creatives.get(key);
        if (existing) {
          creatives.set(key, {
            ...existing,
            leads_count: hasCRMAttribution ? ad.leads_count : existing.leads_count,
            won_count: hasCRMAttribution ? ad.won_count : existing.won_count,
            revenue: hasCRMAttribution ? ad.revenue : existing.revenue,
            score: hasCRMAttribution
              ? ad.leads_count + ad.qualified_count * 3 + ad.won_count * 10
              : existing.score,
            spend: ad.spend ?? existing.spend,
            cpl: ad.cpl ?? existing.cpl,
            currency: ad.currency ?? existing.currency,
            ctr: ad.ctr ?? existing.ctr,
            hook_rate: ad.hook_rate ?? existing.hook_rate,
            impressions: ad.impressions ?? existing.impressions,
            reach: ad.reach ?? existing.reach,
          });
          return;
        }
        creatives.set(key, {
          id: ad.ad_id,
          ad_id: ad.ad_id,
          ad_name: ad.ad_name,
          campaign_name: campaign.campaign_name,
          adset_name: adset.adset_name,
          leads_count: hasCRMAttribution ? ad.leads_count : null,
          won_count: hasCRMAttribution ? ad.won_count : null,
          revenue: hasCRMAttribution ? ad.revenue : null,
          score: ad.leads_count + ad.won_count * 10,
          creative_url: ad.creative_url,
          creative_video_url: ad.creative_video_url,
          creative_permalink_url: ad.creative_permalink_url,
          thumbnail_url: ad.thumbnail_url,
          spend: ad.spend,
          cpl: ad.cpl,
          currency: ad.currency,
          ctr: ad.ctr,
          hook_rate: ad.hook_rate,
          impressions: ad.impressions,
          reach: ad.reach,
          interactions: null,
          source_kind: "paid",
          provider: "meta",
          published_at: null,
        });
      });
    });
  });

  return Array.from(creatives.values()).sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return (right.leads_count ?? 0) - (left.leads_count ?? 0);
  });
}

function integrationHasAdAccount(integration: MetaIntegration) {
  return Boolean(
    integration.ad_account_id ||
      selectedAdAccountCount(integration.selected_ad_accounts) > 0,
  );
}

export function useMarketingDashboard(filters: SharedFilters) {
  const { isSuperAdmin, tenantContext } = useAuth();
  const { hasPermission, isLoading: permissionsLoading } = useUserPermissions();
  const canManageIntegration =
    !permissionsLoading && hasPermission("settings_integrations");
  const memberRole = tenantContext?.memberRole?.trim().toLowerCase() ?? "";
  const canSyncIntegration =
    canManageIntegration &&
    (isSuperAdmin || memberRole === "owner" || memberRole === "admin");
  const insightsQuery = useCampaignInsights(filters);
  // The analytics endpoint already returns a safe connection summary for
  // dashboard viewers. Full integration metadata is management-only.
  const integrationsQuery = useMetaIntegrations({ enabled: canManageIntegration });
  const syncMutation = useSyncCampaignInsights();

  const connectedIntegrations = useMemo(
    () =>
      (integrationsQuery.data ?? []).filter(
        (integration) =>
          integration.is_connected === true &&
          (integration.token_status ?? "active") === "active",
      ),
    [integrationsQuery.data],
  );

  const integration = useMemo(() => {
    return (
      connectedIntegrations.find(
        (item) =>
          item.marketing_token_available === true &&
          integrationHasAdAccount(item),
      ) ??
      connectedIntegrations.find(integrationHasAdAccount) ??
      connectedIntegrations[0] ??
      null
    );
  }, [connectedIntegrations]);

  const integrationState = useMemo(() => {
    const adAccountIds = new Set<string>();
    const analyticsConnection = insightsQuery.data?.connection;

    connectedIntegrations.forEach((item) => {
      if (item.ad_account_id) adAccountIds.add(item.ad_account_id);
      if (Array.isArray(item.selected_ad_accounts)) {
        item.selected_ad_accounts.forEach((account) => {
          if (typeof account === "string") {
            adAccountIds.add(account);
            return;
          }
          if (!account || typeof account !== "object") return;
          const record = account as NumberRecord;
          const id = record.id ?? record.account_id ?? record.accountId;
          if (typeof id === "string") adAccountIds.add(id);
        });
      }
    });

    return {
      isConnected:
        connectedIntegrations.length > 0 ||
        analyticsConnection?.isConnected === true,
      hasAdAccount:
        connectedIntegrations.some(integrationHasAdAccount) ||
        (analyticsConnection?.adAccounts ?? 0) > 0,
      hasMarketingToken:
        connectedIntegrations.some(
          (item) => item.marketing_token_available === true,
        ) || analyticsConnection?.isConnected === true,
      pageCount: Math.max(
        new Set(
          connectedIntegrations
            .map((item) => item.page_id)
            .filter((value): value is string => Boolean(value)),
        ).size,
        analyticsConnection?.connectedPages ?? 0,
      ),
      adAccountCount: Math.max(
        adAccountIds.size,
        analyticsConnection?.adAccounts ?? 0,
      ),
      hasInstagram: connectedIntegrations.some(
        (item) =>
          Boolean(item.instagram_business_account_id) ||
          Boolean(item.instagram_username),
      ) || (analyticsConnection?.instagramAccounts ?? 0) > 0,
      instagramUsername:
        connectedIntegrations.find((item) => item.instagram_username)?.instagram_username ??
        null,
      pageName: connectedIntegrations.find((item) => item.page_name)?.page_name ?? null,
      lastValidatedAt: latestIsoDate(
        connectedIntegrations.map((item) => item.last_validated_at),
      ),
      lastIntegrationSyncAt: latestIsoDate(
        [
          ...connectedIntegrations.map((item) => item.last_sync_at),
          analyticsConnection?.lastIntegrationSync,
        ],
      ),
    };
  }, [connectedIntegrations, insightsQuery.data?.connection]);

  const campaigns = useMemo(() => {
    const source = insightsQuery.data?.campaigns ?? [];
    const query = filters.searchQuery.trim().toLocaleLowerCase("pt-BR");
    if (!query) return source;

    return source.filter((campaign) => {
      if (campaign.campaign_name.toLocaleLowerCase("pt-BR").includes(query)) return true;
      return campaign.adsets.some(
        (adset) =>
          adset.adset_name.toLocaleLowerCase("pt-BR").includes(query) ||
          adset.ads.some((ad) => ad.ad_name.toLocaleLowerCase("pt-BR").includes(query)),
      );
    });
  }, [filters.searchQuery, insightsQuery.data?.campaigns]);

  const creatives = useMemo(
    () =>
      collectCreatives(
        campaigns,
        insightsQuery.data?.topCreatives ?? [],
        insightsQuery.data?.media ?? [],
        insightsQuery.data?.dataQuality.hasCRMAttribution ?? false,
      ),
    [
      campaigns,
      insightsQuery.data?.dataQuality.hasCRMAttribution,
      insightsQuery.data?.media,
      insightsQuery.data?.topCreatives,
    ],
  );

  const optionalMetrics = useMemo<MarketingOptionalMetrics>(() => {
    const summary = insightsQuery.data?.summary;
    const social = insightsQuery.data?.social;
    const hasCRMAttribution =
      insightsQuery.data?.dataQuality.hasCRMAttribution ?? false;
    const hasSocialData = Boolean(
      social?.lastSync ||
        insightsQuery.data?.media.some((asset) => asset.source_kind === "organic"),
    );
    return {
      clicks:
        summary?.totalClicks ??
        readNumber(summary, ["clicks", "total_clicks"]),
      qualified: hasCRMAttribution
        ? (summary?.totalQualified ??
          readNumber(summary, ["qualified", "qualifiedLeads", "qualified_count"]))
        : null,
      responded: hasCRMAttribution
        ? (summary?.totalResponded ??
          readNumber(summary, ["responded", "respondedLeads", "responded_count"]))
        : null,
      lost: hasCRMAttribution
        ? (summary?.totalLost ??
          readNumber(summary, ["lost", "lostLeads", "lost_count"]))
        : null,
      organicReach: hasSocialData ? (social?.reach ?? 0) : null,
      profileVisits: hasSocialData ? (social?.profileViews ?? 0) : null,
      followers: hasSocialData ? (social?.followers ?? null) : null,
    };
  }, [insightsQuery.data]);

  const campaignMetrics = useMemo(() => {
    const ctrCampaigns = campaigns.filter((campaign) => campaign.ctr !== null);
    const hookCampaigns = campaigns.filter((campaign) => campaign.hook_rate !== null);
    const weightedCtrImpressions = ctrCampaigns.reduce(
      (total, campaign) => total + (campaign.impressions ?? 0),
      0,
    );
    const weightedHookImpressions = hookCampaigns.reduce(
      (total, campaign) => total + (campaign.impressions ?? 0),
      0,
    );

    const averageCtr =
      ctrCampaigns.length === 0
        ? null
        : weightedCtrImpressions > 0
          ? ctrCampaigns.reduce(
              (total, campaign) =>
                total + (campaign.ctr ?? 0) * (campaign.impressions ?? 0),
              0,
            ) / weightedCtrImpressions
          : ctrCampaigns.reduce((total, campaign) => total + (campaign.ctr ?? 0), 0) /
            ctrCampaigns.length;

    const averageHookRate =
      hookCampaigns.length === 0
        ? null
        : weightedHookImpressions > 0
          ? hookCampaigns.reduce(
              (total, campaign) =>
                total + (campaign.hook_rate ?? 0) * (campaign.impressions ?? 0),
              0,
            ) / weightedHookImpressions
          : hookCampaigns.reduce(
              (total, campaign) => total + (campaign.hook_rate ?? 0),
              0,
            ) / hookCampaigns.length;

    return {
      activeCampaigns: campaigns.filter((campaign) =>
        ["ACTIVE", "LEARNING"].includes(String(campaign.status ?? "").toUpperCase()),
      ).length,
      averageCtr,
      averageHookRate,
    };
  }, [campaigns]);

  const sync = useCallback(() => {
    const dateStart = formatCalendarDate(filters.dateRange.from);
    const dateStop = formatCalendarDate(filters.dateRange.to);
    syncMutation.mutate({ dateStart, dateStop });
  }, [filters.dateRange.from, filters.dateRange.to, syncMutation]);

  return {
    canManageIntegration,
    canSyncIntegration,
    insightsQuery,
    integrationsQuery,
    syncMutation,
    sync,
    campaigns,
    creatives,
    optionalMetrics,
    campaignMetrics,
    integration,
    integrationState,
    lastSyncAt:
      insightsQuery.data?.lastSync ??
      integrationState.lastIntegrationSyncAt ??
      null,
  };
}
