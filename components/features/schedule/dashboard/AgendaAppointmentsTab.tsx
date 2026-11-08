"use client";

import { EmptyNote, KpiRow, Panel } from "@/components/features/marketing/marketing-ui";
import { formatCount } from "@/components/features/marketing/marketing-format";
import type { ScheduleDashboardData, ScheduleDashboardEventType, ScheduleDashboardQuery } from "@/lib/validation/schedule-dashboard";

import { AgendaEventsPanel } from "./AgendaEventsPanel";
import { completedNote, type AgendaUpcomingRead } from "./AgendaOverviewTab";
import { AgendaBarRow, AgendaKpiCard } from "./agenda-dashboard-ui";
import { buildHourRows, buildWeekdayDistribution, percentDelta } from "./agenda-dashboard-metrics";

function DistributionRows({ rows }: { rows: Array<{ key: string; label: string; total: number }> }) {
  const peak = Math.max(...rows.map((row) => row.total), 0);
  return (
    <div className="space-y-2.5">
      {rows.map((row) => (
        <AgendaBarRow
          key={row.key}
          label={row.label}
          value={formatCount(row.total)}
          percent={peak > 0 ? (row.total / peak) * 100 : 0}
          highlight={peak > 0 && row.total === peak}
        />
      ))}
    </div>
  );
}

export function AgendaAppointmentsTab({
  data,
  previous,
  deltaTitle,
  filters,
  eventsEnabled,
  lifecycleRevision,
  upcoming,
  onTypeSelect,
  onOpenNext7Days,
}: {
  data: ScheduleDashboardData;
  previous?: ScheduleDashboardData | null;
  deltaTitle?: string;
  filters: ScheduleDashboardQuery;
  eventsEnabled: boolean;
  lifecycleRevision: number;
  upcoming: AgendaUpcomingRead;
  onTypeSelect: (type: ScheduleDashboardEventType) => void;
  onOpenNext7Days: () => void;
}) {
  const { kpis } = data;
  const hourRows = buildHourRows(data);
  const weekdayRows = buildWeekdayDistribution(data.daily);
  const hasWeekdayData = weekdayRows.some((row) => row.total > 0);

  return (
    <div className="space-y-3">
      <KpiRow>
        <AgendaKpiCard
          label="Visitas"
          value={formatCount(kpis.visits)}
          note={completedNote(data, "visit", "realizadas")}
          delta={percentDelta(kpis.visits, previous?.kpis.visits)}
          deltaTitle={deltaTitle}
          active={filters.eventType === "visit"}
          onOpen={() => onTypeSelect("visit")}
          openLabel="Filtrar visitas"
        />
        <AgendaKpiCard
          label="Reuniões"
          value={formatCount(kpis.meetings)}
          note={completedNote(data, "meeting", "realizadas")}
          delta={percentDelta(kpis.meetings, previous?.kpis.meetings)}
          deltaTitle={deltaTitle}
          active={filters.eventType === "meeting"}
          onOpen={() => onTypeSelect("meeting")}
          openLabel="Filtrar reuniões"
        />
        <AgendaKpiCard
          label="Ligações"
          value={formatCount(kpis.calls)}
          note={completedNote(data, "call", "realizadas")}
          delta={percentDelta(kpis.calls, previous?.kpis.calls)}
          deltaTitle={deltaTitle}
          active={filters.eventType === "call"}
          onOpen={() => onTypeSelect("call")}
          openLabel="Filtrar ligações"
        />
        <AgendaKpiCard
          label="Próximos 7 dias"
          value={formatCount(upcoming.next7Days)}
          note={upcoming.today === undefined ? undefined : `${formatCount(upcoming.today)} hoje`}
          onOpen={onOpenNext7Days}
          openLabel="Listar os próximos 7 dias"
        />
      </KpiRow>

      <div className="grid min-w-0 grid-cols-1 gap-3 @[720px]/agenda-dashboard:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Panel title="Em que horário" aside="Compromissos por hora">
          {hourRows === null ? (
            <EmptyNote>Este indicador ainda não está disponível nesta versão do serviço.</EmptyNote>
          ) : hourRows.length === 0 ? (
            <EmptyNote>Nenhum compromisso com horário neste recorte.</EmptyNote>
          ) : (
            <DistributionRows rows={hourRows} />
          )}
        </Panel>
        <Panel title="Em que dia da semana" aside="Compromissos no período">
          {hasWeekdayData ? (
            <DistributionRows rows={weekdayRows} />
          ) : (
            <EmptyNote>Nenhum compromisso neste recorte.</EmptyNote>
          )}
        </Panel>
      </div>

      <AgendaEventsPanel
        key={filters.status ?? "all"}
        filters={filters}
        period={data.period}
        reportTimezone={data.report_timezone}
        enabled={eventsEnabled}
        lifecycleRevision={lifecycleRevision}
        overdueRevision={kpis.overdue}
      />
    </div>
  );
}
