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
import type { DashboardAPIFilters } from '@/lib/api/dashboard';
import { useAuth } from '@/contexts/AuthContext';

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
  filters?: DashboardAPIFilters;
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
  const { organization, profile } = useAuth();
  const organizationId = organization?.id ?? profile?.organization_id ?? null;
  const { data: pipelines = [] } = usePipelines();
  const [manualPipelineSelection, setManualPipelineSelection] = useState<{
    organizationId: string | null;
    pipelineId: string | null;
  }>({ organizationId: null, pipelineId: null });
  const manualPipelineId = manualPipelineSelection.organizationId === organizationId
    ? manualPipelineSelection.pipelineId
    : null;

  const selectedPipelineId = useMemo(
    () => manualPipelineId || pipelines.find((p) => p.is_default)?.id || pipelines[0]?.id || null,
    [manualPipelineId, pipelines]
  );

  const { data: funnelData = [], isLoading: funnelLoading } = useFunnelData(filters, manualPipelineId);

  const isLoading = !organizationId || funnelLoading;
  const maxStages = Math.max(funnelData.length, 1);

  return (
    <Card className="flex h-full flex-col overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
      <CardHeader className="shrink-0 px-4 pb-3 pt-4">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-[14px] font-light text-[var(--app-text-primary)]">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-white">
              <TrendingDown className="h-3.5 w-3.5" />
            </span>
            Funil de vendas
          </CardTitle>
          <div className="ml-auto flex shrink-0 items-center">
            {pipelines.length > 1 && (
              <Select
                value={selectedPipelineId || ''}
                onValueChange={(pipelineId) => {
                  setManualPipelineSelection({
                    organizationId,
                    pipelineId,
                  });
                }}
              >
                <SelectTrigger className="h-8 w-[140px] rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-2.5 text-[12px] font-light text-[var(--app-text-primary)] shadow-none transition-colors hover:bg-[var(--app-surface-hover)] focus:ring-1 focus:ring-primary/30">
                  <SelectValue placeholder="Pipeline" />
                </SelectTrigger>
                <SelectContent className="rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-1 shadow-none">
                  {pipelines.map((pipeline) => (
                    <SelectItem key={pipeline.id} value={pipeline.id} className="rounded-[6px] text-[12px] font-light">
                      {pipeline.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="app-scrollbar pt-0 pb-4 flex-1 min-h-0 overflow-y-auto px-4 transition-colors">
        {isLoading ? (
          <FunnelSkeleton />
        ) : funnelData.length === 0 ? (
          <div className="flex h-full min-h-[180px] flex-col items-center justify-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-[6px] bg-primary/50 text-white">
              <TrendingDown className="h-3.5 w-3.5" />
            </div>
            <p className="text-[12px] font-light text-[var(--app-text-secondary)]">Nenhum dado para este pipeline</p>
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
                          'hover:z-10'
                        )}
                        style={{ width: `${width}%` }}
                      >
                        <div
                          className={cn(
                            'w-full rounded flex items-center justify-between px-4 py-2',
                            'bg-gradient-to-r text-white text-sm',
                            'shadow-none transition-all duration-200',
                            'group-hover:brightness-110',
                            funnelGradients[index % funnelGradients.length]
                          )}
                        >
                          <span className="max-w-[60%] truncate text-[12px] font-light">
                            {item.name}
                          </span>

                          <div className="flex items-center gap-2">
                            <span className="text-[12px] font-normal">{item.value}</span>
                            <span className="min-w-[28px] rounded-[6px] bg-[var(--app-surface-solid)]/20 px-1.5 py-0.5 text-center text-[10px] font-light tabular-nums">
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
                      className="min-w-[160px] rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-3 text-[var(--app-text-primary)] shadow-none"
                    >
                      <div className="space-y-2">
                        <p className="text-[12px] font-light text-[var(--app-text-secondary)]">{item.name}</p>
                        <div className="space-y-1.5 pt-2">
                          <div className="flex justify-between items-center gap-4">
                            <span className="text-[11px] font-light text-[var(--app-text-tertiary)]">Quantidade:</span>
                            <span className="text-[11px] font-medium text-[var(--app-text-primary)] tabular-nums">{item.value} leads</span>
                          </div>
                          <div className="flex justify-between items-center gap-4">
                            <span className="text-[11px] font-light text-[var(--app-text-tertiary)]">Percentual:</span>
                            <span className="text-[11px] font-medium text-[var(--app-text-primary)] tabular-nums">{item.percentage}% do funil</span>
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
