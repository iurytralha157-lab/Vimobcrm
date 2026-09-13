import type { ContactListFilters } from '@/hooks/use-contacts-list';

export const CONTACT_PAGE_SIZE_OPTIONS = [5, 10, 30, 50, 100] as const;

export const CONTACT_SOURCE_LABELS: Record<string, string> = {
  manual: 'Manual',
  meta: 'Meta Ads',
  site: 'Site',
};

type ContactDateRange = {
  from: Date;
  to: Date;
};

export type ContactFilterModel = {
  search: string;
  teamId: string | null;
  pipelineId: string;
  stageId: string;
  assigneeId: string | null;
  tagId: string | null;
  source: string | null;
  campaignId: string | null;
  adSetId: string | null;
  adId: string | null;
  dealStatus: string | null;
  dateRange: ContactDateRange | null;
  sortBy: ContactListFilters['sortBy'];
  sortDir: ContactListFilters['sortDir'];
  page: number;
  pageSize: number;
};

export type ContactExportFilters = Pick<
  ContactListFilters,
  | 'search'
  | 'teamId'
  | 'pipelineId'
  | 'stageId'
  | 'assigneeId'
  | 'unassigned'
  | 'tagId'
  | 'source'
  | 'campaignId'
  | 'adSetId'
  | 'adId'
  | 'dealStatus'
  | 'createdFrom'
  | 'createdTo'
>;

export function buildContactListFilters({
  search,
  teamId,
  pipelineId,
  stageId,
  assigneeId,
  tagId,
  source,
  campaignId,
  adSetId,
  adId,
  dealStatus,
  dateRange,
  sortBy,
  sortDir,
  page,
  pageSize,
}: ContactFilterModel): ContactListFilters {
  return {
    search: search || undefined,
    teamId: teamId || undefined,
    pipelineId: pipelineId !== 'all' ? pipelineId : undefined,
    stageId: stageId !== 'all' ? stageId : undefined,
    assigneeId:
      assigneeId && assigneeId !== 'all' && assigneeId !== 'unassigned'
        ? assigneeId
        : undefined,
    unassigned: assigneeId === 'unassigned',
    tagId: tagId && tagId !== 'all' ? tagId : undefined,
    source: source && source !== 'all' ? source : undefined,
    campaignId: campaignId || undefined,
    adSetId: adSetId || undefined,
    adId: adId || undefined,
    dealStatus:
      dealStatus && dealStatus !== 'all'
        ? (dealStatus as NonNullable<ContactListFilters['dealStatus']>)
        : undefined,
    createdFrom: dateRange ? dateRange.from.toISOString() : undefined,
    createdTo: dateRange ? dateRange.to.toISOString() : undefined,
    sortBy,
    sortDir,
    page,
    limit: pageSize,
    mode: 'compact',
  };
}

export function buildContactExportFilters(
  filters: ContactListFilters,
): ContactExportFilters {
  const {
    search,
    teamId,
    pipelineId,
    stageId,
    assigneeId,
    unassigned,
    tagId,
    source,
    campaignId,
    adSetId,
    adId,
    dealStatus,
    createdFrom,
    createdTo,
  } = filters;

  return {
    search,
    teamId,
    pipelineId,
    stageId,
    assigneeId,
    unassigned,
    tagId,
    source,
    campaignId,
    adSetId,
    adId,
    dealStatus,
    createdFrom,
    createdTo,
  };
}

export function getContactDealStatus(
  status: string | null | undefined,
): NonNullable<ContactListFilters['dealStatus']> {
  return status === 'won' || status === 'lost' ? status : 'open';
}

export function toggleCurrentPageSelection(
  selectedIds: ReadonlySet<string>,
  currentPageIds: readonly string[],
): Set<string> {
  if (
    selectedIds.size === currentPageIds.length &&
    currentPageIds.length > 0
  ) {
    return new Set();
  }

  return new Set(currentPageIds);
}

export function toggleContactSelection({
  selectedIds,
  currentPageIds,
  contactId,
  shiftPressed,
  lastSelectedId,
}: {
  selectedIds: ReadonlySet<string>;
  currentPageIds: readonly string[];
  contactId: string;
  shiftPressed: boolean;
  lastSelectedId: string | null;
}): Set<string> {
  const nextSelectedIds = new Set(selectedIds);

  if (shiftPressed && lastSelectedId) {
    const lastIndex = currentPageIds.indexOf(lastSelectedId);
    const currentIndex = currentPageIds.indexOf(contactId);

    if (lastIndex !== -1 && currentIndex !== -1) {
      const start = Math.min(lastIndex, currentIndex);
      const end = Math.max(lastIndex, currentIndex);
      const shouldSelect = selectedIds.has(lastSelectedId);

      for (let index = start; index <= end; index += 1) {
        const currentContactId = currentPageIds[index];
        if (shouldSelect) {
          nextSelectedIds.add(currentContactId);
        } else {
          nextSelectedIds.delete(currentContactId);
        }
      }
    }
  } else if (nextSelectedIds.has(contactId)) {
    nextSelectedIds.delete(contactId);
  } else {
    nextSelectedIds.add(contactId);
  }

  return nextSelectedIds;
}

export function parseContactPageInput(
  input: string,
  totalPages: number,
): number | null {
  const pageNumber = parseInt(input);

  return !Number.isNaN(pageNumber) &&
    pageNumber >= 1 &&
    pageNumber <= totalPages
    ? pageNumber
    : null;
}
