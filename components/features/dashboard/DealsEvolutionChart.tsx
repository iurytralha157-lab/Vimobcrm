import { useCallback, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { DashboardChartTooltip } from './DashboardChartTooltip';
import { NEUTRAL_SOFT, NEUTRAL_STRONG } from '@/components/features/dashboard/dashboard-ui';
import { cn } from '@/lib/utils';
import { DashboardChartError } from './DashboardChartError';
import { dashboardEvolutionTickLayout, dashboardEvolutionTickLines, dashboardEvolutionTickWidth } from '@/components/features/dashboard/evolution-chart-model';

export interface DealsEvolutionPoint {
  date: string;
  ganhos: number;
  perdas: number;
  abertos: number;
}

interface DealsEvolutionChartProps {
  data: DealsEvolutionPoint[];
  isLoading?: boolean;
  isError: boolean;
  onRetry: () => void;
}

const SKELETON_BAR_HEIGHTS = [96, 128, 72, 112, 88, 136, 104];
const INITIAL_CHART_DIMENSION = { width: 600, height: 250 };
const chartTickStyle = {
  fill: 'var(--app-text-tertiary)',
  fontSize: 10,
  fontWeight: 300,
};

function ChartSkeleton() {
  return (
    <div className="space-y-3">
      <div className="flex justify-between items-end h-[200px] px-2">
        {SKELETON_BAR_HEIGHTS.map((height, i) => (
          <div key={i} className="flex flex-col items-center gap-1">
            <Skeleton
              className="w-8 rounded-t-sm"
              style={{ height: `${height}px` }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

type DealsTooltipPayloadEntry = {
  color?: string;
  fill?: string;
  name?: string | number;
  value?: string | number | null;
  [key: string]: unknown;
};

interface DealsTooltipProps {
  active?: boolean;
  payload?: DealsTooltipPayloadEntry[];
  label?: string;
}

function CustomTooltip(props: DealsTooltipProps) {
  return (
    <DashboardChartTooltip
      {...props}
      nameFormatter={(name) => {
        if (name === 'ganhos') return 'Ganhos';
        if (name === 'perdas') return 'Perdidos';
        return 'Em aberto';
      }}
    />
  );
}

/** Pick a nice Y-axis tick count based on available height and max value */
function getYTickCount(chartHeight: number, maxValue: number) {
  // Each tick label needs ~25px vertical space
  const maxTicks = Math.max(3, Math.floor(chartHeight / 25));
  // But don't exceed the data range granularity
  const dataTicks = Math.min(maxTicks, maxValue + 1);
  return Math.min(dataTicks, 12);
}

function isHourlyEvolution(data: DealsEvolutionPoint[]) {
  return data.length > 0 && data.every((point) => /^\d{2}:00$/.test(point.date));
}

function EvolutionAxisTick({ x = 0, y = 0, payload, chartWidth, hourly }: {
  x?: number;
  y?: number;
  payload?: { value?: string | number };
  chartWidth: number;
  hourly: boolean;
}) {
  const label = String(payload?.value ?? '');
  const lines = dashboardEvolutionTickLines(label, hourly);
  const halfWidth = dashboardEvolutionTickWidth(label, hourly) / 2;
  const anchor = x - halfWidth < 8 ? 'start' : x + halfWidth > chartWidth - 8 ? 'end' : 'middle';
  return <text data-evolution-tick="true" x={x} y={y} textAnchor={anchor} dominantBaseline="hanging" style={chartTickStyle} aria-label={label}>
    {lines.map((line, index) => <tspan key={index} x={x} dy={index === 0 ? 0 : 13}>{line}</tspan>)}
  </text>;
}

// Neutral volume with the accent on what was won, as in the Marketing reference.
const EVOLUTION_FILLS = {
  abertos: 'color-mix(in srgb, var(--app-text-primary) 11%, transparent)',
  perdas: 'color-mix(in srgb, var(--app-text-primary) 27%, transparent)',
  ganhos: 'var(--primary)',
};

const EVOLUTION_LEGEND = [
  { key: 'abertos', label: 'Em aberto', className: NEUTRAL_SOFT },
  { key: 'perdas', label: 'Perdidos', className: NEUTRAL_STRONG },
  { key: 'ganhos', label: 'Ganhos', className: 'bg-primary' },
] as const;

export function DealsEvolutionLegend({ className }: { className?: string }) {
  return (
    <ul className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-light text-[var(--app-text-secondary)]', className)}>
      {EVOLUTION_LEGEND.map((item) => (
        <li key={item.key} className="flex items-center gap-1.5">
          <span className={cn('h-2.5 w-2.5 rounded-[2px]', item.className)} aria-hidden="true" />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** Cards created in each interval, stacked by their current state. */
export function DealsEvolutionChart(props: DealsEvolutionChartProps) {
  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col rounded-[12px] bg-[var(--app-surface-solid)] p-4">
      <div className="mb-2 flex min-h-7 flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h3 className="text-[14px] font-normal leading-5 text-[var(--app-text-primary)]">Evolução de negócios</h3>
        <DealsEvolutionLegend />
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <DealsEvolutionBars {...props} />
      </div>
    </section>
  );
}

function DealsEvolutionBars({ data, isLoading, isError, onRetry }: DealsEvolutionChartProps) {
  const isMobile = useIsMobile();
  const [chartSize, setChartSize] = useState({ width: 600, height: 250 });

  const handleResize = useCallback((width: number, height: number) => {
    setChartSize({ width, height });
  }, []);

  if (isLoading) return <ChartSkeleton />;

  if (isError) {
    return <DashboardChartError message="Não foi possível carregar a evolução de negócios." onRetry={onRetry} />;
  }

  if (!data || data.length === 0) {
    return (
      <p className="flex min-h-[160px] flex-1 items-center justify-center text-center text-[12px] font-light text-[var(--app-text-secondary)]">
        Nenhum dado disponível para o período
      </p>
    );
  }

  const maxValue = Math.max(...data.map((d) => d.ganhos + d.perdas + d.abertos), 1);
  const hourlyEvolution = isHourlyEvolution(data);
  const tickLayout = dashboardEvolutionTickLayout(data.map((point) => point.date), chartSize.width, isMobile, hourlyEvolution);
  const yTickCount = getYTickCount(chartSize.height, maxValue);
  const barGap = data.length > 40 ? 1 : data.length > 20 ? 2 : 4;

  return (
    <div className="relative min-h-[160px] w-full flex-1" role="img" aria-label={`Evolução de negócios em ${data.length} intervalos: cards em aberto, perdidos e ganhos.`}>
      <ResponsiveContainer
        width="100%"
        height="100%"
        minWidth={1}
        minHeight={1}
        initialDimension={INITIAL_CHART_DIMENSION}
        onResize={handleResize}
      >
        <BarChart data={data} barCategoryGap={barGap} margin={{ top: 8, right: isMobile ? 4 : 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--app-border)" opacity={0.5} vertical={false} />
          <XAxis
            dataKey="date"
            axisLine={false}
            tickLine={false}
            tick={<EvolutionAxisTick chartWidth={chartSize.width} hourly={hourlyEvolution} />}
            tickMargin={6}
            interval={tickLayout.interval}
            height={tickLayout.height}
            minTickGap={5}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={chartTickStyle}
            tickMargin={4}
            width={isMobile ? 30 : 36}
            tickFormatter={(value: number) => value.toLocaleString('pt-BR', { notation: 'compact', maximumFractionDigits: 1 })}
            allowDecimals={false}
            tickCount={yTickCount}
            domain={[0, 'auto']}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--app-surface-hover)' }} />
          <Bar dataKey="ganhos" name="ganhos" stackId="cards" fill={EVOLUTION_FILLS.ganhos} isAnimationActive={false} />
          <Bar dataKey="perdas" name="perdas" stackId="cards" fill={EVOLUTION_FILLS.perdas} isAnimationActive={false} />
          <Bar dataKey="abertos" name="abertos" stackId="cards" fill={EVOLUTION_FILLS.abertos} radius={[3, 3, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
