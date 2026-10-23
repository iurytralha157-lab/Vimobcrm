import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/contexts/AuthContext';
import { formatResponseTime } from '@/hooks/use-lead-timeline';
import { leadsAPI } from '@/lib/api/leads';
import { isDefinitiveLeadReadDenial } from '@/lib/lead-read-access';
import { formatPropertyCurrency } from '@/lib/property-display-utils';
import { formatBRLCurrencyWithDefaultDecimals } from '@/lib/utils/formatting';
import { createTenantQueryAccessSignature } from '@/lib/access/tenant-query-cache';
import { leadHistoryPageKeys, LEAD_HISTORY_FETCH_PAGE_SIZE, type LeadHistoryPageState } from './lead-history/pagination';
import { fetchLeadHistoryProjection, fetchOlderLeadHistory } from './lead-history/pagination-query';

import {
  buildLeadHistory,
  type LeadHistoryFormatters,
  type LeadHistoryRaw,
  type UnifiedHistoryEvent,
} from './lead-history';

export type { UnifiedHistoryEvent } from './lead-history';

const leadHistoryFormatters: LeadHistoryFormatters = {
  formatCurrency: formatBRLCurrencyWithDefaultDecimals,
  formatPropertyCurrency,
  formatResponseTime,
};

export function useLeadHistory(leadId: string | null, options: { paginated?: boolean } = {}) {
  const { activeOrganization, profile, user, tenantContext, isSuperAdmin, impersonating } = useAuth();
  const queryClient = useQueryClient();
  const organizationId = activeOrganization.organizationId || undefined;
  const accessScope = createTenantQueryAccessSignature({
    userId: user?.id ?? profile?.id, organizationId,
    memberRole: tenantContext?.memberRole, permissions: tenantContext?.permissions,
    enabledModules: tenantContext?.enabledModules, isTeamLeader: tenantContext?.isTeamLeader,
    ledTeamIds: tenantContext?.ledTeamIds, ledUserIds: tenantContext?.ledUserIds,
    ledPipelineIds: tenantContext?.ledPipelineIds,
    isSuperAdmin: tenantContext?.isSuperAdmin ?? isSuperAdmin,
    impersonatedOrganizationId: impersonating?.orgId,
  });
  const keys = leadHistoryPageKeys(leadId, organizationId, accessScope);
  const paginated = options.paginated === true;
  const pageState = useQuery<LeadHistoryPageState>({
    queryKey: paginated ? keys.state : ['lead-history-page-state-disabled'],
    queryFn: async () => queryClient.getQueryData<LeadHistoryPageState>(keys.state)
      ?? { generation: 0, isFetchingOlder: false, olderError: null },
    enabled: false, gcTime: 10 * 60_000,
  });

  const history = useQuery({
    queryKey: paginated ? keys.projection : ['lead-history-v2', leadId],
    queryFn: async ({ signal }): Promise<UnifiedHistoryEvent[]> => {
      if (!leadId || !organizationId) return [];
      try {
      if (paginated) return await fetchLeadHistoryProjection({
        queryClient, leadId, projectionKey: keys.projection, stateKey: keys.state,
        loadPage: (pageSignal, cursor) => leadsAPI.getLeadHistoryPage<LeadHistoryRaw>(leadId, organizationId, {
          signal: pageSignal, pageSize: LEAD_HISTORY_FETCH_PAGE_SIZE, cursor, allowLegacy: !cursor,
        }),
        build: raw => buildLeadHistory(raw, leadId, leadHistoryFormatters),
      }, signal);

        const raw = await leadsAPI.getLeadHistoryRaw<LeadHistoryRaw>(leadId, organizationId, { signal });
        signal.throwIfAborted();
        return buildLeadHistory(raw, leadId, leadHistoryFormatters);
      } catch (error) {
        if (!signal.aborted && isDefinitiveLeadReadDenial(error)) {
          queryClient.setQueryData(paginated ? keys.projection : ['lead-history-v2', leadId], []);
          void queryClient.invalidateQueries({ queryKey: ['lead', organizationId, leadId], exact: true });
        }
        throw error;
      }
    },
    enabled: !!leadId && !!organizationId,
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
  const denied = isDefinitiveLeadReadDenial(history.error);
  return {
    ...history,
    data: denied ? [] : history.data,
    hasOlderHistory: !denied && paginated && Boolean(pageState.data?.pagination?.hasOlder),
    isFetchingOlderHistory: paginated && Boolean(pageState.data?.isFetchingOlder),
    olderHistoryError: paginated ? pageState.data?.olderError ?? null : null,
    historyComplete: !denied && (!paginated || pageState.data?.raw?.historyCoverage?.complete === true),
    historyPaginationUnavailable: !denied && paginated && Boolean(pageState.data?.paginationUnavailable),
    canonicalHistoryPresence: paginated ? pageState.data?.raw?.historyCoverage?.canonicalPresence : undefined,
    fetchOlderHistory: () => paginated
      ? fetchOlderLeadHistory(queryClient, keys.projection, keys.state)
      : Promise.resolve(false),
  };
}
