import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";

import { CreativeDarkCard, creativeMedia } from "./MarketingCreativeSpotlight";
import { formatCompact, formatCount, formatMoney, formatPercent } from "./marketing-format";
import { allCreatives, formatLabel, mediaById, metricOf, type MarketingModel, type RankedCreative } from "./marketing-model";
import { CreativeImage, EmptyNote, KpiCard, KpiRow, Panel } from "./marketing-ui";

const FILTERS = [
  { key: "all", label: "Todos" },
  { key: "paid", label: "Pagos" },
  { key: "organic", label: "Orgânicos" },
] as const;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[11px] font-light text-[var(--app-text-secondary)]">{label}</p>
      <p className="truncate text-[15px] font-normal tabular-nums text-[var(--app-text-primary)]">{value}</p>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="rounded-[4px] bg-white px-1.5 py-0.5 text-[10px] font-light text-[#151515]">{children}</span>;
}

export function MarketingMediaTab({ model }: { model: MarketingModel }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const data = model.insightsQuery.data!;
  const assets = useMemo(() => mediaById(data.media), [data.media]);
  const creatives = useMemo(() => allCreatives(model), [model]);
  const paid = creatives.filter((creative) => creative.source_kind === "paid");
  const organic = creatives.filter((creative) => creative.source_kind === "organic");
  const ranked = [...paid].filter((creative) => creative.realCpl !== null).sort((a, b) => (a.realCpl ?? 0) - (b.realCpl ?? 0));
  const best = ranked[0];
  const bestPosition = new Map(ranked.map((creative, index) => [creative.id, index + 1]));
  const visible = creatives.filter((creative) => filter === "all" || creative.source_kind === filter);
  const selected = creatives.find((creative) => creative.id === selectedId) ?? visible[0] ?? null;
  const paidSpend = paid.reduce((sum, creative) => sum + (creative.spend ?? 0), 0);
  const currency = data.summary.currency;
  const organicReach = organic.reduce((sum, creative) => sum + (creative.reach ?? metricOf(assets.get(creative.id), "reach") ?? 0), 0);

  const engagement = (creative: RankedCreative) => {
    const asset = assets.get(creative.id);
    const parts = [
      [metricOf(asset, "likes"), "curt."],
      [metricOf(asset, "comments"), "coment."],
      [metricOf(asset, "saves"), "salv."],
    ].filter(([value]) => value !== null);
    return parts.map(([value, label]) => `${formatCount(value as number)} ${label}`).join(" · ");
  };

  return (
    <div className="space-y-3">
      <KpiRow>
        <KpiCard label="Criativos pagos" value={formatCount(paid.length)} note={`${formatMoney(paidSpend, currency, 0)} investidos`} />
        <KpiCard label="Melhor CPL" value={formatMoney(best?.realCpl, best?.currency ?? currency)} note={best?.ad_name ?? "Sem leads confirmados"} />
        <KpiCard label="Hook rate médio" value={formatPercent(model.campaignMetrics.averageHookRate)} note="Só vídeos e Reels" />
        <KpiCard label="Publicações orgânicas" value={formatCount(organic.length)} note={`${formatCompact(organicReach)} de alcance somado`} />
      </KpiRow>
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex gap-0.5 rounded-[8px] bg-[color-mix(in_srgb,var(--app-text-primary)_7.5%,transparent)] p-1">
          {FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={filter === item.key}
              onClick={() => setFilter(item.key)}
              className={cn("rounded-[6px] px-2.5 py-1 text-[12px] font-light", filter === item.key ? "bg-[var(--app-surface-solid)] text-[var(--app-text-primary)]" : "text-[var(--app-text-secondary)]")}
            >
              {item.label}
            </button>
          ))}
        </span>
        <span className="text-[12px] font-light text-[var(--app-text-secondary)]">{formatCount(visible.length)} criativos no período</span>
      </div>
      <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_300px]">
        {visible.length === 0 ? (
          <Panel title="Criativos"><EmptyNote>Nenhum criativo neste filtro.</EmptyNote></Panel>
        ) : (
          <div className="grid min-w-0 gap-3 [grid-template-columns:repeat(auto-fill,minmax(190px,1fr))]">
            {visible.map((creative) => {
              const isPaid = creative.source_kind === "paid";
              const position = bestPosition.get(creative.id);
              const asset = assets.get(creative.id);
              return (
                <button
                  key={creative.id}
                  type="button"
                  aria-pressed={selected?.id === creative.id}
                  onClick={() => setSelectedId(creative.id)}
                  className={cn(
                    "flex min-w-0 flex-col justify-start overflow-hidden rounded-[12px] bg-[var(--app-surface-solid)] text-left outline outline-2 -outline-offset-2",
                    selected?.id === creative.id ? "outline-primary" : "outline-transparent",
                  )}
                >
                  <span className="relative flex h-40 w-full shrink-0 items-center justify-center overflow-hidden bg-[var(--app-surface-soft)]">
                    <span className="absolute inset-x-2 top-2 z-10 flex justify-between">
                      <Tag>{position === 1 ? "1º lugar" : isPaid ? "Pago" : "Orgânico"}</Tag>
                      <Tag>{formatLabel(creative.media_type)}</Tag>
                    </span>
                    <CreativeImage media={creativeMedia(creative)} className="h-full w-full justify-center" />
                  </span>
                  <span className="block p-3">
                    <span className="block truncate text-[12px] font-medium text-[var(--app-text-primary)]">{creative.ad_name}</span>
                    <span className="mt-2 grid grid-cols-2 gap-2">
                      {isPaid ? (
                        <>
                          <Stat label="CPL real" value={formatMoney(creative.realCpl, creative.currency)} />
                          <Stat label="Qualificados" value={formatCount(creative.qualified)} />
                        </>
                      ) : (
                        <>
                          <Stat label="Alcance" value={formatCompact(creative.reach ?? metricOf(asset, "reach"))} />
                          <Stat label="Visualizações" value={formatCompact(metricOf(asset, "views"))} />
                        </>
                      )}
                    </span>
                    {engagement(creative) ? (
                      <span className="mt-2 block border-t border-[var(--app-border)] pt-2 text-[10px] font-light text-[var(--app-text-tertiary)]">
                        {engagement(creative)}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <aside className="min-w-0">
          <Panel title="Detalhe do criativo">
            {selected ? <CreativeDarkCard creative={selected} rank={bestPosition.get(selected.id)} /> : <EmptyNote>Escolha um criativo.</EmptyNote>}
          </Panel>
        </aside>
      </div>
    </div>
  );
}
