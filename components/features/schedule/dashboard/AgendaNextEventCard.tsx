"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock } from "lucide-react";

import { EmptyNote, Panel } from "@/components/features/marketing/marketing-ui";
import type { ScheduleDashboardEvent } from "@/lib/validation/schedule-dashboard";

import {
  EVENT_TYPE_LABELS,
  formatEventCountdown,
  formatEventDay,
  formatEventDuration,
  formatEventTime,
} from "./agenda-dashboard-ui";

function googleLabel(status: string | null | undefined) {
  switch (status) {
    case "synced":
      return "Agenda ok";
    case "pending":
      return "Sincronizando";
    case "conflict":
    case "error":
      return "Com erro";
    case "not_connected":
      return "Não conectado";
    default:
      return null;
  }
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[11px] font-light text-[var(--app-text-tertiary)]">{label}</dt>
      <dd className="truncate text-[12px] font-light text-[var(--app-text-primary)]" title={value}>
        {value}
      </dd>
    </div>
  );
}

export function AgendaNextEventCard({
  event,
  reportTimezone,
  isLoading = false,
  isError = false,
}: {
  event?: ScheduleDashboardEvent;
  reportTimezone: string;
  isLoading?: boolean;
  isError?: boolean;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  if (!event) {
    return (
      <Panel title="Próximo compromisso">
        <EmptyNote>
          {isLoading
            ? "Carregando..."
            : isError
              ? "Não foi possível carregar o próximo compromisso."
              : "Nenhum compromisso nos próximos 30 dias com estes filtros."}
        </EmptyNote>
      </Panel>
    );
  }

  const typeLabel = EVENT_TYPE_LABELS[event.event_type] ?? EVENT_TYPE_LABELS.__unknown__;
  const google = googleLabel(event.google_sync_status);
  const property = [event.property_title, event.property_code].filter(Boolean).join(" · ");

  return (
    <Panel title="Próximo compromisso">
      <div className="relative flex h-[92px] items-center justify-center overflow-hidden rounded-[8px] bg-primary/10">
        <CalendarClock className="h-9 w-9 text-primary" strokeWidth={1.25} aria-hidden="true" />
        <span className="absolute right-2 top-2 rounded-[4px] bg-[var(--app-surface-solid)] px-1.5 py-0.5 text-[11px] font-light text-[var(--app-text-primary)]">
          {formatEventCountdown(event.start_time, now)}
        </span>
      </div>
      <p className="mt-3 truncate text-[14px] font-normal text-[var(--app-text-primary)]" title={event.title}>
        {typeLabel} · {event.title}
      </p>
      {property ? (
        <p className="truncate text-[12px] font-light text-[var(--app-text-secondary)]" title={property}>
          {property}
        </p>
      ) : null}
      <div className="mt-3 flex items-baseline justify-between gap-2 border-b border-[var(--app-border)] pb-2.5">
        <span className="text-[12px] font-light text-[var(--app-text-secondary)]">
          {formatEventDay(event.start_time, reportTimezone, now)}
        </span>
        <span className="text-[24px] font-normal tabular-nums leading-tight text-[var(--app-text-primary)]">
          {event.is_all_day ? "Dia inteiro" : formatEventTime(event.start_time, reportTimezone)}
        </span>
      </div>
      <dl className="mt-2.5 grid grid-cols-3 gap-x-2 gap-y-2">
        <Field label="Lead" value={event.lead_name || "Sem lead"} />
        <Field label="Responsável" value={event.user_name} />
        <Field label="Duração" value={formatEventDuration(event.start_time, event.end_time, event.is_all_day)} />
        {event.lead_source ? <Field label="Origem" value={event.lead_source} /> : null}
        {event.lead_stage ? <Field label="Etapa" value={event.lead_stage} /> : null}
        {google ? <Field label="Google" value={google} /> : null}
      </dl>
      <Link
        href={`/agenda?event=${encodeURIComponent(event.id)}`}
        className="mt-3 flex h-9 items-center justify-center rounded-full bg-primary text-[12px] font-normal text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        Abrir compromisso
      </Link>
    </Panel>
  );
}
