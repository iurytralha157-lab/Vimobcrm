export interface PipelineQueryKeyFilters {
  dateRange?: { from: Date; to: Date } | null;
  filterTag?: string | null;
  filterDealStatus?: string | null;
  searchQuery?: string | null;
  filterCampaign?: string | null;
  filterAdSet?: string | null;
  filterAd?: string | null;
  filterSource?: string | null;
  filterUserIds?: string[];
}

function normalizePipelineQueryFilter(value?: string | null) {
  return value && value !== 'all' ? value : undefined;
}

function normalizePipelineQueryUserIds(userIds?: string[]) {
  if (!userIds?.length) return undefined;
  return [...new Set(userIds)].sort().join(',');
}

export function stageWithLeadsQueryKey(params: {
  organizationId?: string;
  pipelineId?: string;
  filterUserId?: string;
  filters?: PipelineQueryKeyFilters;
}) {
  const { organizationId, pipelineId, filterUserId, filters } = params;

  return [
    'stages-with-leads',
    organizationId,
    pipelineId,
    filterUserId,
    filters?.dateRange?.from?.toISOString(),
    filters?.dateRange?.to?.toISOString(),
    normalizePipelineQueryFilter(filters?.filterTag),
    normalizePipelineQueryFilter(filters?.filterDealStatus),
    normalizePipelineQueryFilter(filters?.searchQuery),
    normalizePipelineQueryFilter(filters?.filterCampaign),
    normalizePipelineQueryFilter(filters?.filterAdSet),
    normalizePipelineQueryFilter(filters?.filterAd),
    normalizePipelineQueryFilter(filters?.filterSource),
    normalizePipelineQueryUserIds(filters?.filterUserIds),
  ] as const;
}
