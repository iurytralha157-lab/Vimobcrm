export type DashboardSource = {
  name: string;
  value: number;
  rawSource?: string;
};

export type DashboardSourceSlice = DashboardSource & {
  key: string;
  isOther: boolean;
};

export const DASHBOARD_SOURCE_SLICE_LIMIT = 7;
export const DASHBOARD_SOURCE_PAGE_SIZE = 50;

/** Bound pie geometry while keeping every raw source available in the detail. */
export function buildDashboardSourcesModel(
  data: readonly DashboardSource[],
  limit = DASHBOARD_SOURCE_SLICE_LIMIT,
) {
  const sources = data
    .filter((source) => Number.isFinite(source.value) && source.value >= 0)
    .map((source, index) => ({ ...source, key: `source:${index}:${source.rawSource ?? source.name}`, isOther: false }))
    .sort((left, right) => right.value - left.value || left.name.localeCompare(right.name, "pt-BR"));
  const total = sources.reduce((sum, source) => sum + source.value, 0);
  const positiveSources = sources.filter((source) => source.value > 0);
  const safeLimit = Math.max(1, Math.min(DASHBOARD_SOURCE_SLICE_LIMIT, Math.floor(limit) || 1));
  const slices = positiveSources.slice(0, safeLimit);
  const remaining = positiveSources.slice(safeLimit);
  if (remaining.length > 0) {
    slices.push({
      key: "aggregate:remaining-sources",
      name: "Outras origens",
      value: remaining.reduce((sum, source) => sum + source.value, 0),
      isOther: true,
    });
  }
  return { total, sources, slices, otherSourceCount: remaining.length };
}

export function filterDashboardSources(sources: readonly DashboardSourceSlice[], search: string) {
  const term = search.trim().normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pt-BR");
  if (!term) return sources;
  return sources.filter((source) => `${source.name} ${source.rawSource ?? ""}`
    .normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pt-BR").includes(term));
}

export function formatDashboardSourcePercentage(value: number, total: number) {
  const percentage = total > 0 ? value / total * 100 : 0;
  if (percentage > 0 && percentage < 0.01) return "<0,01%";
  return `${percentage.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

export function formatDashboardSourceTotal(total: number) {
  return total.toLocaleString("pt-BR", total >= 10_000
    ? { notation: "compact", maximumFractionDigits: 1 }
    : undefined);
}
