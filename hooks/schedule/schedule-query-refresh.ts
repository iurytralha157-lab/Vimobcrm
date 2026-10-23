import type { Query, QueryClient, QueryFilters } from "@tanstack/react-query";

type RefreshState = { requested: boolean; promise: Promise<void> };
const pendingRefreshes = new WeakMap<Query, RefreshState>();

function isCurrentQuery(client: QueryClient, query: Query) {
  return client.getQueryCache().get(query.queryHash) === query;
}

function waitUntilSettled(client: QueryClient, query: Query): Promise<void> {
  if (!isCurrentQuery(client, query) || query.state.fetchStatus === "idle") {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const check = () => {
      if (!isCurrentQuery(client, query) || query.state.fetchStatus === "idle") {
        unsubscribe();
        resolve();
      }
    };
    const unsubscribe = client.getQueryCache().subscribe(check);
    check();
  });
}

function queueRefresh(client: QueryClient, query: Query): Promise<void> {
  const pending = pendingRefreshes.get(query);
  if (pending) {
    pending.requested = true;
    return pending.promise;
  }
  const state: RefreshState = { requested: true, promise: Promise.resolve() };
  pendingRefreshes.set(query, state);
  state.promise = Promise.resolve().then(async () => {
    try {
      while (state.requested && isCurrentQuery(client, query)) {
        // A first load has no cached data: normal invalidateQueries would reuse
        // its old promise, and its success would erase the invalidation.
        await waitUntilSettled(client, query);
        if (!isCurrentQuery(client, query)) return;
        if (!query.isActive()) {
          query.invalidate();
          return;
        }
        state.requested = false;
        await client.refetchQueries(
          { queryKey: query.queryKey, exact: true, predicate: (candidate) => candidate === query },
          { cancelRefetch: false, throwOnError: false },
        );
      }
    } finally {
      if (pendingRefreshes.get(query) === state) pendingRefreshes.delete(query);
    }
  });
  return state.promise;
}

/** Coalesce bursts, but always read again after a change received mid-request. */
export function refreshScheduleQueries(client: QueryClient, filters: QueryFilters): Promise<void> {
  const queries = client.getQueryCache().findAll(filters);
  void client.invalidateQueries({ ...filters, refetchType: "none" });
  return Promise.all(queries.map((query) => {
    if (!query.isActive() && query.state.fetchStatus === "idle") return Promise.resolve();
    return queueRefresh(client, query);
  })).then(() => undefined);
}
