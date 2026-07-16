import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useFilters } from '@/contexts/FilterContext';
import { useAuth } from '@/contexts/AuthContext';
import { contactsAPI } from '@/lib/api/contacts';
import { getLeadMetaFilters } from '@/lib/api/pipeline-board';
import { useTags } from '@/hooks/use-tags';
import { useTeams } from '@/hooks/use-teams';
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
    const name = item.name?.trim();
    if (id && name && !isOpaqueMetaId(name)) map.set(id, name);
  });
  return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
}

function optionalFilter(value: string | null | undefined) {
  if (!value || value === 'all') return undefined;
  return value;
}

function firstNonEmpty(...values: Array<string | null | undefined>) {
  return values.map((value) => value?.trim()).find(Boolean) || '';
}

function isOpaqueMetaId(value: string | null | undefined) {
  return /^[0-9]{8,}$/.test(value?.trim() || '');
}

function uniqueAdSetOptions(items: Array<{ id?: string | null; name?: string | null; campaignId?: string | null }>) {
  const map = new Map<string, { id: string; name: string; campaignId: string }>();
  items.forEach((item) => {
    const id = firstNonEmpty(item.id, item.name);
    const name = firstNonEmpty(item.name, item.id);
    const campaignId = firstNonEmpty(item.campaignId);
    if (!id || !name) return;
    map.set(`${campaignId}:${id}`, { id, name, campaignId });
  });
  return Array.from(map.values());
}

function uniqueAdOptions(
  items: Array<{ id?: string | null; name?: string | null; adsetId?: string | null; campaignId?: string | null }>,
) {
  const map = new Map<string, { id: string; name: string; adsetId: string; campaignId: string }>();
  items.forEach((item) => {
    const id = firstNonEmpty(item.id, item.name);
    const name = firstNonEmpty(item.name, item.id);
    const adsetId = firstNonEmpty(item.adsetId);
    const campaignId = firstNonEmpty(item.campaignId);
    if (!id || !name) return;
    map.set(`${campaignId}:${adsetId}:${id}`, { id, name, adsetId, campaignId });
  });
  return Array.from(map.values());
}

const EMPTY_LEAD_META_FILTERS = { campaigns: [], adsets: [], ads: [] };

export function useSharedFilters(options?: {
  loadDynamicOptions?: boolean;
  pipelineId?: string | null;
}) {
  const { organization, profile } = useAuth();
  const organizationId = organization?.id ?? profile?.organization_id;
  const {
    datePreset,
    setDatePreset,
    customDateRange,
    setCustomDateRange,
    activeDateRange: dateRange,
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
  } = useFilters();

  const shouldLoadDynamicOptions = options?.loadDynamicOptions ?? true;
  const pipelineId = options?.pipelineId ?? null;
  const previousTeamIdRef = useRef(teamId);
  const previousCampaignIdRef = useRef(campaignId);
  const previousAdSetIdRef = useRef(adSetId);
  const dateFromStr = dateRange.from.toISOString();
  const dateToStr = dateRange.to.toISOString();
  const teamsQuery = useTeams({ enabled: shouldLoadDynamicOptions });

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
    queryKey: ['shared-filter-lead-meta-filters', organizationId, pipelineId, dateFromStr, dateToStr],
    enabled: shouldLoadDynamicOptions && !!organizationId,
    queryFn: () => getLeadMetaFilters({ organizationId, dateRange, pipelineId }),
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 60,
    refetchOnWindowFocus: false,
    retry: 1,
    retryDelay: 800,
    placeholderData: EMPTY_LEAD_META_FILTERS,
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
      uniqueAdSetOptions(
        (leadMetaFiltersQuery.data?.adsets || [])
          .map((item) => ({
            id: item.id,
            name: item.name,
            campaignId: item.campaignId,
          }))
          .filter((item) => !campaignId || item.campaignId === campaignId),
      ),
    [campaignId, leadMetaFiltersQuery.data],
  );

  const ads = useMemo(
    () =>
      uniqueAdOptions(
        (leadMetaFiltersQuery.data?.ads || [])
          .map((item) => ({
            id: item.id,
            name: item.name,
            adsetId: item.adsetId,
            campaignId: item.campaignId,
          }))
          .filter((item) => !adSetId || item.adsetId === adSetId),
      ),
    [adSetId, leadMetaFiltersQuery.data],
  );

  const tags = useMemo(() => {
    return (tagsQuery.data || [])
      .map((tag) => ({ id: tag.id, name: tag.name, color: tag.color }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [tagsQuery.data]);

  const selectedTeamUserIds = useMemo(() => {
    if (!teamId) return undefined;
    const team = teamsQuery.data?.find((item) => item.id === teamId);
    if (!team) return [];

    return Array.from(
      new Set(
        (team.members || [])
          .map((member) => member.user_id)
          .filter((userId): userId is string => Boolean(userId)),
      ),
    ).sort();
  }, [teamId, teamsQuery.data]);

  useEffect(() => {
    if (previousCampaignIdRef.current === campaignId) return;
    previousCampaignIdRef.current = campaignId;

    let isActive = true;
    queueMicrotask(() => {
      if (!isActive) return;
      setAdSetId(null);
      setAdId(null);
    });
    return () => {
      isActive = false;
    };
  }, [campaignId, setAdId, setAdSetId]);

  useEffect(() => {
    if (previousAdSetIdRef.current === adSetId) return;
    previousAdSetIdRef.current = adSetId;

    let isActive = true;
    queueMicrotask(() => {
      if (isActive) setAdId(null);
    });
    return () => {
      isActive = false;
    };
  }, [adSetId, setAdId]);

  useEffect(() => {
    if (previousTeamIdRef.current === teamId) return;
    previousTeamIdRef.current = teamId;

    let isActive = true;
    queueMicrotask(() => {
      if (isActive) setUserId(null);
    });
    return () => {
      isActive = false;
    };
  }, [setUserId, teamId]);

  useEffect(() => {
    if (leadMetaFiltersQuery.isLoading || adSets.length !== 1 || !campaignId || adSetId) return;
    const nextAdSetId = adSets[0].id;
    queueMicrotask(() => setAdSetId(nextAdSetId));
  }, [adSets, adSetId, campaignId, leadMetaFiltersQuery.isLoading, setAdSetId]);

  useEffect(() => {
    if (leadMetaFiltersQuery.isLoading || ads.length !== 1 || !adSetId || adId) return;
    const nextAdId = ads[0].id;
    queueMicrotask(() => setAdId(nextAdId));
  }, [adId, adSetId, ads, leadMetaFiltersQuery.isLoading, setAdId]);

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

  const isLoadingLeadMetaFilters = leadMetaFiltersQuery.isLoading || leadMetaFiltersQuery.isFetching;

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
    selectedTeamUserIds,
    isLoadingSources: contactsQuery.isLoading || contactsQuery.isFetching,
    isLoadingCampaigns: isLoadingLeadMetaFilters,
    isLoadingAdSets: isLoadingLeadMetaFilters,
    isLoadingAds: isLoadingLeadMetaFilters,
  };
}
