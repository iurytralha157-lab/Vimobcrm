import { format, isToday, isTomorrow, isPast } from "date-fns";
import { ptBR } from "date-fns/locale";
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
  Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ScheduleEvent,
  useCompleteScheduleEvent,
  useDeleteScheduleEvent,
  EventType,
} from "@/hooks/use-schedule-events";

const eventTypeIcons: Record<EventType, React.ElementType> = {
  call: Phone,
  email: Mail,
  meeting: CalendarIcon,
  task: CheckSquare,
  message: MessageSquare,
  visit: MapPin,
};

const eventTypeLabels: Record<EventType, string> = {
  call: "Ligação",
  email: "E-mail",
  meeting: "Reunião",
  task: "Tarefa",
  message: "Mensagem",
  visit: "Visita",
};

const eventTypeColors: Record<EventType, string> = {
  call: "text-white bg-blue-600",
  email: "text-white bg-orange-500",
  meeting: "text-white bg-purple-600",
  task: "text-white bg-amber-500",
  message: "text-white bg-emerald-600",
  visit: "text-white bg-pink-600",
};

interface EventsListProps {
  events: ScheduleEvent[];
  onEditEvent?: (event: ScheduleEvent) => void;
  showUser?: boolean;
  showLead?: boolean;
  onAddEvent?: () => void;
  canManage?: boolean;
}

export function EventsList({
  events,
  onEditEvent,
  onAddEvent,
  showUser = true,
  showLead = true,
  canManage = false,
}: EventsListProps) {
  const completeEvent = useCompleteScheduleEvent();
  const deleteEvent = useDeleteScheduleEvent();

  const getDateLabel = (dateStr: string) => {
    const date = new Date(dateStr);
    if (isToday(date)) return "Hoje";
    if (isTomorrow(date)) return "Amanhã";
    return format(date, "EEEE, dd 'de' MMMM", { locale: ptBR });
  };

  const groupEventsByDate = (events: ScheduleEvent[]) => {
    const groups: Record<string, ScheduleEvent[]> = {};

    events.forEach((event) => {
      const dateKey = format(new Date(event.start_time), "yyyy-MM-dd");
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
      <div className="flex flex-col items-center justify-center rounded-[8px] border-0 bg-[var(--app-surface-solid)] py-12 text-center text-[var(--app-text-tertiary)] shadow-none">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-[6px] bg-primary/50 text-white">
          <CalendarIcon className="h-4 w-4" />
        </div>
        <p className="text-sm font-light text-[var(--app-text-primary)]">
          Nenhuma atividade encontrada
        </p>
        <p className="mb-4 text-xs font-light">
          Você ainda não agendou nenhuma atividade para este lead.
        </p>

        {onAddEvent && canManage && (
          <Button
            variant="default"
            size="sm"
            onClick={onAddEvent}
            className="mx-auto h-9 w-auto rounded-[6px] bg-primary/50 px-6 text-xs font-light text-white shadow-none transition-colors hover:bg-primary"
          >
            <Plus className="h-3.5 w-3.5 mr-2" />
            Novo agendamento
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {groupedEvents.map(([dateKey, dayEvents]) => (
        <div key={dateKey}>
          <h3 className="mb-3 ml-1 text-[12px] font-light capitalize text-[var(--app-text-tertiary)]">
            {getDateLabel(dayEvents[0].start_time)}
          </h3>
          <div className="space-y-3">
            {dayEvents.map((event) => {
              const Icon = eventTypeIcons[event.event_type as EventType];
              const isCompleted = event.status === "completed";
              const isOverdue =
                !isCompleted && isPast(new Date(event.start_time));

              return (
                <div
                  key={event.id}
                  className={cn(
                    "group flex items-start gap-3 rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-4 shadow-none transition-colors hover:bg-[var(--app-surface-hover)]",
                    isCompleted && "opacity-60 grayscale",
                    isOverdue && "bg-destructive/[0.04]",
                  )}
                >
                  <Checkbox
                    checked={isCompleted}
                    disabled={!canManage || Boolean(event.is_masked)}
                    onCheckedChange={(checked) => {
                      completeEvent.mutate({
                        id: event.id,
                        status: checked ? "completed" : "scheduled",
                      });
                    }}
                    className="mt-1 h-5 w-5 rounded-[4px]"
                  />

                  <div
                    className={cn(
                      "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[6px] shadow-none",
                      eventTypeColors[event.event_type as EventType],
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p
                          className={cn(
                            "truncate text-[14px] font-normal text-[var(--app-text-primary)]",
                            isCompleted &&
                              "line-through text-[var(--app-text-tertiary)]",
                          )}
                        >
                          {event.title}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-3 text-[12px] font-light text-[var(--app-text-tertiary)]">
                          <span className="flex items-center gap-1.5">
                            <Clock className="h-3.5 w-3.5" />
                            {format(new Date(event.start_time), "HH:mm")}
                          </span>
                          <span className="flex items-center gap-1.5">
                            <div className="h-1.5 w-1.5 rounded-full bg-primary/40" />
                            {eventTypeLabels[event.event_type as EventType]}
                          </span>
                        </div>
                      </div>

                      {canManage && !event.is_masked && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)] opacity-100 shadow-none transition-colors hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)] md:opacity-0 md:group-hover:opacity-100"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            className="app-header-popover rounded-[8px] border-0 p-1"
                          >
                            <DropdownMenuItem
                              onClick={() => onEditEvent?.(event)}
                              className="gap-2 rounded-[6px] py-2 text-[12px] font-light"
                            >
                              <Edit2 className="h-3.5 w-3.5 text-[var(--app-text-tertiary)]" />
                              Editar
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() =>
                                deleteEvent.mutate({ id: event.id })
                              }
                              className="gap-2 rounded-[6px] py-2 text-[12px] font-light text-destructive focus:text-destructive"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Excluir
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>

                    {event.description && (
                      <p className="mt-3 line-clamp-2 rounded-[6px] border-0 bg-[var(--app-surface-soft)] p-3 text-[12px] font-light leading-[18px] text-[var(--app-text-secondary)]">
                        {event.description}
                      </p>
                    )}

                    <div className="flex flex-col gap-3 mt-4">
                      <div className="flex flex-wrap items-center gap-6">
                        {showUser && event.user && (
                          <div className="flex items-center gap-2.5 text-[11px] font-light text-[var(--app-text-tertiary)]">
                            <Avatar className="h-6 w-6 border-0 shadow-none">
                              <AvatarImage
                                src={event.user.avatar_url || undefined}
                              />
                              <AvatarFallback className="bg-primary/50 text-[8px] font-normal text-white">
                                {event.user.name
                                  .split(" ")
                                  .map((n) => n[0])
                                  .join("")
                                  .slice(0, 2)}
                              </AvatarFallback>
                            </Avatar>
                            <span className="truncate max-w-[120px]">
                              Agendado por: {event.user.name}
                            </span>
                          </div>
                        )}

                        {showLead && event.lead && (
                          <div className="flex items-center gap-2.5 text-[11px] font-light text-[var(--app-text-tertiary)]">
                            <div className="flex h-6 w-6 items-center justify-center rounded-[6px] bg-[var(--app-surface-soft)]">
                              <User className="h-3.5 w-3.5" />
                            </div>
                            <span className="truncate max-w-[150px]">
                              {event.lead.name}
                            </span>
                          </div>
                        )}
                      </div>

                      {isCompleted && event.completed_by_user && (
                        <div className="flex w-fit items-center gap-2 rounded-[6px] border-0 bg-emerald-500/10 px-2 py-1 text-[10px] font-light text-emerald-700 dark:text-emerald-300">
                          <CheckSquare className="h-3 w-3" />
                          <span>
                            Concluído por: {event.completed_by_user.name}{" "}
                            {event.completed_at &&
                              `em ${format(new Date(event.completed_at), "dd/MM HH:mm")}`}
                          </span>
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
