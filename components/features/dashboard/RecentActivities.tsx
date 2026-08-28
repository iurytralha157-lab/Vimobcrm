import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  ArrowRight,
  MessageSquare,
  UserPlus,
  PhoneCall,
  FileText,
  Activity,
  AlertCircle,
  Clock,
  RefreshCw,
  type LucideIcon,
} from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { getDashboardRecentActivities } from '@/lib/api/dashboard';
import { useDashboardQueryScope } from '@/hooks/use-dashboard-stats';

interface ActivityItem {
  id: string;
  type: string;
  content: string | null;
  created_at: string;
  lead_name?: string;
  user_name?: string | null;
}

const activityConfig: Record<string, { icon: LucideIcon; color: string; label: string }> = {
  stage_change: { icon: ArrowRight, color: 'text-primary', label: 'Moveu lead' },
  message_sent: { icon: MessageSquare, color: 'text-emerald-500', label: 'Enviou mensagem' },
  message_received: { icon: MessageSquare, color: 'text-blue-500', label: 'Recebeu mensagem' },
  lead_created: { icon: UserPlus, color: 'text-chart-2', label: 'Novo lead' },
  lead_assigned: { icon: UserPlus, color: 'text-chart-3', label: 'Lead atribuído' },
  call: { icon: PhoneCall, color: 'text-chart-4', label: 'Ligação' },
  note: { icon: FileText, color: 'text-chart-5', label: 'Nota adicionada' },
  deal_status_change: { icon: Activity, color: 'text-primary', label: 'Status alterado' },
};

const defaultConfig = { icon: Activity, color: 'text-muted-foreground', label: 'Atividade' };

export function RecentActivities() {
  const { organizationId, currentUserId, accessSignature, isReady } =
    useDashboardQueryScope();

  const {
    data: activities = [],
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: [
      'dashboard-recent-activities',
      organizationId,
      currentUserId,
      accessSignature,
      8,
    ],
    queryFn: ({ signal }) =>
      getDashboardRecentActivities({ organizationId, limit: 8, signal }),
    enabled: isReady,
    refetchInterval: 30000,
  });

  if (isLoading) {
    return (
      <Card className="app-card flex h-full flex-col">
        <CardHeader className="px-4 pb-2 pt-3">
          <CardTitle className="text-[14px] font-normal">Atividades recentes</CardTitle>
        </CardHeader>
        <CardContent className="flex-1 space-y-3 px-4 pb-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-start gap-2">
              <Skeleton className="h-6 w-6 rounded-full flex-shrink-0" />
              <div className="flex-1 space-y-1">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-2.5 w-16" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  if (isError && activities.length === 0) {
    return (
      <Card className="app-card flex h-full flex-col">
        <CardContent className="flex flex-1 flex-col items-center justify-center px-4 py-6 text-center">
          <span className="grid h-9 w-9 place-items-center rounded-[6px] bg-destructive/10 text-destructive">
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
          </span>
          <p className="mt-3 text-[14px] font-normal text-[var(--app-text-primary)]">
            Não foi possível carregar as atividades
          </p>
          <p className="mt-1 text-[12px] font-light text-[var(--app-text-secondary)]">
            Tente novamente para atualizar esta lista.
          </p>
          <Button
            type="button"
            className="mt-3 h-8 rounded-[6px] bg-primary/50 px-2.5 text-[12px] font-light text-primary-foreground shadow-none hover:bg-primary"
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            <RefreshCw
              className={cn('mr-1.5 h-3.5 w-3.5', isFetching && 'animate-spin')}
              aria-hidden="true"
            />
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    );
  }

  function getDescription(activity: ActivityItem) {
    const config = activityConfig[activity.type] || defaultConfig;
    const userName = activity.user_name || 'Sistema';
    const leadName = activity.lead_name || 'Lead';

    if (activity.content) {
      return activity.content.length > 80 ? activity.content.substring(0, 77) + '...' : activity.content;
    }

    switch (activity.type) {
      case 'stage_change':
        return `${userName} moveu "${leadName}" de etapa`;
      case 'message_sent':
        return `${userName} enviou mensagem para "${leadName}"`;
      case 'message_received':
        return `"${leadName}" enviou mensagem`;
      case 'lead_created':
        return `Lead "${leadName}" foi criado`;
      case 'lead_assigned':
        return `"${leadName}" foi atribuído a ${userName}`;
      case 'deal_status_change':
        return `Status de "${leadName}" foi alterado`;
      case 'note':
        return `${userName} adicionou nota em "${leadName}"`;
      default:
        return `${config.label} - "${leadName}"`;
    }
  }

  return (
    <Card className="app-card flex h-full flex-col">
      <CardHeader className="px-4 pb-2 pt-3">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-[14px] font-normal">Atividades recentes</CardTitle>
          {isError && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="ml-auto h-7 w-7 rounded-[6px]"
              aria-label="Tentar atualizar atividades novamente"
              disabled={isFetching}
              onClick={() => void refetch()}
            >
              <RefreshCw
                className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')}
                aria-hidden="true"
              />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-y-auto px-4 pb-3">
        {activities.length === 0 ? (
          <p className="py-4 text-center text-[12px] font-light text-muted-foreground">Nenhuma atividade recente</p>
        ) : (
          <div className="space-y-2">
            {activities.map((activity) => {
              const config = activityConfig[activity.type] || defaultConfig;
              const Icon = config.icon;

              return (
                <div key={activity.id} className="flex items-start gap-2 border-b border-[var(--app-border)] py-1.5 last:border-0">
                  <div
                    className={cn(
                      'mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-[6px]',
                      'bg-[var(--app-surface-soft)]',
                    )}
                  >
                    <Icon className={cn('h-3 w-3', config.color)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="line-clamp-2 text-[12px] font-light leading-relaxed text-foreground">{getDescription(activity)}</p>
                    <p className="mt-0.5 text-[10px] font-light text-muted-foreground">
                      {formatActivityTime(activity.created_at)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function formatActivityTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data indisponível';

  return formatDistanceToNow(date, {
    addSuffix: true,
    locale: ptBR,
  });
}
