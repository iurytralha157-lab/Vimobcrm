import type { ScheduleDashboardDateBasis } from "@/lib/validation/schedule-dashboard";

export type AgendaDashboardTotalLabels = {
  chart: string;
  period: string;
};

export function getAgendaDashboardTotalLabels(
  dateBasis: ScheduleDashboardDateBasis,
): AgendaDashboardTotalLabels {
  if (dateBasis === "created_at") {
    return { chart: "Criados", period: "Criados no período" };
  }
  if (dateBasis === "completed_at") {
    return { chart: "Com desfecho", period: "Desfechos no período" };
  }
  return { chart: "Agendados", period: "Agendamentos no período" };
}
