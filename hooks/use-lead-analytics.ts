import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { analyticsAPI } from '@/lib/api/analytics';
import { VimobAPIError } from '@/lib/api/vimob-error';
import { DomainValidationError, formatSiteAnalyticsDate } from '@/lib/validation';

export type {
  DailyView,
  DeviceBreakdown,
  FunnelStep,
  LeadAnalyticsData,
  LeadJourney,
  LocationData,
  SiteAnalyticsDetailed,
  SiteAnalyticsSummary,
  TopPage,
} from '@/lib/validation';

class MissingAnalyticsTenantError extends Error {
  constructor() {
    super('Selecione uma organização ativa para consultar o dashboard do site.');
    this.name = 'MissingAnalyticsTenantError';
  }
}

export function siteAnalyticsRangeQuery(dateFrom?: Date, dateTo?: Date) {
  return {
    dateFrom: formatSiteAnalyticsDate(dateFrom),
    dateTo: formatSiteAnalyticsDate(dateTo),
  };
}

function shouldRetryAnalyticsRequest(failureCount: number, error: unknown) {
  if (
    error instanceof DomainValidationError ||
    error instanceof MissingAnalyticsTenantError ||
    (error instanceof VimobAPIError && error.status >= 400 && error.status < 500)
  ) {
    return false;
  }
  return failureCount < 2;
}

function analyticsRefetchInterval(query: { state: { error: unknown } }) {
  return query.state.error ? false : 30_000;
}

export function useLeadAnalytics(dateFrom: Date, dateTo: Date) {
  const { loading, organization, profile } = useAuth();
  const organizationId = organization?.id || profile?.organization_id;
  const range = siteAnalyticsRangeQuery(dateFrom, dateTo);

  return useQuery({
    queryKey: ['lead-analytics', organizationId, range.dateFrom, range.dateTo],
    queryFn: ({ signal }) => {
      if (!organizationId) throw new MissingAnalyticsTenantError();
      return analyticsAPI.leadAnalytics(range, { organizationId, signal });
    },
    enabled: !loading,
    retry: shouldRetryAnalyticsRequest,
    refetchInterval: analyticsRefetchInterval,
    staleTime: 20_000,
  });
}

export function useSiteAnalytics(dateFrom: Date, dateTo: Date) {
  const { loading, organization, profile } = useAuth();
  const organizationId = organization?.id || profile?.organization_id;
  const range = siteAnalyticsRangeQuery(dateFrom, dateTo);

  return useQuery({
    queryKey: ['site-analytics', organizationId, range.dateFrom, range.dateTo],
    queryFn: ({ signal }) => {
      if (!organizationId) throw new MissingAnalyticsTenantError();
      return analyticsAPI.siteSummary(range, { organizationId, signal });
    },
    enabled: !loading,
    retry: shouldRetryAnalyticsRequest,
    refetchInterval: analyticsRefetchInterval,
    staleTime: 20_000,
  });
}

export function useSiteAnalyticsDetailed(dateFrom: Date, dateTo: Date) {
  const { loading, organization, profile } = useAuth();
  const organizationId = organization?.id || profile?.organization_id;
  const range = siteAnalyticsRangeQuery(dateFrom, dateTo);

  return useQuery({
    queryKey: ['site-analytics-detailed', organizationId, range.dateFrom, range.dateTo],
    queryFn: ({ signal }) => {
      if (!organizationId) throw new MissingAnalyticsTenantError();
      return analyticsAPI.siteDetailed(range, { organizationId, signal });
    },
    enabled: !loading,
    retry: shouldRetryAnalyticsRequest,
    refetchInterval: analyticsRefetchInterval,
    staleTime: 20_000,
  });
}
