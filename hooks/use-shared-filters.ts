import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useFilters } from '@/contexts/FilterContext';
import { useAuth } from '@/contexts/AuthContext';
import { contactsAPI } from '@/lib/api/contacts';
import { getLeadMetaFilters } from '@/lib/api/pipeline-board';
import { useTags } from '@/hooks/use-tags';
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
  const { organization, profile } = useAuth();
  const organizationId = organization?.id ?? profile?.organization_id;
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
  const dateFromStr = dateRange.from.toISOString();
  const dateToStr = dateRange.to.toISOString();

  const contactsQuery = useQuery({
    queryKey: ['shared-filter-contacts', organizationId, dateFromStr, dateToStr, teamId, userId, source, campaignId, adSetId, adId, dealStatus, searchQuery],
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
      }, organizationId),
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 60,
    refetchOnWindowFocus: false,
    placeholderData: (previous) => previous ?? [],
  });

  const leadMetaFiltersQuery = useQuery({
    queryKey: ['shared-filter-lead-meta-filters', organizationId, dateFromStr, dateToStr],
    enabled: shouldLoadDynamicOptions && !!organizationId,
    queryFn: () => getLeadMetaFilters({ organizationId, dateRange }),
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 60,
    refetchOnWindowFocus: false,
    retry: 1,
    retryDelay: 800,
    placeholderData: (previous) => previous ?? { campaigns: [], adsets: [], ads: [] },
  });

  const tagsQuery = useTags({ enabled: shouldLoadDynamicOptions });

  const dynamicSources = useMemo(() => {
    const sources = new Set((contactsQuery.data || []).map((contact) => contact.source).filter(Boolean));
    return Array.from(sources).map((value) => ({ value, label: labelize(value) }));
  }, [contactsQuery.data]);

  const campaigns = useMemo(
    () =>
      uniqueOptions(
        (leadMetaFiltersQuery.data?.campaigns || []).map((item) => ({
          id: item.id,
          name: item.name,
        })),
      ),
    [leadMetaFiltersQuery.data],
  );

  const adSets = useMemo(
    () =>
      uniqueOptions(
        (leadMetaFiltersQuery.data?.adsets || [])
          .filter((item) => !campaignId || item.campaignId === campaignId)
          .map((item) => ({ id: item.id, name: item.name })),
      ),
    [campaignId, leadMetaFiltersQuery.data],
  );

  const ads = useMemo(
    () =>
      uniqueOptions(
        (leadMetaFiltersQuery.data?.ads || [])
          .filter((item) => !adSetId || item.adsetId === adSetId)
          .map((item) => ({ id: item.id, name: item.name })),
      ),
    [adSetId, leadMetaFiltersQuery.data],
  );

  const tags = useMemo(() => {
    return (tagsQuery.data || [])
      .map((tag) => ({ id: tag.id, name: tag.name, color: tag.color }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [tagsQuery.data]);

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
    if (leadMetaFiltersQuery.isLoading || adSets.length !== 1 || !campaignId || adSetId) return;
    const nextAdSetId = adSets[0].id;
    queueMicrotask(() => setAdSetId(nextAdSetId));
  }, [adSets, adSetId, campaignId, leadMetaFiltersQuery.isLoading]);

  useEffect(() => {
    if (leadMetaFiltersQuery.isLoading || ads.length !== 1 || !adSetId || adId) return;
    const nextAdId = ads[0].id;
    queueMicrotask(() => setAdId(nextAdId));
  }, [adId, adSetId, ads, leadMetaFiltersQuery.isLoading]);

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
    isLoadingCampaigns: leadMetaFiltersQuery.isLoading,
    isLoadingAdSets: leadMetaFiltersQuery.isLoading,
    isLoadingAds: leadMetaFiltersQuery.isLoading,
  };
}
