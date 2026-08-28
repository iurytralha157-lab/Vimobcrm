import {
  Banknote,
  Eye,
  Radio,
  Sparkles,
  Target,
  Trophy,
  UsersRound,
} from "lucide-react";

import { MetaCreativePreview } from "@/components/features/meta";
import type { MarketingCreative } from "@/hooks/marketing";

interface MarketingMediaGalleryProps {
  creatives: MarketingCreative[];
}

function formatCurrency(value: number | null, currency: string | null) {
  if (value === null || !currency) return "Aguardando";
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString("pt-BR", {
      maximumFractionDigits: 2,
    })}`;
  }
}

function formatNumber(value: number | null) {
  if (value === null) return "Aguardando";
  return new Intl.NumberFormat("pt-BR").format(value);
}

export function MarketingMediaGallery({ creatives }: MarketingMediaGalleryProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {creatives.map((creative) => {
        const preview = {
          name: creative.ad_name,
          type: creative.creative_video_url ? ("video" as const) : ("image" as const),
          thumbnailUrl: creative.thumbnail_url ?? creative.creative_url,
          creativeUrl: creative.creative_url,
          videoUrl: creative.creative_video_url,
          permalinkUrl: creative.creative_permalink_url,
        };

        return (
          <article
            key={creative.id}
            className="min-w-0 rounded-[8px] bg-[var(--app-surface-soft)] p-3 transition-colors hover:bg-[var(--app-surface-hover)]"
          >
            <div className="flex min-w-0 items-start gap-3">
              <MetaCreativePreview
                creative={preview}
                size="lg"
                showAction
                className="shrink-0"
              />
              <div className="min-w-0">
                <h3 className="line-clamp-2 text-[12px] font-medium leading-5 text-[var(--app-text-primary)]">
                  {creative.ad_name}
                </h3>
                <p className="mt-1 truncate text-[10px] text-[var(--app-text-tertiary)]">
                  {creative.source_kind === "organic"
                    ? `${creative.provider} · Orgânico`
                    : creative.campaign_name || `${creative.provider} · Pago`}
                </p>
                {creative.adset_name ? (
                  <p className="mt-0.5 truncate text-[10px] text-[var(--app-text-tertiary)]">
                    {creative.adset_name}
                  </p>
                ) : null}
              </div>
            </div>

            <dl className="mt-3 grid grid-cols-2 gap-1.5">
              {creative.source_kind === "organic" ? (
                <>
                  <MediaMetric
                    icon={Radio}
                    label="Alcance"
                    value={formatNumber(creative.reach)}
                  />
                  <MediaMetric
                    icon={Sparkles}
                    label="Interações"
                    value={formatNumber(creative.interactions)}
                  />
                  <MediaMetric
                    icon={Eye}
                    label="Impressões"
                    value={formatNumber(creative.impressions)}
                  />
                  <MediaMetric
                    icon={UsersRound}
                    label="Origem"
                    value="Orgânico"
                  />
                </>
              ) : (
                <>
                  <MediaMetric
                    icon={UsersRound}
                    label="Leads"
                    value={formatNumber(creative.leads_count)}
                  />
                  <MediaMetric
                    icon={Trophy}
                    label="Ganhos"
                    value={formatNumber(creative.won_count)}
                    success
                  />
                  <MediaMetric
                    icon={Banknote}
                    label="Investimento"
                    value={formatCurrency(creative.spend, creative.currency)}
                  />
                  <MediaMetric
                    icon={Target}
                    label="CPL"
                    value={formatCurrency(creative.cpl, creative.currency)}
                  />
                </>
              )}
            </dl>
          </article>
        );
      })}
    </div>
  );
}

function MediaMetric({
  icon: Icon,
  label,
  value,
  success = false,
}: {
  icon: typeof UsersRound;
  label: string;
  value: string;
  success?: boolean;
}) {
  return (
    <div className="rounded-[6px] bg-[var(--app-surface-solid)] px-2.5 py-2">
      <dt className="flex items-center gap-1 text-[10px] font-light text-[var(--app-text-tertiary)]">
        <Icon className="h-3 w-3" aria-hidden="true" />
        {label}
      </dt>
      <dd
        className={
          success
            ? "mt-1 truncate text-[11px] font-medium tabular-nums text-emerald-500"
            : "mt-1 truncate text-[11px] font-medium tabular-nums text-[var(--app-text-primary)]"
        }
      >
        {value}
      </dd>
    </div>
  );
}
