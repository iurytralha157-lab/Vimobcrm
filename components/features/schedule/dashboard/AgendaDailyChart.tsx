"use client";

import { useMemo } from "react";
import { eachDayOfInterval, format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import type {
  ScheduleDashboardDailyPoint,
  ScheduleDashboardDateBasis,
} from "@/lib/validation/schedule-dashboard";

import { getAgendaDashboardTotalLabels } from "./agenda-dashboard-model";

type AgendaDailyChartProps = {
  data: ScheduleDashboardDailyPoint[];
  dateFrom: string;
  dateTo: string;
  dateBasis: ScheduleDashboardDateBasis;
};

const CHART_CONFIG = {
  remaining: { label: "Demais compromissos", color: "color-mix(in srgb, var(--app-text-primary) 18%, transparent)" },
  completed: { label: "Realizados", color: "var(--success)" },
  overdue: { label: "Em atraso", color: "var(--destructive)" },
} satisfies ChartConfig;

export function AgendaDailyChartLegend() {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1">
      {Object.entries(CHART_CONFIG).map(([key, config]) => (
        <li key={key} className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5 rounded-[2px]" style={{ backgroundColor: config.color }} />
          {config.label}
        </li>
      ))}
    </ul>
  );
}

function formatAxisDate(value: string) {
  return format(parseISO(value), "dd/MM", { locale: ptBR });
}

function buildContinuousSeries(data: ScheduleDashboardDailyPoint[], dateFrom: string, dateTo: string) {
  const points = new Map(data.map((point) => [point.date, point]));
  const days = eachDayOfInterval({ start: parseISO(dateFrom), end: parseISO(dateTo) });
  return days.map((date) => {
    const key = format(date, "yyyy-MM-dd");
    const { total = 0, completed = 0, overdue = 0 } = points.get(key) ?? {};
    return { date: key, total, completed, overdue, remaining: total - completed - overdue };
  });
}

type DailyPoint = ReturnType<typeof buildContinuousSeries>[number];

function getPeak(points: DailyPoint[], metric: "completed" | "overdue") {
  const maximum = Math.max(0, ...points.map((point) => point[metric]));
  if (maximum === 0) return null;
  const peakDates = points.filter((point) => point[metric] === maximum);
  return {
    maximum,
    firstDate: formatAxisDate(peakDates[0].date),
    tiedDays: peakDates.length - 1,
  };
}

function AgendaDailyTooltip({
  active,
  payload,
  totalLabel,
}: {
  active?: boolean;
  payload?: Array<{ payload?: DailyPoint }>;
  totalLabel: string;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;

  return (
    <div className="min-w-[150px] rounded-[8px] bg-[var(--app-surface-solid)] p-3 text-[var(--app-text-primary)] shadow-lg">
      <p className="mb-2 text-[12px] font-medium">
        {format(parseISO(point.date), "dd 'de' MMMM", { locale: ptBR })}
      </p>
      <dl className="space-y-1 text-[12px]">
        {[
          [totalLabel, point.total],
          ["Realizados", point.completed],
          ["Em atraso", point.overdue],
        ].map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4">
            <dt className="text-[var(--app-text-secondary)]">{label}</dt>
            <dd className="tabular-nums">{Number(value).toLocaleString("pt-BR")}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function AgendaDailyChart({ data, dateFrom, dateTo, dateBasis }: AgendaDailyChartProps) {
  const series = useMemo(() => buildContinuousSeries(data, dateFrom, dateTo), [data, dateFrom, dateTo]);
  const totalLabel = getAgendaDashboardTotalLabels(dateBasis).chart;
  const peakMetrics = [
    { label: "Mais realizações", peak: getPeak(series, "completed") },
    { label: "Mais atrasos", peak: getPeak(series, "overdue") },
  ];

  return (
    <>
      <ChartContainer
        config={CHART_CONFIG}
        className="h-[242px] w-full aspect-auto"
        aria-label="Compromissos por dia, realizados e em atraso"
      >
        <BarChart accessibilityLayer data={series} maxBarSize={36} margin={{ top: 4, left: -12, right: 8, bottom: 3 }}>
          <CartesianGrid vertical={false} stroke="var(--app-border)" />
          <XAxis
            dataKey="date"
            tickFormatter={formatAxisDate}
            tickLine={false}
            axisLine={false}
            minTickGap={24}
            tickMargin={8}
            tick={{ fill: "var(--app-text-secondary)", fontSize: 11 }}
          />
          <YAxis
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            width={38}
            tick={{ fill: "var(--app-text-secondary)", fontSize: 11 }}
          />
          <ChartTooltip content={<AgendaDailyTooltip totalLabel={totalLabel} />} />
          <Bar dataKey="remaining" stackId="daily" fill="var(--color-remaining)" isAnimationActive={false} />
          <Bar dataKey="completed" stackId="daily" fill="var(--color-completed)" isAnimationActive={false} />
          <Bar dataKey="overdue" stackId="daily" fill="var(--color-overdue)" isAnimationActive={false} />
        </BarChart>
      </ChartContainer>
      <ul className="flex flex-wrap gap-x-4 gap-y-2 text-[12px] text-[var(--app-text-secondary)]">
        {peakMetrics.map(({ label, peak }) => peak && (
          <li key={label}>
            {label} em <span className="font-medium text-[var(--app-text-primary)]">{peak.firstDate} ({peak.maximum.toLocaleString("pt-BR")})</span>
            {peak.tiedDays > 0 ? ` · empate com ${peak.tiedDays} ${peak.tiedDays === 1 ? "dia" : "dias"}` : null}
          </li>
        ))}
      </ul>
    </>
  );
}
