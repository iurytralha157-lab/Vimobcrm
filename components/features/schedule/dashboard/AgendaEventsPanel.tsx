"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Building2,
  CalendarDays,
  CalendarX2,
  ChevronRight,
  Clock3,
  ClipboardList,
  Home,
  LoaderCircle,
  Mail,
  MessageSquare,
  Phone,
  RefreshCw,
  UserRound,
  Video,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useScheduleDashboardEvents } from "@/hooks/schedule/use-schedule-dashboard-events";
import { getPublicErrorMessage } from "@/lib/api/vimob-error";
import { getScheduleOutcomeLabel } from "@/lib/schedule-outcome";
import { cn } from "@/lib/utils";
import type {
  ScheduleDashboardEvent,
  ScheduleDashboardPeriod,
  ScheduleDashboardQuery,
} from "@/lib/validation/schedule-dashboard";

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
  open: {
    label: "Em aberto",
    className: "bg-primary/10 text-primary",
  },
  overdue: {
    label: "Em atraso",
    className: "bg-rose-500/10 text-rose-600 dark:text-rose-300",
  },
  completed: {
    label: "Realizado",
    className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  no_show: {
    label: "No-show",
    className: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
  },
  cancelled: {
    label: "Cancelado",
    className: "bg-[var(--app-surface-muted)] text-[var(--app-text-secondary)]",
  },
  rescheduled: {
    label: "Remarcado",
    className: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
  unclassified: {
    label: "Não classificado",
    className: "bg-[var(--app-surface-muted)] text-[var(--app-text-secondary)]",
  },
} as const;

type EventDisplayStatus = keyof typeof STATUS_PRESENTATION;

export type AgendaEventsPanelProps = {
  filters: ScheduleDashboardQuery;
  period: ScheduleDashboardPeriod;
  reportTimezone: string;
  enabled?: boolean;
  lifecycleRevision?: number;
  className?: string;
};

function getInitials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?"
  );
}

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
  lifecycleRevision,
  className,
}: AgendaEventsPanelProps) {
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

  const eventsFilters = useMemo<ScheduleDashboardQuery>(
    () => ({
      ...filters,
      dateFrom: period.date_from,
      dateTo: period.date_to,
      dateBasis: period.date_basis,
    }),
    [filters, period.date_basis, period.date_from, period.date_to],
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
      aria-label="Agendamentos do período"
      aria-busy={eventsQuery.isFetching}
      className={cn(
        "flex h-[440px] min-w-0 flex-col overflow-hidden rounded-[8px] bg-[var(--app-surface-solid)] shadow-none",
        className,
      )}
    >
      <div className="flex min-h-16 items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-primary/12 text-primary">
            <CalendarDays className="h-4 w-4" aria-hidden="true" />
          </span>
          <h2 className="truncate text-[13px] font-medium tracking-[-0.01em] text-[var(--app-text-primary)]">
            Agendamentos
          </h2>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={eventsQuery.isFetching || enabled === false}
            onClick={() => void eventsQuery.refetch()}
            aria-label="Atualizar lista de agendamentos"
            title="Atualizar lista de agendamentos"
            className="h-7 w-7 rounded-[6px] text-[var(--app-text-tertiary)] shadow-none hover:bg-primary/10 hover:text-primary"
          >
            <RefreshCw
              className={cn(
                "h-3.5 w-3.5",
                eventsQuery.isFetching && "animate-spin",
              )}
              aria-hidden="true"
            />
          </Button>
          <span
            aria-live="polite"
            className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-1 text-[9px] font-medium tabular-nums text-primary"
          >
            {events.length < total ? `${events.length} de ${total}` : total}
          </span>
        </div>
      </div>

      {eventsQuery.isPending ? (
        <AgendaEventsLoading />
      ) : eventsQuery.isError && events.length === 0 ? (
        <AgendaEventsError
          message={getPublicErrorMessage(
            eventsQuery.error,
            "Não foi possível carregar os agendamentos deste período.",
          )}
          onRetry={() => void eventsQuery.refetch()}
        />
      ) : events.length === 0 ? (
        <AgendaEventsEmpty />
      ) : (
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          {eventsQuery.isError && !eventsQuery.isFetchNextPageError ? (
            <div
              role="status"
              className="mb-2 flex items-center justify-between gap-2 rounded-[7px] bg-amber-500/10 px-3 py-2 text-[9px] text-amber-800 dark:text-amber-300"
            >
              <span>
                A atualização falhou; exibindo a última leitura válida.
              </span>
              <button
                type="button"
                onClick={() => void eventsQuery.refetch()}
                className="shrink-0 font-medium underline underline-offset-2"
              >
                Atualizar
              </button>
            </div>
          ) : null}

          <ol className="space-y-2">
            {events.map((event) => (
              <AgendaEventCard
                key={event.id}
                event={event}
                reportTimezone={reportTimezone}
                lifecycleNow={lifecycleNow}
              />
            ))}
          </ol>

          {eventsQuery.hasNextPage || eventsQuery.isFetchNextPageError ? (
            <div className="flex justify-center pb-1 pt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={eventsQuery.isFetchingNextPage}
                onClick={() => void eventsQuery.fetchNextPage()}
                className="h-8 gap-1.5 rounded-[6px] border-primary/15 bg-primary/[0.04] px-3 text-[10px] font-medium text-primary shadow-none hover:bg-primary/10 hover:text-primary"
              >
                {eventsQuery.isFetchingNextPage ? (
                  <LoaderCircle
                    className="h-3.5 w-3.5 animate-spin"
                    aria-hidden="true"
                  />
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

function AgendaEventCard({
  event,
  reportTimezone,
  lifecycleNow,
}: {
  event: ScheduleDashboardEvent;
  reportTimezone: string;
  lifecycleNow: number;
}) {
  const presentation = getEventTypePresentation(event.event_type);
  const Icon = presentation.icon;
  const startDate = formatEventDate(event.start_time, reportTimezone);
  const endDate = formatEventDate(event.end_time, reportTimezone);
  const displayStatus = getDisplayStatus(event, lifecycleNow);
  const statusPresentation = STATUS_PRESENTATION[displayStatus];
  const statusLabel = getStatusLabel(event, displayStatus);
  const timingLabel = getEventTimingLabel(event, startDate, endDate);
  const propertyLabel =
    [event.property_code, event.property_title]
      .filter((value): value is string => Boolean(value))
      .join(" · ") || "Sem imóvel vinculado";

  return (
    <li>
      <Link
        href={`/agenda?event=${encodeURIComponent(event.id)}`}
        className="group grid min-w-0 grid-cols-[50px_minmax(0,1fr)_auto] items-center gap-3 rounded-[8px] border border-transparent bg-[var(--app-surface-soft)] px-3 py-3 transition-[background-color,border-color] hover:border-primary/20 hover:bg-primary/[0.045] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
        aria-label={`Abrir ${presentation.label.toLowerCase()} ${event.title}`}
      >
        <span className="flex h-[58px] w-[50px] shrink-0 flex-col items-center justify-center rounded-[7px] bg-primary/12 text-center text-primary">
          <span className="text-[18px] font-medium leading-none tracking-[-0.03em] tabular-nums">
            {startDate.day}
          </span>
          <span className="mt-1.5 text-[8px] font-medium uppercase leading-none">
            {startDate.month}
          </span>
        </span>

        <span className="min-w-0">
          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] bg-primary/10 text-primary">
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1 truncate text-[12px] font-medium tracking-[-0.01em] text-[var(--app-text-primary)]">
              {event.title}
            </span>
            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-[8px] font-medium",
                statusPresentation.className,
              )}
            >
              {statusLabel}
            </span>
          </span>

          <span className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-[9px] font-light text-[var(--app-text-tertiary)]">
            <time
              dateTime={event.start_time}
              title={startDate.fullDate}
              className="inline-flex items-center gap-1 text-[var(--app-text-secondary)]"
            >
              <Clock3
                className="h-3 w-3 shrink-0 text-primary"
                aria-hidden="true"
              />
              {timingLabel}
            </time>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[8px] font-medium text-primary">
              {presentation.label}
            </span>
          </span>

          <span className="mt-2 grid min-w-0 gap-1.5 text-[8px] font-light text-[var(--app-text-tertiary)] sm:grid-cols-2">
            <span
              className="inline-flex min-w-0 items-center gap-1.5"
              title={event.lead_name || "Sem lead vinculado"}
            >
              <UserRound className="h-3 w-3 shrink-0 text-primary" />
              <span className="truncate">
                {event.lead_name || "Sem lead vinculado"}
              </span>
            </span>
            <span
              className="inline-flex min-w-0 items-center gap-1.5"
              title={propertyLabel}
            >
              <Building2 className="h-3 w-3 shrink-0 text-primary" />
              <span className="truncate">{propertyLabel}</span>
            </span>
          </span>

          <span className="mt-2 flex min-w-0 items-center gap-1.5">
            <Avatar className="h-5 w-5 shrink-0">
              {event.user_avatar_url ? (
                <AvatarImage
                  src={event.user_avatar_url}
                  alt={event.user_name}
                />
              ) : null}
              <AvatarFallback className="bg-primary/10 text-[7px] font-medium text-primary">
                {getInitials(event.user_name)}
              </AvatarFallback>
            </Avatar>
            <span
              className="truncate text-[8px] font-light text-[var(--app-text-secondary)]"
              title={`Responsável principal: ${event.user_name}`}
            >
              Responsável principal: {event.user_name}
            </span>
          </span>
        </span>

        <ChevronRight className="h-4 w-4 shrink-0 text-[var(--app-text-tertiary)] transition-[color,transform] group-hover:translate-x-0.5 group-hover:text-primary" />
      </Link>
    </li>
  );
}

function AgendaEventsLoading() {
  return (
    <div
      aria-label="Carregando agendamentos"
      className="min-h-0 flex-1 space-y-2 overflow-hidden px-3 pb-3"
    >
      {Array.from({ length: 3 }, (_, index) => (
        <Skeleton key={index} className="h-[128px] rounded-[8px]" />
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
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-5 py-8 text-center">
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

function AgendaEventsEmpty() {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-5 py-8 text-center">
      <span className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-primary/10 text-primary">
        <CalendarX2 className="h-4 w-4" aria-hidden="true" />
      </span>
      <p className="mt-2 max-w-[280px] text-[10px] font-light leading-5 text-[var(--app-text-tertiary)]">
        Nenhum agendamento encontrado para o período e os filtros selecionados.
      </p>
    </div>
  );
}
