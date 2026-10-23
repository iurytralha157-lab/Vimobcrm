'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient, type QueryKey, type UseQueryOptions, type UseQueryResult } from '@tanstack/react-query';
import { createQueryDataTrustStore } from '@/lib/query-data-trust';

export type QueryDataTrustScope = { accessSignature: string; isReady: boolean };
export type QueryWithDataTrust<T, E = Error> = UseQueryResult<T, E> & {
  displayData: T | undefined;
  isAccessBlocked: boolean;
};

export function useQueryDataTrust(
  queryKey: QueryKey,
  result: { error: unknown; isSuccess: boolean },
  scope?: QueryDataTrustScope,
) {
  const client = useQueryClient();
  const query = client.getQueryCache().find({ queryKey, exact: true });
  const signature = scope?.isReady ? scope.accessSignature : null;
  const store = useMemo(() => createQueryDataTrustStore(client, query, signature), [client, query, signature]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  // Observe these fields even when response data is structurally unchanged.
  void result.error;
  void result.isSuccess;
  return {
    canDisplayData: scope === undefined || snapshot === 'trusted',
    isAccessBlocked: scope !== undefined && (!scope.isReady || snapshot === 'blocked'),
  };
}

export function useQueryWithDataTrust<T, E = Error, D = T, K extends QueryKey = QueryKey>(
  options: UseQueryOptions<T, E, D, K>,
  scope?: QueryDataTrustScope,
): QueryWithDataTrust<D, E> {
  const result = useQuery(options);
  const trust = useQueryDataTrust(options.queryKey, result, scope);
  return { ...result, displayData: trust.canDisplayData ? result.data : undefined, isAccessBlocked: trust.isAccessBlocked };
}
