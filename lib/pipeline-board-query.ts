import {
  resolvePipelineDateModeForRange,
  type PipelineDateMode,
} from './pipeline-date-mode';

export type PipelineBoardQueryFilters = {
  dateRange?: { from: Date; to: Date } | null;
  dateMode?: PipelineDateMode;
  filterTags?: string[];
  filterDealStatus?: string;
  searchQuery?: string;
  filterPage?: string;
  filterCampaign?: string;
  filterAdSet?: string;
  filterAd?: string;
  filterSource?: string;
  filterUserIds?: string[];
  unassigned?: boolean;
  teamId?: string;
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
    filterTags: serializeSelectedIds(filters?.filterTags),
    filterDealStatus: filters?.filterDealStatus,
    search: filters?.searchQuery,
    filterPage: filters?.filterPage,
    filterCampaign: filters?.filterCampaign,
    filterAdSet: filters?.filterAdSet,
    filterAd: filters?.filterAd,
    filterSource: filters?.filterSource,
    filterUserIds: serializeOptionalIds(filters?.filterUserIds),
    unassigned: filters?.unassigned ? true : undefined,
    teamId: filters?.teamId,
  };
}

function serializeOptionalIds(values?: string[]) {
  if (!Array.isArray(values)) return undefined;
  if (values.length === 0) return '__none__';

  return [...new Set(values)].sort().join(',');
}

function serializeSelectedIds(values?: string[]) {
  if (!Array.isArray(values)) return undefined;
  const normalized = [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
  return normalized.length > 0 ? normalized.join(',') : undefined;
}
