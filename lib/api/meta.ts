export type MetaCampaignKind = "lead_form" | "whatsapp" | "site";
export type MetaDeliveryStatus = "ACTIVE" | "PAUSED" | "ARCHIVED" | "LEARNING";

export interface MetaCreativeAsset {
  id: string;
  name: string;
  type: "image" | "video" | "carousel";
  thumbnailUrl: string | null;
  creativeUrl: string | null;
  videoUrl: string | null;
  permalinkUrl: string | null;
  hookRate: number;
  ctr: number;
  spend: number;
  leads: number;
  sales: number;
  cpl: number;
}

export interface MetaAdSetPerformance {
  id: string;
  name: string;
  status: MetaDeliveryStatus;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  leads: number;
  sales: number;
  revenue: number;
  ctr: number;
  cpl: number;
  hookRate: number;
  creatives: MetaCreativeAsset[];
}

export interface MetaCampaignPerformance {
  id: string;
  name: string;
  kind: MetaCampaignKind;
  status: MetaDeliveryStatus;
  objective: string;
  startedAt: string;
  endedAt: string | null;
  spend: number;
  previousMonthSpend: number;
  impressions: number;
  reach: number;
  clicks: number;
  leads: number;
  sales: number;
  revenue: number;
  ctr: number;
  cpl: number;
  hookRate: number;
  adSets: MetaAdSetPerformance[];
}

export interface MetaDailyPerformance {
  date: string;
  spend: number;
  leads: number;
  cpl: number;
}

export interface MetaCampaignSnapshot {
  source: "database" | "empty";
  generatedAt: string | null;
  campaigns: MetaCampaignPerformance[];
  daily: MetaDailyPerformance[];
  previousMonthSpend: number;
}

export function getEmptyMetaCampaignSnapshot(): MetaCampaignSnapshot {
  return {
    source: "empty",
    generatedAt: null,
    campaigns: [],
    daily: [],
    previousMonthSpend: 0,
  };
}

export function flattenMetaCreatives(campaigns: MetaCampaignPerformance[]) {
  return campaigns
    .flatMap((campaign) =>
      campaign.adSets.flatMap((adSet) =>
        adSet.creatives.map((creative) => ({
          ...creative,
          campaignId: campaign.id,
          campaignName: campaign.name,
          adSetId: adSet.id,
          adSetName: adSet.name,
          revenue: campaign.revenue,
          score: creative.leads + creative.sales * 10 - Math.round(creative.cpl / 10),
        })),
      ),
    )
    .sort((a, b) => b.score - a.score);
}

export function getMetaCreativeDestination(creative: Pick<MetaCreativeAsset, "permalinkUrl" | "videoUrl" | "creativeUrl">) {
  return creative.permalinkUrl || creative.videoUrl || creative.creativeUrl || null;
}
