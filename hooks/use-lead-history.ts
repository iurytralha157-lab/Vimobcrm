import { useQuery } from '@tanstack/react-query';

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
  return useQuery({
    queryKey: ['lead-history-v2', leadId],
    queryFn: async (): Promise<UnifiedHistoryEvent[]> => {
      if (!leadId) return [];

      const raw = await leadsAPI.getLeadHistoryRaw<LeadHistoryRaw>(leadId);
      return buildLeadHistory(raw, leadId, leadHistoryFormatters);
    },
    enabled: !!leadId,
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });
}
