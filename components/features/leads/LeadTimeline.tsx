import { useLeadTimeline, LeadTimelineEvent, formatResponseTime } from '@/hooks/use-lead-timeline';
import { formatDistanceToNow, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  Loader2,
  ArrowRight,
  UserPlus,
  UserCheck,
  MessageCircle,
  Phone,
  Zap,
  Tag,
  FileText,
  Bot,
  Clock,
  AlertTriangle,
  Calendar as CalendarIcon,
  MapPin
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

interface LeadTimelineProps {
  leadId: string;
}

type TimelineMetadata = {
  response_seconds?: number | null;
};

const eventConfig: Record<string, {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  color: string;
  bgColor: string;
}> = {
  lead_created: {
    icon: UserPlus,
    label: 'Lead criado',
    color: 'text-green-600 dark:text-green-400',
    bgColor: 'bg-green-100 dark:bg-green-900/50'
  },
  lead_assigned: {
    icon: UserCheck,
    label: 'Atribuído',
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-100 dark:bg-blue-900/50'
  },
  first_response: {
    icon: Zap,
    label: 'Primeiro contato',
    color: 'text-yellow-600 dark:text-yellow-400',
    bgColor: 'bg-yellow-100 dark:bg-yellow-900/50'
  },
  whatsapp_message_sent: {
    icon: MessageCircle,
    label: 'Mensagem enviada',
    color: 'text-orange-600 dark:text-orange-400',
    bgColor: 'bg-orange-100 dark:bg-orange-900/50'
  },
  whatsapp_message_received: {
    icon: MessageCircle,
    label: 'Mensagem recebida',
    color: 'text-purple-600 dark:text-purple-400',
    bgColor: 'bg-purple-100 dark:bg-purple-900/50'
  },
  call_initiated: {
    icon: Phone,
    label: 'Ligação iniciada',
    color: 'text-teal-600 dark:text-teal-400',
    bgColor: 'bg-teal-100 dark:bg-teal-900/50'
  },
  stage_changed: {
    icon: ArrowRight,
    label: 'Estágio alterado',
    color: 'text-gray-600 dark:text-gray-400',
    bgColor: 'bg-gray-100 dark:bg-gray-800'
  },
  note_created: {
    icon: FileText,
    label: 'Nota adicionada',
    color: 'text-indigo-600 dark:text-indigo-400',
    bgColor: 'bg-indigo-100 dark:bg-indigo-900/50'
  },
  tag_added: {
    icon: Tag,
    label: 'Tag adicionada',
    color: 'text-pink-600 dark:text-pink-400',
    bgColor: 'bg-pink-100 dark:bg-pink-900/50'
  },
  tag_removed: {
    icon: Tag,
    label: 'Tag removida',
    color: 'text-gray-500 dark:text-gray-500',
    bgColor: 'bg-gray-100 dark:bg-gray-800'
  },
  sla_warning: {
    icon: AlertTriangle,
    label: 'SLA em alerta',
    color: 'text-yellow-600 dark:text-yellow-400',
    bgColor: 'bg-yellow-100 dark:bg-yellow-900/50'
  },
  sla_overdue: {
    icon: AlertTriangle,
    label: 'SLA estourado',
    color: 'text-red-600 dark:text-red-400',
    bgColor: 'bg-red-100 dark:bg-red-900/50'
  },
  visit_scheduled: {
    icon: CalendarIcon,
    label: 'Visita agendada',
    color: 'text-pink-600 dark:text-pink-400',
    bgColor: 'bg-pink-100 dark:bg-pink-900/50'
  },
  visit_made: {
    icon: MapPin,
    label: 'Visita realizada',
    color: 'text-green-600 dark:text-green-400',
    bgColor: 'bg-green-100 dark:bg-green-900/50'
  },
  meeting_scheduled: {
    icon: CalendarIcon,
    label: 'Reunião agendada',
    color: 'text-purple-600 dark:text-purple-400',
    bgColor: 'bg-purple-100 dark:bg-purple-900/50'
  },
  meeting_made: {
    icon: CalendarIcon,
    label: 'Reunião realizada',
    color: 'text-green-600 dark:text-green-400',
    bgColor: 'bg-green-100 dark:bg-green-900/50'
  }
};

function getEventDetails(event: LeadTimelineEvent): string {
  const metadata = event.metadata || {};

  switch (event.event_type) {
    case 'lead_created':
      return metadata.source ? `Origem: ${metadata.source}` : '';

    case 'lead_assigned':
      return '';

    case 'first_response': {
      const responseTime = metadata.response_seconds;
      if (responseTime !== undefined) {
        return `Primeiro contato: ${formatResponseTime(responseTime)}`;
      }
      return '';
    }

    case 'stage_changed': {
      const from = metadata.old_stage_name;
      const to = metadata.new_stage_name;
      if (from && to) {
        return `${from} → ${to}`;
      }
      return '';
    }

    case 'sla_warning': {
      const warnSeconds = metadata.elapsed_seconds;
      if (warnSeconds !== undefined) {
        return `${Math.floor(warnSeconds / 60)} minutos sem resposta`;
      }
      return 'Lead em alerta de SLA';
    }

    case 'sla_overdue': {
      const overdueSeconds = metadata.elapsed_seconds;
      if (overdueSeconds !== undefined) {
        return `${Math.floor(overdueSeconds / 60)} minutos sem resposta`;
      }
      return 'SLA de resposta estourado';
    }

    default:
      return '';
  }
}

export function LeadTimeline({ leadId }: LeadTimelineProps) {
  const { data: events = [], isLoading } = useLeadTimeline(leadId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        Nenhum evento na timeline
      </div>
    );
  }

  // Find first_response event for highlighting
  const firstResponseEvent = events.find(e => e.event_type === 'first_response');
  const firstResponseMetadata = firstResponseEvent?.metadata as TimelineMetadata | null | undefined;
  const firstResponseSeconds = firstResponseMetadata?.response_seconds || 0;

  return (
    <div className="relative">
      {/* First Response Summary */}
      {firstResponseEvent && (
        <div className="mb-4 p-3 rounded-lg border border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/20">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
            <span className="text-sm font-medium text-yellow-700 dark:text-yellow-300">
              Primeiro contato: {formatResponseTime(firstResponseSeconds)}
            </span>
            {firstResponseEvent.is_automation && (
              <Badge variant="outline" className="text-xs gap-1">
                <Bot className="h-3 w-3" />
                Automação
              </Badge>
            )}
            {firstResponseEvent.channel && (
              <Badge variant="secondary" className="text-xs">
                {firstResponseEvent.channel === 'whatsapp' ? 'WhatsApp' : firstResponseEvent.channel}
              </Badge>
            )}
          </div>
        </div>
      )}

      {/* Timeline line */}
      <div className="absolute left-3.5 top-2 bottom-2 w-px bg-border" />

      <div className="space-y-3">
        {events.map((event) => {
          const config = eventConfig[event.event_type] || {
            icon: Clock,
            label: event.event_type,
            color: 'text-gray-500',
            bgColor: 'bg-gray-100 dark:bg-gray-800'
          };

          const Icon = config.icon;
          const details = getEventDetails(event);
          const isFirstResponse = event.event_type === 'first_response';

          return (
            <div key={event.id} className="relative flex gap-3 pl-9">
              {/* Icon */}
              <div
                className={cn(
                  "absolute left-0 w-7 h-7 rounded-full flex items-center justify-center",
                  config.bgColor,
                  isFirstResponse && "ring-2 ring-yellow-400 dark:ring-yellow-600"
                )}
              >
                <Icon className={cn("h-3.5 w-3.5", config.color)} />
              </div>

              {/* Content */}
              <div className={cn(
                "flex-1 pb-3 border-b border-white/[0.055] last:border-0",
                isFirstResponse && "bg-yellow-50/50 dark:bg-yellow-900/10 -mx-2 px-2 py-2 rounded-lg border-0"
              )}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className={cn(
                        "text-sm font-medium",
                        isFirstResponse && "text-yellow-700 dark:text-yellow-300"
                      )}>
                        {config.label}
                      </p>

                      {event.is_automation && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1">
                          <Bot className="h-2.5 w-2.5" />
                          Auto
                        </Badge>
                      )}

                      {event.channel && event.event_type !== 'first_response' && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          {event.channel}
                        </Badge>
                      )}
                    </div>

                    {details && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {details}
                      </p>
                    )}
                  </div>

                  <div className="text-right shrink-0">
                    <p className="text-[10px] text-muted-foreground">
                      {formatDistanceToNow(new Date(event.event_at), { addSuffix: true, locale: ptBR })}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {format(new Date(event.event_at), 'dd/MM HH:mm', { locale: ptBR })}
                    </p>
                  </div>
                </div>

                {/* Actor info */}
                {event.actor && (
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <Avatar className="h-4 w-4">
                      <AvatarImage src={event.actor.avatar_url || undefined} />
                      <AvatarFallback className="text-[8px]">
                        {event.actor.name?.[0] || '?'}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-[10px] text-muted-foreground">
                      {event.actor.name}
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
