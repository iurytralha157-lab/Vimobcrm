"use client";

import { useId, useMemo } from "react";
import type { TooltipContentProps } from "recharts";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { useIsMobile } from "@/hooks/use-mobile";

interface MarketingTrendPoint {
  date: string;
  leads: number;
  conversations: number;
  total: number;
}

interface ContinuousMarketingTrendPoint extends MarketingTrendPoint {
  hasSourceData: boolean;
}

interface MarketingTrendChartProps {
  data: MarketingTrendPoint[];
  dateFrom?: string;
  dateTo?: string;
  showLegend?: boolean;
  labels?: {
    primary: string;
    secondary: string;
  };
  ariaLabel?: string;
}

const DAY_IN_MS = 24 * 60 * 60 * 1_000;
const MAX_CONTINUOUS_DAYS = 366;
const compactNumberFormatter = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 0,
});
const fullDateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "long",
  year: "numeric",
});

function parseCalendarDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const [, year, month, day] = match;
  const timestamp = Date.UTC(Number(year), Number(month) - 1, Number(day));
  const parsed = new Date(timestamp);

  if (
    parsed.getUTCFullYear() !== Number(year) ||
    parsed.getUTCMonth() !== Number(month) - 1 ||
    parsed.getUTCDate() !== Number(day)
  ) {
    return null;
  }

  return timestamp;
}

function formatCalendarDate(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function safeMetric(value: number) {
  return Number.isFinite(value) ? value : 0;
}

/**
 * The API only returns dates with facts. The chart still needs the complete
 * selected calendar range, otherwise a missing day looks like an abrupt jump
 * and empty days at the beginning/end disappear from the axis.
 */
function buildContinuousSeries(
  data: MarketingTrendPoint[],
  dateFrom?: string,
  dateTo?: string,
) {
  const pointsByDate = new Map<string, ContinuousMarketingTrendPoint>();

  data.forEach((point) => {
    if (parseCalendarDate(point.date) === null) return;

    const current = pointsByDate.get(point.date);
    pointsByDate.set(point.date, {
      date: point.date,
      leads: safeMetric(point.leads) + (current?.leads ?? 0),
      conversations:
        safeMetric(point.conversations) + (current?.conversations ?? 0),
      total: safeMetric(point.total) + (current?.total ?? 0),
      hasSourceData: true,
    });
  });

  const populatedDates = Array.from(pointsByDate.keys()).sort();
  if (populatedDates.length === 0) return [];

  const firstFactTimestamp = parseCalendarDate(populatedDates[0]);
  const lastFactTimestamp = parseCalendarDate(populatedDates.at(-1) ?? "");
  const selectedStart = dateFrom ? parseCalendarDate(dateFrom) : null;
  const selectedEnd = dateTo ? parseCalendarDate(dateTo) : null;
  const hasValidSelectedRange =
    selectedStart !== null &&
    selectedEnd !== null &&
    selectedStart <= selectedEnd;
  const firstTimestamp = hasValidSelectedRange
    ? selectedStart
    : firstFactTimestamp;
  const lastTimestamp = hasValidSelectedRange ? selectedEnd : lastFactTimestamp;
  if (firstTimestamp === null || lastTimestamp === null) return [];

  const dayCount = Math.round((lastTimestamp - firstTimestamp) / DAY_IN_MS) + 1;
  if (dayCount > MAX_CONTINUOUS_DAYS) {
    return populatedDates.map((date) => pointsByDate.get(date)!);
  }

  return Array.from({ length: dayCount }, (_, index) => {
    const date = formatCalendarDate(firstTimestamp + index * DAY_IN_MS);
    return (
      pointsByDate.get(date) ?? {
        date,
        leads: 0,
        conversations: 0,
        total: 0,
        hasSourceData: false,
      }
    );
  });
}

function formatFullDate(value: string) {
  const timestamp = parseCalendarDate(value);
  return timestamp === null ? value : fullDateFormatter.format(timestamp);
}

function formatAxisDate(
  value: string,
  index: number,
  series: ContinuousMarketingTrendPoint[],
) {
  const timestamp = parseCalendarDate(value);
  if (timestamp === null) return value;

  const parsed = new Date(timestamp);
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const previousMonth = series[index - 1]?.date.slice(0, 7);
  const isBoundary =
    index === 0 ||
    index === series.length - 1 ||
    previousMonth !== value.slice(0, 7);

  return isBoundary ? `${day}/${month}` : day;
}

type MarketingTrendTooltipProps = Partial<
  Pick<TooltipContentProps<number, string>, "active" | "payload" | "label">
>;

function MarketingTrendTooltip({
  active,
  payload,
  label,
  labels,
}: MarketingTrendTooltipProps & {
  labels: { primary: string; secondary: string };
}) {
  if (!active || !payload?.length) return null;

  const values = new Map(
    payload.map((entry) => [String(entry.dataKey), Number(entry.value) || 0]),
  );
  const sourcePoint = payload[0]?.payload as
    ContinuousMarketingTrendPoint | undefined;

  return (
    <div className="min-w-[176px] rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-3 text-[var(--app-text-primary)] shadow-[0_8px_24px_rgba(0,0,0,0.08)]">
      <p className="mb-2 text-[11px] font-light capitalize text-[var(--app-text-secondary)]">
        {formatFullDate(String(label ?? ""))}
      </p>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-5">
          <span className="flex items-center gap-2 text-[11px] font-light text-[var(--app-text-tertiary)]">
            <span className="h-2 w-2 rounded-full bg-[var(--color-leads)]" />
            {labels.primary}
          </span>
          <span className="text-[11px] font-medium tabular-nums">
            {compactNumberFormatter.format(values.get("leads") ?? 0)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-5">
          <span className="flex items-center gap-2 text-[11px] font-light text-[var(--app-text-tertiary)]">
            <span className="h-2 w-2 rounded-full bg-[var(--color-conversations)]" />
            {labels.secondary}
          </span>
          <span className="text-[11px] font-medium tabular-nums">
            {compactNumberFormatter.format(values.get("conversations") ?? 0)}
          </span>
        </div>
      </div>

      {sourcePoint?.hasSourceData === false ? (
        <p className="mt-2 text-[10px] font-light text-[var(--app-text-tertiary)]">
          Sem aquisição registrada neste dia.
        </p>
      ) : null}
    </div>
  );
}

export function MarketingTrendChart({
  data,
  dateFrom,
  dateTo,
  showLegend = true,
  labels = { primary: "Leads", secondary: "Conversas" },
  ariaLabel = "Evolução diária de leads e conversas",
}: MarketingTrendChartProps) {
  const isMobile = useIsMobile();
  const series = useMemo(
    () => buildContinuousSeries(data, dateFrom, dateTo),
    [data, dateFrom, dateTo],
  );
  const chartId = useId().replace(/:/g, "");
  const leadsGradientId = `marketing-leads-fill-${chartId}`;
  const conversationsGradientId = `marketing-conversations-fill-${chartId}`;
  // Keep a complete monthly reading. Recharts' automatic spacing used to drop
  // isolated dates (for example day 30 while keeping 29 and 31), which made a
  // continuous range look incomplete. Up to one month we render every day;
  // longer periods remain automatically sampled for legibility.
  const showEveryDate = !isMobile && series.length <= 31;

  return (
    <div className="min-w-0">
      {showLegend ? (
        <div
          aria-hidden="true"
          className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[10px] font-light text-[var(--app-text-tertiary)]"
        >
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[var(--chart-1)]" />
            {labels.primary}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[var(--chart-2)]" />
            {labels.secondary}
          </span>
        </div>
      ) : null}

      <div className="min-w-0 overflow-hidden pb-1">
        <ChartContainer
          config={{
            leads: { label: labels.primary, color: "var(--chart-1)" },
            conversations: { label: labels.secondary, color: "var(--chart-2)" },
          }}
          className="h-[230px] min-h-[230px] w-full sm:h-[250px]"
          role="img"
          aria-label={ariaLabel}
        >
          <AreaChart
            accessibilityLayer
            data={series}
            margin={{ left: 0, right: 12, top: 10, bottom: 2 }}
          >
            <defs>
              <linearGradient id={leadsGradientId} x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--color-leads)"
                  stopOpacity={0.34}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-leads)"
                  stopOpacity={0}
                />
              </linearGradient>
              <linearGradient
                id={conversationsGradientId}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop
                  offset="5%"
                  stopColor="var(--color-conversations)"
                  stopOpacity={0.2}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-conversations)"
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
              dataKey="date"
              tickFormatter={(value, index) =>
                formatAxisDate(String(value), index, series)
              }
              tickLine={false}
              axisLine={false}
              tickMargin={10}
              minTickGap={18}
              interval={showEveryDate ? 0 : "preserveStartEnd"}
              height={28}
              tick={{
                fill: "var(--app-text-tertiary)",
                fontSize: showEveryDate && series.length > 20 ? 9 : 10,
                fontWeight: 300,
              }}
            />
            <YAxis
              allowDecimals={false}
              domain={[0, "auto"]}
              tickLine={false}
              axisLine={false}
              tickMargin={6}
              tickCount={5}
              width={34}
              tick={{
                fill: "var(--app-text-tertiary)",
                fontSize: 10,
                fontWeight: 300,
              }}
            />
            <ChartTooltip
              content={<MarketingTrendTooltip labels={labels} />}
              cursor={{
                stroke: "var(--app-border-strong)",
                strokeDasharray: "3 3",
              }}
              wrapperStyle={{ outline: "none" }}
            />
            <Area
              type="monotone"
              dataKey="leads"
              name={labels.primary}
              stroke="var(--color-leads)"
              strokeWidth={2}
              fill={`url(#${leadsGradientId})`}
              dot={false}
              activeDot={{
                r: 4,
                strokeWidth: 2,
                stroke: "var(--app-surface-solid)",
              }}
            />
            <Area
              type="monotone"
              dataKey="conversations"
              name={labels.secondary}
              stroke="var(--color-conversations)"
              strokeWidth={2}
              fill={`url(#${conversationsGradientId})`}
              dot={false}
              activeDot={{
                r: 4,
                strokeWidth: 2,
                stroke: "var(--app-surface-solid)",
              }}
            />
          </AreaChart>
        </ChartContainer>
      </div>
    </div>
  );
}
