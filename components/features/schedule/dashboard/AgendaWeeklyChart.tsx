"use client";

import { useId, useMemo } from "react";
import type { ReactNode } from "react";
import {
  eachWeekOfInterval,
  endOfWeek,
  format,
  parseISO,
  startOfWeek,
} from "date-fns";
import { ptBR } from "date-fns/locale";
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
import type {
  ScheduleDashboardDateBasis,
  ScheduleDashboardWeeklyPoint,
} from "@/lib/validation/schedule-dashboard";

const integerFormatter = new Intl.NumberFormat("pt-BR");

type AgendaWeeklyChartProps = {
  data: ScheduleDashboardWeeklyPoint[];
  dateFrom: string;
  dateTo: string;
  dateBasis: ScheduleDashboardDateBasis;
  action?: ReactNode;
};

type TooltipPayloadEntry = {
  color?: string;
  dataKey?: string | number;
  name?: string | number;
  value?: string | number;
};

function getBasisLabel(dateBasis: ScheduleDashboardDateBasis) {
  if (dateBasis === "created_at") return "criados";
  if (dateBasis === "completed_at") return "com desfecho";
  return "marcados";
}

function getTotalLabel(dateBasis: ScheduleDashboardDateBasis) {
  if (dateBasis === "created_at") return "Criados";
  if (dateBasis === "completed_at") return "Com desfecho";
  return "Agendados";
}

function buildContinuousWeeks(
  data: ScheduleDashboardWeeklyPoint[],
  dateFrom: string,
  dateTo: string,
) {
  const points = new Map(data.map((point) => [point.week_start, point]));
  const start = startOfWeek(parseISO(dateFrom), { weekStartsOn: 1 });

  return eachWeekOfInterval(
    { start, end: parseISO(dateTo) },
    { weekStartsOn: 1 },
  ).map((date) => {
    const key = format(date, "yyyy-MM-dd");
    return (
      points.get(key) ?? {
        week_start: key,
        week_end: format(endOfWeek(date, { weekStartsOn: 1 }), "yyyy-MM-dd"),
        total: 0,
        open: 0,
        completed: 0,
        cancelled: 0,
        no_show: 0,
        overdue: 0,
      }
    );
  });
}

function formatWeek(value: string) {
  return format(parseISO(value), "dd 'de' MMM", { locale: ptBR });
}

function AgendaWeeklyTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
}) {
  if (!active || !payload?.length || !label) return null;

  return (
    <div className="min-w-[184px] rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-3 text-[var(--app-text-primary)] shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
      <p className="mb-2 text-[11px] font-medium">
        Semana de {formatWeek(label)}
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

export function AgendaWeeklyChart({
  data,
  dateFrom,
  dateTo,
  dateBasis,
  action,
}: AgendaWeeklyChartProps) {
  const id = useId().replace(/:/g, "");
  const totalGradientId = `agenda-week-total-${id}`;
  const completedGradientId = `agenda-week-completed-${id}`;
  const series = useMemo(
    () => buildContinuousWeeks(data, dateFrom, dateTo),
    [data, dateFrom, dateTo],
  );
  const basisLabel = getBasisLabel(dateBasis);
  const totalLabel = getTotalLabel(dateBasis);
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

  return (
    <section className="flex h-[360px] min-w-0 flex-col overflow-hidden rounded-[8px] bg-[var(--app-surface-solid)] shadow-none">
      <div className="px-4 pb-2 pt-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-[7px] bg-primary/10 text-primary">
              <Activity className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-[13px] font-normal text-[var(--app-text-primary)]">
                Evolução semanal
              </h2>
              <p className="text-[9px] font-light text-[var(--app-text-tertiary)]">
                Compromissos {basisLabel} e seus desfechos no período
              </p>
            </div>
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
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
          config={chartConfig}
          className="h-full min-h-0 w-full aspect-auto"
          role="img"
          aria-label="Evolução semanal de agendamentos, realizações, pendências, atrasos e no-shows"
        >
          <ComposedChart
            accessibilityLayer
            data={series}
            margin={{ left: -8, right: 10, top: 12, bottom: 2 }}
          >
            <defs>
              <linearGradient id={totalGradientId} x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--color-total)"
                  stopOpacity={0.3}
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
              strokeOpacity={0.7}
            />
            <XAxis
              dataKey="week_start"
              tickFormatter={(value: string) =>
                format(parseISO(value), "dd/MM")
              }
              tickLine={false}
              axisLine={false}
              tickMargin={9}
              minTickGap={18}
              interval="preserveStartEnd"
              tick={{
                fill: "var(--app-text-tertiary)",
                fontSize: 9,
                fontWeight: 300,
              }}
            />
            <YAxis
              allowDecimals={false}
              domain={[0, "auto"]}
              tickLine={false}
              axisLine={false}
              tickMargin={4}
              width={34}
              tick={{
                fill: "var(--app-text-tertiary)",
                fontSize: 9,
                fontWeight: 300,
              }}
            />
            <ChartTooltip
              content={<AgendaWeeklyTooltip />}
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
              strokeWidth={2}
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
              strokeWidth={2}
              fill={`url(#${completedGradientId})`}
              dot={false}
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
