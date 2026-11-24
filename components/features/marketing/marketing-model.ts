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

/** Only CPL confirmed by the API participates in the ranking. */
export function rankPaidCreatives(creatives: readonly RankedCreative[]) {
  return creatives
    .filter((creative) => creative.source_kind === "paid" && creative.realCpl !== null)
    .sort((left, right) => {
      return (left.realCpl ?? 0) - (right.realCpl ?? 0) ||
        (right.leads_count ?? 0) - (left.leads_count ?? 0) ||
        right.score - left.score || left.id.localeCompare(right.id);
    });
}

export function allCreatives(model: MarketingModel) {
  const ads = indexAds(model);
  return model.creatives.map((creative): RankedCreative => ({
    ...creative,
    qualified: creative.leads_count !== null && creative.ad_id
      ? ads.get(creative.ad_id)?.qualified_count ?? null
      : null,
    realCpl: creative.source_kind === "paid" && (creative.leads_count ?? 0) > 0
      ? creative.cpl
      : null,
  }));
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
