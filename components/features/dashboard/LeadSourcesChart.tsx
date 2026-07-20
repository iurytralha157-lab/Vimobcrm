import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PieChart as PieChartIcon, MousePointer2 } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { cn } from '@/lib/utils';
import { sourceLabels } from '@/hooks/use-dashboard-filters';

interface SourceDataPoint {
  name: string;
  value: number;
  rawSource?: string;
}

interface LeadSourcesChartProps {
  data: SourceDataPoint[];
  isLoading?: boolean;
  selectedSource?: string | null;
  onSourceChange?: (source: string | null) => void;
}

interface LeadSourceChartPoint extends SourceDataPoint {
  percentage: number;
  color: string;
}

interface LeadSourcesTooltipEntry {
  value?: string | number;
  color?: string;
  fill?: string;
  name?: string;
  payload?: Partial<LeadSourceChartPoint>;
}

interface LeadSourcesTooltipProps {
  active?: boolean;
  payload?: LeadSourcesTooltipEntry[];
}

const COLORS = [
  'var(--primary)',
  '#7C3AED',
  '#3B82F6',
  '#10B981',
  '#F59E0B',
  '#EF4444',
  '#06B6D4',
];

function getTotalValueClassName(total: number) {
  const digits = Math.abs(total).toString().length;

  if (digits <= 3) return 'text-4xl sm:text-5xl';
  if (digits === 4) return 'text-3xl sm:text-4xl';
  if (digits === 5) return 'text-2xl sm:text-3xl';
  return 'text-xl sm:text-2xl';
}

function ChartSkeleton() {
  return (
    <div className="flex flex-col items-center justify-center h-full space-y-6 py-4">
      <div className="relative h-48 w-48 flex items-center justify-center">
        <Skeleton className="h-full w-full rounded-full" />
        <div className="absolute inset-0 flex items-center justify-center">
          <Skeleton className="h-16 w-16 rounded-full bg-background/50" />
        </div>
      </div>
      <div className="space-y-2 flex flex-col items-center">
        <Skeleton className="h-3 w-20 rounded" />
        <Skeleton className="h-8 w-12 rounded" />
      </div>
    </div>
  );
}

function LeadSourcesTooltip({ active, payload }: LeadSourcesTooltipProps) {
  if (!active || !payload?.length) return null;

  const entry = payload[0];
  const source = entry.payload;
  const percentage = source?.percentage ?? 0;
  const value = Number(entry.value || 0);
  const leadLabel = value === 1 ? 'lead' : 'leads';

  return (
    <div className="min-w-[150px] rounded-xl border-0 bg-[var(--app-surface-solid)] px-3 py-2.5 text-[var(--app-text-primary)] shadow-[0_8px_20px_rgba(0,0,0,0.18)] animate-in fade-in zoom-in-95 duration-150">
      <div className="mb-1 flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 rounded-full ring-2 ring-[var(--app-surface-solid)]"
          style={{ backgroundColor: source?.color || entry.color || entry.fill }}
        />
        <span className="truncate text-[11px] font-light text-[var(--app-text-secondary)]">
          {source?.name || entry.name}
        </span>
      </div>
      <div className="flex items-end justify-between gap-4">
        <span className="text-[11px] font-light text-[var(--app-text-tertiary)]">
          {value} {leadLabel}
        </span>
        <span className="rounded-full bg-[var(--app-surface-soft)] px-2 py-0.5 text-[11px] font-medium tabular-nums text-[var(--app-text-primary)]">
          {percentage}%
        </span>
      </div>
    </div>
  );
}

export function LeadSourcesChart({ data, isLoading, selectedSource, onSourceChange }: LeadSourcesChartProps) {
  if (isLoading) {
    return (
      <Card className="app-card overflow-hidden h-full flex flex-col">
        <CardHeader className="pb-1 pt-4 px-4">
          <CardTitle className="dashboard-card-title flex items-center gap-2 !text-[14px] !font-light !text-[var(--app-text-primary)]">
            <PieChartIcon className="h-4 w-4 text-primary" />
            Origem dos leads
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 p-4">
          <ChartSkeleton />
        </CardContent>
      </Card>
    );
  }

  const total = data.reduce((sum, item) => sum + item.value, 0);
  const totalValueClassName = getTotalValueClassName(total);
  const chartData = data
    .map(item => ({
      ...item,
      percentage: total > 0 ? Math.round((item.value / total) * 100) : 0,
    }))
    .sort((a, b) => b.value - a.value)
    .map((item, index) => ({
      ...item,
      color: COLORS[index % COLORS.length],
    }));

  const handleSourceClick = (entry: LeadSourceChartPoint) => {
    if (!onSourceChange) return;

    const clickedSource = entry.rawSource ?? entry.name;
    const clickedLabel = entry.name;
    const currentSelectedLabel = selectedSource ? (sourceLabels[selectedSource] || selectedSource) : null;

    if (clickedLabel === currentSelectedLabel) {
      onSourceChange(null);
    } else {
      onSourceChange(clickedSource);
    }
  };

  if (total === 0) {
    return (
      <Card className="app-card overflow-hidden h-full flex flex-col">
        <CardHeader className="pb-1 pt-4 px-4">
          <CardTitle className="dashboard-card-title flex items-center gap-2 !text-[14px] !font-light !text-[var(--app-text-primary)]">
            <PieChartIcon className="h-4 w-4 text-primary" />
            Origem dos leads
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 flex items-center justify-center p-8 text-center">
          <div className="space-y-2">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-white/[0.045]">
              <PieChartIcon className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-muted-foreground">Nenhum dado de origem disponível para este período</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="app-card overflow-hidden h-full flex flex-col">
      <CardHeader className="pb-0 pt-4 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="dashboard-card-title flex items-center gap-2 !text-[14px] !font-light !text-[var(--app-text-primary)]">
            <PieChartIcon className="h-3.5 w-3.5 text-primary" />
            Origem dos leads
          </CardTitle>
          {selectedSource && (
            <button
              onClick={() => onSourceChange?.(null)}
              className="text-[10px] font-bold text-primary hover:underline flex items-center gap-1"
            >
              <MousePointer2 className="h-2.5 w-2.5" />
              Limpar Filtro
            </button>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex-1 min-h-0 overflow-hidden p-4 pt-2 flex flex-col items-center justify-center">
        {/* Donut Chart Container */}
        <div className="flex min-h-0 w-full flex-1 items-center justify-center">
          <div className="dashboard-recharts-focusless relative min-h-0 min-w-[1px] max-w-full" style={{ width: 'min(100%, 280px)', height: 'min(100%, 280px)' }}>
            <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  innerRadius="60%"
                  outerRadius="95%"
                  paddingAngle={3}
                  dataKey="value"
                  animationBegin={0}
                  animationDuration={1200}
                  stroke="transparent"
                  strokeWidth={0}
                  className="outline-none"
                >
                  {chartData.map((entry, index) => {
                    const isSelected = selectedSource ? (sourceLabels[selectedSource] || selectedSource) === entry.name : false;
                    const hasSelection = !!selectedSource;

                    return (
                      <Cell
                        key={`cell-${index}`}
                        fill={entry.color}
                        opacity={hasSelection && !isSelected ? 0.35 : 1}
                        stroke="transparent"
                        strokeWidth={0}
                        className={cn(
                          "transition-all duration-300 hover:opacity-90 origin-center outline-none cursor-pointer",
                          isSelected && "drop-shadow-md scale-[1.02]"
                        )}
                        onClick={() => handleSourceClick(entry)}
                      />
                    );
                  })}
                </Pie>
                <Tooltip
                  content={<LeadSourcesTooltip />}
                  cursor={false}
                  position={{ x: 12, y: 10 }}
                  allowEscapeViewBox={{ x: true, y: true }}
                  wrapperStyle={{ zIndex: 30, pointerEvents: 'none' }}
                />
              </PieChart>
            </ResponsiveContainer>

            {/* Central text for Donut - Improved Hierarchy */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none z-0">
              <div className="relative flex max-w-[52%] items-center justify-center">
                <span
                  className={cn(
                    "max-w-full truncate font-medium leading-none text-[var(--app-text-primary)] tabular-nums drop-shadow-sm",
                    totalValueClassName,
                  )}
                >
                  {total}
                </span>
                <div className="absolute -bottom-1 left-1/2 h-1 w-8 -translate-x-1/2 rounded-full bg-[var(--app-surface-soft)] blur-[2px]" />
              </div>
              <span className="mt-1 text-[10px] font-light uppercase tracking-[0.2em] text-[var(--app-text-secondary)] sm:text-[11px]">
                Leads
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
