"use client";

import { KpiRow } from "@/components/features/marketing/marketing-ui";
import { formatCount, formatPercent } from "@/components/features/marketing/marketing-format";
import type { ScheduleDashboardData, ScheduleDashboardStatus } from "@/lib/validation/schedule-dashboard";

import { AgendaDataQualityNotice } from "./AgendaDataQualityNotice";
import {
  AgendaCompletedBySourcePanel,
  AgendaDataQualityPanel,
  AgendaOutcomeDistributionPanel,
  AgendaWeeklyCompletionPanel,
} from "./AgendaDashboardPanels";
import { AgendaKpiCard } from "./agenda-dashboard-ui";
import { buildWeeklyCompletion, countDelta } from "./agenda-dashboard-metrics";

export function AgendaResultsTab({
  data,
  previous,
  deltaTitle,
  activeStatus,
  onStatusSelect,
}: {
  data: ScheduleDashboardData;
  previous?: ScheduleDashboardData | null;
  deltaTitle?: string;
  activeStatus?: ScheduleDashboardStatus;
  onStatusSelect: (status: ScheduleDashboardStatus) => void;
}) {
  const { kpis } = data;
  const visitsCompleted = data.by_type.some((item) => item.completed !== undefined)
    ? (data.by_type.find((item) => item.key === "visit")?.completed ?? 0)
    : null;
  const previousVisitsCompleted = previous?.by_type.some((item) => item.completed !== undefined)
    ? (previous.by_type.find((item) => item.key === "visit")?.completed ?? 0)
    : null;

  return (
    <div className="space-y-3">
      <KpiRow>
        <AgendaKpiCard
          label="Realizados"
          value={formatCount(kpis.completed)}
          note={kpis.eligible > 0 ? `${formatPercent(kpis.completion_rate)} dos elegíveis` : "Sem base elegível"}
          delta={countDelta(kpis.completed, previous?.kpis.completed)}
          deltaTitle={deltaTitle}
          active={activeStatus === "completed"}
          onOpen={() => onStatusSelect("completed")}
          openLabel="Filtrar compromissos realizados"
        />
        <AgendaKpiCard
          label="Visitas realizadas"
          value={formatCount(visitsCompleted)}
          note={visitsCompleted !== null && kpis.visits > 0 ? `${formatPercent((visitsCompleted / kpis.visits) * 100)} das visitas` : undefined}
          delta={visitsCompleted === null ? null : countDelta(visitsCompleted, previousVisitsCompleted)}
          deltaTitle={deltaTitle}
        />
        <AgendaKpiCard
          label="Cancelados"
          value={formatCount(kpis.cancelled)}
          note={kpis.total > 0 ? `${formatPercent((kpis.cancelled / kpis.total) * 100)} do total` : undefined}
          delta={countDelta(kpis.cancelled, previous?.kpis.cancelled, "down")}
          deltaTitle={deltaTitle}
          active={activeStatus === "cancelled"}
          onOpen={() => onStatusSelect("cancelled")}
          openLabel="Filtrar compromissos cancelados"
        />
        <AgendaKpiCard
          label="Não compareceu"
          value={formatCount(kpis.no_show)}
          note={kpis.appointment_eligible > 0 ? `${formatPercent(kpis.no_show_rate)} de visitas e reuniões` : undefined}
          delta={countDelta(kpis.no_show, previous?.kpis.no_show, "down")}
          deltaTitle={deltaTitle}
          active={activeStatus === "no_show"}
          onOpen={() => onStatusSelect("no_show")}
          openLabel="Filtrar quem não compareceu"
        />
      </KpiRow>

      <div className="grid min-w-0 grid-cols-1 gap-3 @[720px]/agenda-dashboard:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <AgendaOutcomeDistributionPanel items={data.by_outcome} />
        <AgendaCompletedBySourcePanel items={data.by_source} />
        <AgendaWeeklyCompletionPanel weeks={buildWeeklyCompletion(data.daily)} />
        <AgendaDataQualityPanel quality={data.data_quality} overdue={kpis.overdue}>
          <AgendaDataQualityNotice quality={data.data_quality} />
        </AgendaDataQualityPanel>
      </div>
    </div>
  );
}
