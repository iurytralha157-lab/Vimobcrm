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
    <div className="app-card min-w-[150px] px-3 py-2.5 shadow-xl shadow-black/20 animate-in fade-in zoom-in-95 duration-150">
      <div className="mb-1 flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 rounded-full ring-2 ring-[var(--app-surface-solid)]"
          style={{ backgroundColor: source?.color || entry.color || entry.fill }}
        />
        <span className="truncate text-xs font-semibold text-foreground">
          {source?.name || entry.name}
        </span>
      </div>
      <div className="flex items-end justify-between gap-4">
        <span className="text-[11px] text-muted-foreground">
          {value} {leadLabel}
        </span>
        <span className="rounded-full bg-white/[0.055] px-2 py-0.5 text-[11px] font-bold tabular-nums text-foreground">
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
          <CardTitle className="text-sm font-semibold flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
            <PieChartIcon className="h-4 w-4 text-primary" />
            Origem dos Leads
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 p-4">
          <ChartSkeleton />
        </CardContent>
      </Card>
    );
  }

  const total = data.reduce((sum, item) => sum + item.value, 0);
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
          <CardTitle className="text-sm font-semibold flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
            <PieChartIcon className="h-4 w-4 text-primary" />
            Origem dos Leads
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
          <CardTitle className="text-xs font-semibold flex items-center gap-2 uppercase tracking-widest text-muted-foreground">
            <PieChartIcon className="h-3.5 w-3.5 text-primary" />
            Origem dos Leads
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

      <CardContent className="flex-1 p-4 pt-2 flex flex-col items-center justify-center">
        {/* Donut Chart Container */}
        <div className="w-full aspect-square max-w-[280px] relative mt-2">
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
                      stroke={isSelected ? "white" : "transparent"}
                      strokeWidth={isSelected ? 2 : 0}
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
            <span className="text-[10px] sm:text-[11px] uppercase font-bold text-muted-foreground/70 tracking-[0.2em] mb-0.5">
              Leads
            </span>
            <div className="relative">
              <span className="text-4xl sm:text-5xl font-black text-foreground tracking-tighter tabular-nums drop-shadow-sm">
                {total}
              </span>
              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-8 h-1 bg-primary/20 rounded-full blur-[2px]" />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
