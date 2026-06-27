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

// Gradientes modernos para cada etapa do funil
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

// Cores de borda/glow
const funnelBorderColors = [
  'border-primary/30 shadow-primary/20',
  'border-violet-500/30 shadow-violet-500/20',
  'border-blue-500/30 shadow-blue-500/20',
  'border-emerald-500/30 shadow-emerald-500/20',
  'border-amber-500/30 shadow-amber-500/20',
  'border-rose-500/30 shadow-rose-500/20',
  'border-cyan-500/30 shadow-cyan-500/20',
  'border-fuchsia-500/30 shadow-fuchsia-500/20',
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
          <CardTitle className="text-sm font-medium flex items-center gap-2">
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
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <TrendingDown className="h-4 w-4 text-primary" />
            Funil de Vendas
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[180px] flex items-center justify-center text-muted-foreground text-sm">
            Nenhum dado disponível
          </div>
        </CardContent>
      </Card>
    );
  }

  const total = data.reduce((sum, d) => sum + d.value, 0);
  const maxStages = data.length;

  return (
    <Card className="app-card overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <TrendingDown className="h-4 w-4 text-primary" />
            Funil de Vendas
          </CardTitle>
          <span className="text-xs text-muted-foreground">
            {total} leads no total
          </span>
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
                        "relative group cursor-default transition-all duration-300",
                        "hover:scale-[1.02] hover:z-10"
                      )}
                      style={{ width: `${width}%` }}
                    >
                      {/* Barra principal com gradiente */}
                      <div
                        className={cn(
                          "w-full rounded flex items-center justify-between px-3 py-1.5",
                          "bg-gradient-to-r text-white text-sm",
                          "border shadow-sm transition-all duration-200",
                          "group-hover:shadow-md",
                          funnelGradients[index % funnelGradients.length],
                          funnelBorderColors[index % funnelBorderColors.length]
                        )}
                      >
                        {/* Nome do estágio */}
                        <span className="text-xs font-medium truncate max-w-[50%] drop-shadow-sm">
                          {item.name}
                        </span>

                        {/* Valor e percentual */}
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-bold drop-shadow-sm">
                            {item.value}
                          </span>
                          <span className="text-[9px] opacity-80 font-medium bg-white/20 px-1 py-0.5 rounded-full">
                            {item.percentage}%
                          </span>
                        </div>
                      </div>

                      {/* Connector visual (pequeno triângulo) */}
                      {index < data.length - 1 && (
                        <div className="absolute -bottom-0.5 left-1/2 transform -translate-x-1/2 w-0 h-0
                          border-l-[5px] border-l-transparent
                          border-r-[5px] border-r-transparent
                          border-t-[4px] border-t-white/20
                          z-10"
                        />
                      )}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent
                    side="right"
                    className="min-w-[160px] rounded-lg border-0 bg-[var(--app-surface-solid)] p-3 text-[var(--app-text-primary)] shadow-[0_8px_20px_rgba(0,0,0,0.22)] animate-in fade-in zoom-in duration-200"
                  >
                    <div className="space-y-2">
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{item.name}</p>
                      <div className="space-y-1.5 pt-2">
                        <div className="flex justify-between items-center gap-4">
                          <span className="text-xs text-muted-foreground font-medium">Leads:</span>
                          <span className="text-xs font-bold text-foreground tabular-nums">{item.value}</span>
                        </div>
                        <div className="flex justify-between items-center gap-4">
                          <span className="text-xs text-muted-foreground font-medium">Percentual:</span>
                          <span className="text-xs font-bold text-foreground tabular-nums">{item.percentage}%</span>
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
                    "w-2 h-2 rounded-full bg-gradient-to-r",
                    funnelGradients[index % funnelGradients.length]
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
