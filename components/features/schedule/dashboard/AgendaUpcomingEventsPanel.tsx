"use client";

import Link from "next/link";
import {
  CalendarDays,
  CalendarClock,
  ChevronRight,
  Clock3,
  ClipboardList,
  Home,
  Mail,
  MessageSquare,
  Phone,
  Video,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { ScheduleDashboardUpcomingEvent } from "@/lib/validation/schedule-dashboard";

const EVENT_TYPE_PRESENTATION = {
  call: { label: "Ligação", icon: Phone },
  email: { label: "E-mail", icon: Mail },
  meeting: { label: "Reunião", icon: Video },
  task: { label: "Tarefa", icon: ClipboardList },
  message: { label: "Mensagem", icon: MessageSquare },
  visit: { label: "Visita", icon: Home },
  __unknown__: { label: "Outro", icon: CalendarDays },
} as const;

function getEventTypePresentation(eventType: string) {
  return (
    EVENT_TYPE_PRESENTATION[
      eventType as keyof typeof EVENT_TYPE_PRESENTATION
    ] ?? EVENT_TYPE_PRESENTATION.__unknown__
  );
}

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

  try {
    return {
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
      weekday: new Intl.DateTimeFormat("pt-BR", {
        weekday: "short",
        timeZone,
      })
        .format(value)
        .replace(".", ""),
      time: new Intl.DateTimeFormat("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone,
      }).format(value),
    };
  } catch {
    return {
      day: new Intl.DateTimeFormat("pt-BR", { day: "2-digit" }).format(value),
      month: new Intl.DateTimeFormat("pt-BR", { month: "short" })
        .format(value)
        .replace(".", ""),
      weekday: new Intl.DateTimeFormat("pt-BR", { weekday: "short" })
        .format(value)
        .replace(".", ""),
      time: new Intl.DateTimeFormat("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      }).format(value),
    };
  }
}

export function AgendaUpcomingEventsPanel({
  events,
  totalUpcoming,
  reportTimezone,
}: {
  events: ScheduleDashboardUpcomingEvent[];
  totalUpcoming: number;
  reportTimezone: string;
}) {
  return (
    <section className="flex h-[440px] min-w-0 flex-col overflow-hidden rounded-[8px] bg-[var(--app-surface-solid)] shadow-none">
      <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-primary/12 text-primary">
            <CalendarClock className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-[13px] font-medium tracking-[-0.01em] text-[var(--app-text-primary)]">
              Próximos agendamentos
            </h2>
            <p className="mt-0.5 truncate text-[9px] font-light text-[var(--app-text-tertiary)]">
              Agenda futura em ordem cronológica
            </p>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-[9px] font-medium tabular-nums text-primary">
          {events.length < totalUpcoming
            ? `${events.length} de ${totalUpcoming}`
            : `${events.length} ${events.length === 1 ? "próximo" : "próximos"}`}
        </span>
      </div>

      {events.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-5 py-10 text-center">
          <p className="max-w-[260px] text-[11px] font-light leading-5 text-[var(--app-text-tertiary)]">
            Nenhum compromisso futuro em aberto para os filtros selecionados.
          </p>
        </div>
      ) : (
        <ol className="scrollbar-thin min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-3">
          {events.map((event) => {
            const presentation = getEventTypePresentation(event.event_type);
            const Icon = presentation.icon;
            const date = formatEventDate(event.start_time, reportTimezone);
            const endDate = formatEventDate(event.end_time, reportTimezone);
            const propertyLabel =
              [event.property_code, event.property_title]
                .filter((value): value is string => Boolean(value))
                .join(" · ") || null;

            return (
              <li key={event.id}>
                <Link
                  href={`/agenda?event=${encodeURIComponent(event.id)}`}
                  className="group grid min-w-0 grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-3 rounded-[8px] border border-transparent bg-[var(--app-surface-soft)] px-3 py-3 transition-[background-color,border-color] hover:border-primary/20 hover:bg-primary/[0.045] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
                  aria-label={`Abrir ${presentation.label.toLowerCase()} ${event.title}`}
                >
                  <span className="flex h-14 w-12 shrink-0 flex-col items-center justify-center rounded-[7px] bg-primary/12 text-center text-primary">
                    <span className="text-[17px] font-medium leading-none tracking-[-0.03em] tabular-nums">
                      {date.day}
                    </span>
                    <span className="mt-1.5 text-[8px] font-medium uppercase leading-none">
                      {date.month}
                    </span>
                  </span>

                  <span className="min-w-0">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] bg-primary/10 text-primary">
                        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
                      <span className="truncate text-[12px] font-medium tracking-[-0.01em] text-[var(--app-text-primary)]">
                        {event.title}
                      </span>
                    </span>
                    <span className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-[9px] font-light text-[var(--app-text-tertiary)]">
                      <time
                        dateTime={event.start_time}
                        className="inline-flex items-center gap-1 capitalize text-[var(--app-text-secondary)]"
                      >
                        <Clock3
                          className="h-3 w-3 shrink-0 text-primary"
                          aria-hidden="true"
                        />
                        {date.weekday} · {date.time}–{endDate.time}
                      </time>
                      {event.lead_name ? (
                        <span
                          className="max-w-[190px] truncate"
                          title={event.lead_name}
                        >
                          {event.lead_name}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-2 flex min-w-0 items-center gap-2">
                      <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[8px] font-medium text-primary">
                        {presentation.label}
                      </span>
                      {propertyLabel ? (
                        <span
                          className="min-w-0 flex-1 truncate text-[8px] font-light text-[var(--app-text-tertiary)]"
                          title={`Imóvel ${propertyLabel}`}
                        >
                          Imóvel {propertyLabel}
                        </span>
                      ) : (
                        <span className="min-w-0 flex-1" />
                      )}
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
                        className="max-w-[120px] truncate text-[8px] font-light text-[var(--app-text-secondary)]"
                        title={event.user_name}
                      >
                        {event.user_name}
                      </span>
                    </span>
                  </span>

                  <ChevronRight className="h-4 w-4 shrink-0 text-[var(--app-text-tertiary)] transition-[color,transform] group-hover:translate-x-0.5 group-hover:text-primary" />
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
