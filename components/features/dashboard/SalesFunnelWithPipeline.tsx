import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { TrendingDown } from 'lucide-react';
import { usePipelines } from '@/hooks/use-stages';
import { useFunnelData } from '@/hooks/use-dashboard-stats';
import { DashboardFilters } from '@/hooks/use-dashboard-filters';

const funnelGradients = [
  'from-primary to-primary/80',
  'from-violet-500 to-violet-600',
  'from-blue-500 to-blue-600',
  'from-emerald-500 to-emerald-600',
  'from-amber-500 to-amber-600',
  'from-rose-500 to-rose-600',
  'from-cyan-500 to-cyan-600',
  'from-fuchsia-500 to-fuchsia-600',
];

interface SalesFunnelWithPipelineProps {
  filters?: DashboardFilters;
}

function FunnelSkeleton() {
  return (
    <div className="flex flex-col items-center space-y-2 py-4">
      {Array.from({ length: 5 }).map((_, i) => {
        const width = 100 - i * 12;
        return (
          <Skeleton
            key={i}
            className="h-8 rounded"
            style={{ width: `${width}%` }}
          />
        );
      })}
    </div>
  );
}

export function SalesFunnelWithPipeline({ filters }: SalesFunnelWithPipelineProps) {
  const { data: pipelines = [], isLoading: pipelinesLoading } = usePipelines();
  const [manualPipelineId, setManualPipelineId] = useState<string | null>(null);

  const selectedPipelineId = useMemo(
    () => manualPipelineId || pipelines.find((p) => p.is_default)?.id || pipelines[0]?.id || null,
    [manualPipelineId, pipelines]
  );

  const { data: funnelData = [], isLoading: funnelLoading } = useFunnelData(filters, selectedPipelineId);

  const isLoading = pipelinesLoading || funnelLoading;
  const total = funnelData.reduce((sum, d) => sum + d.value, 0);
  const maxStages = Math.max(funnelData.length, 1);

  return (
    <Card className="app-card overflow-hidden h-full flex flex-col">
      <CardHeader className="pb-3 pt-4 px-4 shrink-0">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
            <TrendingDown className="h-3.5 w-3.5 text-primary" />
            Funil de vendas
          </CardTitle>
          <div className="flex items-center gap-2">
            {pipelines.length > 1 && (
              <Select value={selectedPipelineId || ''} onValueChange={setManualPipelineId}>
                <SelectTrigger className="h-7 w-[140px] border-white/[0.055] bg-white/[0.045] text-[10px] font-medium">
                  <SelectValue placeholder="Pipeline" />
                </SelectTrigger>
                <SelectContent>
                  {pipelines.map((pipeline) => (
                    <SelectItem key={pipeline.id} value={pipeline.id} className="text-[10px]">
                      {pipeline.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <div className="rounded bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
              {total} LEADS
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="app-scrollbar pt-0 pb-4 flex-1 min-h-0 overflow-y-auto px-4 transition-colors">
        {isLoading ? (
          <FunnelSkeleton />
        ) : funnelData.length === 0 ? (
          <div className="flex h-full min-h-[180px] flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-white/[0.045]">
              <TrendingDown className="h-6 w-6 opacity-45" />
            </div>
            <p className="text-xs font-medium">Nenhum dado para este pipeline</p>
          </div>
        ) : (
          <TooltipProvider delayDuration={100}>
            <div className="flex flex-col items-center space-y-1.5 py-2">
              {funnelData.map((item, index) => {
                const baseWidth = 100 - (index * (55 / maxStages));
                const width = Math.max(baseWidth, 35);

                return (
                  <Tooltip key={`${item.stage_key || item.name}-${index}`}>
                    <TooltipTrigger asChild>
                      <div
                        className={cn(
                          'relative group cursor-default transition-all duration-300',
                          'hover:scale-[1.03] hover:z-10'
                        )}
                        style={{ width: `${width}%` }}
                      >
                        <div
                          className={cn(
                            'w-full rounded flex items-center justify-between px-4 py-2',
                            'bg-gradient-to-r text-white text-sm',
                            'shadow-sm transition-all duration-200',
                            'group-hover:shadow-md group-hover:brightness-110',
                            funnelGradients[index % funnelGradients.length]
                          )}
                        >
                          <span className="text-[11px] font-bold truncate max-w-[60%] drop-shadow-sm uppercase tracking-tight">
                            {item.name}
                          </span>

                          <div className="flex items-center gap-2">
                            <span className="text-sm font-black drop-shadow-sm">{item.value}</span>
                            <span className="text-[9px] font-bold bg-black/10 backdrop-blur-sm px-1.5 py-0.5 rounded-full">
                              {item.percentage}%
                            </span>
                          </div>
                        </div>

                        {index < funnelData.length - 1 && (
                          <div className="absolute -bottom-1 left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[5px] border-t-white/20 z-10" />
                        )}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent
                      side="right"
                      className="min-w-[160px] animate-in rounded-xl border-0 bg-[var(--app-surface-solid)] p-3 text-[var(--app-text-primary)] shadow-[0_8px_20px_rgba(0,0,0,0.22)] fade-in zoom-in duration-200"
                    >
                      <div className="space-y-2">
                        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{item.name}</p>
                        <div className="space-y-1.5 pt-2">
                          <div className="flex justify-between items-center gap-4">
                            <span className="text-xs text-muted-foreground font-medium">Quantidade:</span>
                            <span className="text-xs font-bold text-foreground tabular-nums">{item.value} leads</span>
                          </div>
                          <div className="flex justify-between items-center gap-4">
                            <span className="text-xs text-muted-foreground font-medium">Percentual:</span>
                            <span className="text-xs font-bold text-foreground tabular-nums">{item.percentage}% do funil</span>
                          </div>
                        </div>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          </TooltipProvider>
        )}
      </CardContent>
    </Card>
  );
}
