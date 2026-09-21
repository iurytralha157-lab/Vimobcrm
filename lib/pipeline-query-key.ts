import {
  resolvePipelineDateModeForRange,
  type PipelineDateMode,
} from './pipeline-date-mode';

export interface PipelineQueryKeyFilters {
  dateRange?: { from: Date; to: Date } | null;
  dateMode?: PipelineDateMode;
  filterTags?: string[];
  filterDealStatus?: string | null;
  searchQuery?: string | null;
  filterCampaign?: string | null;
  filterAdSet?: string | null;
  filterAd?: string | null;
  filterSource?: string | null;
  filterUserIds?: string[];
  unassigned?: boolean;
  teamId?: string | null;
}

function normalizePipelineQueryFilter(value?: string | null) {
  return value && value !== 'all' ? value : undefined;
}

function normalizePipelineQueryUserIds(userIds?: string[]) {
  if (!Array.isArray(userIds)) return undefined;
  if (userIds.length === 0) return '__none__';
  return [...new Set(userIds)].sort().join(',');
}

function normalizePipelineQueryTagIds(tagIds?: string[]) {
  if (!Array.isArray(tagIds)) return undefined;
  const normalized = [...new Set(tagIds.map((tagId) => tagId.trim()).filter(Boolean))].sort();
  return normalized.length > 0 ? normalized.join(',') : undefined;
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
    normalizePipelineQueryTagIds(filters?.filterTags),
    normalizePipelineQueryFilter(filters?.filterDealStatus),
    normalizePipelineQueryFilter(filters?.searchQuery),
    normalizePipelineQueryFilter(filters?.filterCampaign),
    normalizePipelineQueryFilter(filters?.filterAdSet),
    normalizePipelineQueryFilter(filters?.filterAd),
    normalizePipelineQueryFilter(filters?.filterSource),
    normalizePipelineQueryUserIds(filters?.filterUserIds),
    resolvePipelineDateModeForRange(filters?.dateRange, filters?.dateMode),
    filters?.unassigned ? true : undefined,
    normalizePipelineQueryFilter(filters?.teamId),
  ] as const;
}
