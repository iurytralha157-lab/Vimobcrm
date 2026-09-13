"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
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
  isSameDay,
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
import { DEFAULT_SCHEDULE_TIME_ZONE } from "@/lib/schedule-outcome";
import {
  getLocalScheduleCivilDateKey,
  getScheduleCivilDayRange,
  getScheduleCivilDayStart,
  scheduleInstantToLocalDateProxy,
} from "@/lib/schedule-time-zone";

const AgendaDashboard = dynamic(
  () =>
    import("@/components/features/schedule/dashboard").then(
      (module) => module.AgendaDashboard,
    ),
  {
    loading: () => (
      <div className="flex min-h-[320px] items-center justify-center">
        <VimobLoader showLabel label="Carregando dashboard da agenda..." />
      </div>
    ),
  },
);

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
  const searchParams = useSearchParams();

  if (searchParams.get("tab") === "dashboard") {
    return (
      <AppLayout title="Dashboard da agenda">
        <AgendaDashboard />
      </AppLayout>
    );
  }

  return <AgendaCalendar />;
}

function AgendaCalendar() {
  const { profile, activeOrganization } = useAuth();
  const organizationId = activeOrganization.organizationId;
  const router = useRouter();
  const searchParams = useSearchParams();
  const isMobile = useIsMobile();
  const { hasPermission } = useUserPermissions();
  const canManageSchedule = hasPermission("schedule_manage");
  const searchParamsString = searchParams.toString();
  const focusedEventId = searchParams.get("event") || searchParams.get("task");

  const { data: scheduleCapabilities } = useScheduleCapabilities();
  const scheduleTimeZone =
    scheduleCapabilities?.timeZone || DEFAULT_SCHEDULE_TIME_ZONE;

  const { data: users = [], canFilterScheduleUsers } = useScheduleUsers();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [pivotDate, setPivotDate] = useState(new Date());
  const [agendaNow, setAgendaNow] = useState(() => Date.now());
  const initialTimeZoneAlignedRef = useRef(false);
  const forceTimeZoneAlignmentRef = useRef(false);
  const previousOrganizationIdRef = useRef(organizationId);
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

  useEffect(() => {
    const intervalId = window.setInterval(
      () => setAgendaNow(Date.now()),
      60_000,
    );
    return () => window.clearInterval(intervalId);
  }, []);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetEvent, setSheetEvent] = useState<ScheduleEvent | null>(null);
  const [sheetDefaultTime, setSheetDefaultTime] = useState<string | undefined>(
    undefined,
  );
  const [googleCalendarOpen, setGoogleCalendarOpen] = useState(false);
  const handledGoogleOAuthRef = useRef(false);
  const updateEventMutation = useUpdateScheduleEvent();
  const effectiveViewMode: AgendaViewMode = isMobile ? "day" : viewMode;

  useEffect(() => {
    const previousOrganizationId = previousOrganizationIdRef.current;
    previousOrganizationIdRef.current = organizationId;
    if (
      !previousOrganizationId ||
      !organizationId ||
      previousOrganizationId === organizationId
    ) {
      return;
    }

    initialTimeZoneAlignedRef.current = false;
    forceTimeZoneAlignmentRef.current = true;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setSelectedUserId(null);
      setSheetDefaultTime(undefined);
      setSheetEvent(null);
      setSheetOpen(false);
    });
    return () => {
      active = false;
    };
  }, [organizationId]);

  useEffect(() => {
    if (!scheduleCapabilities?.timeZone || initialTimeZoneAlignedRef.current) {
      return;
    }
    initialTimeZoneAlignedRef.current = true;
    const forceAlignment = forceTimeZoneAlignmentRef.current;
    const browserToday = new Date(agendaNow);
    if (
      !forceAlignment &&
      (!isSameDay(selectedDate, browserToday) ||
        !isSameDay(pivotDate, browserToday))
    ) {
      return;
    }
    const organizationToday = scheduleInstantToLocalDateProxy(
      agendaNow,
      scheduleTimeZone,
    );
    if (!organizationToday) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      forceTimeZoneAlignmentRef.current = false;
      setSelectedDate(organizationToday);
      setPivotDate(organizationToday);
    });
    return () => {
      active = false;
    };
  }, [
    agendaNow,
    organizationId,
    pivotDate,
    scheduleCapabilities?.timeZone,
    scheduleTimeZone,
    selectedDate,
  ]);

  const dateRange = useMemo(() => {
    let localStart: Date;
    let localEnd: Date;

    switch (effectiveViewMode) {
      case "day":
        localStart = startOfDay(pivotDate);
        localEnd = endOfDay(pivotDate);
        break;
      case "week":
        localStart = startOfWeek(pivotDate, { weekStartsOn: 0 });
        localEnd = endOfWeek(pivotDate, { weekStartsOn: 0 });
        break;
      case "month":
        localStart = startOfWeek(startOfMonth(pivotDate), { weekStartsOn: 0 });
        localEnd = endOfWeek(endOfMonth(pivotDate), { weekStartsOn: 0 });
        break;
      case "year":
        localStart = startOfYear(pivotDate);
        localEnd = endOfYear(pivotDate);
        break;
      default:
        localStart = startOfDay(pivotDate);
        localEnd = endOfDay(addDays(pivotDate, 30));
        break;
    }

    const startDate =
      getScheduleCivilDayStart(
        getLocalScheduleCivilDateKey(localStart),
        scheduleTimeZone,
      ) || localStart;
    const endRange = getScheduleCivilDayRange(
      getLocalScheduleCivilDateKey(localEnd),
      scheduleTimeZone,
    );

    return {
      startDate,
      endDate: endRange ? new Date(endRange.endTime) : localEnd,
    };
  }, [effectiveViewMode, pivotDate, scheduleTimeZone]);

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
    const todayKey = getLocalScheduleCivilDateKey(
      scheduleInstantToLocalDateProxy(agendaNow, scheduleTimeZone) ||
        new Date(),
    );
    const today = getScheduleCivilDayStart(todayKey, scheduleTimeZone);
    const nextKey = getLocalScheduleCivilDateKey(
      addDays(
        scheduleInstantToLocalDateProxy(agendaNow, scheduleTimeZone) ||
          new Date(),
        7,
      ),
    );
    const nextRange = getScheduleCivilDayRange(nextKey, scheduleTimeZone);
    const next = nextRange ? new Date(nextRange.endTime) : null;
    if (!today || !next) return [];
    return filteredEvents
      .filter((ev) => {
        const d = new Date(ev.start_time);
        return (
          d >= today &&
          d <= next &&
          !["completed", "no_show", "cancelled", "canceled"].includes(
            ev.status || "",
          )
        );
      })
      .slice(0, 10);
  }, [agendaNow, filteredEvents, scheduleTimeZone]);

  const openCreateSheet = useCallback(() => {
    setSheetEvent(null);
    setSheetDefaultTime(undefined);
    setSheetOpen(true);
  }, []);

  const openEventSheet = (event: ScheduleEvent) => {
    setSheetDefaultTime(undefined);
    setSheetEvent(event);
    setSheetOpen(true);
  };

  useEffect(() => {
    if (!focusedEventId) return;

    const focusedEvent =
      events.find((event) => event.id === focusedEventId) || focusedEvents[0];
    if (!focusedEvent) return;

    const eventDate =
      scheduleInstantToLocalDateProxy(
        focusedEvent.start_time,
        scheduleTimeZone,
      ) || new Date(focusedEvent.start_time);
    let isActive = true;

    queueMicrotask(() => {
      if (!isActive) return;

      setSelectedDate(eventDate);
      setPivotDate(eventDate);
      setSheetDefaultTime(undefined);
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
  }, [
    events,
    focusedEventId,
    focusedEvents,
    router,
    scheduleTimeZone,
    searchParamsString,
  ]);

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
    const callbackWarning = searchParams.get("google_calendar_warning");
    if (
      (!connected && !callbackError && !callbackWarning) ||
      handledGoogleOAuthRef.current
    )
      return;

    handledGoogleOAuthRef.current = true;
    setGoogleCalendarOpen(true);
    if (callbackError) {
      toast.error(
        `Não foi possível conectar o Google Agenda: ${callbackError.slice(0, 300)}`,
      );
    } else if (callbackWarning) {
      toast.warning(
        `Google Agenda conectada, mas a sincronização precisa de atenção: ${callbackWarning.slice(0, 300)}`,
      );
    } else if (connected) {
      toast.success("Google Agenda conectada e sincronizada.");
    }

    const cleanParams = new URLSearchParams(searchParamsString);
    cleanParams.delete("google_calendar_connected");
    cleanParams.delete("google_calendar_error");
    cleanParams.delete("google_calendar_warning");
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
                onClick={() =>
                  setPivotDate(
                    scheduleInstantToLocalDateProxy(
                      Date.now(),
                      scheduleTimeZone,
                    ) || new Date(),
                  )
                }
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
                timeZone={scheduleCapabilities?.timeZone}
                onQuickCreate={
                  canManageSchedule
                    ? (date, time) => {
                        setSelectedDate(date);
                        setSheetEvent(null);
                        setSheetDefaultTime(time);
                        setSheetOpen(true);
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
                  timeZone={scheduleCapabilities?.timeZone}
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
        defaultTime={sheetDefaultTime}
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
