import { useMemo } from "react";

import type { MarketingDailyPerformance } from "@/hooks/use-campaign-insights";
import { cn } from "@/lib/utils";

import { buildLeadBuckets, formatCount, formatMoney, niceAxisMax } from "./marketing-format";
import { INK, NEUTRAL_SOFT, NEUTRAL_STRONG, Panel } from "./marketing-ui";

const CHART_HEIGHT = 200;
const BEST_LABEL = { dia: "Melhor dia", semana: "Melhor semana", mês: "Melhor mês" } as const;
const TITLE = { dia: "Leads por dia", semana: "Leads por semana", mês: "Leads por mês" } as const;

function LegendItem({ label, className, line = false }: { label: string; className: string; line?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className={cn(line ? "h-0.5 w-3" : "h-2.5 w-2.5 rounded-[2px]", className)} />
      {label}
    </span>
  );
}

export function MarketingLeadsChart({
  rows,
  from,
  to,
  currency,
  stats,
}: {
  rows: MarketingDailyPerformance[];
  from: string;
  to: string;
  currency: string | null;
  stats: React.ReactNode;
}) {
  const { unit, buckets } = useMemo(() => buildLeadBuckets(rows, from, to), [rows, from, to]);
  const peak = buckets.reduce((max, bucket) => Math.max(max, bucket.leads, bucket.reported), 0);
  const axisMax = niceAxisMax(peak);
  const bestKey = buckets.reduce<{ key: string | null; leads: number }>(
    (best, bucket) => (bucket.leads > best.leads ? { key: bucket.key, leads: bucket.leads } : best),
    { key: null, leads: 0 },
  ).key;
  const ticks = [4, 3, 2, 1, 0].map((step) => (axisMax / 4) * step);

  return (
    <Panel
      title={TITLE[unit]}
      aside={
        <span className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
          <LegendItem label="Leads no CRM" className={NEUTRAL_SOFT} />
          <LegendItem label="Qualificados" className={NEUTRAL_STRONG} />
          <LegendItem label="Resultados Meta e Google" className={INK} line />
          <LegendItem label={BEST_LABEL[unit]} className="bg-primary" />
        </span>
      }
    >
      {stats}
      <div className="mt-4 grid grid-cols-[28px_minmax(0,1fr)] gap-1.5">
        <div className="relative text-[11px] font-light tabular-nums text-[var(--app-text-tertiary)]" style={{ height: CHART_HEIGHT }} aria-hidden="true">
          {ticks.map((tick, index) => (
            <span key={tick} className="absolute right-0 -translate-y-1/2" style={{ top: `${(index / 4) * 100}%` }}>
              {formatCount(tick)}
            </span>
          ))}
        </div>
        <div>
          <div
            role="img"
            aria-label={`${TITLE[unit]}: ${formatCount(buckets.reduce((sum, bucket) => sum + bucket.leads, 0))} leads no período`}
            className="flex gap-[3px] border-b border-[var(--app-border)]"
            style={{ height: CHART_HEIGHT }}
          >
            {buckets.map((bucket, index) => {
              const isBest = bucket.key === bestKey;
              const leadsHeight = (bucket.leads / axisMax) * 100;
              const qualifiedHeight = (Math.min(bucket.qualified, bucket.leads) / axisMax) * 100;
              const reportedBottom = (bucket.reported / axisMax) * 100;
              const alignRight = index > buckets.length / 2;
              return (
                <div key={bucket.key} className="group relative h-full min-w-0 flex-1 rounded-t-[4px] hover:bg-[var(--app-surface-hover)]">
                  <span
                    className={cn("absolute inset-x-0 bottom-0", isBest ? "bg-primary/40" : NEUTRAL_SOFT)}
                    style={{ height: `${leadsHeight}%` }}
                  />
                  <span
                    className={cn("absolute inset-x-0 bottom-0", isBest ? "bg-primary" : NEUTRAL_STRONG)}
                    style={{ height: `${qualifiedHeight}%` }}
                  />
                  {bucket.reported > 0 ? (
                    <span className={cn("absolute inset-x-0 h-0.5", INK)} style={{ bottom: `${reportedBottom}%` }} />
                  ) : null}
                  <div
                    className={cn(
                      "pointer-events-none absolute top-1.5 z-20 hidden w-44 rounded-[8px] bg-[var(--app-surface-solid)] p-2.5 text-[11px] font-light shadow-lg group-hover:block",
                      alignRight ? "right-full mr-1" : "left-full ml-1",
                    )}
                  >
                    <p className="mb-1 font-normal text-[var(--app-text-primary)]">{bucket.tooltip}</p>
                    {[
                      ["Meta e Google", formatCount(bucket.reported)],
                      ["Leads no CRM", formatCount(bucket.leads)],
                      ["Qualificados", formatCount(bucket.qualified)],
                      ["Ganhos", formatCount(bucket.won)],
                      ["Investido", formatMoney(bucket.spend, currency, 0)],
                    ].map(([label, value]) => (
                      <p key={label} className="flex justify-between gap-2 tabular-nums text-[var(--app-text-secondary)]">
                        <span>{label}</span>
                        <span className="text-[var(--app-text-primary)]">{value}</span>
                      </p>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-1.5 flex gap-[3px] text-[10px] font-light tabular-nums text-[var(--app-text-tertiary)]" aria-hidden="true">
            {buckets.map((bucket) => (
              <span key={bucket.key} className="min-w-0 flex-1 overflow-visible whitespace-nowrap">
                <span className={cn(bucket.showLabelOnPhone ? "" : "sm:inline hidden", !bucket.showLabel && "sm:hidden")}>{bucket.label}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </Panel>
  );
}
