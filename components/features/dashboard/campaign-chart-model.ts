export type CampaignChartItem = {
  key: string;
  name: string;
  leadCount: number;
  campaignId?: string | null;
};

export const DASHBOARD_CAMPAIGNS_PAGE_SIZE = 25;

export function campaignChartSearchRows<T extends CampaignChartItem>(rows: T[], search: string) {
  const term = campaignSearchText(search.trim());
  if (!term) return rows;
  return rows.filter((campaign) => campaignSearchText(`${campaign.name} ${campaign.campaignId ?? campaign.key}`).includes(term));
}

function campaignSearchText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
}

// Pagination limits mounted rows, not the API aggregate or its exact totals.
export function campaignChartPage<T>(rows: T[], requestedPage: number) {
  const pageCount = Math.max(1, Math.ceil(rows.length / DASHBOARD_CAMPAIGNS_PAGE_SIZE));
  const page = Math.min(pageCount, Math.max(1, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1));
  const start = (page - 1) * DASHBOARD_CAMPAIGNS_PAGE_SIZE;
  return {
    items: rows.slice(start, start + DASHBOARD_CAMPAIGNS_PAGE_SIZE),
    page,
    pageCount,
    total: rows.length,
    start: rows.length > 0 ? start + 1 : 0,
    end: Math.min(start + DASHBOARD_CAMPAIGNS_PAGE_SIZE, rows.length),
  };
}

export function campaignBarHeight(campaignCount: number) {
  if (campaignCount <= 2) return 22;
  if (campaignCount === 3) return 26;
  return 30;
}

export function campaignChartRows<T extends CampaignChartItem>(campaigns: T[]) {
  const sorted = [...campaigns].sort(
    (left, right) =>
      right.leadCount - left.leadCount ||
      left.name.localeCompare(right.name, "pt-BR") ||
      left.key.localeCompare(right.key),
  );
  const maxCount = sorted.reduce(
    (current, campaign) => Math.max(current, campaign.leadCount),
    1,
  );

  return sorted.map((campaign) => ({
    ...campaign,
    // A positive result remains visible when one campaign dwarfs the others.
    barPercent: campaign.leadCount > 0
      ? Math.max(2, (campaign.leadCount / maxCount) * 100)
      : 0,
  }));
}
