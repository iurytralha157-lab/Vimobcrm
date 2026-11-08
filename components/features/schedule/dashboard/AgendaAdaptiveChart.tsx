"use client";

import { useMemo } from "react";
import type { ReactNode } from "react";

import { NEUTRAL_SOFT, NEUTRAL_STRONG, Panel } from "@/components/features/marketing/marketing-ui";
import { niceAxisMax } from "@/components/features/marketing/marketing-format";
import { cn } from "@/lib/utils";
import type {
  ScheduleDashboardDailyPoint,
  ScheduleDashboardDateBasis,
  ScheduleDashboardHourlyPoint,
} from "@/lib/validation/schedule-dashboard";

import {
  buildAgendaAdaptiveChartModel,
  type AgendaAdaptiveChartGranularity,
  type AgendaAdaptiveChartPoint,
} from "./agenda-adaptive-chart-model";
import { getAgendaDashboardTotalLabels } from "./agenda-dashboard-model";

export type AgendaAdaptiveChartProps = {
  hourly: readonly ScheduleDashboardHourlyPoint[];
  daily: readonly ScheduleDashboardDailyPoint[];
  dateFrom: string;
  dateTo: string;
  dateBasis: ScheduleDashboardDateBasis;
  stats?: ReactNode;
};

const CHART_HEIGHT = 210;
const TITLES: Record<AgendaAdaptiveChartGranularity, string> = {
  hourly: "Compromissos por hora",
  daily: "Compromissos por dia",
  monthly: "Compromissos por mês",
};
const MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const WEEK_DAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function describePoint(point: AgendaAdaptiveChartPoint, granularity: AgendaAdaptiveChartGranularity) {
  if (granularity === "hourly") return { label: `${point.key}h`, tooltip: `${point.key}h` };
  if (granularity === "monthly") {
    const [year, month] = point.key.split("-").map(Number);
    return { label: MONTHS[month - 1], tooltip: `${MONTHS[month - 1]} de ${year}` };
  }
  const [year, month, day] = point.key.split("-").map(Number);
  const label = `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}`;
  return { label, tooltip: `${WEEK_DAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]}, ${label}` };
}

function LegendItem({ label, className }: { label: string; className: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className={cn("h-2.5 w-2.5 rounded-[2px]", className)} />
      {label}
    </span>
  );
}

export function AgendaAdaptiveChart({ hourly, daily, dateFrom, dateTo, dateBasis, stats }: AgendaAdaptiveChartProps) {
  const { granularity, points } = useMemo(
    () => buildAgendaAdaptiveChartModel({ hourly, daily, dateFrom, dateTo }),
    [daily, dateFrom, dateTo, hourly],
  );
  const stackOf = (point: AgendaAdaptiveChartPoint) => point.completed + point.open + point.cancelled + point.no_show;
  const axisMax = niceAxisMax(points.reduce((max, point) => Math.max(max, stackOf(point)), 0));
  const ticks = [4, 3, 2, 1, 0].map((step) => (axisMax / 4) * step);
  const labelStep = points.length > 16 ? Math.ceil(points.length / 10) : 1;
  const phoneLabelStep = points.length > 7 ? Math.ceil(points.length / 5) : 1;
  const totalLabel = getAgendaDashboardTotalLabels(dateBasis).chart;
  const total = points.reduce((sum, point) => sum + point.total, 0);

  return (
    <Panel
      title={TITLES[granularity]}
      aside={
        <span className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
          <LegendItem label="Realizados" className="bg-primary" />
          <LegendItem label="Em aberto" className={NEUTRAL_SOFT} />
          <LegendItem label="Cancelado ou faltou" className={NEUTRAL_STRONG} />
        </span>
      }
    >
      {stats}
      <div className="mt-4 grid grid-cols-[28px_minmax(0,1fr)] gap-1.5">
        <div
          className="relative text-[11px] font-light tabular-nums text-[var(--app-text-tertiary)]"
          style={{ height: CHART_HEIGHT }}
          aria-hidden="true"
        >
          {ticks.map((tick, index) => (
            <span key={tick} className="absolute right-0 -translate-y-1/2" style={{ top: `${(index / 4) * 100}%` }}>
              {tick.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}
            </span>
          ))}
        </div>
        <div className="min-w-0">
          <div
            role="img"
            aria-label={`${TITLES[granularity]}: ${total.toLocaleString("pt-BR")} no período`}
            className="flex gap-px border-b border-[var(--app-border)] sm:gap-[3px]"
            style={{ height: CHART_HEIGHT }}
          >
            {points.map((point, index) => {
              const { tooltip } = describePoint(point, granularity);
              const closedOut = point.cancelled + point.no_show;
              return (
                <div key={point.key} className="group relative flex h-full min-w-0 flex-1 flex-col justify-end rounded-t-[3px] hover:bg-[var(--app-surface-hover)]">
                  <span className={NEUTRAL_STRONG} style={{ height: `${(closedOut / axisMax) * 100}%` }} />
                  <span className={NEUTRAL_SOFT} style={{ height: `${(point.open / axisMax) * 100}%` }} />
                  <span className="bg-primary" style={{ height: `${(point.completed / axisMax) * 100}%` }} />
                  <div
                    className={cn(
                      "pointer-events-none absolute top-1.5 z-20 hidden w-40 rounded-[8px] bg-[var(--app-surface-solid)] p-2.5 text-[11px] font-light shadow-lg group-hover:block",
                      index > points.length / 2 ? "right-full mr-1" : "left-full ml-1",
                    )}
                  >
                    <p className="mb-1 font-normal text-[var(--app-text-primary)]">{tooltip}</p>
                    {[
                      [totalLabel, point.total],
                      ["Realizados", point.completed],
                      ["Em aberto", point.open],
                      ["Em atraso", point.overdue],
                      ["Cancelados", point.cancelled],
                      ["Não compareceu", point.no_show],
                    ].map(([label, value]) => (
                      <p key={label} className="flex justify-between gap-2 tabular-nums text-[var(--app-text-secondary)]">
                        <span>{label}</span>
                        <span className="text-[var(--app-text-primary)]">{Number(value).toLocaleString("pt-BR")}</span>
                      </p>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-1.5 flex gap-px text-[10px] font-light tabular-nums text-[var(--app-text-tertiary)] sm:gap-[3px]" aria-hidden="true">
            {points.map((point, index) => (
              <span key={point.key} className="min-w-0 flex-1 overflow-visible whitespace-nowrap">
                <span className={cn(index % phoneLabelStep === 0 ? "" : "hidden sm:inline", index % labelStep !== 0 && "sm:hidden")}>
                  {describePoint(point, granularity).label}
                </span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </Panel>
  );
}
