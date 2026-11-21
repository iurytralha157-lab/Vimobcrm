"use client";

import { KpiRow } from "@/components/features/marketing/marketing-ui";
import { formatCount } from "@/components/features/marketing/marketing-format";
import type {
  ScheduleDashboardDateBasis,
  ScheduleDashboardEventType,
  ScheduleDashboardKpis,
  ScheduleDashboardStatus,
} from "@/lib/validation/schedule-dashboard";

import { AgendaKpiCard } from "./agenda-dashboard-ui";
import { getAgendaDashboardTotalLabels } from "./agenda-dashboard-model";

export type AgendaDashboardKpisProps = {
  kpis: ScheduleDashboardKpis;
  dateBasis: ScheduleDashboardDateBasis;
  activeType?: ScheduleDashboardEventType;
  activeStatus?: ScheduleDashboardStatus;
  onOpenCompromissos?: () => void;
  onTypeSelect?: (type: ScheduleDashboardEventType) => void;
  onStatusSelect?: (status: ScheduleDashboardStatus) => void;
};

export function AgendaDashboardKpis({
  kpis,
  dateBasis,
  activeType,
  activeStatus,
  onOpenCompromissos,
  onTypeSelect,
  onStatusSelect,
}: AgendaDashboardKpisProps) {
  const totalLabel = dateBasis === "start_time" ? "Compromissos" : getAgendaDashboardTotalLabels(dateBasis).period;

  return (
    <KpiRow>
      <AgendaKpiCard
        label={totalLabel}
        value={formatCount(kpis.total)}
        onOpen={onOpenCompromissos}
        openLabel="Abrir lista de compromissos"
      />
      <AgendaKpiCard
        label="Reuniões"
        value={formatCount(kpis.meetings)}
        active={activeType === "meeting"}
        onOpen={onTypeSelect ? () => onTypeSelect("meeting") : undefined}
        openLabel="Filtrar reuniões"
      />
      <AgendaKpiCard
        label="Visitas"
        value={formatCount(kpis.visits)}
        active={activeType === "visit"}
        onOpen={onTypeSelect ? () => onTypeSelect("visit") : undefined}
        openLabel="Filtrar visitas"
      />
      <AgendaKpiCard
        label="Em atraso"
        value={formatCount(kpis.overdue)}
        active={activeStatus === "overdue"}
        emphasis={kpis.overdue > 0}
        onOpen={onStatusSelect ? () => onStatusSelect("overdue") : undefined}
        openLabel="Filtrar compromissos em atraso"
      />
    </KpiRow>
  );
}
