import type { QueryClient, QueryKey } from '@tanstack/react-query';

const TAG_CONSUMER_KEYS = new Set([
  'tags', 'tag-usage', 'leads', 'lead', 'conversation-lead-detail', 'contacts-list', 'stages-with-leads',
  'filtered-stage-counts', 'shared-filter-contacts', 'shared-filter-lead-meta-filters',
  'funnel-data', 'lead-analytics', 'campaign-insights', 'enhanced-dashboard-stats',
  'lead-sources-data', 'deals-evolution', 'round-robins', 'automations',
]);

export function isTagConsumerQuery(key: QueryKey, organizationId: string) {
  const root = key[0];
  if (typeof root !== 'string') return false;
  if (root.startsWith('whatsapp-')) {
    return key[1] === 'tenant-scope' && key[2] === organizationId;
  }
  return key[1] === organizationId && (
    TAG_CONSUMER_KEYS.has(root) || root.startsWith('dashboard-')
  );
}

export function invalidateTagConsumers(queryClient: QueryClient, organizationId: string) {
  return queryClient.invalidateQueries({
    predicate: (query) => isTagConsumerQuery(query.queryKey, organizationId),
    refetchType: 'active',
  });
}

// Association changes affect catalog counters and deletion preflight snapshots,
// but do not change the name/color embedded in every tag consumer.
export function invalidateTagCounts(queryClient: QueryClient, organizationId: string) {
  return queryClient.invalidateQueries({
    predicate: (query) => query.queryKey[1] === organizationId &&
      (query.queryKey[0] === 'tags' || query.queryKey[0] === 'tag-usage'),
    refetchType: 'active',
  });
}

const TAG_COUNT_LEAD_EVENTS = new Set([
  'lead.tagged', 'lead.untagged', 'lead.created', 'lead.deleted',
  'lead.reentered', 'lead.meta_webhook_received', 'lead.webhook_received',
]);

export function shouldRefreshTagCounts(reasons: Iterable<string>) {
  return [...reasons].some((reason) => TAG_COUNT_LEAD_EVENTS.has(reason.trim().toLowerCase()));
}

export const TAG_USAGE_LABELS: Record<string, string> = {
  distribution_rule: 'Regras de distribuição',
  distribution_auto_tags: 'Filas de distribuição',
  automation: 'Automações',
  automation_execution: 'Execuções de automação em andamento',
  stage_automation: 'Automações de etapa',
  meta_form: 'Formulários da Meta',
  webhook: 'Integrações de webhook',
};

export function canConfirmTagDeletion(snapshot: { updated_at: string; usages: readonly unknown[] } | undefined, expectedUpdatedAt: string) {
  return Boolean(snapshot && snapshot.updated_at === expectedUpdatedAt && snapshot.usages.length === 0);
}

export function isCurrentManagementMutation(scope: string | null, mutationOrganizationId?: string | null) {
  return Boolean(scope && scope === mutationOrganizationId);
}
