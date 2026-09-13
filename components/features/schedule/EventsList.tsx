import { useEffect, useState } from "react";
import { format } from "date-fns";
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
  CalendarClock,
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
import {
  DEFAULT_SCHEDULE_TIME_ZONE,
  getScheduleLifecycleLabel,
  getScheduleLifecycleState,
  getScheduleOutcomeLabel,
  getSimpleScheduleCompletionOutcome,
  isAttendanceScheduleType,
  shouldPreserveAttendanceHistory,
} from "@/lib/schedule-outcome";
import {
  formatScheduleZonedTime,
  getNextScheduleCivilDate,
  getScheduleCivilDateKey,
  scheduleCivilDateKeyToLocalDate,
} from "@/lib/schedule-time-zone";

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
  timeZone?: string;
}

export function EventsList({
  events,
  onEditEvent,
  onAddEvent,
  showUser = true,
  showLead = true,
  canManage = false,
  timeZone = DEFAULT_SCHEDULE_TIME_ZONE,
}: EventsListProps) {
  const completeEvent = useCompleteScheduleEvent();
  const deleteEvent = useDeleteScheduleEvent();
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  useEffect(() => {
    const intervalId = window.setInterval(
      () => setCurrentTime(Date.now()),
      60_000,
    );
    return () => window.clearInterval(intervalId);
  }, []);

  const getDateLabel = (dateKey: string) => {
    const todayKey = getScheduleCivilDateKey(currentTime, timeZone);
    if (dateKey === todayKey) return "Hoje";
    if (todayKey && dateKey === getNextScheduleCivilDate(todayKey)) {
      return "Amanhã";
    }
    const date = scheduleCivilDateKeyToLocalDate(dateKey);
    return date
      ? format(date, "EEEE, dd 'de' MMMM", { locale: ptBR })
      : "Data indisponível";
  };

  const groupEventsByDate = (events: ScheduleEvent[]) => {
    const groups: Record<string, ScheduleEvent[]> = {};

    events.forEach((event) => {
      const dateKey =
        getScheduleCivilDateKey(event.start_time, timeZone) || "invalid";
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
            {getDateLabel(dateKey)}
          </h3>
          <div className="space-y-3">
            {dayEvents.map((event) => {
              const eventType = event.event_type as EventType;
              const Icon = eventTypeIcons[eventType] || CalendarIcon;
              const isCompleted = event.status === "completed";
              const isFinalized = [
                "completed",
                "no_show",
                "cancelled",
                "canceled",
              ].includes(event.status || "");
              const preservesAttendanceHistory =
                shouldPreserveAttendanceHistory(event.event_type, event.status);
              const lifecycle = getScheduleLifecycleState({
                status: event.status,
                outcome: event.outcome,
                startTime: event.start_time,
                endTime: event.end_time,
                isAllDay: event.is_all_day ?? false,
                timeZone,
                now: currentTime,
              });
              const isOverdue = lifecycle === "overdue";
              const lifecycleClass =
                lifecycle === "completed"
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : lifecycle === "no_show"
                    ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                    : lifecycle === "rescheduled"
                      ? "bg-blue-500/10 text-blue-700 dark:text-blue-300"
                      : lifecycle === "cancelled" || lifecycle === "overdue"
                        ? "bg-red-500/10 text-red-700 dark:text-red-300"
                        : "bg-primary/10 text-primary";

              return (
                <div
                  key={event.id}
                  className={cn(
                    "group flex items-start gap-3 rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-4 shadow-none transition-colors hover:bg-[var(--app-surface-hover)]",
                    isCompleted && "opacity-70",
                    isFinalized && !isCompleted && "opacity-80",
                    isOverdue && "bg-destructive/[0.04]",
                  )}
                >
                  <Checkbox
                    checked={isCompleted}
                    disabled={
                      !canManage ||
                      Boolean(event.is_masked) ||
                      (isFinalized &&
                        (!isCompleted ||
                          isAttendanceScheduleType(event.event_type)))
                    }
                    onCheckedChange={(checked) => {
                      if (checked) {
                        if (isAttendanceScheduleType(event.event_type)) {
                          onEditEvent?.(event);
                        } else {
                          completeEvent.mutate({
                            id: event.id,
                            status: "completed",
                            outcome: getSimpleScheduleCompletionOutcome(
                              event.event_type,
                            ),
                          });
                        }
                        return;
                      }
                      completeEvent.mutate({
                        id: event.id,
                        status: "scheduled",
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
                            {event.is_all_day
                              ? "Dia inteiro"
                              : formatScheduleZonedTime(
                                  event.start_time,
                                  timeZone,
                                )}
                          </span>
                          <span className="flex items-center gap-1.5">
                            <div className="h-1.5 w-1.5 rounded-full bg-primary/40" />
                            {eventTypeLabels[eventType] || "Compromisso"}
                          </span>
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 rounded-[4px] px-1.5 py-0.5 text-[10px]",
                              lifecycleClass,
                            )}
                          >
                            {lifecycle === "rescheduled" && (
                              <CalendarClock className="h-3 w-3" />
                            )}
                            {getScheduleLifecycleLabel(lifecycle)}
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
                              {preservesAttendanceHistory
                                ? "Ver detalhes"
                                : "Editar"}
                            </DropdownMenuItem>
                            {!preservesAttendanceHistory && (
                              <DropdownMenuItem
                                onClick={() =>
                                  deleteEvent.mutate({ id: event.id })
                                }
                                className="gap-2 rounded-[6px] py-2 text-[12px] font-light text-destructive focus:text-destructive"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Excluir
                              </DropdownMenuItem>
                            )}
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
                              Responsável: {event.user.name}
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

                      {isCompleted &&
                        (event.performed_by_user ||
                          event.completed_by_user) && (
                          <div className="flex w-fit items-center gap-2 rounded-[6px] border-0 bg-emerald-500/10 px-2 py-1 text-[10px] font-light text-emerald-700 dark:text-emerald-300">
                            <CheckSquare className="h-3 w-3" />
                            <span>
                              {isAttendanceScheduleType(event.event_type)
                                ? "Realizado"
                                : "Concluído"}{" "}
                              por:{" "}
                              {
                                (
                                  event.performed_by_user ||
                                  event.completed_by_user
                                )?.name
                              }{" "}
                              {event.completed_at &&
                                `em ${format(new Date(event.completed_at), "dd/MM HH:mm")}`}
                            </span>
                          </div>
                        )}

                      {event.outcome && lifecycle !== "rescheduled" && (
                        <div className="flex w-fit items-center gap-2 rounded-[6px] border-0 bg-primary/10 px-2 py-1 text-[10px] font-light text-primary">
                          <CheckSquare className="h-3 w-3" />
                          <span>{getScheduleOutcomeLabel(event.outcome)}</span>
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
