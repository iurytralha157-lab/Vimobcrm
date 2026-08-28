"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  format,
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  addDays,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Plus,
  ChevronLeft,
  ChevronRight,
  Clock,
  Calendar as CalendarIcon,
  List,
  LayoutGrid,
  Phone,
  Mail,
  Video,
  ClipboardList,
  Home,
  MessageSquare,
  SlidersHorizontal,
  Trash2,
  AlertCircle,
  RefreshCw,
  CalendarSync,
} from "lucide-react";
import { AppLayout } from "@/components/shared/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { CalendarView } from "@/components/features/schedule/CalendarView";
import { EventsList } from "@/components/features/schedule/EventsList";
import { EventSheet } from "@/components/features/schedule/EventSheet";
import { UserFilter } from "@/components/features/schedule/UserFilter";
import {
  useScheduleEvents,
  type EventType,
  type ScheduleEvent,
  useScheduleCapabilities,
  useUpdateScheduleEvent,
} from "@/hooks/use-schedule-events";
import { useScheduleUsers } from "@/hooks/use-schedule-users";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { useIsMobile } from "@/hooks/use-mobile";
import { useUserPermissions } from "@/hooks/use-user-permissions";
import { VimobLoader } from "@/components/shared/loading/VimobLoader";
import { GoogleCalendarConnect } from "@/components/features/schedule/GoogleCalendarConnect";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

// --- helpers ----------------------------------------------------------------

const EVENT_TYPE_FILTER_OPTIONS: Array<{
  value: EventType;
  label: string;
  icon: React.ElementType;
}> = [
  { value: "call", label: "Ligação", icon: Phone },
  { value: "email", label: "E-mail", icon: Mail },
  { value: "meeting", label: "Reunião", icon: Video },
  { value: "task", label: "Tarefa", icon: ClipboardList },
  { value: "message", label: "Mensagem", icon: MessageSquare },
  { value: "visit", label: "Visita ao imóvel", icon: Home },
];

const AGENDA_VIEW_MODES = ["day", "week", "month", "year", "list"] as const;
type AgendaViewMode = (typeof AGENDA_VIEW_MODES)[number];

const isAgendaViewMode = (value: string | null): value is AgendaViewMode =>
  value !== null && AGENDA_VIEW_MODES.includes(value as AgendaViewMode);

// --- Componente principal ----------------------------------------------------

export default function Agenda() {
  const { profile } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isMobile = useIsMobile();
  const { hasPermission } = useUserPermissions();
  const canManageSchedule = hasPermission("schedule_manage");
  const searchParamsString = searchParams.toString();
  const focusedEventId = searchParams.get("event") || searchParams.get("task");

  const { data: scheduleCapabilities } = useScheduleCapabilities();

  const { data: users = [], canFilterScheduleUsers } = useScheduleUsers();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [pivotDate, setPivotDate] = useState(new Date());
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedEventType, setSelectedEventType] = useState<EventType | null>(
    null,
  );
  const [viewMode, setViewMode] = useState<AgendaViewMode>(() => {
    if (typeof window === "undefined") return "week";
    const saved = localStorage.getItem("agendaViewMode");
    return isAgendaViewMode(saved) ? saved : "week";
  });
  useEffect(() => {
    localStorage.setItem("agendaViewMode", viewMode);
  }, [viewMode]);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetEvent, setSheetEvent] = useState<ScheduleEvent | null>(null);
  const [googleCalendarOpen, setGoogleCalendarOpen] = useState(false);
  const handledGoogleOAuthRef = useRef(false);
  const updateEventMutation = useUpdateScheduleEvent();
  const effectiveViewMode: AgendaViewMode = isMobile ? "day" : viewMode;

  const dateRange = useMemo(() => {
    switch (effectiveViewMode) {
      case "day":
        return {
          startDate: startOfDay(pivotDate),
          endDate: endOfDay(pivotDate),
        };
      case "week":
        return {
          startDate: startOfWeek(pivotDate, { weekStartsOn: 0 }),
          endDate: endOfWeek(pivotDate, { weekStartsOn: 0 }),
        };
      case "month":
        return {
          startDate: startOfWeek(startOfMonth(pivotDate), { weekStartsOn: 0 }),
          endDate: endOfWeek(endOfMonth(pivotDate), { weekStartsOn: 0 }),
        };
      case "year":
        return {
          startDate: startOfYear(pivotDate),
          endDate: endOfYear(pivotDate),
        };
      default:
        return {
          startDate: startOfDay(new Date()),
          endDate: addDays(new Date(), 30),
        };
    }
  }, [pivotDate, effectiveViewMode]);

  const {
    data: events = [],
    isLoading: eventsLoading,
    isError: eventsFailed,
    refetch: refetchEvents,
  } = useScheduleEvents({
    userId: selectedUserId || undefined,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
  });
  const { data: focusedEvents = [] } = useScheduleEvents({
    enabled: Boolean(focusedEventId),
    eventId: focusedEventId || undefined,
  });

  const filteredEvents = useMemo(
    () =>
      selectedEventType
        ? events.filter((event) => event.event_type === selectedEventType)
        : events,
    [events, selectedEventType],
  );

  const upcomingEvents = useMemo(() => {
    const today = startOfDay(new Date());
    const next = addDays(today, 7);
    return filteredEvents
      .filter((ev) => {
        const d = new Date(ev.start_time);
        return d >= today && d <= next && ev.status !== "completed";
      })
      .slice(0, 10);
  }, [filteredEvents]);

  const openCreateSheet = useCallback(() => {
    setSheetEvent(null);
    setSheetOpen(true);
  }, []);

  const openEventSheet = (event: ScheduleEvent) => {
    setSheetEvent(event);
    setSheetOpen(true);
  };

  useEffect(() => {
    if (!focusedEventId) return;

    const focusedEvent =
      events.find((event) => event.id === focusedEventId) || focusedEvents[0];
    if (!focusedEvent) return;

    const eventDate = new Date(focusedEvent.start_time);
    let isActive = true;

    queueMicrotask(() => {
      if (!isActive) return;

      setSelectedDate(eventDate);
      setPivotDate(eventDate);
      setSheetEvent(focusedEvent);
      setSheetOpen(true);

      const cleanParams = new URLSearchParams(searchParamsString);
      cleanParams.delete("event");
      cleanParams.delete("task");
      const cleanSearch = cleanParams.toString();
      router.replace(`/agenda${cleanSearch ? `?${cleanSearch}` : ""}`);
    });

    return () => {
      isActive = false;
    };
  }, [events, focusedEventId, focusedEvents, router, searchParamsString]);

  useEffect(() => {
    const handleMobileCreate = () => openCreateSheet();
    window.addEventListener("vimob:mobile-create-agenda", handleMobileCreate);
    return () =>
      window.removeEventListener(
        "vimob:mobile-create-agenda",
        handleMobileCreate,
      );
  }, [openCreateSheet]);

  useEffect(() => {
    const connected = searchParams.get("google_calendar_connected") === "1";
    const callbackError = searchParams.get("google_calendar_error");
    if ((!connected && !callbackError) || handledGoogleOAuthRef.current) return;

    handledGoogleOAuthRef.current = true;
    setGoogleCalendarOpen(true);
    if (connected) {
      toast.success("Google Agenda conectada e sincronizada.");
    } else if (callbackError) {
      toast.error(
        `Não foi possível conectar o Google Agenda: ${callbackError.slice(0, 300)}`,
      );
    }

    const cleanParams = new URLSearchParams(searchParamsString);
    cleanParams.delete("google_calendar_connected");
    cleanParams.delete("google_calendar_error");
    const cleanSearch = cleanParams.toString();
    router.replace(`/agenda${cleanSearch ? `?${cleanSearch}` : ""}`);
  }, [router, searchParams, searchParamsString]);

  const canFilterUsers = Boolean(
    scheduleCapabilities?.isTeamLeader && canFilterScheduleUsers,
  );

  useEffect(() => {
    if (!selectedUserId) return;
    if (!users.some((user) => user.id === selectedUserId)) {
      let cancelled = false;
      queueMicrotask(() => {
        if (!cancelled) setSelectedUserId(null);
      });
      return () => {
        cancelled = true;
      };
    }
  }, [selectedUserId, users]);

  const VIEW_MODES: Array<{
    value: AgendaViewMode;
    label: string;
    icon: React.ElementType;
  }> = [
    { value: "day", label: "Dia", icon: Clock },
    { value: "week", label: "Semana", icon: LayoutGrid },
    { value: "month", label: "Mês", icon: CalendarIcon },
    { value: "list", label: "Lista", icon: List },
  ];

  const activeFiltersCount =
    (selectedUserId ? 1 : 0) + (selectedEventType ? 1 : 0);
  const navigationStep =
    effectiveViewMode === "week"
      ? 7
      : effectiveViewMode === "month"
        ? 30
        : effectiveViewMode === "year"
          ? 365
          : 1;
  const periodLabel =
    effectiveViewMode === "day"
      ? format(pivotDate, "EEEE, d 'de' MMMM", { locale: ptBR })
      : effectiveViewMode === "week"
        ? `${format(startOfWeek(pivotDate, { weekStartsOn: 0 }), "d", { locale: ptBR })} a ${format(endOfWeek(pivotDate, { weekStartsOn: 0 }), "d 'de' MMMM, yyyy", { locale: ptBR })}`
        : effectiveViewMode === "year"
          ? format(pivotDate, "yyyy", { locale: ptBR })
          : format(pivotDate, "MMMM yyyy", { locale: ptBR });

  return (
    <AppLayout title="Agenda" disableMainScroll={true}>
      <div
        data-tour="agenda-overview"
        style={{
          display: "flex",
          height: "100%",
          overflow: "hidden",
          borderRadius: 8,
          background: "var(--app-surface)",
        }}
      >
        {/* -- Área principal (calendário) -- */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            overflow: "hidden",
          }}
        >
          {/* Header da agenda */}
          <div
            data-tour="agenda-period"
            className="flex items-center gap-2 px-3 py-2 md:px-[18px] md:py-3"
          >
            {!isMobile && (
              <button
                className="h-8 rounded-[6px] border-0 bg-primary/50 px-3 text-[12px] font-light text-white shadow-none transition-colors hover:bg-primary"
                onClick={() => setPivotDate(new Date())}
              >
                Hoje
              </button>
            )}
            <div className="flex gap-1">
              <button
                className="flex h-8 w-8 items-center justify-center rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--app-surface-hover)]"
                onClick={() => setPivotDate((d) => addDays(d, -navigationStep))}
                aria-label="Período anterior"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                className="flex h-8 w-8 items-center justify-center rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--app-surface-hover)]"
                onClick={() => setPivotDate((d) => addDays(d, navigationStep))}
                aria-label="Próximo período"
              >
                <ChevronRight size={14} />
              </button>
            </div>
            <span className="min-w-0 flex-1 truncate text-[14px] font-light capitalize text-[var(--color-text-primary)]">
              {periodLabel}
            </span>

            <div className="flex items-center gap-2">
              <Button
                data-tour="google-calendar-agenda"
                variant="ghost"
                size="sm"
                className={cn(
                  "h-8 gap-2 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-[12px] font-light text-[var(--color-text-secondary)] shadow-none hover:bg-[var(--app-surface-hover)]",
                  isMobile && "w-8 px-0",
                )}
                onClick={() => setGoogleCalendarOpen(true)}
                aria-label="Configurar Google Agenda"
              >
                <CalendarSync size={14} />
                {!isMobile && <span>Google Agenda</span>}
              </Button>

              {/* Novo Botão de Filtros */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    data-tour="agenda-filters"
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "h-8 gap-2 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-[12px] font-light text-[var(--color-text-secondary)] shadow-none hover:bg-[var(--app-surface-hover)]",
                      isMobile && "w-8 px-0",
                      activeFiltersCount > 0 &&
                        "bg-primary/50 text-white hover:bg-primary hover:text-white",
                    )}
                  >
                    <SlidersHorizontal size={14} />
                    {!isMobile && <span>Filtros</span>}
                    {activeFiltersCount > 0 && (
                      <Badge
                        variant="secondary"
                        className="h-4 min-w-[18px] rounded-[4px] bg-primary/50 px-1 text-[10px] font-light text-white hover:bg-primary/50"
                      >
                        {activeFiltersCount}
                      </Badge>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="app-header-popover z-50 max-h-[calc(100dvh-5rem)] w-[min(320px,calc(100vw-16px))] overflow-y-auto rounded-[8px] border-0 p-2.5"
                  align="end"
                >
                  <div className="flex flex-col gap-3">
                    {/* Visualização */}
                    {!isMobile && (
                      <div className="flex flex-col gap-3">
                        <SideLabel>Visualização</SideLabel>
                        <div className="grid grid-cols-2 gap-2">
                          {VIEW_MODES.map((m) => {
                            const active = viewMode === m.value;
                            const Icon = m.icon;
                            return (
                              <button
                                key={m.value}
                                onClick={() => setViewMode(m.value)}
                                className={cn(
                                  "flex items-center gap-2 rounded-[6px] border-0 px-3 py-2 text-[12px] font-light transition-colors",
                                  active
                                    ? "bg-primary/50 text-white hover:bg-primary"
                                    : "bg-[var(--app-surface-soft)] text-[var(--color-text-secondary)] hover:bg-[var(--app-surface-hover)]",
                                )}
                              >
                                <Icon size={14} />
                                {m.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Filtro por tipo de agendamento */}
                    <div className="flex flex-col gap-3">
                      <SideLabel>Tipo de agendamento</SideLabel>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedEventType(null)}
                          className={cn(
                            "col-span-2 flex items-center gap-2 rounded-[6px] border-0 px-3 py-2 text-[12px] font-light transition-colors",
                            selectedEventType === null
                              ? "bg-primary/50 text-white hover:bg-primary"
                              : "bg-[var(--app-surface-soft)] text-[var(--color-text-secondary)] hover:bg-[var(--app-surface-hover)]",
                          )}
                        >
                          <CalendarIcon size={14} />
                          Todos os tipos
                        </button>
                        {EVENT_TYPE_FILTER_OPTIONS.map((option) => {
                          const active = selectedEventType === option.value;
                          const Icon = option.icon;

                          return (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => setSelectedEventType(option.value)}
                              className={cn(
                                "flex min-w-0 items-center gap-2 rounded-[6px] border-0 px-3 py-2 text-left text-[12px] font-light transition-colors",
                                active
                                  ? "bg-primary/50 text-white hover:bg-primary"
                                  : "bg-[var(--app-surface-soft)] text-[var(--color-text-secondary)] hover:bg-[var(--app-surface-hover)]",
                              )}
                            >
                              <Icon className="h-3.5 w-3.5 shrink-0" />
                              <span className="truncate">{option.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Filtro de Equipe */}
                    {canFilterUsers && (
                      <div className="flex flex-col gap-3">
                        <SideLabel>Filtro por Equipe</SideLabel>
                        <UserFilter
                          users={users}
                          selectedUserId={selectedUserId}
                          onUserSelect={setSelectedUserId}
                        />
                      </div>
                    )}

                    {activeFiltersCount > 0 && (
                      <div>
                        <Button
                          size="sm"
                          className="h-8 w-full gap-2 rounded-[6px] bg-primary/50 text-[12px] font-light text-white shadow-none hover:bg-primary hover:text-white"
                          onClick={() => {
                            setSelectedUserId(null);
                            setSelectedEventType(null);
                          }}
                        >
                          <Trash2 size={13} />
                          Limpar filtros
                        </Button>
                      </div>
                    )}
                  </div>
                </PopoverContent>
              </Popover>

              {!isMobile && canManageSchedule && (
                <Button
                  data-tour="agenda-new"
                  onClick={openCreateSheet}
                  className="h-8 gap-2 rounded-[6px] border-0 bg-primary/50 px-3 text-[12px] font-light text-white shadow-none hover:bg-primary"
                >
                  <Plus size={15} /> Novo agendamento
                </Button>
              )}
            </div>
          </div>

          {/* Calendário / lista */}
          <div
            data-tour="agenda-calendar"
            style={{ flex: 1, overflow: "hidden" }}
          >
            {eventsLoading ? (
              <div className="flex h-full items-center justify-center">
                <VimobLoader showLabel label="Carregando agenda..." />
              </div>
            ) : eventsFailed ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                <AlertCircle className="h-6 w-6 text-destructive" />
                <p className="text-sm text-[var(--app-text-secondary)]">
                  Não foi possível carregar a agenda.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 rounded-[6px]"
                  onClick={() => void refetchEvents()}
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Tentar novamente
                </Button>
              </div>
            ) : effectiveViewMode !== "list" ? (
              <CalendarView
                events={filteredEvents}
                selectedDate={selectedDate}
                onDateSelect={setSelectedDate}
                pivotDate={pivotDate}
                onPivotChange={setPivotDate}
                viewMode={effectiveViewMode}
                onEditEvent={openEventSheet}
                onEventUpdate={(id, updates) =>
                  canManageSchedule &&
                  updateEventMutation.mutate({
                    id,
                    ...updates,
                  })
                }
                canManageEvents={canManageSchedule}
                onQuickCreate={
                  canManageSchedule
                    ? (date) => {
                        setSelectedDate(date);
                        openCreateSheet();
                      }
                    : undefined
                }
              />
            ) : (
              <div style={{ height: "100%", padding: 24, overflowY: "auto" }}>
                <EventsList
                  events={upcomingEvents}
                  onEditEvent={openEventSheet}
                  showUser={true}
                  canManage={canManageSchedule}
                />
              </div>
            )}
          </div>

        </div>
      </div>

      <Dialog open={googleCalendarOpen} onOpenChange={setGoogleCalendarOpen}>
        <DialogContent className="w-[calc(100vw-16px)] max-w-xl rounded-[8px] border-0 bg-[var(--app-background)] p-4 sm:p-5">
          <DialogHeader className="gap-1.5">
            <DialogTitle className="text-[14px] font-light text-[var(--app-text-primary)]">
              Google Agenda
            </DialogTitle>
            <DialogDescription className="text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
              Conecte sua conta pessoal para enviar e receber compromissos
              automaticamente.
            </DialogDescription>
          </DialogHeader>
          <GoogleCalendarConnect />
        </DialogContent>
      </Dialog>

      <EventSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        event={sheetEvent}
        defaultUserId={selectedUserId || profile?.id}
        defaultDate={selectedDate}
      />
    </AppLayout>
  );
}

// --- Sub-componentes pequenos ------------------------------------------------

function SideLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: 10,
        fontWeight: 300,
        color: "var(--app-text-tertiary)",
      }}
    >
      <div
        style={{
          width: 4,
          height: 4,
          borderRadius: "50%",
          background: "var(--primary)",
        }}
      />
      {children}
    </div>
  );
}
