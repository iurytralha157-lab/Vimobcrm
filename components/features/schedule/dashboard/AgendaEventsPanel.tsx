"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  CalendarDays,
  ClipboardList,
  Home,
  LoaderCircle,
  Mail,
  MessageSquare,
  Phone,
  RefreshCw,
  Video,
} from "lucide-react";

import { EmptyNote } from "@/components/features/marketing/marketing-ui";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useScheduleDashboardEvents } from "@/hooks/schedule/use-schedule-dashboard-events";
import { getPublicErrorMessage } from "@/lib/api/vimob-error";
import { getScheduleAllDayLastOccupiedInstant, getScheduleOutcomeLabel } from "@/lib/schedule-outcome";
import { cn } from "@/lib/utils";
import type {
  ScheduleDashboardEvent,
  ScheduleDashboardPeriod,
  ScheduleDashboardQuery,
} from "@/lib/validation/schedule-dashboard";

import { AgendaTableHeader, EventTypePill, formatEventWhen } from "./agenda-dashboard-ui";

const EVENT_TYPE_PRESENTATION = {
  call: { label: "Ligação", icon: Phone },
  email: { label: "E-mail", icon: Mail },
  meeting: { label: "Reunião", icon: Video },
  task: { label: "Tarefa", icon: ClipboardList },
  message: { label: "Mensagem", icon: MessageSquare },
  visit: { label: "Visita", icon: Home },
  __unknown__: { label: "Outro", icon: CalendarDays },
} as const;

const STATUS_PRESENTATION = {
  open: { label: "Em aberto", className: "text-[var(--app-text-primary)]" },
  overdue: { label: "Em atraso", className: "text-rose-600 dark:text-rose-400" },
  completed: { label: "Realizado", className: "text-[var(--app-text-primary)]" },
  no_show: { label: "Não compareceu", className: "text-[var(--app-text-primary)]" },
  cancelled: { label: "Cancelado", className: "text-[var(--app-text-secondary)]" },
  rescheduled: { label: "Remarcado", className: "text-[var(--app-text-secondary)]" },
  unclassified: { label: "Não classificado", className: "text-[var(--app-text-secondary)]" },
} as const;

const LIST_SEGMENTS = [
  { key: "all", label: "Todos", status: undefined },
  { key: "open", label: "Em aberto", status: "scheduled" },
  { key: "overdue", label: "Atrasado", status: "overdue" },
  { key: "completed", label: "Realizado", status: "completed" },
] as const;

type ListSegment = (typeof LIST_SEGMENTS)[number]["key"];

function segmentOfStatus(status: ScheduleDashboardQuery["status"]): ListSegment {
  return LIST_SEGMENTS.find((segment) => segment.status === status)?.key ?? "all";
}

const ROW_COLUMNS =
  "@[720px]/agenda-dashboard:grid @[720px]/agenda-dashboard:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_120px_120px]";

type EventDisplayStatus = keyof typeof STATUS_PRESENTATION;

export type AgendaEventsPanelProps = {
  filters: ScheduleDashboardQuery;
  period: ScheduleDashboardPeriod;
  reportTimezone: string;
  enabled?: boolean;
  lifecycleRevision?: number;
  /** Refreshes the list when the local "Atrasado" segment is on. */
  overdueRevision?: number;
  className?: string;
};

function formatEventDate(isoDate: string, timeZone: string) {
  const value = new Date(isoDate);

  const formatDateKey = (resolvedTimeZone?: string) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      ...(resolvedTimeZone ? { timeZone: resolvedTimeZone } : {}),
    }).formatToParts(value);
    const partByType = new Map(parts.map((part) => [part.type, part.value]));
    return `${partByType.get("year")}-${partByType.get("month")}-${partByType.get("day")}`;
  };

  try {
    return {
      dateKey: formatDateKey(timeZone),
      day: new Intl.DateTimeFormat("pt-BR", {
        day: "2-digit",
        timeZone,
      }).format(value),
      month: new Intl.DateTimeFormat("pt-BR", {
        month: "short",
        timeZone,
      })
        .format(value)
        .replace(".", ""),
      fullDate: new Intl.DateTimeFormat("pt-BR", {
        weekday: "short",
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone,
      })
        .format(value)
        .replace(/\./g, ""),
      time: new Intl.DateTimeFormat("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone,
      }).format(value),
    };
  } catch {
    return {
      dateKey: formatDateKey(),
      day: new Intl.DateTimeFormat("pt-BR", { day: "2-digit" }).format(value),
      month: new Intl.DateTimeFormat("pt-BR", { month: "short" })
        .format(value)
        .replace(".", ""),
      fullDate: new Intl.DateTimeFormat("pt-BR", {
        weekday: "short",
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
        .format(value)
        .replace(/\./g, ""),
      time: new Intl.DateTimeFormat("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      }).format(value),
    };
  }
}

function getEventTimingLabel(
  event: ScheduleDashboardEvent,
  startDate: ReturnType<typeof formatEventDate>,
  endDate: ReturnType<typeof formatEventDate>,
) {
  const spansMultipleDays = startDate.dateKey !== endDate.dateKey;

  if (event.is_all_day) {
    return spansMultipleDays
      ? `Dia inteiro · ${startDate.fullDate} → ${endDate.fullDate}`
      : `Dia inteiro · ${startDate.fullDate}`;
  }

  return spansMultipleDays
    ? `${startDate.fullDate} · ${startDate.time} → ${endDate.fullDate} · ${endDate.time}`
    : `${startDate.fullDate} · ${startDate.time}–${endDate.time}`;
}

function getEventTypePresentation(eventType: string) {
  return (
    EVENT_TYPE_PRESENTATION[
      eventType as keyof typeof EVENT_TYPE_PRESENTATION
    ] ?? EVENT_TYPE_PRESENTATION.__unknown__
  );
}

function getDisplayStatus(
  event: ScheduleDashboardEvent,
  now: number,
): EventDisplayStatus {
  if (event.outcome === "rescheduled") return "rescheduled";
  if (event.status === "no_show" || event.outcome === "no_show") {
    return "no_show";
  }
  if (event.status === "cancelled") return "cancelled";
  if (event.status === "completed") return "completed";
  if (event.status === "__unknown__") return "unclassified";
  const endTime = Date.parse(event.end_time);
  if (
    event.is_overdue ||
    (event.status === "scheduled" && Number.isFinite(endTime) && endTime < now)
  ) {
    return "overdue";
  }
  return "open";
}

function getStatusLabel(
  event: ScheduleDashboardEvent,
  status: EventDisplayStatus,
) {
  if (status === "completed") {
    return getScheduleOutcomeLabel(event.outcome) || "Realizado";
  }
  return STATUS_PRESENTATION[status].label;
}

export function AgendaEventsPanel({
  filters,
  period,
  reportTimezone,
  enabled,
  lifecycleRevision: filterRevision = 0,
  overdueRevision = 0,
  className,
}: AgendaEventsPanelProps) {
  const [segment, setSegment] = useState<ListSegment>(() => segmentOfStatus(filters.status));
  // Picking a segment overrides the status filter set by a KPI, "Todos" included,
  // until a new KPI is chosen.
  const [segmentOverridesFilter, setSegmentOverridesFilter] = useState(false);
  const [syncedStatus, setSyncedStatus] = useState(filters.status);
  if (syncedStatus !== filters.status) {
    setSyncedStatus(filters.status);
    setSegment(segmentOfStatus(filters.status));
    setSegmentOverridesFilter(false);
  }
  const [lifecycleNow, setLifecycleNow] = useState(() => Date.now());
  useEffect(() => {
    let intervalId: number | undefined;
    const timeoutId = window.setTimeout(
      () => {
        setLifecycleNow(Date.now());
        intervalId = window.setInterval(
          () => setLifecycleNow(Date.now()),
          60_000,
        );
      },
      60_000 - (Date.now() % 60_000),
    );
    return () => {
      window.clearTimeout(timeoutId);
      if (intervalId !== undefined) window.clearInterval(intervalId);
    };
  }, []);

  const segmentStatus = LIST_SEGMENTS.find((item) => item.key === segment)?.status;
  const lifecycleRevision = segment === "overdue" ? overdueRevision : filterRevision;
  const eventsFilters = useMemo<ScheduleDashboardQuery>(
    () => ({
      ...filters,
      dateFrom: period.date_from,
      dateTo: period.date_to,
      // "Em atraso" only exists on the scheduled date, as in the dashboard filter.
      dateBasis: segmentStatus === "overdue" ? "start_time" : period.date_basis,
      status: segmentStatus ?? (segmentOverridesFilter ? undefined : filters.status),
    }),
    [filters, period.date_basis, period.date_from, period.date_to, segmentOverridesFilter, segmentStatus],
  );
  const eventsQuery = useScheduleDashboardEvents(eventsFilters, {
    enabled,
    lifecycleRevision,
  });
  const events = useMemo(() => {
    const uniqueEvents = new Map<string, ScheduleDashboardEvent>();
    eventsQuery.data?.pages.forEach((page) => {
      page.items.forEach((event) => {
        if (!uniqueEvents.has(event.id)) uniqueEvents.set(event.id, event);
      });
    });
    return Array.from(uniqueEvents.values());
  }, [eventsQuery.data?.pages]);
  const total = eventsQuery.data?.pages[0]?.total ?? 0;

  return (
    <section
      aria-label="Compromissos do período"
      aria-busy={eventsQuery.isFetching}
      className={cn(
        "min-w-0 rounded-[12px] bg-[var(--app-surface-solid)] p-4",
        className,
      )}
    >
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-[14px] font-normal text-[var(--app-text-primary)]">
            Lista de compromissos
          </h2>
          <span aria-live="polite" className="shrink-0 text-[12px] font-light tabular-nums text-[var(--app-text-tertiary)]">
            {events.length < total ? `${events.length} de ${total}` : total}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={eventsQuery.isFetching || enabled === false}
            onClick={() => void eventsQuery.refetch()}
            aria-label="Atualizar lista de compromissos"
            title="Atualizar lista de compromissos"
            className="h-7 w-7 shrink-0 rounded-[6px] text-[var(--app-text-tertiary)] shadow-none hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]"
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", eventsQuery.isFetching && "animate-spin")}
              aria-hidden="true"
            />
          </Button>
        </div>
        <div role="group" aria-label="Situação na lista" className="flex max-w-full gap-1 overflow-x-auto rounded-[8px] bg-[var(--app-surface-soft)] p-1 [scrollbar-width:none]">
          {LIST_SEGMENTS.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={segment === item.key}
              onClick={() => {
                setSegment(item.key);
                setSegmentOverridesFilter(true);
              }}
              className={cn(
                "h-6 shrink-0 rounded-[6px] px-2.5 text-[11px] font-light text-[var(--app-text-secondary)] transition-colors hover:text-[var(--app-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/30 sm:text-[12px]",
                segment === item.key && "bg-[var(--app-surface-solid)] text-[var(--app-text-primary)]",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      {eventsQuery.isPending ? (
        <AgendaEventsLoading />
      ) : eventsQuery.isError && events.length === 0 ? (
        <AgendaEventsError
          message={getPublicErrorMessage(
            eventsQuery.error,
            "Não foi possível carregar os compromissos deste período.",
          )}
          onRetry={() => void eventsQuery.refetch()}
        />
      ) : events.length === 0 ? (
        <EmptyNote>Nenhum compromisso encontrado para o período e os filtros selecionados.</EmptyNote>
      ) : (
        <div className="text-[12px] font-light">
          {eventsQuery.isError && !eventsQuery.isFetchNextPageError ? (
            <div
              role="status"
              className="mb-2 flex items-center justify-between gap-2 rounded-[7px] bg-amber-500/10 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-300"
            >
              <span>A atualização falhou; exibindo a última leitura válida.</span>
              <button
                type="button"
                onClick={() => void eventsQuery.refetch()}
                className="shrink-0 underline underline-offset-2"
              >
                Atualizar
              </button>
            </div>
          ) : null}

          <AgendaTableHeader className={ROW_COLUMNS}>
            <span>Compromisso</span>
            <span className="text-right">Lead</span>
            <span className="text-right">Responsável</span>
            <span className="text-right">Quando</span>
            <span className="text-right">Situação</span>
          </AgendaTableHeader>
          <ol className="max-h-[560px] overflow-y-auto overscroll-contain">
            {events.map((event) => (
              <AgendaEventRow
                key={event.id}
                event={event}
                reportTimezone={reportTimezone}
                lifecycleNow={lifecycleNow}
              />
            ))}
          </ol>

          {eventsQuery.hasNextPage || eventsQuery.isFetchNextPageError ? (
            <div className="flex justify-center pt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={eventsQuery.isFetchingNextPage}
                onClick={() => void eventsQuery.fetchNextPage()}
                className="h-8 gap-1.5 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-[11px] font-light text-[var(--app-text-primary)] shadow-none hover:bg-[var(--app-surface-hover)]"
              >
                {eventsQuery.isFetchingNextPage ? (
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {eventsQuery.isFetchingNextPage
                  ? "Carregando"
                  : eventsQuery.isFetchNextPageError
                    ? "Tentar carregar novamente"
                    : "Carregar mais"}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function AgendaEventRow({
  event,
  reportTimezone,
  lifecycleNow,
}: {
  event: ScheduleDashboardEvent;
  reportTimezone: string;
  lifecycleNow: number;
}) {
  const presentation = getEventTypePresentation(event.event_type);
  const startDate = formatEventDate(event.start_time, reportTimezone);
  const occupiedEnd = event.is_all_day
    ? getScheduleAllDayLastOccupiedInstant(event.start_time, event.end_time, reportTimezone)
    : null;
  const endDate = formatEventDate(occupiedEnd == null ? event.end_time : new Date(occupiedEnd).toISOString(), reportTimezone);
  const displayStatus = getDisplayStatus(event, lifecycleNow);
  const statusPresentation = STATUS_PRESENTATION[displayStatus];
  const statusLabel = getStatusLabel(event, displayStatus);
  const timingLabel = getEventTimingLabel(event, startDate, endDate);
  const propertyLabel = [event.property_code, event.property_title]
    .filter((value): value is string => Boolean(value))
    .join(" · ");
  const leadLabel = event.lead_name || "Sem lead vinculado";

  return (
    <li className="border-b border-[var(--app-border)] last:border-b-0">
      <Link
        href={`/agenda?event=${encodeURIComponent(event.id)}`}
        aria-label={`Abrir ${presentation.label.toLowerCase()} ${event.title}`}
        className={cn(
          "block gap-3 py-2 text-[var(--app-text-primary)] transition-colors hover:bg-[var(--app-surface-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 @[720px]/agenda-dashboard:items-center",
          ROW_COLUMNS,
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <EventTypePill type={event.event_type} />
          <span className="truncate" title={propertyLabel ? `${event.title} · ${propertyLabel}` : event.title}>
            {event.title}
            {propertyLabel ? <span className="text-[var(--app-text-secondary)]"> · {propertyLabel}</span> : null}
          </span>
        </span>
        <span className={SECONDARY_CELL} title={leadLabel}>{leadLabel}</span>
        <span className={SECONDARY_CELL} title={`Responsável principal: ${event.user_name}`}>{event.user_name}</span>
        <time dateTime={event.start_time} title={timingLabel} className={cn(SECONDARY_CELL, "tabular-nums")}>
          {formatEventWhen(event.start_time, reportTimezone, event.is_all_day)}
        </time>
        <span className={cn("block truncate @[720px]/agenda-dashboard:text-right", statusPresentation.className)} title={statusLabel}>
          {statusLabel}
        </span>
      </Link>
    </li>
  );
}

const SECONDARY_CELL =
  "block truncate text-[var(--app-text-secondary)] @[720px]/agenda-dashboard:text-right @[720px]/agenda-dashboard:text-[var(--app-text-primary)]";

function AgendaEventsLoading() {
  return (
    <div aria-label="Carregando compromissos" className="space-y-2">
      {Array.from({ length: 5 }, (_, index) => (
        <Skeleton key={index} className="h-9 rounded-[6px]" />
      ))}
    </div>
  );
}

function AgendaEventsError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-5 py-8 text-center">
      <span className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-destructive/10 text-destructive">
        <AlertCircle className="h-4 w-4" aria-hidden="true" />
      </span>
      <p className="mt-2 max-w-[280px] text-[10px] font-light leading-5 text-[var(--app-text-tertiary)]">
        {message}
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onRetry}
        className="mt-3 h-8 gap-1.5 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[10px] shadow-none"
      >
        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
        Tentar novamente
      </Button>
    </div>
  );
}
