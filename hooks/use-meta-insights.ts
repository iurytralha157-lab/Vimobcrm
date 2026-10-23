import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { DashboardFilters } from './use-dashboard-filters';
import { analyticsAPI } from '@/lib/api/analytics';
import { format } from 'date-fns';

export interface MetaCampaignInsight {
  id: string;
  campaign_id: string;
  campaign_name: string;
  adset_id: string;
  adset_name: string;
  ad_id: string;
  ad_name: string;
  spend: number;
  impressions: number;
  reach: number;
  leads_count: number;
  cpl: number;
  date_start: string;
  date_stop: string;
  level: string;
  fetched_at: string;
}

export function useMetaInsights(filters: DashboardFilters) {
  const { activeOrganization } = useAuth();

  return useQuery({
    queryKey: ['meta-insights', activeOrganization.organizationId, format(filters.dateRange.from, 'yyyy-MM-dd'), format(filters.dateRange.to, 'yyyy-MM-dd'), filters.campaignId, filters.adSetId, filters.adId, JSON.stringify([...(filters.campaignIds ?? [])].sort())],
    enabled: !!activeOrganization.organizationId,
    queryFn: async () => {
      return analyticsAPI.metaInsights<MetaCampaignInsight>({
        dateFrom: format(filters.dateRange.from, 'yyyy-MM-dd'),
        dateTo: format(filters.dateRange.to, 'yyyy-MM-dd'),
        campaignId: filters.campaignId,
        campaignIds: filters.campaignIds,
        adSetId: filters.adSetId,
        adId: filters.adId,
      });
    },
  });
}
