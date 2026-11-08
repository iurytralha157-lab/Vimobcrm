import type { useMarketingDashboard, MarketingCreative } from "@/hooks/marketing";
import type { AdAggregated, MarketingMediaAsset } from "@/hooks/use-campaign-insights";

export type MarketingModel = ReturnType<typeof useMarketingDashboard>;

export interface RankedCreative extends MarketingCreative {
  qualified: number | null;
  realCpl: number | null;
}

export function indexAds(model: MarketingModel) {
  const ads = new Map<string, AdAggregated>();
  model.campaigns.forEach((campaign) => {
    campaign.adsets.forEach((adset) => {
      adset.ads.forEach((ad) => ads.set(ad.ad_id, ad));
    });
  });
  return ads;
}

function withRealCost(creative: MarketingCreative, ads: Map<string, AdAggregated>): RankedCreative {
  const ad = creative.ad_id ? ads.get(creative.ad_id) : undefined;
  const leads = creative.leads_count ?? ad?.leads_count ?? null;
  const spend = creative.spend ?? ad?.spend ?? null;
  return {
    ...creative,
    leads_count: leads,
    spend,
    ctr: creative.ctr ?? ad?.ctr ?? null,
    hook_rate: creative.hook_rate ?? ad?.hook_rate ?? null,
    won_count: creative.won_count ?? ad?.won_count ?? null,
    currency: creative.currency ?? ad?.currency ?? null,
    qualified: ad?.qualified_count ?? null,
    realCpl: leads && spend !== null ? spend / leads : null,
  };
}

/** Paid creatives with confirmed CRM leads first, cheapest real lead on top. */
export function rankPaidCreatives(model: MarketingModel) {
  const ads = indexAds(model);
  return model.creatives
    .filter((creative) => creative.source_kind === "paid")
    .map((creative) => withRealCost(creative, ads))
    .sort((left, right) => {
      if (left.realCpl === null && right.realCpl === null) return (right.spend ?? 0) - (left.spend ?? 0);
      if (left.realCpl === null) return 1;
      if (right.realCpl === null) return -1;
      return left.realCpl - right.realCpl;
    });
}

export function allCreatives(model: MarketingModel) {
  const ads = indexAds(model);
  return model.creatives.map((creative) => withRealCost(creative, ads));
}

export function mediaById(media: MarketingMediaAsset[]) {
  return new Map(media.map((asset) => [asset.id, asset]));
}

export function metricOf(asset: MarketingMediaAsset | undefined, key: string) {
  const value = asset?.metrics?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function formatLabel(mediaType: string | null | undefined) {
  const value = String(mediaType ?? "").toUpperCase();
  if (value.includes("REEL")) return "Reels";
  if (value.includes("STOR")) return "Stories";
  if (value.includes("CAROUSEL")) return "Carrossel";
  if (value.includes("VIDEO")) return "Vídeo";
  if (value.includes("IMAGE") || value.includes("PHOTO") || value.includes("FEED")) return "Foto";
  return "Outro";
}
