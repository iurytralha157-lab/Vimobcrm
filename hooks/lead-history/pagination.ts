import type { LeadHistoryRaw } from './types';

export const LEAD_HISTORY_FETCH_PAGE_SIZE = 100;

export type LeadHistoryPagination = { nextCursor: string | null; hasOlder: boolean; snapshotAt: string };

export type LeadHistoryPage = { data: LeadHistoryRaw; pagination: LeadHistoryPagination; legacy?: false }
  | { data: LeadHistoryRaw; legacy: true; pagination?: undefined };

export type LeadHistoryPageState = {
  raw?: LeadHistoryRaw;
  pagination?: LeadHistoryPagination;
  paginationUnavailable?: boolean;
  generation: number;
  requestedCursor?: string;
  isFetchingOlder: boolean;
  olderError: Error | null;
};

export function leadHistoryPageKeys(leadId: string | null, organizationId: string | undefined, accessScope: string) {
  return {
    // All members of this family remain UnifiedHistoryEvent[], including optimistic writes.
    projection: ['lead-history-v2', leadId, 'paged', organizationId, accessScope] as const,
    state: ['lead-history-page-state', leadId, organizationId, accessScope] as const,
  };
}

type DatedRow = { id: string; created_at?: string | null; event_at?: string | null };
const epoch = '1970-01-01T00:00:00.000Z';
const time = (row: DatedRow) => new Date(row.event_at || row.created_at || epoch).getTime();

function mergeRows<T extends DatedRow>(current: T[] = [], incoming: T[] = []): T[] {
  const rows = new Map(current.map(row => [row.id, row]));
  for (const row of incoming) {
    // Canonical IDs are unique within each source; a repeated page cannot fabricate events.
    rows.set(row.id, { ...row, created_at: row.created_at || row.event_at || epoch });
  }
  return [...rows.values()].sort((a, b) => time(a) - time(b) || a.id.localeCompare(b.id));
}

export function historyRawRowCount(raw: LeadHistoryRaw) {
  return (raw.timelineEvents?.length ?? 0) + (raw.activityEvents?.length ?? 0)
    + (raw.entryEvents?.length ?? 0) + (raw.distributionLogs?.length ?? 0)
    + (raw.assignmentLogs?.length ?? 0) + (raw.auditLogs?.length ?? 0) + (raw.queueRuntimeEvents?.length ?? 0);
}

export function mergeLeadHistoryPage(
  previous: LeadHistoryPageState | undefined,
  page: LeadHistoryPage,
  leadId: string,
  requestedCursor?: string,
): Pick<LeadHistoryPageState, 'raw' | 'pagination' | 'paginationUnavailable'> {
  if (page.legacy === true) {
    if (requestedCursor || page.data?.lead?.id !== leadId
      || Object.hasOwn(page, 'pagination') || Object.hasOwn(page.data, 'historyCoverage')) {
      throw new Error('Resposta legada do histórico inválida. Atualize o histórico.');
    }
    // Keep unknown completeness/presence explicit; do not derive missing historical facts.
    return { raw: { ...page.data, historyCoverage: { complete: false } }, paginationUnavailable: true };
  }
  const { data, pagination } = page;
  if (data.lead?.id !== leadId || !data.historyCoverage?.canonicalPresence
    || pagination.hasOlder !== Boolean(pagination.nextCursor)
    || !Number.isFinite(new Date(pagination.snapshotAt).getTime())) {
    throw new Error('Resposta de paginação do histórico inválida. Atualize o histórico.');
  }
  const current = requestedCursor ? previous?.raw : undefined;
  if (requestedCursor && (!current || previous?.pagination?.nextCursor !== requestedCursor
    || previous.pagination.snapshotAt !== pagination.snapshotAt
    || pagination.nextCursor === requestedCursor)) {
    throw new Error('A sequência de páginas do histórico mudou. Atualize o histórico.');
  }
  const priorPresence = current?.historyCoverage?.canonicalPresence;
  if (priorPresence && (['leadCreated', 'firstResponse', 'assignment'] as const)
    .some(key => priorPresence[key] !== data.historyCoverage!.canonicalPresence![key])) {
    throw new Error('O histórico mudou durante a consulta. Atualize o histórico.');
  }
  const raw: LeadHistoryRaw = {
    ...data,
    // Context is anchored to the first page. Later pages must not change derived facts.
    lead: current?.lead ?? data.lead,
    leadMeta: current ? current.leadMeta : data.leadMeta,
    timelineEvents: mergeRows(current?.timelineEvents, data.timelineEvents),
    activityEvents: mergeRows(current?.activityEvents, data.activityEvents),
    entryEvents: mergeRows(current?.entryEvents, data.entryEvents),
    distributionLogs: mergeRows(current?.distributionLogs, data.distributionLogs),
    assignmentLogs: mergeRows(current?.assignmentLogs, data.assignmentLogs),
    auditLogs: mergeRows(current?.auditLogs, data.auditLogs),
    queueRuntimeEvents: mergeRows(current?.queueRuntimeEvents, data.queueRuntimeEvents),
    users: [...new Map([...(current?.users ?? []), ...(data.users ?? [])].map(row => [row.id, row])).values()],
    historyCoverage: { ...data.historyCoverage, complete: !pagination.hasOlder },
  };
  if ((pagination.hasOlder && historyRawRowCount(data) === 0)
    || (current && historyRawRowCount(raw) === historyRawRowCount(current))) {
    throw new Error('A página do histórico não avançou. Atualize o histórico.');
  }
  return { raw, pagination, paginationUnavailable: false };
}
