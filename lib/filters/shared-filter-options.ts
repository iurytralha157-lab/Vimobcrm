import type { QueryClient, QueryKey } from '@tanstack/react-query';

export function isSharedFilterOptionsAccessDenied(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const details = error as { status?: unknown; code?: unknown };
  const code = typeof details.code === 'string' ? details.code.toLowerCase() : '';
  return details.status === 401 || details.status === 403 || [
    'missing_session',
    'session_check_unavailable',
    'permission_denied',
    'organization_required',
    'recovery_session_restricted',
  ].includes(code);
}

export function isSharedFilterOptionsQueryForOrganization(queryKey: QueryKey, organizationId: string) {
  if (queryKey[1] !== organizationId) return false;
  return queryKey[0] === 'shared-filter-lead-meta-filters'
    || (queryKey[0] === 'tags' && queryKey[2] === 'catalog')
    || (queryKey[0] === 'teams' && queryKey[2] === 'filter-catalog')
    || (queryKey[0] === 'organization-users' && queryKey[2] === 'filters');
}

export function refreshStaleSharedFilterOptions(queryClient: QueryClient, organizationId: string | null | undefined) {
  if (!organizationId) return Promise.resolve();
  // Disabled observers fetch when opening enables them. Already enabled
  // observers also need a refresh when an in-memory selection has kept them on.
  return queryClient.refetchQueries({
    type: 'active',
    predicate: (query) => isSharedFilterOptionsQueryForOrganization(query.queryKey, organizationId)
      && (query.isStale() || query.state.status === 'error'),
  }, { cancelRefetch: false });
}
