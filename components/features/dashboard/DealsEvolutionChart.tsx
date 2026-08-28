import { useCallback, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { DashboardChartTooltip } from './DashboardChartTooltip';
import { DASHBOARD_DEAL_EVOLUTION_COLORS } from '@/config/dashboard-chart-colors';

export interface DealsEvolutionPoint {
  date: string;
  ganhos: number;
  perdas: number;
  abertos: number;
}

interface DealsEvolutionChartProps {
  data: DealsEvolutionPoint[];
  isLoading?: boolean;
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
        if (name === 'perdas') return 'Perdas';
        return 'Em Aberto';
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

/** Compute X-axis interval so labels don't overlap. ~45px per label. */
function getXInterval(chartWidth: number, totalPoints: number) {
  // We want to show as many labels as possible without overlap
  // For ~30 points (one month), we can show every 3rd or 4th label on small screens
  // and more on large screens.
  const labelWidth = 45;
  const maxLabels = Math.max(2, Math.floor(chartWidth / labelWidth));
  if (totalPoints <= maxLabels) return 0; // show all
  return Math.ceil(totalPoints / maxLabels) - 1;
}

function isHourlyEvolution(data: DealsEvolutionPoint[]) {
  return data.length > 0 && data.every((point) => /^\d{2}:00$/.test(point.date));
}

function getHourlyXInterval(chartWidth: number, isMobile: boolean) {
  if (isMobile) return 3;
  if (chartWidth < 560) return 3;
  if (chartWidth < 820) return 2;
  return 1;
}

function formatHourlyTick(value: string | number) {
  return String(value).replace(':00', 'h');
}

export function DealsEvolutionChart({ data, isLoading }: DealsEvolutionChartProps) {
  const isMobile = useIsMobile();
  const [chartSize, setChartSize] = useState({ width: 600, height: 250 });

  const handleResize = useCallback((width: number, height: number) => {
    setChartSize({ width, height });
  }, []);

  if (isLoading) {
    return (
      <Card className="flex h-full flex-col overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
        <CardHeader className="px-4 pb-2 pt-4">
          <CardTitle className="flex items-center gap-2 text-[14px] font-normal text-[var(--app-text-primary)]">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
              <TrendingUp className="h-3.5 w-3.5" />
            </span>
            Evolução de Negócios
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1">
          <ChartSkeleton />
        </CardContent>
      </Card>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card className="flex h-full flex-col overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
        <CardHeader className="px-4 pb-2 pt-4">
          <CardTitle className="flex items-center gap-2 text-[14px] font-normal text-[var(--app-text-primary)]">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
              <TrendingUp className="h-3.5 w-3.5" />
            </span>
            Evolução de Negócios
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 flex items-center justify-center">
          <div className="py-8 text-center">
            <span className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
              <TrendingUp className="h-3.5 w-3.5" />
            </span>
            <p className="text-[12px] font-light text-[var(--app-text-secondary)]">
              Nenhum dado disponível
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const maxValue = Math.max(...data.map(d => Math.max(d.ganhos, d.perdas, d.abertos)), 1);
  const hourlyEvolution = isHourlyEvolution(data);
  const tickInterval = hourlyEvolution
    ? getHourlyXInterval(chartSize.width, isMobile)
    : getXInterval(chartSize.width, data.length);
  const yTickCount = getYTickCount(chartSize.height, maxValue);

  return (
    <Card className="flex h-full flex-col overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
      <CardHeader className="px-4 pb-2 pt-4">
        <CardTitle className="flex items-center gap-2 text-[14px] font-normal text-[var(--app-text-primary)]">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
            <TrendingUp className="h-3.5 w-3.5" />
          </span>
          Evolução de Negócios
        </CardTitle>
      </CardHeader>
      <CardContent className="pb-3 flex-1 flex flex-col px-0">
        {/* Chart */}
        <div className="dashboard-recharts-focusless relative min-h-[200px] w-full flex-1">
          <ResponsiveContainer
            width="100%"
            height="100%"
            minWidth={1}
            minHeight={1}
            initialDimension={INITIAL_CHART_DIMENSION}
            onResize={handleResize}
          >
            <AreaChart
              data={data}
              margin={{
                top: 10,
                right: isMobile ? 10 : 40,
                left: isMobile ? -4 : 0,
                bottom: 0
              }}
            >
              <defs>
                <linearGradient id="gradientGanhos" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={DASHBOARD_DEAL_EVOLUTION_COLORS.won} stopOpacity={0.4} />
                  <stop offset="95%" stopColor={DASHBOARD_DEAL_EVOLUTION_COLORS.won} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradientPerdas" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={DASHBOARD_DEAL_EVOLUTION_COLORS.lost} stopOpacity={0.4} />
                  <stop offset="95%" stopColor={DASHBOARD_DEAL_EVOLUTION_COLORS.lost} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradientAbertos" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={DASHBOARD_DEAL_EVOLUTION_COLORS.open} stopOpacity={0.4} />
                  <stop offset="95%" stopColor={DASHBOARD_DEAL_EVOLUTION_COLORS.open} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--app-border)"
                opacity={0.18}
                vertical={false}
              />
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                tick={chartTickStyle}
                tickFormatter={hourlyEvolution ? formatHourlyTick : undefined}
                tickMargin={8}
                interval={tickInterval}
                minTickGap={5}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={chartTickStyle}
                tickMargin={4}
                width={isMobile ? 32 : 45}
                allowDecimals={false}
                tickCount={yTickCount}
                domain={[0, 'auto']}
              />
              <Tooltip content={<CustomTooltip />} cursor={false} />
              <Area
                type="monotone"
                dataKey="abertos"
                name="abertos"
                stroke={DASHBOARD_DEAL_EVOLUTION_COLORS.open}
                strokeWidth={2}
                fill="url(#gradientAbertos)"
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--app-surface-solid)' }}
              />
              <Area
                type="monotone"
                dataKey="ganhos"
                name="ganhos"
                stroke={DASHBOARD_DEAL_EVOLUTION_COLORS.won}
                strokeWidth={2}
                fill="url(#gradientGanhos)"
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--app-surface-solid)' }}
              />
              <Area
                type="monotone"
                dataKey="perdas"
                name="perdas"
                stroke={DASHBOARD_DEAL_EVOLUTION_COLORS.lost}
                strokeWidth={2}
                fill="url(#gradientPerdas)"
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--app-surface-solid)' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
