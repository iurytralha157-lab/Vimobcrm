import type {
  ScheduleDashboardDateBasis,
  ScheduleDashboardPerformerRanking,
} from "@/lib/validation/schedule-dashboard";

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

export type AgendaPerformanceHighlights = {
  best: ScheduleDashboardPerformerRanking | null;
  attention: ScheduleDashboardPerformerRanking | null;
  comparableCount: number;
  bestTied: boolean;
  attentionTied: boolean;
  sameRate: boolean;
};

function comparePerformer(
  left: ScheduleDashboardPerformerRanking,
  right: ScheduleDashboardPerformerRanking,
) {
  const leftOverdueRate = left.eligible > 0 ? left.overdue / left.eligible : 0;
  const rightOverdueRate =
    right.eligible > 0 ? right.overdue / right.eligible : 0;

  return (
    right.completion_rate - left.completion_rate ||
    right.completed - left.completed ||
    left.no_show_rate - right.no_show_rate ||
    leftOverdueRate - rightOverdueRate ||
    right.total - left.total ||
    left.name.localeCompare(right.name, "pt-BR")
  );
}

export function getAgendaPerformanceHighlights(
  ranking: ScheduleDashboardPerformerRanking[],
): AgendaPerformanceHighlights {
  const comparable = ranking
    .filter((person) => person.eligible > 0)
    .slice()
    .sort(comparePerformer);
  const best = comparable[0] ?? null;
  const attention = comparable.length > 1 ? (comparable.at(-1) ?? null) : null;

  return {
    best,
    attention,
    comparableCount: comparable.length,
    bestTied: Boolean(
      best &&
      comparable.filter(
        (person) => person.completion_rate === best.completion_rate,
      ).length > 1,
    ),
    attentionTied: Boolean(
      attention &&
      comparable.filter(
        (person) => person.completion_rate === attention.completion_rate,
      ).length > 1,
    ),
    sameRate: Boolean(
      best && attention && best.completion_rate === attention.completion_rate,
    ),
  };
}
