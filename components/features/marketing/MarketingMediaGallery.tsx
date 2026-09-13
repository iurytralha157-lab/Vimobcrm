import { ExternalLink } from "lucide-react";

import { MetaCreativePreview } from "@/components/features/meta";
import type { MarketingCreative } from "@/hooks/marketing";

interface MarketingMediaGalleryProps {
  creatives: MarketingCreative[];
}

function formatCurrency(value: number | null, currency: string | null) {
  if (value === null || !currency) return "—";
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency,
      notation: Math.abs(value) >= 100_000 ? "compact" : "standard",
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString("pt-BR", {
      maximumFractionDigits: 2,
    })}`;
  }
}

function formatNumber(value: number | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("pt-BR", {
    notation: Math.abs(value) >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatProvider(
  provider: string,
  sourceKind: MarketingCreative["source_kind"],
) {
  const normalizedProvider = provider.trim().toLocaleLowerCase("pt-BR");
  const providerLabel =
    normalizedProvider === "meta" || normalizedProvider === "facebook"
      ? "Meta"
      : normalizedProvider === "instagram"
        ? "Instagram"
        : normalizedProvider === "google" || normalizedProvider === "google_ads"
          ? "Google"
          : provider.trim() || "Não informada";

  return sourceKind === "paid" ? `${providerLabel} Ads` : providerLabel;
}

function asSafeExternalUrl(value: string | null) {
  const candidate = value?.trim();
  if (!candidate) return null;

  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function getFormatHint(mediaType: string | null) {
  const normalizedType = mediaType?.trim().toLocaleLowerCase("pt-BR") ?? "";
  if (normalizedType.includes("stor") || normalizedType.includes("reel")) {
    return "story" as const;
  }
  if (normalizedType.includes("feed")) return "feed" as const;
  return null;
}

export function MarketingMediaGallery({ creatives }: MarketingMediaGalleryProps) {
  return (
    <div
      className="grid items-start justify-center gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),280px))]"
      data-marketing-media-grid
    >
      {creatives.map((creative, index) => {
        const titleId = `marketing-media-title-${index}`;
        const preview = {
          name: creative.ad_name,
          type: creative.creative_video_url ? ("video" as const) : ("image" as const),
          thumbnailUrl: creative.thumbnail_url,
          creativeUrl: creative.creative_url,
          videoUrl: creative.creative_video_url,
          permalinkUrl: creative.creative_permalink_url,
        };
        const destination =
          [
            creative.creative_permalink_url,
            creative.creative_video_url,
            creative.creative_url,
          ]
            .map(asSafeExternalUrl)
            .find((value): value is string => Boolean(value)) ?? null;

        return (
          <article
            key={creative.id}
            aria-labelledby={titleId}
            className="group min-w-0 overflow-hidden rounded-[8px] bg-[var(--app-surface-solid)] ring-1 ring-inset ring-[var(--app-border)] transition-[box-shadow] duration-200 hover:ring-primary/50 focus-within:ring-primary/50"
          >
            <div className="relative flex h-[344px] items-center justify-center bg-[var(--app-surface-muted)] p-2.5">
              <MetaCreativePreview
                creative={preview}
                size="gallery"
                showAction={false}
                showFormatBadge
                formatHint={getFormatHint(creative.media_type)}
                className="h-full w-full justify-center"
              />

              {destination ? (
                <a
                  href={destination}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Abrir criativo ${creative.ad_name}`}
                  className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-[5px] bg-[var(--app-media-scrim-strong)] text-[var(--app-on-media)] transition-colors after:absolute after:-inset-1.5 after:content-[''] hover:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              ) : null}
            </div>

            <div className="min-w-0 px-2.5 pb-2.5 pt-2">
              <h3
                id={titleId}
                className="line-clamp-2 min-h-8 text-[12px] font-medium leading-4 text-[var(--app-text-primary)]"
                title={creative.ad_name}
              >
                {creative.ad_name}
              </h3>
              <p
                className="mt-0.5 truncate text-[10px] leading-4 text-[var(--app-text-tertiary)]"
                title={creative.campaign_name ?? undefined}
              >
                {creative.campaign_name ??
                  (creative.source_kind === "organic"
                    ? "Conteúdo orgânico"
                    : "Campanha não informada")}
              </p>

              <dl className="mt-2 grid grid-cols-3 gap-x-2 gap-y-1.5 rounded-[6px] bg-[var(--app-surface-soft)] px-2 py-2">
                <MediaMetric
                  label="Alcance"
                  value={formatNumber(creative.reach)}
                />
                <MediaMetric
                  label="Interações"
                  value={formatNumber(creative.interactions)}
                />
                <MediaMetric
                  label="Impressões"
                  value={formatNumber(creative.impressions)}
                />
                <MediaMetric
                  label="Origem"
                  value={formatProvider(creative.provider, creative.source_kind)}
                />
                <MediaMetric
                  label="Leads CRM"
                  value={formatNumber(creative.leads_count)}
                />
                <MediaMetric
                  label="Investimento"
                  value={formatCurrency(creative.spend, creative.currency)}
                />
              </dl>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function MediaMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[9px] font-light uppercase tracking-[0.03em] text-[var(--app-text-secondary)]">
        {label}
      </dt>
      <dd
        className="mt-0.5 truncate text-[11px] font-medium leading-4 tabular-nums text-[var(--app-text-primary)]"
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}
