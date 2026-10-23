import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { canClaimQueuePool, type QueuePoolLead } from '@/lib/queue-pool';

const versions = new WeakMap<QueryClient, Map<string, number>>();
const sensitiveLeadKeys = new Set(['lead', 'leads', 'stages-with-leads', 'filtered-stage-counts', 'contacts-list', 'pipeline-selected-lead-access', 'lead-history-v2', 'lead-history-page-state', 'lead-timeline', 'activities', 'conversation-lead-detail', 'lead-sensitive-profile']);
const legacyUnscopedKeys = new Set(['lead-history-v2', 'lead-timeline', 'activities']);
export function queuePoolAccessVersion(client: QueryClient, organizationId: string): number {
  return versions.get(client)?.get(organizationId) ?? 0;
}

export function isLeadResourceQuery(key: QueryKey, organizationId: string): boolean {
  return typeof key[0] === 'string' && sensitiveLeadKeys.has(key[0]) && (key.includes(organizationId) || legacyUnscopedKeys.has(key[0]));
}

/** Discard capabilities immediately; refetches establish current server access. */
export function resetQueuePoolAccessCaches(client: QueryClient, organizationId: string): void {
  let scopes = versions.get(client);
  if (!scopes) { scopes = new Map(); versions.set(client, scopes); }
  scopes.set(organizationId, queuePoolAccessVersion(client, organizationId) + 1);
  const filter = { predicate: (query: { queryKey: QueryKey }) => isLeadResourceQuery(query.queryKey, organizationId) };
  void client.cancelQueries(filter);
  void client.resetQueries(filter);
}

export function hasCachedQueuePoolClaim(client: QueryClient, organizationId: string, lead: QueuePoolLead): boolean {
  const matches = (candidate: QueuePoolLead | null | undefined) => Boolean(candidate && canClaimQueuePool(candidate) && candidate.id === lead.id && candidate.queue_pool?.episode_id === lead.queue_pool?.episode_id && candidate.queue_pool?.round_robin_id === lead.queue_pool?.round_robin_id && candidate.queue_pool?.revision === lead.queue_pool?.revision);
  const detail = client.getQueryData<QueuePoolLead | null>(['lead', organizationId, lead.id]);
  if (detail !== undefined) return matches(detail);
  for (const [, data] of client.getQueriesData<Array<{ leads?: QueuePoolLead[] }>>({ queryKey: ['stages-with-leads', organizationId] })) {
    if (Array.isArray(data) && data.some((stage) => stage.leads?.some(matches))) return true;
  }
  for (const [, data] of client.getQueriesData<QueuePoolLead[]>({ queryKey: ['leads', organizationId] })) if (Array.isArray(data) && data.some(matches)) return true;
  return false;
}
