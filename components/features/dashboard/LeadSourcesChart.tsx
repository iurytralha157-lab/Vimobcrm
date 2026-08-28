import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PieChart as PieChartIcon, MousePointer2 } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { cn } from '@/lib/utils';
import { sourceLabels } from '@/hooks/use-dashboard-filters';
import { DASHBOARD_CHART_COLORS } from '@/config/dashboard-chart-colors';

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

const INITIAL_CHART_DIMENSION = { width: 240, height: 240 };

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
    <div className="min-w-[150px] rounded-[8px] border-0 bg-[var(--app-surface-solid)] px-3 py-2.5 text-[var(--app-text-primary)] shadow-none animate-in fade-in zoom-in-95 duration-150">
      <div className="mb-1 flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 rounded-[4px] ring-2 ring-[var(--app-surface-solid)]"
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
        <span className="rounded-[6px] bg-[var(--app-surface-soft)] px-2 py-0.5 text-[11px] font-light tabular-nums text-[var(--app-text-primary)]">
          {percentage}%
        </span>
      </div>
    </div>
  );
}

export function LeadSourcesChart({ data, isLoading, selectedSource, onSourceChange }: LeadSourcesChartProps) {
  if (isLoading) {
    return (
      <Card className="flex h-full flex-col overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
        <CardHeader className="px-4 pb-1 pt-4">
          <CardTitle className="flex items-center gap-2 text-[14px] font-light text-[var(--app-text-primary)]">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
              <PieChartIcon className="h-3.5 w-3.5" />
            </span>
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
      color: DASHBOARD_CHART_COLORS[index % DASHBOARD_CHART_COLORS.length],
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
      <Card className="flex h-full flex-col overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
        <CardHeader className="px-4 pb-1 pt-4">
          <CardTitle className="flex items-center gap-2 text-[14px] font-light text-[var(--app-text-primary)]">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
              <PieChartIcon className="h-3.5 w-3.5" />
            </span>
            Origem dos leads
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 flex items-center justify-center p-8 text-center">
          <div className="space-y-2">
            <div className="mx-auto flex h-8 w-8 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
              <PieChartIcon className="h-3.5 w-3.5" />
            </div>
            <p className="text-[12px] font-light text-[var(--app-text-secondary)]">Nenhum dado de origem disponível para este período</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="flex h-full flex-col overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
      <CardHeader className="px-4 pb-0 pt-4">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-[14px] font-light text-[var(--app-text-primary)]">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
              <PieChartIcon className="h-3.5 w-3.5" />
            </span>
            Origem dos leads
          </CardTitle>
          {selectedSource && (
            <button
              onClick={() => onSourceChange?.(null)}
              className="flex items-center gap-1 rounded-[6px] bg-[var(--app-surface-soft)] px-2 py-1 text-[10px] font-light text-[var(--app-text-secondary)] transition-colors hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]"
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
            <ResponsiveContainer
              width="100%"
              height="100%"
              minWidth={1}
              minHeight={1}
              initialDimension={INITIAL_CHART_DIMENSION}
            >
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
                          "cursor-pointer outline-none transition-opacity duration-200 hover:opacity-90 focus-visible:opacity-80",
                        )}
                        role="button"
                        tabIndex={0}
                        aria-label={`Filtrar por ${entry.name}: ${entry.value} ${entry.value === 1 ? 'lead' : 'leads'}`}
                        onClick={() => handleSourceClick(entry)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            handleSourceClick(entry);
                          }
                        }}
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
                    "max-w-full truncate font-normal leading-none text-[var(--app-text-primary)] tabular-nums",
                    totalValueClassName,
                  )}
                >
                  {total}
                </span>
                <div className="absolute -bottom-1 left-1/2 h-1 w-8 -translate-x-1/2 rounded-[4px] bg-[var(--app-surface-soft)]" />
              </div>
              <span className="mt-1 text-[10px] font-light text-[var(--app-text-secondary)] sm:text-[11px]">
                Leads
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
