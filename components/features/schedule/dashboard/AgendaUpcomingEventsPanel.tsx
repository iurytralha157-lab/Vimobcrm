"use client";

import Link from "next/link";

import { EmptyNote, Panel } from "@/components/features/marketing/marketing-ui";
import type { ScheduleDashboardEvent } from "@/lib/validation/schedule-dashboard";

import { AgendaTableHeader, EventTypePill, formatEventWhen } from "./agenda-dashboard-ui";

const VISIBLE_EVENTS = 5;
const COLUMNS = "@[720px]/agenda-dashboard:grid @[720px]/agenda-dashboard:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_130px]";

export function AgendaUpcomingEventsPanel({
  events,
  reportTimezone,
  isLoading = false,
  isError = false,
  onViewAll,
}: {
  events: ScheduleDashboardEvent[];
  reportTimezone: string;
  isLoading?: boolean;
  isError?: boolean;
  onViewAll?: () => void;
}) {
  return (
    <Panel
      title="Próximos compromissos"
      aside={
        onViewAll ? (
          <button type="button" onClick={onViewAll} className="rounded-[4px] hover:text-[var(--app-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40">
            Ver todos
          </button>
        ) : null
      }
    >
      {events.length === 0 ? (
        <EmptyNote>
          {isLoading
            ? "Carregando próximos compromissos..."
            : isError
              ? "Não foi possível carregar os próximos compromissos."
              : "Nenhum compromisso nos próximos 30 dias com estes filtros."}
        </EmptyNote>
      ) : (
        <div className="text-[12px] font-light">
          <AgendaTableHeader className={COLUMNS}>
            <span>Compromisso</span>
            <span className="text-right">Lead</span>
            <span className="text-right">Responsável</span>
            <span className="text-right">Quando</span>
          </AgendaTableHeader>
          <ol>
            {events.slice(0, VISIBLE_EVENTS).map((event) => (
              <li key={event.id} className="border-b border-[var(--app-border)] last:border-b-0">
                <Link
                  href={`/agenda?event=${encodeURIComponent(event.id)}`}
                  aria-label={`Abrir ${event.title}`}
                  className={`block gap-3 py-2 text-[var(--app-text-primary)] transition-colors hover:bg-[var(--app-surface-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 @[720px]/agenda-dashboard:items-center ${COLUMNS}`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <EventTypePill type={event.event_type} />
                    <span className="truncate" title={event.title}>{event.title}</span>
                  </span>
                  <span className="mt-1 block truncate text-[var(--app-text-secondary)] @[720px]/agenda-dashboard:mt-0 @[720px]/agenda-dashboard:text-right @[720px]/agenda-dashboard:text-[var(--app-text-primary)]">
                    {event.lead_name || "Sem lead"}
                  </span>
                  <span className="block truncate text-[var(--app-text-secondary)] @[720px]/agenda-dashboard:text-right @[720px]/agenda-dashboard:text-[var(--app-text-primary)]">
                    {event.user_name}
                  </span>
                  <span className="block text-[var(--app-text-secondary)] tabular-nums @[720px]/agenda-dashboard:text-right @[720px]/agenda-dashboard:text-[var(--app-text-primary)]">
                    {formatEventWhen(event.start_time, reportTimezone, event.is_all_day)}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </div>
      )}
    </Panel>
  );
}
