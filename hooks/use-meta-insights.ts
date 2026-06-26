import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { DashboardFilters } from './use-dashboard-filters';
import { analyticsAPI } from '@/lib/api/analytics';

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
  const { organization } = useAuth();

  return useQuery({
    queryKey: ['meta-insights', organization?.id, filters.dateRange.from.toISOString(), filters.dateRange.to.toISOString(), filters.campaignId, filters.adSetId, filters.adId],
    enabled: !!organization?.id,
    queryFn: async () => {
      return analyticsAPI.metaInsights<MetaCampaignInsight>({
        dateFrom: filters.dateRange.from.toISOString(),
        dateTo: filters.dateRange.to.toISOString(),
        campaignId: filters.campaignId,
        adSetId: filters.adSetId,
        adId: filters.adId,
      });
    },
  });
}
