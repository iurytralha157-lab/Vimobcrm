"use client";

import { KpiRow } from "@/components/features/marketing/marketing-ui";
import { formatCount, formatPercent } from "@/components/features/marketing/marketing-format";
import type {
  ScheduleDashboardDateBasis,
  ScheduleDashboardKpis,
  ScheduleDashboardStatus,
} from "@/lib/validation/schedule-dashboard";

import { AgendaKpiCard } from "./agenda-dashboard-ui";
import { percentDelta, pointsDelta } from "./agenda-dashboard-metrics";
import { getAgendaDashboardTotalLabels } from "./agenda-dashboard-model";

export type AgendaDashboardKpisProps = {
  kpis: ScheduleDashboardKpis;
  previous?: ScheduleDashboardKpis | null;
  deltaTitle?: string;
  dateBasis: ScheduleDashboardDateBasis;
  activeStatus?: ScheduleDashboardStatus;
  onOpenCompromissos?: () => void;
  onOpenResultados?: () => void;
  onStatusSelect?: (status: ScheduleDashboardStatus) => void;
};

/** The overview row. The other tabs have their own, over the same report. */
export function AgendaDashboardKpis({
  kpis,
  previous,
  deltaTitle,
  dateBasis,
  activeStatus,
  onOpenCompromissos,
  onOpenResultados,
  onStatusSelect,
}: AgendaDashboardKpisProps) {
  const totalLabels = getAgendaDashboardTotalLabels(dateBasis);
  // Only the scheduled-date basis counts appointments; the others state what they count.
  const totalLabel = dateBasis === "start_time" ? "Compromissos" : totalLabels.period;
  const breakdown = [
    kpis.visits > 0 ? `${formatCount(kpis.visits)} visitas` : null,
    kpis.meetings > 0 ? `${formatCount(kpis.meetings)} reuniões` : null,
  ].filter(Boolean).join(" · ");

  return (
    <KpiRow>
      <AgendaKpiCard
        label={totalLabel}
        value={formatCount(kpis.total)}
        note={breakdown || "Sem visitas ou reuniões"}
        delta={percentDelta(kpis.total, previous?.total)}
        deltaTitle={deltaTitle}
        onOpen={onOpenCompromissos}
        openLabel="Abrir lista de compromissos"
      />
      <AgendaKpiCard
        label="Taxa de realização"
        value={kpis.eligible > 0 ? formatPercent(kpis.completion_rate) : "—"}
        note={`${formatCount(kpis.completed)} de ${formatCount(kpis.eligible)} elegíveis`}
        delta={pointsDelta(kpis.completion_rate, previous?.completion_rate, previous?.eligible)}
        deltaTitle={deltaTitle}
        onOpen={onOpenResultados}
        openLabel="Abrir resultados"
      />
      <AgendaKpiCard
        label="Não compareceu"
        value={kpis.appointment_eligible > 0 ? formatPercent(kpis.no_show_rate) : "—"}
        note={`${formatCount(kpis.no_show)} de ${formatCount(kpis.appointment_eligible)} visitas e reuniões`}
        delta={pointsDelta(kpis.no_show_rate, previous?.no_show_rate, previous?.appointment_eligible, "down")}
        deltaTitle={deltaTitle}
        active={activeStatus === "no_show"}
        onOpen={onStatusSelect ? () => onStatusSelect("no_show") : undefined}
        openLabel="Filtrar quem não compareceu"
      />
      <AgendaKpiCard
        label="Atrasados"
        value={formatCount(kpis.overdue)}
        note="Sem resultado lançado"
        active={activeStatus === "overdue"}
        onOpen={onStatusSelect ? () => onStatusSelect("overdue") : undefined}
        openLabel="Filtrar compromissos em atraso"
      />
    </KpiRow>
  );
}
