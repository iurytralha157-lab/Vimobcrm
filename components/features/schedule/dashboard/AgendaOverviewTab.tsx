"use client";

import { Panel, SegmentedBar, StatTile, NEUTRAL_SOFT, NEUTRAL_STRONG } from "@/components/features/marketing/marketing-ui";
import { formatCount, formatPercent } from "@/components/features/marketing/marketing-format";
import { cn } from "@/lib/utils";
import type { ScheduleDashboardData, ScheduleDashboardEvent, ScheduleDashboardStatus } from "@/lib/validation/schedule-dashboard";

import { AgendaAdaptiveChart } from "./AgendaAdaptiveChart";
import { AgendaDashboardKpis } from "./AgendaDashboardKpis";
import {
  AgendaSourceDistributionPanel,
  AgendaTopPerformersPanel,
  AgendaTypeDistributionPanel,
} from "./AgendaDashboardPanels";
import { AgendaNextEventCard } from "./AgendaNextEventCard";
import { AgendaUpcomingEventsPanel } from "./AgendaUpcomingEventsPanel";

export type AgendaUpcomingRead = {
  events: ScheduleDashboardEvent[];
  next7Days?: number;
  today?: number;
  isLoading: boolean;
  isError: boolean;
};

export function completedNote(data: ScheduleDashboardData, type: string, plural: string) {
  const completed = data.by_type.find((item) => item.key === type)?.completed;
  return completed === undefined ? (data.by_type.some((item) => item.completed !== undefined) ? `0 ${plural}` : undefined) : `${formatCount(completed)} ${plural}`;
}

export function AgendaOverviewTab({
  data,
  previous,
  deltaTitle,
  upcoming,
  activeStatus,
  onOpenCompromissos,
  onOpenResultados,
  onStatusSelect,
}: {
  data: ScheduleDashboardData;
  previous?: ScheduleDashboardData | null;
  deltaTitle?: string;
  upcoming: AgendaUpcomingRead;
  activeStatus?: ScheduleDashboardStatus;
  onOpenCompromissos: () => void;
  onOpenResultados: () => void;
  onStatusSelect: (status: ScheduleDashboardStatus) => void;
}) {
  const { kpis } = data;
  const segments = [
    { key: "completed", label: "Realizados", value: kpis.completed, className: "bg-primary" },
    { key: "open", label: "Em aberto", value: kpis.open, className: NEUTRAL_SOFT },
    { key: "cancelled", label: "Cancelados", value: kpis.cancelled, className: NEUTRAL_STRONG },
    { key: "no_show", label: "Não compareceu", value: kpis.no_show, className: "bg-primary/40" },
  ];

  return (
    <div className="space-y-3">
      <AgendaDashboardKpis
        kpis={kpis}
        previous={previous?.kpis}
        deltaTitle={deltaTitle}
        dateBasis={data.period.date_basis}
        activeStatus={activeStatus}
        onOpenCompromissos={onOpenCompromissos}
        onOpenResultados={onOpenResultados}
        onStatusSelect={onStatusSelect}
      />

      <div className="grid min-w-0 grid-cols-1 gap-3 @[960px]/agenda-dashboard:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 space-y-3">
          <AgendaAdaptiveChart
            hourly={data.hourly}
            daily={data.daily}
            dateFrom={data.period.date_from}
            dateTo={data.period.date_to}
            dateBasis={data.period.date_basis}
            stats={
              <div className="grid grid-cols-2 gap-2 @[640px]/agenda-dashboard:grid-cols-3 @[1040px]/agenda-dashboard:grid-cols-5">
                <StatTile label="Visitas" value={formatCount(kpis.visits)} note={completedNote(data, "visit", "realizadas")} />
                <StatTile label="Reuniões" value={formatCount(kpis.meetings)} note={completedNote(data, "meeting", "realizadas")} />
                <StatTile label="Ligações" value={formatCount(kpis.calls)} note={completedNote(data, "call", "realizadas")} />
                <StatTile
                  label="Próximos 7 dias"
                  value={formatCount(upcoming.next7Days)}
                  note={upcoming.today === undefined ? undefined : `${formatCount(upcoming.today)} hoje`}
                />
                <StatTile label="Atrasados" value={formatCount(kpis.overdue)} note="Sem resultado lançado" highlight={kpis.overdue > 0} />
              </div>
            }
          />

          <div className="grid min-w-0 grid-cols-1 gap-3 @[720px]/agenda-dashboard:grid-cols-3">
            <Panel title="Do agendado ao realizado" aside={`${formatCount(kpis.total)} compromissos`}>
              <SegmentedBar items={segments} />
              <ul className="mt-3 space-y-1.5 text-[12px] font-light">
                {segments.map((segment) => (
                  <li key={segment.key} className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5 text-[var(--app-text-secondary)]">
                      <span aria-hidden="true" className={cn("h-2.5 w-2.5 shrink-0 rounded-[2px]", segment.className)} />
                      <span className="truncate">{segment.label}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-[var(--app-text-primary)]">
                      {formatCount(segment.value)} · {kpis.total > 0 ? formatPercent((segment.value / kpis.total) * 100) : "—"}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
            <AgendaTypeDistributionPanel items={data.by_type} />
            <AgendaSourceDistributionPanel items={data.by_source} />
          </div>

          <AgendaUpcomingEventsPanel
            events={upcoming.events}
            reportTimezone={data.report_timezone}
            isLoading={upcoming.isLoading}
            isError={upcoming.isError}
            onViewAll={onOpenCompromissos}
          />
        </div>

        <div className="grid min-w-0 grid-cols-1 content-start gap-3 sm:grid-cols-2 @[960px]/agenda-dashboard:grid-cols-1">
          <AgendaNextEventCard
            event={upcoming.events[0]}
            reportTimezone={data.report_timezone}
            isLoading={upcoming.isLoading}
            isError={upcoming.isError}
          />
          <AgendaTopPerformersPanel performers={data.performer_ranking} />
        </div>
      </div>
    </div>
  );
}
