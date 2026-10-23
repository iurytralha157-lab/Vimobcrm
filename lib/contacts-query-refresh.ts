import type { Query, QueryClient } from '@tanstack/react-query';
import { captureQueryClientAccess } from '@/lib/access/query-client-access';

/** Keep a same-tenant event pending until its earlier Contacts read has settled. */
export function createContactsQueryRefresh(client: QueryClient, organizationId: string) {
  const cache = client.getQueryCache();
  const pending = new Map<Query, () => boolean>();
  let active = true;
  let flushQueued = false;

  const refresh = (query: Query) => {
    query.invalidate();
    void client.refetchQueries(
      { queryKey: query.queryKey, exact: true, type: 'active', predicate: candidate => candidate === query },
      { cancelRefetch: false },
    );
  };

  const flush = () => {
    flushQueued = false;
    if (!active) return;
    for (const [query, isCurrentAccess] of pending) {
      if (cache.get(query.queryHash) !== query || !isCurrentAccess()) {
        pending.delete(query);
        continue;
      }
      // Paused/offline reads have not settled either.
      if (query.state.fetchStatus !== 'idle') continue;
      // Remove first so an event during this new read gets its own trailing turn.
      pending.delete(query);
      refresh(query);
    }
  };

  const unsubscribe = cache.subscribe(event => {
    if (!pending.has(event.query)) return;
    if (event.type === 'removed') {
      pending.delete(event.query);
    } else if (event.query.state.fetchStatus === 'idle' && !flushQueued) {
      flushQueued = true;
      queueMicrotask(flush);
    }
  });

  return {
    invalidate() {
      const isCurrentAccess = captureQueryClientAccess(client);
      if (!active || !isCurrentAccess()) return;
      for (const query of cache.findAll({ queryKey: ['contacts-list', organizationId] })) {
        if (query.state.fetchStatus === 'idle') {
          // A read started after this event also satisfies any previous event.
          pending.delete(query);
          refresh(query);
        } else {
          pending.set(query, isCurrentAccess);
          query.invalidate();
        }
      }
    },
    dispose() {
      active = false;
      unsubscribe();
      pending.clear();
    },
  };
}
