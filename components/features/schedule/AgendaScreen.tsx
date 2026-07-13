"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
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
} from "lucide-react";
import { AppLayout } from "@/components/shared/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { CalendarView } from "@/components/features/schedule/CalendarView";
import { EventsList } from "@/components/features/schedule/EventsList";
import { EventSheet } from "@/components/features/schedule/EventSheet";
import { UserFilter } from "@/components/features/schedule/UserFilter";
import { useScheduleEvents, ScheduleEvent, useScheduleCapabilities, useUpdateScheduleEvent } from "@/hooks/use-schedule-events";
import { useUsers } from "@/hooks/use-users";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useIsMobile } from "@/hooks/use-mobile";

// --- helpers ----------------------------------------------------------------

const EVENT_TYPE_CONFIG: Record<string, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  call: { label: "Ligação", color: "#6366f1", bg: "rgba(99,102,241,0.18)", icon: Phone },
  email: { label: "E-mail", color: "#f59e0b", bg: "rgba(245,158,11,0.18)", icon: Mail },
  meeting: { label: "Reunião", color: "#8b5cf6", bg: "rgba(139,92,246,0.18)", icon: Video },
  task: { label: "Tarefa", color: "#f59e0b", bg: "rgba(245,158,11,0.18)", icon: ClipboardList },
  message: { label: "Mensagem", color: "#22c55e", bg: "rgba(34,197,94,0.18)", icon: MessageSquare },
  visit: { label: "Visita ao imóvel", color: "#ec4899", bg: "rgba(236,72,153,0.18)", icon: Home },
};

const AGENDA_VIEW_MODES = ["day", "week", "month", "year", "list"] as const;
type AgendaViewMode = typeof AGENDA_VIEW_MODES[number];

const isAgendaViewMode = (value: string | null): value is AgendaViewMode =>
  value !== null && AGENDA_VIEW_MODES.includes(value as AgendaViewMode);

// --- Componente principal ----------------------------------------------------


export default function Agenda() {
  const { profile } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isMobile = useIsMobile();
  const searchParamsString = searchParams.toString();
  const focusedEventId = searchParams.get("event") || searchParams.get("task");

  const { data: scheduleCapabilities } = useScheduleCapabilities();

  const { data: users = [] } = useUsers();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [pivotDate, setPivotDate] = useState(new Date());
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<AgendaViewMode>(() => {
    if (typeof window === "undefined") return "week";
    const saved = localStorage.getItem("agendaViewMode");
    return isAgendaViewMode(saved) ? saved : "week";
  });
  useEffect(() => {
    localStorage.setItem("agendaViewMode", viewMode);
  }, [viewMode]);

  const [showThirtyMinLines, setShowThirtyMinLines] = useState(() => {
    if (typeof window === "undefined") return false;
    const saved = localStorage.getItem("agendaShowThirtyMinLines");
    return saved === "true";
  });
  useEffect(() => {
    localStorage.setItem("agendaShowThirtyMinLines", String(showThirtyMinLines));
  }, [showThirtyMinLines]);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetEvent, setSheetEvent] = useState<ScheduleEvent | null>(null);
  const updateEventMutation = useUpdateScheduleEvent();
  const effectiveViewMode: AgendaViewMode = isMobile ? "day" : viewMode;

  const dateRange = useMemo(() => {
    switch (effectiveViewMode) {
      case "day":
        return { startDate: startOfDay(pivotDate), endDate: endOfDay(pivotDate) };
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
        return { startDate: startOfYear(pivotDate), endDate: endOfYear(pivotDate) };
      default:
        return { startDate: startOfDay(new Date()), endDate: addDays(new Date(), 30) };
    }
  }, [pivotDate, effectiveViewMode]);

  const { data: events = [] } = useScheduleEvents({
    userId: selectedUserId || undefined,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
  });
  const { data: focusedEvents = [] } = useScheduleEvents({
    enabled: Boolean(focusedEventId),
    eventId: focusedEventId || undefined,
  });

  const upcomingEvents = useMemo(() => {
    const today = startOfDay(new Date());
    const next = addDays(today, 7);
    return events
      .filter((ev) => {
        const d = new Date(ev.start_time);
        return d >= today && d <= next && ev.status !== "completed";
      })
      .slice(0, 10);
  }, [events]);

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

    const focusedEvent = events.find((event) => event.id === focusedEventId) || focusedEvents[0];
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
    return () => window.removeEventListener("vimob:mobile-create-agenda", handleMobileCreate);
  }, [openCreateSheet]);


  const canFilterUsers = profile?.role === "admin" || Boolean(scheduleCapabilities?.isTeamLeader);

  const VIEW_MODES: Array<{ value: AgendaViewMode; label: string; icon: React.ElementType }> = [
    { value: "day", label: "Dia", icon: Clock },
    { value: "week", label: "Semana", icon: LayoutGrid },
    { value: "month", label: "Mês", icon: CalendarIcon },
    { value: "list", label: "Lista", icon: List },
  ];

  const TYPE_LEGEND = [
    { key: "call", label: "Ligação" },
    { key: "email", label: "E-mail" },
    { key: "meeting", label: "Reunião" },
    { key: "task", label: "Tarefa" },
    { key: "message", label: "Mensagem" },
    { key: "visit", label: "Visita ao imóvel" },
  ];

  const activeFiltersCount = (selectedUserId ? 1 : 0);
  const navigationStep =
    effectiveViewMode === "week" ? 7 : effectiveViewMode === "month" ? 30 : effectiveViewMode === "year" ? 365 : 1;
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
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
          {/* Header da agenda */}
          <div
            data-tour="agenda-period"
            className="flex items-center gap-2 border-b border-[var(--app-border)] px-3 py-2 md:px-[18px] md:py-3"
            style={{ borderBottomColor: "color-mix(in srgb, var(--app-border) 58%, transparent)" }}
          >
            {!isMobile && (
              <button
                className="h-8 rounded-[6px] border-0 bg-primary/10 px-3 text-xs font-medium text-primary transition-colors hover:bg-primary/15"
                onClick={() => setPivotDate(new Date())}
              >
                Hoje
              </button>
            )}
            <div className="flex gap-1">
              <button
                className="flex h-8 w-8 items-center justify-center rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--app-surface-hover)]"
                onClick={() => setPivotDate((d) => addDays(d, -navigationStep))}
                aria-label="Periodo anterior"
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
            <span className="min-w-0 flex-1 truncate text-sm font-medium capitalize text-[var(--color-text-primary)]">
              {periodLabel}
            </span>

            <div className="flex items-center gap-2">
              {/* Novo Botão de Filtros */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    data-tour="agenda-filters"
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "h-9 gap-2 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-[var(--color-text-secondary)] shadow-none hover:bg-[var(--app-surface-hover)]",
                      isMobile && "w-9 px-0",
                      activeFiltersCount > 0 && "bg-primary/10 text-primary hover:bg-primary/15"
                    )}
                  >
                    <SlidersHorizontal size={14} />
                    {!isMobile && <span>Filtros</span>}
                    {activeFiltersCount > 0 && (
                      <Badge variant="secondary" className="h-5 px-1.5 min-w-[20px] bg-[#ff4e1a] text-white hover:bg-[#ff4e1a]">
                        {activeFiltersCount}
                      </Badge>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-0 shadow-none z-50" align="end">
                  <div className="p-4 flex flex-col gap-6">
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
                                "flex items-center gap-2 rounded-[6px] border-0 px-3 py-2 text-xs font-medium transition-colors",
                                active
                                  ? "bg-primary/15 text-primary"
                                  : "bg-[var(--app-surface-soft)] text-[var(--color-text-secondary)] hover:bg-[var(--app-surface-hover)]"
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

                    {/* Configurações de Grade */}
                    <div className="flex flex-col gap-3">
                      <SideLabel>Configurações</SideLabel>
                      <div className="flex items-center justify-between px-1">
                        <Label htmlFor="grid-lines" className="text-xs font-medium text-[var(--color-text-secondary)]">
                          Mostrar linhas de 30 min
                        </Label>
                        <Switch
                          id="grid-lines"
                          checked={showThirtyMinLines}
                          onCheckedChange={setShowThirtyMinLines}
                        />
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

                    {(activeFiltersCount > 0) && (
                      <div className="pt-4">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-full text-xs gap-2 text-red-400 hover:text-red-300 hover:bg-red-400/10"
                          onClick={() => {
                            setSelectedUserId(null);
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

              {!isMobile && (
                <Button
                  data-tour="agenda-new"
                  onClick={openCreateSheet}
                  className="h-9 gap-2 rounded-[6px] border-0 bg-primary px-3 text-xs font-medium text-primary-foreground shadow-none hover:bg-primary/90"
                >
                  <Plus size={15} /> Novo agendamento
                </Button>
              )}
            </div>
          </div>

          {/* Calendário / lista */}
          <div data-tour="agenda-calendar" style={{ flex: 1, overflow: "hidden" }}>
            {effectiveViewMode !== "list" ? (
              <CalendarView
                events={events}
                selectedDate={selectedDate}
                onDateSelect={setSelectedDate}
                pivotDate={pivotDate}
                onPivotChange={setPivotDate}
                viewMode={effectiveViewMode}
                onEditEvent={openEventSheet}
                onEventUpdate={(id, updates) =>
                  updateEventMutation.mutate({
                    id,
                    ...updates,
                    visibility: updates.visibility ?? undefined,
                  })
                }
                showThirtyMinLines={showThirtyMinLines}
                onQuickCreate={(date) => {
                  setSelectedDate(date);
                  openCreateSheet();
                }}
              />
            ) : (
              <div style={{ height: "100%", padding: 24, overflowY: "auto" }}>
                <EventsList events={upcomingEvents} onEditEvent={openEventSheet} showUser={true} />
              </div>
            )}
          </div>

          {/* Legenda de tipos no rodapé */}
          <div
            style={{
              display: "none",
              gap: 16,
              justifyContent: "center",
              padding: "8px 0",
              borderTop: "1px solid var(--app-border)",
            }}
          >
            {TYPE_LEGEND.map((t) => {
              const conf = EVENT_TYPE_CONFIG[t.key];
              return (
                <div
                  key={t.key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    fontSize: 11,
                    color: "var(--color-text-tertiary)",
                  }}
                >
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: conf.color }} />
                  {t.label}
                </div>
              );
            })}
          </div>
        </div>
      </div>

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
        fontWeight: 700,
        color: "var(--color-text-tertiary)",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
      }}
    >
      <div style={{ width: 4, height: 4, borderRadius: "50%", background: "#ff4e1a" }} />
      {children}
    </div>
  );
}
