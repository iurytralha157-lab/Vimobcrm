import { Trophy, Medal, Award } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface Broker {
  id: string;
  name: string;
  avatar_url: string | null;
  closedLeads: number;
  salesValue: number;
  totalCommissions: number;
}

interface TopBrokersWidgetProps {
  brokers: Broker[];
  isLoading?: boolean;
  isFallbackMode?: boolean; // When true, shows "leads" instead of "vendas"
}

const positionIcons = [
  { icon: Trophy, color: 'text-yellow-500', bg: 'bg-yellow-500/10' },
  { icon: Medal, color: 'text-gray-400', bg: 'bg-gray-400/10' },
  { icon: Award, color: 'text-amber-600', bg: 'bg-amber-600/10' },
];

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    notation: value >= 100000 ? 'compact' : 'standard',
    maximumFractionDigits: value >= 100000 ? 1 : 0,
  }).format(value);
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map(word => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function BrokerSkeleton() {
  return (
    <div className="flex items-center gap-3 py-2">
      <Skeleton className="h-5 w-5 rounded" />
      <Skeleton className="h-8 w-8 rounded-full" />
      <div className="flex-1 space-y-1">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-16" />
      </div>
      <Skeleton className="h-4 w-12" />
    </div>
  );
}

export function TopBrokersWidget({ brokers, isLoading, isFallbackMode }: TopBrokersWidgetProps) {
  if (isLoading) {
    return (
      <Card className="app-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Trophy className="h-4 w-4 text-yellow-500" />
            Top 5 Corretores
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <BrokerSkeleton key={i} />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (brokers.length === 0) {
    return (
      <Card className="app-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Trophy className="h-4 w-4 text-yellow-500" />
            Top 5 Corretores
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">
            Nenhum dado disponível
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="app-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Trophy className="h-4 w-4 text-yellow-500" />
          Top 5 Corretores
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {brokers.slice(0, 5).map((broker, index) => {
          const position = positionIcons[index];
          const Icon = position?.icon;

          return (
            <div
              key={broker.id}
              className={cn(
                "flex items-center gap-3 py-2 px-2 rounded-md transition-colors",
                index < 3 ? "hover:bg-white/[0.055]" : ""
              )}
            >
              {/* Position Badge */}
              <div className={cn(
                "flex items-center justify-center w-6 h-6 rounded text-xs font-bold",
                position?.bg || "bg-white/[0.06]",
                position?.color || "text-muted-foreground"
              )}>
                {Icon ? <Icon className="h-4 w-4" /> : index + 1}
              </div>

              {/* Avatar */}
              <Avatar className="h-8 w-8">
                <AvatarImage src={broker.avatar_url || undefined} />
                <AvatarFallback className="text-xs">
                  {getInitials(broker.name)}
                </AvatarFallback>
              </Avatar>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{broker.name}</p>
                {/* Só mostra quantidade quando tem vendas (não fallback mode) */}
                {!isFallbackMode && (
                  <p className="text-xs text-muted-foreground">
                    {broker.closedLeads} {broker.closedLeads === 1 ? 'venda' : 'vendas'}
                  </p>
                )}
              </div>

              {/* Value and Commission - only show when not in fallback mode */}
              {!isFallbackMode && (
                <div className="text-right">
                  <span className="text-xs font-medium text-primary block">
                    {formatCurrency(broker.salesValue)}
                  </span>
                  {broker.totalCommissions > 0 && (
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400">
                      Com: {formatCurrency(broker.totalCommissions)}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
