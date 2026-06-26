import { format, isToday, isTomorrow, isPast } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  Phone,
  Mail,
  Calendar as CalendarIcon,
  CheckSquare,
  MessageSquare,
  MapPin,
  MoreHorizontal,
  Trash2,
  Edit2,
  Clock,
  User,
  Plus
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScheduleEvent, useCompleteScheduleEvent, useDeleteScheduleEvent, EventType } from '@/hooks/use-schedule-events';

const eventTypeIcons: Record<EventType, React.ElementType> = {
  call: Phone,
  email: Mail,
  meeting: CalendarIcon,
  task: CheckSquare,
  message: MessageSquare,
  visit: MapPin,
};

const eventTypeLabels: Record<EventType, string> = {
  call: 'Ligação',
  email: 'E-mail',
  meeting: 'Reunião',
  task: 'Tarefa',
  message: 'Mensagem',
  visit: 'Visita',
};

const eventTypeColors: Record<EventType, string> = {
  call: 'text-white bg-blue-600 border-blue-700 shadow-blue-500/20',
  email: 'text-white bg-orange-500 border-orange-600 shadow-orange-500/20',
  meeting: 'text-white bg-purple-600 border-purple-700 shadow-purple-500/20',
  task: 'text-white bg-amber-500 border-amber-600 shadow-amber-500/20',
  message: 'text-white bg-emerald-600 border-emerald-700 shadow-emerald-500/20',
  visit: 'text-white bg-pink-600 border-pink-700 shadow-pink-500/20',
};

interface EventsListProps {
  events: ScheduleEvent[];
  onEditEvent?: (event: ScheduleEvent) => void;
  showUser?: boolean;
  showLead?: boolean;
  onAddEvent?: () => void;
}

export function EventsList({ events, onEditEvent, onAddEvent, showUser = true, showLead = true }: EventsListProps) {
  const completeEvent = useCompleteScheduleEvent();
  const deleteEvent = useDeleteScheduleEvent();

  const getDateLabel = (dateStr: string) => {
    const date = new Date(dateStr);
    if (isToday(date)) return 'Hoje';
    if (isTomorrow(date)) return 'Amanhã';
    return format(date, "EEEE, dd 'de' MMMM", { locale: ptBR });
  };

  const groupEventsByDate = (events: ScheduleEvent[]) => {
    const groups: Record<string, ScheduleEvent[]> = {};

    events.forEach((event) => {
      const dateKey = format(new Date(event.start_time), 'yyyy-MM-dd');
      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(event);
    });

    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  };

  const groupedEvents = groupEventsByDate(events);

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground bg-white/[0.035] rounded-xl border border-dashed border-white/[0.08]">
        <div className="h-12 w-12 rounded-full bg-white/[0.06] flex items-center justify-center mb-3">
          <CalendarIcon className="h-6 w-6 opacity-50" />
        </div>
        <p className="text-sm font-medium">Nenhuma atividade encontrada</p>
        <p className="text-xs mb-4">Você ainda não agendou nenhuma atividade para este lead.</p>

        {onAddEvent && (
          <Button
            variant="default"
            size="sm"
            onClick={onAddEvent}
            className="rounded-lg h-9 px-6 text-xs font-medium w-auto mx-auto transition-all"
          >
            <Plus className="h-3.5 w-3.5 mr-2" />
            Novo agendamento
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {groupedEvents.map(([dateKey, dayEvents]) => (
        <div key={dateKey}>
          <h3 className="text-[10px] font-black text-muted-foreground/60 mb-4 uppercase tracking-[0.2em] ml-1">
            {getDateLabel(dayEvents[0].start_time)}
          </h3>
          <div className="space-y-3">
            {dayEvents.map((event) => {
              const Icon = eventTypeIcons[event.event_type as EventType];
              const isCompleted = event.status === 'completed';
              const isOverdue = !isCompleted && isPast(new Date(event.start_time));

              return (
                <div
                  key={event.id}
                  className={cn(
                    "group flex items-start gap-4 p-4 rounded-3xl border border-white/[0.055] bg-white/[0.035] transition-all hover:shadow-xl hover:-translate-y-0.5",
                    isCompleted && "opacity-60 grayscale",
                    isOverdue && "border-destructive/20 bg-destructive/[0.02]"
                  )}
                >
                  <Checkbox
                    checked={isCompleted}
                    onCheckedChange={(checked) => {
                      completeEvent.mutate({ id: event.id, status: checked ? 'completed' : 'scheduled' });
                    }}
                    className="mt-1.5 h-5 w-5 rounded-lg border-2"
                  />

                  <div
                    className={cn(
                      "flex-shrink-0 p-3 rounded-2xl shadow-sm",
                      eventTypeColors[event.event_type as EventType]
                    )}
                  >
                    <Icon className="h-5 w-5" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className={cn(
                          "font-black text-base truncate",
                          isCompleted && "line-through text-muted-foreground"
                        )}>
                          {event.title}
                        </p>
                        <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-muted-foreground/80 font-bold uppercase tracking-tighter">
                          <span className="flex items-center gap-1.5">
                            <Clock className="h-3.5 w-3.5" />
                            {format(new Date(event.start_time), 'HH:mm')}
                          </span>
                          <span className="flex items-center gap-1.5">
                            <div className="h-1.5 w-1.5 rounded-full bg-primary/40" />
                            {eventTypeLabels[event.event_type as EventType]}
                          </span>
                        </div>
                      </div>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white/[0.055]"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="rounded-2xl border-white/[0.055] p-2">
                          <DropdownMenuItem onClick={() => onEditEvent?.(event)} className="rounded-xl gap-2 font-bold py-2">
                            <Edit2 className="h-4 w-4 text-muted-foreground" />
                            Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => deleteEvent.mutate({ id: event.id })}
                            className="text-destructive focus:text-destructive rounded-xl gap-2 font-bold py-2"
                          >
                            <Trash2 className="h-4 w-4" />
                            Excluir
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    {event.description && (
                      <p className="text-sm text-muted-foreground/80 mt-3 line-clamp-2 leading-relaxed bg-white/[0.045] p-3 rounded-2xl border border-white/[0.055]">
                        {event.description}
                      </p>
                    )}

                    <div className="flex flex-col gap-3 mt-4">
                      <div className="flex flex-wrap items-center gap-6">
                        {showUser && event.user && (
                          <div className="flex items-center gap-2.5 text-[11px] font-black uppercase tracking-tighter text-muted-foreground/70">
                            <Avatar className="h-6 w-6 border-2 border-background shadow-sm">
                              <AvatarImage src={event.user.avatar_url || undefined} />
                              <AvatarFallback className="bg-primary/10 text-primary text-[8px] font-black">
                                {event.user.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                              </AvatarFallback>
                            </Avatar>
                            <span className="truncate max-w-[120px]">Agendado por: {event.user.name}</span>
                          </div>
                        )}

                        {showLead && event.lead && (
                          <div className="flex items-center gap-2.5 text-[11px] font-black uppercase tracking-tighter text-muted-foreground/70">
                            <div className="h-6 w-6 rounded-full bg-white/[0.06] flex items-center justify-center">
                              <User className="h-3.5 w-3.5" />
                            </div>
                            <span className="truncate max-w-[150px]">{event.lead.name}</span>
                          </div>
                        )}
                      </div>

                      {isCompleted && event.completed_by_user && (
                        <div className="flex items-center gap-2 text-[10px] font-bold text-emerald-300 uppercase tracking-tighter bg-emerald-500/10 w-fit px-2 py-1 rounded-lg border border-emerald-500/20">
                          <CheckSquare className="h-3 w-3" />
                          <span>Concluído por: {event.completed_by_user.name} {event.completed_at && `em ${format(new Date(event.completed_at), 'dd/MM HH:mm')}`}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
