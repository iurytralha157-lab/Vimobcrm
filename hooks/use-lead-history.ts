import { useQuery } from '@tanstack/react-query';

import { useAuth } from '@/contexts/AuthContext';
import { formatResponseTime } from '@/hooks/use-lead-timeline';
import { leadsAPI } from '@/lib/api/leads';
import { formatPropertyCurrency } from '@/lib/property-display-utils';
import { formatBRLCurrencyWithDefaultDecimals } from '@/lib/utils/formatting';

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

export function useLeadHistory(leadId: string | null) {
  const { activeOrganization } = useAuth();
  const organizationId = activeOrganization.organizationId || undefined;

  return useQuery({
    queryKey: ['lead-history-v2', leadId],
    queryFn: async (): Promise<UnifiedHistoryEvent[]> => {
      if (!leadId || !organizationId) return [];

      const raw = await leadsAPI.getLeadHistoryRaw<LeadHistoryRaw>(leadId, organizationId);
      return buildLeadHistory(raw, leadId, leadHistoryFormatters);
    },
    enabled: !!leadId && !!organizationId,
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
}
