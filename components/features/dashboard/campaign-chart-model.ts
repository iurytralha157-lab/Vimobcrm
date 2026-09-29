export type CampaignChartItem = {
  key: string;
  name: string;
  leadCount: number;
};

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
