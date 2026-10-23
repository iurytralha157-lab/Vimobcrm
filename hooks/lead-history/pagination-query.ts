import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { isDefinitiveLeadReadDenial } from '@/lib/lead-read-access';

import { mergeLeadHistoryPage, type LeadHistoryPage, type LeadHistoryPageState } from './pagination';
import type { LeadHistoryRaw, UnifiedHistoryEvent } from './types';

export type LeadHistoryPageQuery = {
  queryClient: QueryClient;
  projectionKey: QueryKey;
  stateKey: QueryKey;
  leadId: string;
  loadPage: (signal: AbortSignal, cursor?: string) => Promise<LeadHistoryPage>;
  build: (raw: LeadHistoryRaw) => UnifiedHistoryEvent[];
};

export async function fetchLeadHistoryProjection(context: LeadHistoryPageQuery, signal: AbortSignal) {
  const { queryClient, projectionKey, stateKey, leadId, loadPage, build } = context;
  signal.throwIfAborted();
  const previous = queryClient.getQueryData<LeadHistoryPageState>(stateKey);
  const cursor = previous?.requestedCursor;
  const generation = (previous?.generation ?? 0) + 1;
  queryClient.setQueryData<LeadHistoryPageState>(stateKey, {
    ...previous, requestedCursor: undefined, generation, isFetchingOlder: Boolean(cursor), olderError: null,
  });
  const ownsGeneration = () => queryClient.getQueryData<LeadHistoryPageState>(stateKey)?.generation === generation;
  const query = queryClient.getQueryCache().find({ queryKey: projectionKey, exact: true });
  let invalidatedDuringFetch = false;
  const unsubscribe = queryClient.getQueryCache().subscribe(event => {
    if (event.type === 'updated' && event.query === query && event.action.type === 'invalidate') {
      invalidatedDuringFetch = true;
    }
  });
  const abort = () => {
    if (ownsGeneration()) queryClient.setQueryData<LeadHistoryPageState>(stateKey, {
      ...previous, requestedCursor: undefined, generation: generation + 1,
      isFetchingOlder: false, olderError: null,
    });
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    // Both initial and older requests run in the ARRAY query. Existing prefix cancel/refetch
    // operations therefore cancel their AbortSignal, without touching an InfiniteData cache.
    const page = await loadPage(signal, cursor);
    signal.throwIfAborted();
    if (!ownsGeneration()) throw new DOMException('Consulta substituída', 'AbortError');
    const merged = mergeLeadHistoryPage(previous, page, leadId, cursor);
    let events = build(merged.raw!);
    if (cursor) {
      const loadedIds = new Set(events.map(event => event.id));
      const optimistic = (queryClient.getQueryData<UnifiedHistoryEvent[]>(projectionKey) ?? [])
        .filter(event => event.id.startsWith('optimistic-') && !loadedIds.has(event.id));
      events = [...events, ...optimistic].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    }
    signal.throwIfAborted();
    queryClient.setQueryData<LeadHistoryPageState>(stateKey, {
      ...merged, generation, isFetchingOlder: false, olderError: null,
    });
    return events;
  } catch (error) {
    if (!signal.aborted && ownsGeneration() && isDefinitiveLeadReadDenial(error)) {
      queryClient.setQueryData<LeadHistoryPageState>(stateKey, { generation: generation + 1, isFetchingOlder: false, olderError: null });
      queryClient.setQueryData<UnifiedHistoryEvent[]>(projectionKey, []);
      throw error;
    }
    if (ownsGeneration()) {
      queryClient.setQueryData<LeadHistoryPageState>(stateKey, {
        ...previous, requestedCursor: undefined, generation, isFetchingOlder: false,
        olderError: cursor && !signal.aborted ? error instanceof Error ? error : new Error('Erro ao buscar histórico anterior') : null,
      });
    }
    if (signal.aborted || !cursor) throw error;
    // An older-page error does not erase already loaded history or claim completeness.
    return queryClient.getQueryData<UnifiedHistoryEvent[]>(projectionKey) ?? build(previous!.raw!);
  } finally {
    signal.removeEventListener('abort', abort);
    unsubscribe();
    if (invalidatedDuringFetch && !signal.aborted && ownsGeneration()) {
      // Realtime uses cancelRefetch:false. Its in-flight promise may otherwise consume
      // the invalidation and mark a stale page fresh. Recheck after QueryCore commits it.
      setTimeout(() => {
        if (ownsGeneration()) void queryClient.invalidateQueries({ queryKey: projectionKey, exact: true });
      }, 0);
    }
  }
}

export async function fetchOlderLeadHistory(queryClient: QueryClient, projectionKey: QueryKey, stateKey: QueryKey) {
  const state = queryClient.getQueryData<LeadHistoryPageState>(stateKey);
  const query = queryClient.getQueryCache().find({ queryKey: projectionKey, exact: true });
  if (!state?.pagination?.nextCursor || state.isFetchingOlder || state.requestedCursor
    || !query || query.state.fetchStatus !== 'idle' || query.state.isInvalidated) return false;
  queryClient.setQueryData<LeadHistoryPageState>(stateKey, {
    ...state, requestedCursor: state.pagination.nextCursor, isFetchingOlder: true, olderError: null,
  });
  // Use the existing queryFn; installing a one-off fetchQuery fn could corrupt future refreshes.
  await queryClient.refetchQueries({ queryKey: projectionKey, exact: true, type: 'active' }, { cancelRefetch: false });
  const after = queryClient.getQueryData<LeadHistoryPageState>(stateKey);
  if (after?.requestedCursor) {
    queryClient.setQueryData<LeadHistoryPageState>(stateKey, { ...after, requestedCursor: undefined, isFetchingOlder: false });
  }
  return Boolean(after?.pagination && !after.olderError
    && after.pagination.snapshotAt === state.pagination.snapshotAt
    && after.pagination.nextCursor !== state.pagination.nextCursor);
}
