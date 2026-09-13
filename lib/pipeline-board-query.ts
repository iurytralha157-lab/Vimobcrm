import {
  resolvePipelineDateModeForRange,
  type PipelineDateMode,
} from './pipeline-date-mode';

export type PipelineBoardQueryFilters = {
  dateRange?: { from: Date; to: Date } | null;
  dateMode?: PipelineDateMode;
  filterTag?: string;
  filterDealStatus?: string;
  searchQuery?: string;
  filterCampaign?: string;
  filterAdSet?: string;
  filterAd?: string;
  filterSource?: string;
  filterUserIds?: string[];
};

export function buildPipelineBoardQuery(params: {
  pipelineId?: string;
  stageId?: string;
  offset?: number;
  cursorBefore?: string;
  cursorBeforeId?: string;
  filterUserId?: string;
  filters?: PipelineBoardQueryFilters;
  limit?: number;
}) {
  const filters = params.filters;
  const hasCompleteCursor = Boolean(params.cursorBefore && params.cursorBeforeId);

  return {
    pipelineId: params.pipelineId,
    stageId: params.stageId,
    offset: params.offset,
    cursorBefore: hasCompleteCursor ? params.cursorBefore : undefined,
    cursorBeforeId: hasCompleteCursor ? params.cursorBeforeId : undefined,
    limit: params.limit,
    filterUserId: params.filterUserId,
    dateFrom: filters?.dateRange?.from.toISOString(),
    dateTo: filters?.dateRange?.to.toISOString(),
    dateMode: resolvePipelineDateModeForRange(filters?.dateRange, filters?.dateMode),
    filterTag: filters?.filterTag,
    filterDealStatus: filters?.filterDealStatus,
    search: filters?.searchQuery,
    filterCampaign: filters?.filterCampaign,
    filterAdSet: filters?.filterAdSet,
    filterAd: filters?.filterAd,
    filterSource: filters?.filterSource,
    filterUserIds: serializeOptionalIds(filters?.filterUserIds),
  };
}

function serializeOptionalIds(values?: string[]) {
  if (!Array.isArray(values)) return undefined;
  if (values.length === 0) return '__none__';

  return [...new Set(values)].sort().join(',');
}
