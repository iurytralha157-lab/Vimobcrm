import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { analyticsAPI } from '@/lib/api/analytics';

export interface LeadJourney {
  session_id: string;
  path_sequence: string[];
  event_sequence: string[];
  first_event: string;
  last_event: string;
  total_events: number;
  converted: boolean;
  device_type: string | null;
  browser: string | null;
  os: string | null;
  city: string | null;
  region: string | null;
}

export interface FunnelStep {
  event_type: string;
  total: number;
}

export interface TopPage {
  page_path: string;
  views: number;
}

export interface DailyView {
  date: string;
  views: number;
}

export interface DeviceBreakdown {
  device_type: string;
  total: number;
}

export interface LocationData {
  city: string;
  region: string | null;
  lat: number;
  lng: number;
  sessions: number;
}

export interface LeadAnalyticsData {
  journeys: LeadJourney[];
  funnel: FunnelStep[];
  top_pages: TopPage[];
  daily_views: DailyView[];
  total_sessions: number;
  total_conversions: number;
  device_breakdown: DeviceBreakdown[];
  locations: LocationData[];
}

export interface SiteAnalyticsSummary {
  totalViews: number;
  totalPages: number;
  uniquePages: number;
  uniqueSessions: number;
  avgDuration: number;
  desktopPct: number;
  mobilePct: number;
  tabletPct: number;
  directPct: number;
  searchPct: number;
  socialPct: number;
  campaignPct: number;
  conversions: number;
  prevViews: number;
  prevPages: number;
  prevUniquePages: number;
  prevAvgDuration: number;
  prevDesktopPct: number;
  prevMobilePct: number;
  prevConversions: number;
}

export interface SiteAnalyticsDetailed {
  topProperties: { property_id: string; title: string; code: string; views: number; favorites: number }[];
  topPages: { page_path: string; views: number }[];
  dailyViews: { date: string; views: number }[];
  conversionRate: number;
  totalSessions: number;
  totalConversions: number;
  siteLeads: number;
}

function rangeQuery(dateFrom?: Date, dateTo?: Date) {
  return {
    dateFrom: dateFrom?.toISOString(),
    dateTo: dateTo?.toISOString(),
  };
}

export function useLeadAnalytics(dateFrom?: Date, dateTo?: Date) {
  const { organization } = useAuth();

  return useQuery({
    queryKey: ['lead-analytics', organization?.id, dateFrom?.toISOString(), dateTo?.toISOString()],
    queryFn: async (): Promise<LeadAnalyticsData> => {
      if (!organization?.id) {
        return analyticsAPI.leadAnalytics<LeadAnalyticsData>({});
      }
      return analyticsAPI.leadAnalytics<LeadAnalyticsData>(rangeQuery(dateFrom, dateTo));
    },
    enabled: !!organization?.id,
  });
}

export function useSiteAnalytics(dateFrom?: Date, dateTo?: Date) {
  const { organization } = useAuth();

  return useQuery({
    queryKey: ['site-analytics', organization?.id, dateFrom?.toISOString(), dateTo?.toISOString()],
    queryFn: async (): Promise<SiteAnalyticsSummary> => {
      return analyticsAPI.siteSummary<SiteAnalyticsSummary>(rangeQuery(dateFrom, dateTo));
    },
    enabled: !!organization?.id,
  });
}

export function useSiteAnalyticsDetailed(dateFrom?: Date, dateTo?: Date) {
  const { organization } = useAuth();

  return useQuery({
    queryKey: ['site-analytics-detailed', organization?.id, dateFrom?.toISOString(), dateTo?.toISOString()],
    queryFn: async (): Promise<SiteAnalyticsDetailed> => {
      return analyticsAPI.siteDetailed<SiteAnalyticsDetailed>(rangeQuery(dateFrom, dateTo));
    },
    enabled: !!organization?.id,
  });
}
