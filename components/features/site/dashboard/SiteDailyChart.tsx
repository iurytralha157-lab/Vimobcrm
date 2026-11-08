import { useMemo } from "react";

import { formatCount, niceAxisMax } from "@/components/features/marketing/marketing-format";
import { NEUTRAL_SOFT, NEUTRAL_STRONG, Panel } from "@/components/features/marketing/marketing-ui";
import { cn } from "@/lib/utils";

import { buildSiteBuckets, type SiteDayBucket } from "./site-dashboard-format";

const CHART_HEIGHT = 200;
const BEST_LABEL = { dia: "Melhor dia", semana: "Melhor semana", mês: "Melhor mês" } as const;
const UNIT_TITLE = { dia: "dia", semana: "semana", mês: "mês" } as const;

function LegendItem({ label, className }: { label: string; className: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className={cn("h-2.5 w-2.5 rounded-[2px]", className)} />
      {label}
    </span>
  );
}

export function SiteDailyChart({
  rows,
  metric,
  from,
  to,
  stats,
}: {
  rows: Array<{ date: string; sessions?: number; views: number; leads?: number }>;
  /** Without the insights breakdown only daily page views are known. */
  metric: "sessions" | "views";
  from: string;
  to: string;
  stats: React.ReactNode;
}) {
  const { unit, buckets } = useMemo(() => buildSiteBuckets(rows, from, to), [rows, from, to]);
  const valueOf = (bucket: SiteDayBucket) => bucket[metric];
  const peak = buckets.reduce((max, bucket) => Math.max(max, valueOf(bucket)), 0);
  const axisMax = niceAxisMax(peak);
  const bestKey = peak > 0 ? buckets.find((bucket) => valueOf(bucket) === peak)?.key : undefined;
  const ticks = [4, 3, 2, 1, 0].map((step) => (axisMax / 4) * step);
  const metricLabel = metric === "sessions" ? "Sessões" : "Páginas vistas";
  const title = `${metricLabel} por ${UNIT_TITLE[unit]}`;

  return (
    <Panel
      title={title}
      aside={
        <span className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
          <LegendItem label={metricLabel} className={NEUTRAL_STRONG} />
          <LegendItem label={BEST_LABEL[unit]} className="bg-primary" />
        </span>
      }
    >
      {stats}
      <div className="mt-4 grid grid-cols-[32px_minmax(0,1fr)] gap-1.5">
        <div className="relative text-[11px] font-light tabular-nums text-[var(--app-text-tertiary)]" style={{ height: CHART_HEIGHT }} aria-hidden="true">
          {ticks.map((tick, index) => (
            <span key={tick} className="absolute right-0 -translate-y-1/2" style={{ top: `${(index / 4) * 100}%` }}>
              {formatCount(tick)}
            </span>
          ))}
        </div>
        <div className="min-w-0">
          <div
            role="img"
            aria-label={`${title}: ${formatCount(buckets.reduce((sum, bucket) => sum + valueOf(bucket), 0))} no período`}
            className="flex gap-[3px] border-b border-[var(--app-border)]"
            style={{ height: CHART_HEIGHT }}
          >
            {buckets.map((bucket, index) => (
              <div key={bucket.key} className="group relative h-full min-w-0 flex-1 rounded-t-[4px] hover:bg-[var(--app-surface-hover)]">
                <span
                  className={cn("absolute inset-x-0 bottom-0", bucket.key === bestKey ? "bg-primary" : NEUTRAL_SOFT, bucket.key !== bestKey && "group-hover:bg-[color-mix(in_srgb,var(--app-text-primary)_27%,transparent)]")}
                  style={{ height: `${(valueOf(bucket) / axisMax) * 100}%` }}
                />
                <div
                  className={cn(
                    "pointer-events-none absolute top-1.5 z-20 hidden w-40 rounded-[8px] bg-[var(--app-surface-solid)] p-2.5 text-[11px] font-light shadow-lg group-hover:block",
                    index > buckets.length / 2 ? "right-full mr-1" : "left-full ml-1",
                  )}
                >
                  <p className="mb-1 font-normal text-[var(--app-text-primary)]">{bucket.tooltip}</p>
                  {(metric === "sessions"
                    ? [["Sessões", bucket.sessions], ["Páginas vistas", bucket.views], ["Leads", bucket.leads]]
                    : [["Páginas vistas", bucket.views]]
                  ).map(([label, value]) => (
                    <p key={label} className="flex justify-between gap-2 tabular-nums text-[var(--app-text-secondary)]">
                      <span>{label}</span>
                      <span className="text-[var(--app-text-primary)]">{formatCount(Number(value))}</span>
                    </p>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex gap-[3px] text-[10px] font-light tabular-nums text-[var(--app-text-tertiary)]" aria-hidden="true">
            {buckets.map((bucket) => (
              <span key={bucket.key} className="min-w-0 flex-1 overflow-visible whitespace-nowrap">
                <span className={cn(bucket.showLabelOnPhone ? "" : "hidden sm:inline", !bucket.showLabel && "sm:hidden")}>{bucket.label}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </Panel>
  );
}
