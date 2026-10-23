'use client';

import type { QueryKey, UseQueryOptions } from '@tanstack/react-query';
import { useQueryWithDataTrust, type QueryDataTrustScope } from '@/hooks/shared/use-query-data-trust';

export function useDashboardQuery<T, E = Error, D = T, K extends QueryKey = QueryKey>(
  options: UseQueryOptions<T, E, D, K>,
  scope: QueryDataTrustScope,
) {
  const result = useQueryWithDataTrust(options, scope);
  return { ...result, data: result.displayData };
}
