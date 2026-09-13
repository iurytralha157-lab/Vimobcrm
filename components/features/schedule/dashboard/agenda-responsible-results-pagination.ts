export const AGENDA_RESPONSIBLE_RESULTS_PAGE_SIZE = 25;

export type AgendaResponsibleResultsPage<T> = {
  items: T[];
  page: number;
  totalPages: number;
  totalItems: number;
  startIndex: number;
  from: number;
  to: number;
};

export function paginateAgendaResponsibleResults<T>(
  orderedItems: readonly T[],
  requestedPage: number,
  pageSize = AGENDA_RESPONSIBLE_RESULTS_PAGE_SIZE,
): AgendaResponsibleResultsPage<T> {
  const safePageSize = Math.max(1, Math.trunc(pageSize) || 1);
  const totalItems = orderedItems.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
  const normalizedPage = Number.isFinite(requestedPage)
    ? Math.trunc(requestedPage)
    : 1;
  const page = Math.min(totalPages, Math.max(1, normalizedPage));
  const startIndex = (page - 1) * safePageSize;
  const items = orderedItems.slice(startIndex, startIndex + safePageSize);

  return {
    items,
    page,
    totalPages,
    totalItems,
    startIndex,
    from: totalItems === 0 ? 0 : startIndex + 1,
    to: Math.min(startIndex + items.length, totalItems),
  };
}
