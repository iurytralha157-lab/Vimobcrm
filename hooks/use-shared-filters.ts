import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useFilters } from '@/contexts/FilterContext';
import { useAuth } from '@/contexts/AuthContext';
import { contactsAPI } from '@/lib/api/contacts';
import { analyticsAPI } from '@/lib/api/analytics';
import { DatePreset } from './use-dashboard-filters';

export interface SharedFilters {
  datePreset: DatePreset;
  dateRange: { from: Date; to: Date };
  teamId: string | null;
  userId: string | null;
  source: string | null;
  campaignId: string | null;
  adSetId: string | null;
  adId: string | null;
  tagId: string | null;
  dealStatus: string | null;
  searchQuery: string;
}

type MetaInsightOption = {
  campaign_id?: string | null;
  campaign_name?: string | null;
  adset_id?: string | null;
  adset_name?: string | null;
  ad_id?: string | null;
  ad_name?: string | null;
};

function labelize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function uniqueOptions(items: Array<{ id?: string | null; name?: string | null }>) {
  const map = new Map<string, string>();
  items.forEach((item) => {
    const id = item.id || item.name;
    if (id) map.set(id, item.name || item.id || id);
  });
  return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
}

function optionalFilter(value: string | null | undefined) {
  if (!value || value === 'all') return undefined;
  return value;
}

export function useSharedFilters(options?: { loadDynamicOptions?: boolean }) {
  const { organization } = useAuth();
  const organizationId = organization?.id;
  const {
    datePreset,
    setDatePreset,
    customDateRange,
    setCustomDateRange,
    activeDateRange: dateRange,
  } = useFilters();

  const [teamId, setTeamId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [adSetId, setAdSetId] = useState<string | null>(null);
  const [adId, setAdId] = useState<string | null>(null);
  const [tagId, setTagId] = useState<string | null>(null);
  const [dealStatus, setDealStatus] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const shouldLoadDynamicOptions = options?.loadDynamicOptions ?? true;

  const contactsQuery = useQuery({
    queryKey: ['shared-filter-contacts', organizationId, dateRange, teamId, userId, source, campaignId, adSetId, adId, dealStatus, searchQuery],
    enabled: shouldLoadDynamicOptions && !!organizationId,
    queryFn: () =>
      contactsAPI.list({
        teamId: optionalFilter(teamId),
        assigneeId: optionalFilter(userId),
        source: optionalFilter(source),
        campaignId: optionalFilter(campaignId),
        adSetId: optionalFilter(adSetId),
        adId: optionalFilter(adId),
        dealStatus: optionalFilter(dealStatus) as 'open' | 'won' | 'lost' | undefined,
        search: optionalFilter(searchQuery),
        createdFrom: dateRange.from.toISOString(),
        createdTo: dateRange.to.toISOString(),
        page: 1,
        limit: 500,
      }),
  });

  const metaInsightsQuery = useQuery({
    queryKey: ['shared-filter-meta-insights', organizationId, dateRange, campaignId, adSetId],
    enabled: shouldLoadDynamicOptions && !!organizationId,
    queryFn: () =>
      analyticsAPI.metaInsights<MetaInsightOption>({
        dateFrom: dateRange.from.toISOString(),
        dateTo: dateRange.to.toISOString(),
        campaignId,
        adSetId,
      }),
  });

  const dynamicSources = useMemo(() => {
    const sources = new Set((contactsQuery.data || []).map((contact) => contact.source).filter(Boolean));
    return Array.from(sources).map((value) => ({ value, label: labelize(value) }));
  }, [contactsQuery.data]);

  const campaigns = useMemo(
    () =>
      uniqueOptions(
        (metaInsightsQuery.data || []).map((item) => ({
          id: item.campaign_id,
          name: item.campaign_name,
        })),
      ),
    [metaInsightsQuery.data],
  );

  const adSets = useMemo(
    () =>
      uniqueOptions(
        (metaInsightsQuery.data || [])
          .filter((item) => !campaignId || item.campaign_id === campaignId || item.campaign_name === campaignId)
          .map((item) => ({ id: item.adset_id, name: item.adset_name })),
      ),
    [campaignId, metaInsightsQuery.data],
  );

  const ads = useMemo(
    () =>
      uniqueOptions(
        (metaInsightsQuery.data || [])
          .filter((item) => !adSetId || item.adset_id === adSetId || item.adset_name === adSetId)
          .map((item) => ({ id: item.ad_id, name: item.ad_name })),
      ),
    [adSetId, metaInsightsQuery.data],
  );

  const tags = useMemo(() => {
    const unique = new Map<string, { id: string; name: string; color: string }>();
    (contactsQuery.data || []).forEach((contact) => {
      contact.tags.forEach((tag) => unique.set(tag.id, tag));
    });
    return Array.from(unique.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [contactsQuery.data]);

  useEffect(() => {
    let isActive = true;
    queueMicrotask(() => {
      if (!isActive) return;
      setSource(null);
      setCampaignId(null);
      setAdSetId(null);
      setAdId(null);
    });
    return () => {
      isActive = false;
    };
  }, [datePreset, customDateRange]);

  useEffect(() => {
    let isActive = true;
    queueMicrotask(() => {
      if (!isActive) return;
      setAdSetId(null);
      setAdId(null);
    });
    return () => {
      isActive = false;
    };
  }, [campaignId]);

  useEffect(() => {
    let isActive = true;
    queueMicrotask(() => {
      if (isActive) setAdId(null);
    });
    return () => {
      isActive = false;
    };
  }, [adSetId]);

  useEffect(() => {
    let isActive = true;
    queueMicrotask(() => {
      if (isActive) setUserId(null);
    });
    return () => {
      isActive = false;
    };
  }, [teamId]);

  useEffect(() => {
    if (metaInsightsQuery.isLoading || adSets.length !== 1 || !campaignId || adSetId) return;
    const nextAdSetId = adSets[0].id;
    queueMicrotask(() => setAdSetId(nextAdSetId));
  }, [adSets, adSetId, campaignId, metaInsightsQuery.isLoading]);

  useEffect(() => {
    if (metaInsightsQuery.isLoading || ads.length !== 1 || !adSetId || adId) return;
    const nextAdId = ads[0].id;
    queueMicrotask(() => setAdId(nextAdId));
  }, [adId, adSetId, ads, metaInsightsQuery.isLoading]);

  const filters: SharedFilters = useMemo(
    () => ({
      datePreset,
      dateRange,
      teamId,
      userId,
      source,
      campaignId,
      adSetId,
      adId,
      tagId,
      dealStatus,
      searchQuery,
    }),
    [datePreset, dateRange, teamId, userId, source, campaignId, adSetId, adId, tagId, dealStatus, searchQuery],
  );

  const clearFilters = () => {
    setDatePreset('last30days');
    setCustomDateRange(null);
    setTeamId(null);
    setUserId(null);
    setSource(null);
    setCampaignId(null);
    setAdSetId(null);
    setAdId(null);
    setTagId(null);
    setDealStatus(null);
    setSearchQuery('');
  };

  const hasActiveFilters =
    teamId !== null ||
    (userId !== null && userId !== 'all') ||
    source !== null ||
    campaignId !== null ||
    adSetId !== null ||
    adId !== null ||
    tagId !== null ||
    dealStatus !== null ||
    searchQuery !== '' ||
    datePreset !== 'last30days';

  return {
    filters,
    datePreset,
    setDatePreset,
    customDateRange,
    setCustomDateRange,
    teamId,
    setTeamId,
    userId,
    setUserId,
    source,
    setSource,
    campaignId,
    setCampaignId,
    adSetId,
    setAdSetId,
    adId,
    setAdId,
    tagId,
    setTagId,
    dealStatus,
    setDealStatus,
    searchQuery,
    setSearchQuery,
    clearFilters,
    hasActiveFilters,
    dynamicSources,
    campaigns,
    adSets,
    ads,
    tags,
    isLoadingSources: contactsQuery.isLoading,
    isLoadingCampaigns: metaInsightsQuery.isLoading,
    isLoadingAdSets: metaInsightsQuery.isLoading,
    isLoadingAds: metaInsightsQuery.isLoading,
  };
}
