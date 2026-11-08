import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

import { formatCount, formatMoney, formatPercent } from "./marketing-format";
import type { RankedCreative } from "./marketing-model";
import { CreativeImage, EmptyNote, NEUTRAL_SOFT, PANEL_SOFT, Panel, safeExternalUrl } from "./marketing-ui";

export function creativeMedia(creative: RankedCreative) {
  return {
    name: creative.ad_name,
    thumbnailUrl: creative.thumbnail_url,
    imageUrl: creative.creative_url,
    videoUrl: creative.creative_video_url,
    permalinkUrl: creative.creative_permalink_url,
  };
}

function DarkStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[11px] font-light text-white/60">{label}</p>
      <p className="truncate text-[14px] font-normal tabular-nums text-white">{value}</p>
    </div>
  );
}

export function CreativeDarkCard({ creative, rank }: { creative: RankedCreative; rank?: number }) {
  const link = safeExternalUrl(creative.creative_permalink_url);
  return (
    <div className="overflow-hidden rounded-[14px] bg-[#151515] p-2.5">
      <div className="relative overflow-hidden rounded-[8px] bg-white/10">
        {rank ? (
          <span className="absolute right-2 top-2 z-10 rounded-[4px] bg-primary px-1.5 py-0.5 text-[10px] font-normal text-white">
            {rank}º lugar
          </span>
        ) : null}
        <div className="flex h-56 items-center justify-center">
          <CreativeImage media={creativeMedia(creative)} className="h-full w-full justify-center" />
        </div>
      </div>
      <div className="px-1.5 pb-1.5 pt-3">
        <h3 className="truncate text-[15px] font-medium text-white">{creative.ad_name}</h3>
        <p className="truncate text-[11px] font-light text-white/60">{creative.campaign_name ?? "Campanha não informada"}</p>
        <div className="mt-3 flex items-baseline justify-between border-b border-white/15 pb-3">
          <span className="text-[12px] font-light text-white/60">CPL real</span>
          <span className="text-[24px] font-normal tabular-nums text-white">{formatMoney(creative.realCpl, creative.currency)}</span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2.5">
          <DarkStat label="Leads" value={formatCount(creative.leads_count)} />
          <DarkStat label="Qualificados" value={formatCount(creative.qualified)} />
          <DarkStat label="Vendas" value={formatCount(creative.won_count)} />
          <DarkStat label="Investido" value={formatMoney(creative.spend, creative.currency, 0)} />
          <DarkStat label="CTR" value={formatPercent(creative.ctr)} />
          <DarkStat label="Hook rate" value={formatPercent(creative.hook_rate)} />
        </div>
        {link ? (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 flex h-10 items-center justify-center rounded-full bg-primary text-[12px] font-normal text-white hover:bg-primary/90"
          >
            Ver anúncio
          </a>
        ) : null}
      </div>
    </div>
  );
}

export function MarketingCreativeSpotlight({ creatives }: { creatives: RankedCreative[] }) {
  const [index, setIndex] = useState(0);
  const list = creatives.slice(0, 6);
  const safeIndex = list.length ? Math.min(index, list.length - 1) : 0;
  const current = list[safeIndex];
  const move = (delta: number) => setIndex((safeIndex + delta + list.length) % list.length);
  return (
    <Panel
      title="Criativo do momento"
      aside={
        list.length > 1 ? (
          <span className="flex gap-1.5">
            {[
              { label: "Criativo anterior", delta: -1, Icon: ChevronLeft },
              { label: "Próximo criativo", delta: 1, Icon: ChevronRight },
            ].map(({ label, delta, Icon }) => (
              <button
                key={label}
                type="button"
                aria-label={label}
                onClick={() => move(delta)}
                className={cn("flex h-7 w-7 items-center justify-center rounded-full text-[var(--app-text-primary)]", PANEL_SOFT)}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            ))}
          </span>
        ) : null
      }
    >
      {current ? <CreativeDarkCard creative={current} rank={safeIndex + 1} /> : <EmptyNote>Sem criativos pagos no período.</EmptyNote>}
    </Panel>
  );
}

export function MarketingBestCreatives({ creatives }: { creatives: RankedCreative[] }) {
  const list = creatives.slice(0, 6);
  const worst = Math.max(...list.map((creative) => creative.realCpl ?? 0), 0);
  return (
    <Panel title="Melhores criativos" aside="Por CPL real">
      {list.length === 0 ? <EmptyNote>Sem criativos pagos no período.</EmptyNote> : null}
      <ul className="space-y-1">
        {list.map((creative, index) => (
          <li key={creative.id} className={cn("flex items-center gap-3 rounded-[8px] p-2", index === 0 && "bg-primary/10")}>
            <span className="flex h-12 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[6px]">
              <CreativeImage media={creativeMedia(creative)} size="sm" className="h-full w-full" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-medium text-[var(--app-text-primary)]">{creative.ad_name}</span>
              <span className="mt-0.5 flex items-baseline justify-between gap-2 text-[11px] font-light text-[var(--app-text-secondary)]">
                <span className="truncate">
                  {formatCount(creative.leads_count)} leads · {formatCount(creative.qualified)} qualif.
                </span>
                <span className="whitespace-nowrap tabular-nums text-[var(--app-text-primary)]">{formatMoney(creative.realCpl, creative.currency)}</span>
              </span>
              <span className={cn("mt-1 block h-1 overflow-hidden rounded-full", NEUTRAL_SOFT)}>
                <span
                  className="block h-full rounded-full bg-primary"
                  style={{ width: `${creative.realCpl && worst ? Math.max(8, 100 - ((creative.realCpl / worst) * 100 - 100 / list.length)) : 0}%` }}
                />
              </span>
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
