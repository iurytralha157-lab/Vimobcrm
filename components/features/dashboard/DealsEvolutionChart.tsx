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
const chartTickStyle = {
  fill: 'var(--app-text-tertiary)',
  fontSize: 11,
  fontWeight: 500,
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
      <div className="flex justify-center gap-6">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-16" />
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

export function DealsEvolutionChart({ data, isLoading }: DealsEvolutionChartProps) {
  const isMobile = useIsMobile();
  const [chartSize, setChartSize] = useState({ width: 600, height: 250 });

  const handleResize = useCallback((width: number, height: number) => {
    setChartSize({ width, height });
  }, []);

  if (isLoading) {
    return (
      <Card className="app-card overflow-hidden h-full flex flex-col">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
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
      <Card className="app-card overflow-hidden h-full flex flex-col">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            Evolução de Negócios
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 flex items-center justify-center">
          <div className="text-center py-8">
            <TrendingUp className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              Nenhum dado disponível
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Calculate totals for the legend
  const totals = data.reduce(
    (acc, item) => ({
      ganhos: acc.ganhos + item.ganhos,
      perdas: acc.perdas + item.perdas,
      abertos: acc.abertos + item.abertos,
    }),
    { ganhos: 0, perdas: 0, abertos: 0 }
  );

  const maxValue = Math.max(...data.map(d => Math.max(d.ganhos, d.perdas, d.abertos)), 1);
  const tickInterval = getXInterval(chartSize.width, data.length);
  const yTickCount = getYTickCount(chartSize.height, maxValue);

  return (
    <Card className="app-card overflow-hidden h-full flex flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          Evolução de Negócios
        </CardTitle>
      </CardHeader>
      <CardContent className="pb-2 flex-1 flex flex-col px-0">
        {/* Chart */}
        <div className="flex-1 w-full relative">
          <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1} onResize={handleResize}>
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
                  <stop offset="5%" stopColor="#22C55E" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#22C55E" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradientPerdas" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#EF4444" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#EF4444" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradientAbertos" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
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
                tickMargin={8}
                interval={tickInterval}
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
              <Tooltip content={<CustomTooltip />} />
              <Area
                type="monotone"
                dataKey="abertos"
                name="abertos"
                stroke="#3B82F6"
                strokeWidth={2}
                fill="url(#gradientAbertos)"
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }}
              />
              <Area
                type="monotone"
                dataKey="ganhos"
                name="ganhos"
                stroke="#22C55E"
                strokeWidth={2}
                fill="url(#gradientGanhos)"
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }}
              />
              <Area
                type="monotone"
                dataKey="perdas"
                name="perdas"
                stroke="#EF4444"
                strokeWidth={2}
                fill="url(#gradientPerdas)"
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Legend with totals */}
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 pt-3 mt-2">
          <div className="flex items-center gap-2 whitespace-nowrap">
            <div className="w-3 h-3 rounded-full bg-[#22C55E]" />
            <span className="text-xs text-muted-foreground">Ganhos</span>
            <span className="text-xs font-semibold text-foreground">{totals.ganhos}</span>
          </div>
          <div className="flex items-center gap-2 whitespace-nowrap">
            <div className="w-3 h-3 rounded-full bg-[#EF4444]" />
            <span className="text-xs text-muted-foreground">Perdas</span>
            <span className="text-xs font-semibold text-foreground">{totals.perdas}</span>
          </div>
          <div className="flex items-center gap-2 whitespace-nowrap">
            <div className="w-3 h-3 rounded-full bg-[#3B82F6]" />
            <span className="text-xs text-muted-foreground">Em Aberto</span>
            <span className="text-xs font-semibold text-foreground">{totals.abertos}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
