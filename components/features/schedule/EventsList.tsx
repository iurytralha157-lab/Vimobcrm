import { useEffect, useRef, useState } from "react";
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
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { getAgendaEventsPage } from "@/components/features/schedule/agenda-period";
import { formatScheduleTimestamp, getSchedulePerformerName } from "@/components/features/schedule/event-sheet/model";
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
  getScheduleOutcomeLabel,
  getSimpleScheduleCompletionOutcome,
  isAttendanceScheduleType,
  shouldPreserveAttendanceHistory,
} from "@/lib/schedule-outcome";
import { getScheduleDisplayLifecycle, getScheduleDisplayLifecycleLabel, getScheduleDisplayTitle } from "@/components/features/schedule/schedule-event-presentation";
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
  paginate?: boolean;
}

export function EventsList({
  events,
  onEditEvent,
  onAddEvent,
  showUser = true,
  showLead = true,
  canManage = false,
  timeZone = DEFAULT_SCHEDULE_TIME_ZONE,
  paginate = false,
}: EventsListProps) {
  const completeEvent = useCompleteScheduleEvent();
  const deleteEvent = useDeleteScheduleEvent();
  const mutationLock = useRef(false);
  const mutationPending = completeEvent.isPending || deleteEvent.isPending;
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const [visibleCount, setVisibleCount] = useState(20);
  const [eventToDelete, setEventToDelete] = useState<ScheduleEvent | null>(null);
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

  const sortedEvents = [...events].sort((left, right) => left.start_time.localeCompare(right.start_time) || left.id.localeCompare(right.id));
  const page = getAgendaEventsPage(sortedEvents, paginate ? visibleCount : events.length);
  const groupedEvents = groupEventsByDate(page.items);

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
          Não há atividades para o período e os filtros selecionados.
        </p>

        {onAddEvent && canManage && (
          <Button
            variant="default"
            size="sm"
            disabled={mutationPending}
            onClick={() => { if (!mutationLock.current && !mutationPending) onAddEvent(); }}
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
    <div className="space-y-4">
      {paginate && <p aria-live="polite" className="text-[11px] text-[var(--app-text-tertiary)]">{page.items.length} de {page.total} atividades</p>}
      {groupedEvents.map(([dateKey, dayEvents]) => (
        <div key={dateKey}>
          <h3 className="mb-3 ml-1 text-[12px] font-light capitalize text-[var(--app-text-tertiary)]">
            {getDateLabel(dateKey)}
          </h3>
          <div className="space-y-3">
            {dayEvents.map((event) => {
              const eventType = event.event_type as EventType;
              const Icon = event.is_masked ? Clock : eventTypeIcons[eventType] || CalendarIcon;
              const eventTitle = getScheduleDisplayTitle(event);
              const isCompleted = !event.is_masked && event.status === "completed";
              const isFinalized = [
                "completed",
                "no_show",
                "cancelled",
                "canceled",
              ].includes(event.status || "");
              const preservesAttendanceHistory =
                shouldPreserveAttendanceHistory(event.event_type, event.status);
              const lifecycle = getScheduleDisplayLifecycle(event, timeZone, currentTime);
              const isOverdue = lifecycle === "overdue";
              const lifecycleClass =
                lifecycle === "busy"
                  ? "bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)]"
                  : lifecycle === "completed"
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
                    aria-label={`Conclusão de ${eventTitle}`}
                    checked={isCompleted}
                    disabled={
                      !canManage ||
                      mutationPending ||
                      Boolean(event.is_masked) ||
                      (isFinalized &&
                        (!isCompleted ||
                          isAttendanceScheduleType(event.event_type)))
                    }
                    onCheckedChange={async (checked) => {
                      if (!canManage || event.is_masked || mutationPending || mutationLock.current ||
                        (isFinalized && (!isCompleted || isAttendanceScheduleType(event.event_type)))) return;
                      if (checked && isAttendanceScheduleType(event.event_type)) {
                        onEditEvent?.(event);
                        return;
                      }
                      mutationLock.current = true;
                      try {
                        if (checked) {
                          await completeEvent.mutateAsync({
                            id: event.id,
                            status: "completed",
                            expected_updated_at: event.updated_at || undefined,
                            outcome: getSimpleScheduleCompletionOutcome(
                              event.event_type,
                            ),
                          });
                          return;
                        }
                        await completeEvent.mutateAsync({
                          id: event.id,
                          status: "scheduled",
                          expected_updated_at: event.updated_at || undefined,
                        });
                      } catch { /* Mutation owns feedback. */ }
                      finally { mutationLock.current = false; }
                    }}
                    className="mt-1 h-5 w-5 rounded-[4px]"
                  />

                  <div
                    className={cn(
                      "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[6px] shadow-none",
                      event.is_masked ? "bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)]" : eventTypeColors[eventType],
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
                          {onEditEvent ? (
                            <button type="button" disabled={mutationPending} onClick={() => { if (!mutationLock.current && !mutationPending) onEditEvent(event); }} className="block max-w-full truncate text-left hover:text-primary focus-visible:underline" aria-label={`Abrir detalhes de ${eventTitle}`}>
                              {eventTitle}
                            </button>
                          ) : eventTitle}
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
                            {event.is_masked ? "Horário ocupado" : eventTypeLabels[eventType] || "Compromisso"}
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
                            {getScheduleDisplayLifecycleLabel(lifecycle)}
                          </span>
                        </div>
                      </div>

                      {canManage && !event.is_masked && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Ações de ${event.title}`}
                              disabled={mutationPending}
                              className="h-8 w-8 rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)] opacity-100 shadow-none transition-colors hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)] md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 md:focus-visible:opacity-100"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            className="app-header-popover rounded-[8px] border-0 p-1"
                          >
                            <DropdownMenuItem
                              disabled={mutationPending}
                              onClick={() => { if (!mutationLock.current && !mutationPending) onEditEvent?.(event); }}
                              className="gap-2 rounded-[6px] py-2 text-[12px] font-light"
                            >
                              <Edit2 className="h-3.5 w-3.5 text-[var(--app-text-tertiary)]" />
                              {preservesAttendanceHistory
                                ? "Ver detalhes"
                                : "Editar"}
                            </DropdownMenuItem>
                            {!preservesAttendanceHistory && (
                              <DropdownMenuItem
                                disabled={mutationPending}
                                onClick={() => { if (!mutationLock.current && !mutationPending) setEventToDelete(event); }}
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

                      {isCompleted && !event.is_masked && (
                          <div className="flex w-fit items-center gap-2 rounded-[6px] border-0 bg-emerald-500/10 px-2 py-1 text-[10px] font-light text-emerald-700 dark:text-emerald-300">
                            <CheckSquare className="h-3 w-3" />
                            <span>
                              {getSchedulePerformerName(event)
                                ? `${isAttendanceScheduleType(event.event_type) ? "Realizado" : "Concluído"} por: ${getSchedulePerformerName(event)}`
                                : "Executor não informado"}{" "}
                              {event.completed_at &&
                                `em ${formatScheduleTimestamp(event.completed_at, timeZone)}`}
                            </span>
                          </div>
                        )}
                      {isCompleted && !event.is_masked && event.completed_by_user && (
                        <p className="text-[10px] text-[var(--app-text-tertiary)]">Conclusão registrada por {event.completed_by_user.name}.</p>
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
      {paginate && page.hasMore && (
        <Button variant="outline" size="sm" className="h-8 text-[12px]" onClick={() => setVisibleCount((count) => count + 20)}>Carregar mais atividades</Button>
      )}
      <AlertDialog open={Boolean(eventToDelete)} onOpenChange={(nextOpen) => { if (!nextOpen && !mutationPending && !mutationLock.current) setEventToDelete(null); }}>
        <AlertDialogContent className="rounded-[8px] bg-[var(--app-surface-solid)]">
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir atividade?</AlertDialogTitle>
            <AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutationPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={mutationPending || !canManage} onClick={async (event) => {
              event.preventDefault();
              const currentEvent = events.find((item) => item.id === eventToDelete?.id);
              if (!canManage || mutationPending || mutationLock.current || !currentEvent || currentEvent.is_masked ||
                shouldPreserveAttendanceHistory(currentEvent.event_type, currentEvent.status)) return;
              mutationLock.current = true;
              try { await deleteEvent.mutateAsync({ id: currentEvent.id }); setEventToDelete(null); } catch { /* Mutation owns feedback; retain confirmation. */ }
              finally { mutationLock.current = false; }
            }}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
