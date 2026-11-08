/** Pure helpers for the Dashboard KPIs, kept apart from the components for tests. */

export type DashboardDelta = { text: string; tone: "up" | "down" };

/**
 * The API sends 0 both for "no change" and for "no previous period to compare",
 * so a zero is not shown as a comparison.
 */
export function dashboardDelta(trend: number | undefined, { lowerIsBetter = false } = {}): DashboardDelta | null {
  if (trend === undefined || !Number.isFinite(trend) || trend === 0) return null;
  const good = lowerIsBetter ? trend < 0 : trend > 0;
  return {
    text: `${trend > 0 ? "+" : ""}${trend.toLocaleString("pt-BR")}%`,
    tone: good ? "up" : "down",
  };
}

type RateInput = { totalLeads: number; openLeads?: number; lostLeads?: number; closedLeads: number };

/** Shares are over the unique cards of the cohort, never over entries. */
export function dashboardKpiRates(data: RateInput) {
  return {
    open: data.totalLeads > 0 ? ((data.openLeads ?? 0) / data.totalLeads) * 100 : 0,
    lost: data.totalLeads > 0 ? ((data.lostLeads ?? 0) / data.totalLeads) * 100 : 0,
    won: data.totalLeads > 0 ? (data.closedLeads / data.totalLeads) * 100 : 0,
  };
}

/** Cards created in each interval, the same series the evolution chart stacks. */
export function dashboardCardsSpark(points: ReadonlyArray<{ abertos: number; ganhos: number; perdas: number }>) {
  return points.map((point) => point.abertos + point.ganhos + point.perdas);
}
