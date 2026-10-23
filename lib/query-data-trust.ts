import type { Query, QueryClient } from '@tanstack/react-query';
import { isSharedFilterOptionsAccessDenied } from '@/lib/filters/shared-filter-options';

type Trust = 'trusted' | 'pending' | 'blocked';
type History = {
  scope: string;
  dataCount: number;
  errorCount: number;
  trusted: boolean;
  blocked: boolean;
  fetchScope: string | null;
  scopes: Map<string, number>;
  listeners: Set<() => void>;
};

// Only authorization history, never response data. A removed Query can be collected.
const histories = new WeakMap<Query, History>();
const observers = new WeakMap<QueryClient, { count: number; unsubscribe: () => void }>();

function isDenied(query: Query) {
  return isSharedFilterOptionsAccessDenied(query.state.error)
    || isSharedFilterOptionsAccessDenied(query.state.fetchFailureReason);
}

function readTrust(query: Query, scope: string): Trust {
  if (isDenied(query)) return 'blocked';
  const history = histories.get(query);
  if (history) {
    if (history.scope !== scope || history.blocked) return 'blocked';
    // A success/error while no consumer was observing may have been a manual
    // cache write or may conceal a denial. Do not infer permission from that gap.
    if (history.dataCount !== query.state.dataUpdateCount
      || history.errorCount !== query.state.errorUpdateCount) return 'blocked';
    if (history.trusted) return 'trusted';
    // A first transient failure is not a denial when its full history was
    // observed. Keep the consumer's ordinary error/fallback behavior.
    if (query.state.data === undefined) return 'pending';
  } else if (query.state.status === 'success' && query.state.errorUpdateCount === 0
    && query.state.fetchFailureCount === 0) {
    // Preserve the QueryClient's fresh successful cache on first opt-in. Once
    // observed, only a real complete fetch can recover a denied snapshot.
    return 'trusted';
  }
  return query.state.data !== undefined || query.state.status === 'error' ? 'blocked' : 'pending';
}

function observe(client: QueryClient) {
  const existing = observers.get(client);
  if (existing) { existing.count++; return; }
  const observer = { count: 1, unsubscribe: () => {} };
  observer.unsubscribe = client.getQueryCache().subscribe((event) => {
    const history = histories.get(event.query);
    if (!history) return;
    if (event.type === 'removed') {
      history.blocked = true;
      history.trusted = false;
      observer.count--;
      if (observer.count === 0) { observer.unsubscribe(); observers.delete(client); }
    } else if (event.type === 'updated') {
      const action = event.action;
      if (action.type === 'fetch') {
        history.fetchScope = history.scopes.size > 1 ? null
          : history.scopes.keys().next().value ?? history.scope;
      }
      if ((action.type === 'failed' || action.type === 'error')
        && isSharedFilterOptionsAccessDenied(action.error)) {
        history.blocked = true;
        history.trusted = false;
      }
      if (action.type === 'success' && !action.manual) {
        const incremental = Boolean(event.query.state.fetchMeta?.fetchMore);
        // Another page does not revalidate the retained old pages. Neither a
        // manual cache write nor cancel(revert) can restore denied data.
        if (!incremental && history.fetchScope === history.scope) {
          history.blocked = false;
          history.trusted = true;
        }
      }
      history.dataCount = event.query.state.dataUpdateCount;
      history.errorCount = event.query.state.errorUpdateCount;
    }
    for (const listener of history.listeners) listener();
  });
  observers.set(client, observer);
}

export function createQueryDataTrustStore(client: QueryClient, query: Query | undefined, scope: string | null) {
  const getSnapshot = (): Trust => {
    if (!scope || !query) return 'pending';
    if (client.getQueryCache().get(query.queryHash) !== query) return 'blocked';
    return readTrust(query, scope);
  };

  return {
    getSnapshot,
    subscribe(onChange: () => void) {
      if (!scope || !query) return () => {};
      const initial = getSnapshot();
      let history = histories.get(query);
      if (!history) {
        history = {
          scope, dataCount: query.state.dataUpdateCount, errorCount: query.state.errorUpdateCount,
          trusted: initial === 'trusted', blocked: initial === 'blocked',
          fetchScope: query.state.fetchStatus === 'idle' ? null : scope,
          scopes: new Map(), listeners: new Set(),
        };
        histories.set(query, history);
        observe(client);
      } else if (history.scope !== scope) {
        history.scope = scope;
        history.blocked = true;
        history.trusted = false;
        history.fetchScope = null;
        // A→B→A must not revive a fetch from the previous visit to A.
      } else if (initial === 'blocked') {
        history.blocked = true;
        history.trusted = false;
      }
      const activeHistory = history;
      activeHistory.scopes.set(scope, (activeHistory.scopes.get(scope) ?? 0) + 1);
      activeHistory.listeners.add(onChange);
      for (const listener of activeHistory.listeners) listener();
      return () => {
        activeHistory.listeners.delete(onChange);
        const remaining = (activeHistory.scopes.get(scope) ?? 1) - 1;
        if (remaining) activeHistory.scopes.set(scope, remaining);
        else activeHistory.scopes.delete(scope);
        // Keep the single cache listener until Query removal/GC. Otherwise a
        // failed 403 followed by cancel(revert) is invisible across unmount.
      };
    },
  };
}
