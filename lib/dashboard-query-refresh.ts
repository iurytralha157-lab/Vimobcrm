import type { Query, QueryClient } from '@tanstack/react-query';
import { captureQueryClientAccess } from '@/lib/access/query-client-access';

const DASHBOARD_REFRESH_KEYS = new Set([
  'enhanced-dashboard-stats',
  'funnel-data',
  'lead-sources-data',
  'deals-evolution',
  'dashboard-extra-counts',
  'dashboard-lead-distribution',
  'dashboard-campaigns',
  'dashboard-creatives',
  'dashboard-first-contact',
  'dashboard-first-contact-leads',
  'dashboard-lead-entries',
  'dashboard-visits',
]);

export function isDashboardRefreshQueryKey(prefix: string): boolean {
  return DASHBOARD_REFRESH_KEYS.has(prefix);
}

type Owner = object;
type AccessCheck = () => boolean;
type PendingRefresh = Map<Owner, AccessCheck>;
type Coordinator = {
  owners: Set<Owner>;
  pending: Map<Query, PendingRefresh>;
  invalidate: (owner: Owner, prefix: string) => void;
  dispose: () => void;
};

const coordinators = new WeakMap<QueryClient, Map<string, Coordinator>>();

function createCoordinator(client: QueryClient, organizationId: string): Coordinator {
  const cache = client.getQueryCache();
  const owners = new Set<Owner>();
  const pending = new Map<Query, PendingRefresh>();
  let flushQueued = false;

  const refresh = (query: Query) => {
    query.invalidate();
    void client.refetchQueries(
      {
        queryKey: query.queryKey,
        exact: true,
        type: 'active',
        predicate: (candidate) => candidate === query,
      },
      { cancelRefetch: false },
    );
  };

  const flush = () => {
    flushQueued = false;
    if (owners.size === 0) return;
    for (const [query, requests] of pending) {
      if (cache.get(query.queryHash) !== query) {
        pending.delete(query);
        continue;
      }
      if (query.state.fetchStatus !== 'idle') continue;
      // Remove before refetching: a new event during that read needs its own turn.
      pending.delete(query);
      if ([...requests].some(([owner, isCurrentAccess]) => owners.has(owner) && isCurrentAccess())) {
        refresh(query);
      }
    }
  };

  const unsubscribe = cache.subscribe((event) => {
    if (!pending.has(event.query)) return;
    if (event.type === 'removed') {
      pending.delete(event.query);
      return;
    }
    // Paused/offline requests are still in flight. Wait for the actual settlement.
    if (event.query.state.fetchStatus === 'idle' && !flushQueued) {
      flushQueued = true;
      queueMicrotask(flush);
    }
  });

  return {
    owners,
    pending,
    invalidate(owner, prefix) {
      if (!owners.has(owner) || !isDashboardRefreshQueryKey(prefix)) return;
      const isCurrentAccess = captureQueryClientAccess(client);
      if (!isCurrentAccess()) return;
      for (const query of cache.findAll({ queryKey: [prefix, organizationId] })) {
        if (query.state.fetchStatus === 'idle') {
          // A read started after this event also satisfies an older queued event.
          pending.delete(query);
          refresh(query);
          continue;
        }
        const requests = pending.get(query) ?? new Map<Owner, AccessCheck>();
        requests.set(owner, isCurrentAccess);
        pending.set(query, requests);
        query.invalidate();
      }
    },
    dispose() {
      unsubscribe();
      pending.clear();
    },
  };
}

/** Share trailing reads across the Lead and Backend buses without changing other domains. */
export function createDashboardQueryRefresh(client: QueryClient, organizationId: string) {
  let byOrganization = coordinators.get(client);
  if (!byOrganization) {
    byOrganization = new Map();
    coordinators.set(client, byOrganization);
  }
  let coordinator = byOrganization.get(organizationId);
  if (!coordinator) {
    coordinator = createCoordinator(client, organizationId);
    byOrganization.set(organizationId, coordinator);
  }
  const shared = coordinator;
  const owner: Owner = {};
  shared.owners.add(owner);
  let disposed = false;
  return {
    invalidate: (prefix: string) => shared.invalidate(owner, prefix),
    dispose() {
      if (disposed) return;
      disposed = true;
      shared.owners.delete(owner);
      for (const [query, requests] of shared.pending) {
        requests.delete(owner);
        if (requests.size === 0) shared.pending.delete(query);
      }
      if (shared.owners.size === 0) {
        shared.dispose();
        byOrganization.delete(organizationId);
        if (byOrganization.size === 0) coordinators.delete(client);
      }
    },
  };
}
