"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Activity } from "lucide-react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
} from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from "@/components/ui/chart";
import { useIsMobile } from "@/hooks/use-mobile";
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
  hourly: ScheduleDashboardHourlyPoint[];
  daily: ScheduleDashboardDailyPoint[];
  dateFrom: string;
  dateTo: string;
  dateBasis: ScheduleDashboardDateBasis;
};

type TooltipPayloadEntry = {
  color?: string;
  dataKey?: string | number;
  name?: string | number;
  payload?: AgendaAdaptiveChartPoint;
  value?: string | number;
};

const integerFormatter = new Intl.NumberFormat("pt-BR");
const fullDateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const monthFormatter = new Intl.DateTimeFormat("pt-BR", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const shortMonthFormatter = new Intl.DateTimeFormat("pt-BR", {
  month: "short",
  timeZone: "UTC",
});

function getGranularityLabel(granularity: AgendaAdaptiveChartGranularity) {
  if (granularity === "hourly") return "Por hora";
  if (granularity === "monthly") return "Por mês";
  return "Por dia";
}

function capitalize(value: string) {
  return value.charAt(0).toLocaleUpperCase("pt-BR") + value.slice(1);
}

function formatTooltipLabel(
  key: string,
  granularity: AgendaAdaptiveChartGranularity,
) {
  if (granularity === "hourly") {
    const hour = Number(key);
    const nextHour = (hour + 1) % 24;
    return `${String(hour).padStart(2, "0")}h às ${String(nextHour).padStart(2, "0")}h`;
  }

  const date = new Date(
    granularity === "monthly" ? `${key}-01T00:00:00Z` : `${key}T00:00:00Z`,
  );
  if (Number.isNaN(date.getTime())) return key;

  return capitalize(
    granularity === "monthly"
      ? monthFormatter.format(date)
      : fullDateFormatter.format(date),
  );
}

function formatAxisLabel(
  value: string,
  index: number,
  granularity: AgendaAdaptiveChartGranularity,
  points: AgendaAdaptiveChartPoint[],
) {
  if (granularity === "hourly") return `${value}h`;

  if (granularity === "monthly") {
    const date = new Date(`${value}-01T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return value;

    const month = shortMonthFormatter.format(date).replace(".", "");
    const previousYear = points[index - 1]?.key.slice(0, 4);
    const year = value.slice(2, 4);
    const showYear =
      index === 0 ||
      index === points.length - 1 ||
      previousYear !== value.slice(0, 4);

    return showYear ? `${month}/${year}` : month;
  }

  const day = value.slice(8, 10);
  const month = value.slice(5, 7);
  const previousMonth = points[index - 1]?.key.slice(0, 7);
  const showMonth =
    index === 0 ||
    index === points.length - 1 ||
    previousMonth !== value.slice(0, 7);

  return showMonth ? `${day}/${month}` : day;
}

export function getAgendaChartTickInterval(
  width: number,
  pointCount: number,
  granularity: AgendaAdaptiveChartGranularity,
  isMobile: boolean,
) {
  if (pointCount <= 1) return 0;
  if (granularity === "daily" && !isMobile && pointCount <= 31) return 0;

  const availableWidth = Math.max(width || (isMobile ? 360 : 760), 240) - 54;
  const labelWidth = granularity === "monthly" ? 62 : isMobile ? 48 : 40;
  const maxLabels = Math.max(2, Math.floor(availableWidth / labelWidth));

  return pointCount <= maxLabels
    ? 0
    : Math.max(1, Math.ceil(pointCount / maxLabels) - 1);
}

function AgendaAdaptiveTooltip({
  active,
  payload,
  granularity,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  granularity: AgendaAdaptiveChartGranularity;
}) {
  if (!active || !payload?.length) return null;

  const point = payload[0]?.payload;
  if (!point) return null;

  return (
    <div className="min-w-[184px] rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-3 text-[var(--app-text-primary)] shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
      <p className="mb-2 text-[11px] font-medium">
        {formatTooltipLabel(point.key, granularity)}
      </p>
      <div className="space-y-1.5">
        {payload.map((entry) => (
          <div
            key={String(entry.dataKey ?? entry.name)}
            className="flex items-center justify-between gap-5"
          >
            <span className="flex items-center gap-2 text-[10px] font-light text-[var(--app-text-tertiary)]">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              {String(entry.name ?? entry.dataKey ?? "")}
            </span>
            <span className="text-[11px] font-medium tabular-nums">
              {integerFormatter.format(Number(entry.value ?? 0))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AgendaAdaptiveChart({
  hourly,
  daily,
  dateFrom,
  dateTo,
  dateBasis,
}: AgendaAdaptiveChartProps) {
  const isMobile = useIsMobile();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const chartId = useId().replace(/:/g, "");
  const totalGradientId = `agenda-adaptive-total-${chartId}`;
  const completedGradientId = `agenda-adaptive-completed-${chartId}`;
  const model = useMemo(
    () =>
      buildAgendaAdaptiveChartModel({
        hourly,
        daily,
        dateFrom,
        dateTo,
      }),
    [daily, dateFrom, dateTo, hourly],
  );
  const totalLabel = getAgendaDashboardTotalLabels(dateBasis).chart;
  const chartConfig = useMemo(
    () =>
      ({
        total: { label: totalLabel, color: "var(--primary)" },
        completed: { label: "Realizados", color: "var(--success)" },
        open: { label: "Em aberto", color: "var(--chart-2)" },
        overdue: { label: "Em atraso", color: "var(--destructive)" },
        no_show: { label: "No-show", color: "var(--warning)" },
      }) satisfies ChartConfig,
    [totalLabel],
  );

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const updateWidth = () => {
      setContainerWidth(Math.floor(node.getBoundingClientRect().width));
    };
    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const tickInterval = getAgendaChartTickInterval(
    containerWidth,
    model.points.length,
    model.granularity,
    isMobile,
  );

  return (
    <section className="flex h-[360px] min-w-0 flex-col overflow-hidden rounded-[8px] bg-[var(--app-surface-solid)] shadow-none">
      <div className="px-4 pb-2 pt-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] bg-primary/10 text-primary">
              <Activity className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-[13px] font-normal text-[var(--app-text-primary)]">
                Evolução dos agendamentos
              </h2>
            </div>
          </div>
          <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-[9px] font-medium text-primary">
            {getGranularityLabel(model.granularity)}
          </span>
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-[9px] font-light text-[var(--app-text-tertiary)]">
          {Object.entries(chartConfig).map(([key, config]) => (
            <span key={key} className="inline-flex items-center gap-1.5">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: config.color }}
              />
              {config.label}
            </span>
          ))}
        </div>
      </div>

      <div className="min-h-0 min-w-0 flex-1 px-1 pb-2 sm:px-3">
        <ChartContainer
          ref={containerRef}
          config={chartConfig}
          className="h-full min-h-0 w-full aspect-auto"
          role="img"
          aria-label={`Evolução de ${totalLabel.toLocaleLowerCase("pt-BR")}, realizados, em aberto, em atraso e no-show ${getGranularityLabel(model.granularity).toLocaleLowerCase("pt-BR")}`}
        >
          <ComposedChart
            accessibilityLayer
            data={model.points}
            margin={{ left: -8, right: 10, top: 12, bottom: 2 }}
          >
            <defs>
              <linearGradient id={totalGradientId} x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--color-total)"
                  stopOpacity={0.34}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-total)"
                  stopOpacity={0}
                />
              </linearGradient>
              <linearGradient
                id={completedGradientId}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop
                  offset="5%"
                  stopColor="var(--color-completed)"
                  stopOpacity={0.16}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-completed)"
                  stopOpacity={0}
                />
              </linearGradient>
            </defs>
            <CartesianGrid
              vertical={false}
              stroke="var(--app-border)"
              strokeDasharray="3 3"
              strokeOpacity={0.8}
            />
            <XAxis
              dataKey="key"
              tickFormatter={(value, index) =>
                formatAxisLabel(
                  String(value),
                  index,
                  model.granularity,
                  model.points,
                )
              }
              tickLine={false}
              axisLine={false}
              tickMargin={9}
              minTickGap={5}
              interval={tickInterval}
              height={28}
              tick={{
                fill: "var(--app-text-tertiary)",
                fontSize:
                  model.granularity === "daily" && model.points.length > 20
                    ? 9
                    : 10,
                fontWeight: 300,
              }}
            />
            <YAxis
              allowDecimals={false}
              domain={[0, "auto"]}
              tickLine={false}
              axisLine={false}
              tickMargin={4}
              tickCount={5}
              width={34}
              tick={{
                fill: "var(--app-text-tertiary)",
                fontSize: 9,
                fontWeight: 300,
              }}
            />
            <ChartTooltip
              content={
                <AgendaAdaptiveTooltip granularity={model.granularity} />
              }
              cursor={{
                stroke: "var(--app-border-strong)",
                strokeDasharray: "3 3",
              }}
              wrapperStyle={{ outline: "none" }}
            />
            <Area
              type="monotone"
              dataKey="total"
              name={totalLabel}
              stroke="var(--color-total)"
              strokeWidth={2.25}
              fill={`url(#${totalGradientId})`}
              dot={false}
              activeDot={{
                r: 4,
                strokeWidth: 2,
                stroke: "var(--app-surface-solid)",
              }}
            />
            <Area
              type="monotone"
              dataKey="completed"
              name="Realizados"
              stroke="var(--color-completed)"
              strokeWidth={1.75}
              fill={`url(#${completedGradientId})`}
              dot={false}
              activeDot={{
                r: 4,
                strokeWidth: 2,
                stroke: "var(--app-surface-solid)",
              }}
            />
            <Line
              type="monotone"
              dataKey="open"
              name="Em aberto"
              stroke="var(--color-open)"
              strokeWidth={1.5}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="overdue"
              name="Em atraso"
              stroke="var(--color-overdue)"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="no_show"
              name="No-show"
              stroke="var(--color-no_show)"
              strokeWidth={1.5}
              strokeDasharray="2 4"
              dot={false}
            />
          </ComposedChart>
        </ChartContainer>
      </div>
    </section>
  );
}
