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
  Clock,
  type LucideIcon,
} from 'lucide-react';

import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { getDashboardRecentActivities } from '@/lib/api/dashboard';

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
  const { organization } = useAuth();

  const { data: activities = [], isLoading } = useQuery({
    queryKey: ['dashboard-recent-activities', organization?.id],
    queryFn: async () => {
      if (!organization?.id) return [];
      return getDashboardRecentActivities({ organizationId: organization.id, limit: 8 });
    },
    enabled: !!organization?.id,
    refetchInterval: 30000,
  });

  if (isLoading) {
    return (
      <Card className="app-card h-full flex flex-col">
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-sm font-medium">Atividades Recentes</CardTitle>
        </CardHeader>
        <CardContent className="flex-1 px-4 pb-3 space-y-3">
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
    <Card className="app-card h-full flex flex-col">
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-sm font-medium">Atividades Recentes</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="flex-1 px-4 pb-3 overflow-y-auto">
        {activities.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">Nenhuma atividade recente</p>
        ) : (
          <div className="space-y-2">
            {activities.map((activity) => {
              const config = activityConfig[activity.type] || defaultConfig;
              const Icon = config.icon;

              return (
                <div key={activity.id} className="flex items-start gap-2 py-1.5 border-b border-white/[0.045] last:border-0">
                  <div
                    className={cn(
                      'h-6 w-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5',
                      'bg-white/[0.055]',
                    )}
                  >
                    <Icon className={cn('h-3 w-3', config.color)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs leading-relaxed text-foreground line-clamp-2">{getDescription(activity)}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {formatDistanceToNow(new Date(activity.created_at), {
                        addSuffix: true,
                        locale: ptBR,
                      })}
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
