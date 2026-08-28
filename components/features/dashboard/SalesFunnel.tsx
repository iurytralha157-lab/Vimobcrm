import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { TrendingDown } from 'lucide-react';

interface FunnelDataPoint {
  name: string;
  value: number;
  percentage: number;
  stage_key: string;
}

const funnelSurfaces = [
  'bg-primary',
  'bg-primary/90',
  'bg-primary/80',
  'bg-primary/75',
  'bg-primary/70',
  'bg-primary/65',
  'bg-primary/60',
  'bg-primary/50',
];

const funnelBorderColors = [
  'border-primary/30',
  'border-primary/30',
  'border-primary/30',
  'border-primary/30',
  'border-primary/30',
  'border-primary/30',
  'border-primary/30',
  'border-primary/30',
];

interface SalesFunnelProps {
  data: FunnelDataPoint[];
  isLoading?: boolean;
}

function FunnelSkeleton() {
  return (
    <div className="flex flex-col items-center space-y-1 py-2">
      {Array.from({ length: 5 }).map((_, i) => {
        const width = 100 - i * 12;
        return (
          <Skeleton
            key={i}
            className="h-7 rounded"
            style={{ width: `${width}%` }}
          />
        );
      })}
    </div>
  );
}

export function SalesFunnel({ data, isLoading }: SalesFunnelProps) {
  if (isLoading) {
    return (
      <Card className="app-card overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-[14px] font-normal">
            <TrendingDown className="h-4 w-4 text-primary" />
            Funil de Vendas
          </CardTitle>
        </CardHeader>
        <CardContent>
          <FunnelSkeleton />
        </CardContent>
      </Card>
    );
  }

  if (data.length === 0) {
    return (
      <Card className="app-card overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-[14px] font-normal">
            <TrendingDown className="h-4 w-4 text-primary" />
            Funil de Vendas
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-[180px] items-center justify-center text-[12px] font-light text-muted-foreground">
            Nenhum dado disponível
          </div>
        </CardContent>
      </Card>
    );
  }

  const maxStages = data.length;

  return (
    <Card className="app-card overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center">
          <CardTitle className="flex items-center gap-2 text-[14px] font-normal">
            <TrendingDown className="h-4 w-4 text-primary" />
            Funil de Vendas
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="pt-0 pb-3">
        <TooltipProvider delayDuration={100}>
          <div className="flex flex-col items-center space-y-0.5">
            {data.map((item, index) => {
              // Calcula a largura baseada na posição (formato de funil)
              const baseWidth = 100 - (index * (55 / maxStages));
              const minWidth = 40;
              const width = Math.max(baseWidth, minWidth);

              return (
                <Tooltip key={`${item.stage_key || item.name}-${index}`}>
                  <TooltipTrigger asChild>
                    <div
                      className={cn(
                        "group relative cursor-default"
                      )}
                      style={{ width: `${width}%` }}
                    >
                      {/* Barra principal com gradiente */}
                      <div
                        className={cn(
                          "flex w-full items-center justify-between rounded-[6px] px-3 py-1.5",
                          "border text-[12px] font-light text-primary-foreground transition-colors",
                          "group-hover:bg-primary",
                          funnelSurfaces[index % funnelSurfaces.length],
                          funnelBorderColors[index % funnelBorderColors.length]
                        )}
                      >
                        {/* Nome do estágio */}
                        <span className="max-w-[50%] truncate text-[12px] font-light">
                          {item.name}
                        </span>

                        {/* Valor e percentual */}
                        <div className="flex items-center gap-1.5">
                          <span className="text-[12px] font-normal">
                            {item.value}
                          </span>
                          <span className="min-w-[26px] rounded-[4px] bg-primary-foreground/20 px-1.5 py-0.5 text-center text-[10px] font-light tabular-nums">
                            {item.percentage}%
                          </span>
                        </div>
                      </div>

                      {/* Connector visual (pequeno triângulo) */}
                      {index < data.length - 1 && (
                        <div className="absolute -bottom-0.5 left-1/2 transform -translate-x-1/2 w-0 h-0
                          border-l-[5px] border-l-transparent
                          border-r-[5px] border-r-transparent
                          border-t-[4px] border-t-primary/30
                          z-10"
                        />
                      )}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent
                    side="right"
                    className="min-w-[160px] rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-3 text-[var(--app-text-primary)] shadow-none"
                  >
                    <div className="space-y-2">
                      <p className="text-[12px] font-normal text-muted-foreground">{item.name}</p>
                      <div className="space-y-1.5 pt-2">
                        <div className="flex justify-between items-center gap-4">
                          <span className="text-[12px] font-light text-muted-foreground">Leads:</span>
                          <span className="text-[12px] font-normal tabular-nums text-foreground">{item.value}</span>
                        </div>
                        <div className="flex justify-between items-center gap-4">
                          <span className="text-[12px] font-light text-muted-foreground">Percentual:</span>
                          <span className="text-[12px] font-normal tabular-nums text-foreground">{item.percentage}%</span>
                        </div>
                      </div>
                    </div>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </TooltipProvider>

        {/* Legenda inferior compacta */}
        <div className="mt-2 pt-2">
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 justify-center">
            {data.slice(0, 5).map((item, index) => (
              <div key={`${item.stage_key || item.name}-${index}`} className="flex items-center gap-1">
                <div
                  className={cn(
                    "h-2 w-2 rounded-full",
                    funnelSurfaces[index % funnelSurfaces.length]
                  )}
                />
                <span className="text-[9px] text-muted-foreground">{item.name}</span>
              </div>
            ))}
            {data.length > 5 && (
              <span className="text-[9px] text-muted-foreground">+{data.length - 5}</span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
