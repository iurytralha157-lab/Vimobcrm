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

export type PipelineLeadMetaFilterQueryParams = {
  dateRange?: { from: Date; to: Date } | null;
  dateMode?: PipelineDateMode;
  pipelineId?: string | null;
  filterPage?: string | null;
  entryMode?: boolean;
  scopeToBoard?: boolean;
  teamId?: string | null;
  userId?: string | null;
  dealStatus?: string | null;
  tagIds?: string[];
  searchQuery?: string;
};

export function buildPipelineLeadMetaFilterQueryKey(params: {
  organizationId?: string | null;
  pipelineId?: string | null;
  pageId?: string | null;
  dateFrom?: string;
  dateTo?: string;
  dateMode?: PipelineDateMode;
  entryMode: boolean;
  scopeToBoard: boolean;
  accessSignature?: string | null;
  teamId?: string | null;
  userId?: string | null;
  dealStatus?: string | null;
  tagIds?: string[];
  searchQuery?: string;
}) {
  const scoped = params.entryMode || params.scopeToBoard;
  return [
    'shared-filter-lead-meta-filters',
    params.organizationId,
    params.pipelineId,
    params.pageId,
    params.dateFrom,
    params.dateTo,
    params.dateMode,
    params.entryMode,
    params.scopeToBoard,
    scoped ? params.accessSignature : null,
    scoped ? params.teamId : null,
    scoped ? params.userId : null,
    scoped ? params.dealStatus : null,
    scoped ? [...(params.tagIds ?? [])].sort().join(',') : null,
    scoped ? params.searchQuery : null,
  ] as const;
}

export function buildPipelineLeadMetaFilterQuery(params: PipelineLeadMetaFilterQueryParams) {
  if (params.entryMode) {
    // Dashboard options use entry cohorts and their own query vocabulary.
    return {
      pipelineId: params.pipelineId,
      filterPage: params.filterPage,
      dateFrom: params.dateRange?.from.toISOString(),
      dateTo: params.dateRange?.to.toISOString(),
      dateMode: resolvePipelineDateModeForRange(params.dateRange, params.dateMode),
      entryMode: true,
      teamId: params.teamId,
      userId: params.userId,
      dealStatus: params.dealStatus,
      tagIds: params.tagIds?.join(','),
      searchQuery: params.searchQuery,
    };
  }

  if (!params.scopeToBoard) {
    // Existing Contacts and marketing consumers keep their original options.
    return {
      pipelineId: params.pipelineId,
      filterPage: params.filterPage,
      dateFrom: params.dateRange?.from.toISOString(),
      dateTo: params.dateRange?.to.toISOString(),
      dateMode: resolvePipelineDateModeForRange(params.dateRange, params.dateMode),
    };
  }

  // The Pipeline options and board must use the same card cohort. Source and
  // campaign are deliberately omitted so a selected option does not hide peers.
  const filterUserId = params.userId && params.userId !== 'all' && params.userId !== 'unassigned'
    ? params.userId
    : undefined;
  return buildPipelineBoardQuery({
    pipelineId: params.pipelineId ?? undefined,
    filterUserId,
    filters: {
      dateRange: params.dateRange,
      dateMode: params.dateMode,
      filterPage: params.filterPage ?? undefined,
      teamId: params.teamId ?? undefined,
      unassigned: params.userId === 'unassigned',
      filterDealStatus: params.dealStatus ?? undefined,
      filterTags: params.tagIds,
      searchQuery: params.searchQuery,
    },
  });
}

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
