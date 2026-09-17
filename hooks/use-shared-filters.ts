import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useFilters } from '@/contexts/FilterContext';
import { useAuth } from '@/contexts/AuthContext';
import { getLeadMetaFilters } from '@/lib/api/pipeline-board';
import { useTags } from '@/hooks/use-tags';
import { useTeams } from '@/hooks/use-teams';
import { useUserPermissions } from '@/hooks/use-user-permissions';
import { DatePreset } from './use-dashboard-filters';
import {
  resolvePipelineDateModeForRange,
  type PipelineDateMode,
} from '@/lib/pipeline-date-mode';
import { shouldRetryPipelineQuery } from '@/lib/pipeline-reliability';
import { resolvePipelineFilterScopeState } from '@/lib/pipeline-filter-readiness';

export interface SharedFilters {
  datePreset: DatePreset;
  dateRange: { from: Date; to: Date };
  teamId: string | null;
  userId: string | null;
  source: string | null;
  campaignId: string | null;
  adSetId: string | null;
  adId: string | null;
  tagIds: string[];
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

const EMPTY_LEAD_META_FILTERS = { sources: [], campaigns: [], adsets: [], ads: [] };

export function useSharedFilters(options?: {
  loadDynamicOptions?: boolean;
  pipelineId?: string | null;
  dateMode?: PipelineDateMode;
  dateRangeOverride?: { from: Date; to: Date } | null;
}) {
  const { activeOrganization } = useAuth();
  const { hasPermission, isLoading: permissionsLoading } = useUserPermissions();
  const organizationId = activeOrganization.organizationId;
  const {
    isHydrated: isFiltersHydrated,
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
    tagIds,
    setTagIds,
    dealStatus,
    setDealStatus,
    searchQuery,
    setSearchQuery,
    clearFilters,
  } = useFilters();

  const shouldLoadDynamicOptions = options?.loadDynamicOptions ?? true;
  const canUseTeamFilters = hasPermission('lead_view_all') || hasPermission('lead_view_team');
  const pipelineId = options?.pipelineId ?? null;
  const hasDateRangeOverride = Object.prototype.hasOwnProperty.call(
    options || {},
    'dateRangeOverride',
  );
  const effectiveDateRange = hasDateRangeOverride
    ? options?.dateRangeOverride ?? null
    : dateRange;
  const dateMode = resolvePipelineDateModeForRange(effectiveDateRange, options?.dateMode);
  const previousTeamIdRef = useRef(teamId);
  const wasFiltersHydratedRef = useRef(false);
  const wasMetaFilterCascadeHydratedRef = useRef(false);
  const previousCampaignIdRef = useRef(campaignId);
  const previousAdSetIdRef = useRef(adSetId);
  const dateFromStr = effectiveDateRange?.from.toISOString();
  const dateToStr = effectiveDateRange?.to.toISOString();
  const teamsQuery = useTeams({
    enabled:
      isFiltersHydrated &&
      !permissionsLoading &&
      shouldLoadDynamicOptions &&
      canUseTeamFilters,
  });

  const leadMetaFiltersQuery = useQuery({
    queryKey: [
      'shared-filter-lead-meta-filters',
      organizationId,
      pipelineId,
      dateFromStr,
      dateToStr,
      dateMode,
    ],
    enabled: isFiltersHydrated && shouldLoadDynamicOptions && !!organizationId,
    queryFn: ({ signal }) => getLeadMetaFilters({
      organizationId,
      dateRange: effectiveDateRange,
      dateMode,
      pipelineId,
      signal,
    }),
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 60,
    refetchOnWindowFocus: false,
    retry: shouldRetryPipelineQuery,
    retryDelay: 800,
    placeholderData: EMPTY_LEAD_META_FILTERS,
  });

  const tagsQuery = useTags({ enabled: isFiltersHydrated && shouldLoadDynamicOptions });

  const dynamicSources = useMemo(() => {
    const sources = new Set(leadMetaFiltersQuery.data?.sources || []);
    return Array.from(sources).map((value) => ({ value, label: labelize(value) }));
  }, [leadMetaFiltersQuery.data?.sources]);

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
          .filter((item) => (
            (!campaignId || item.campaignId === campaignId) &&
            (!adSetId || item.adsetId === adSetId)
          )),
      ),
    [adSetId, campaignId, leadMetaFiltersQuery.data],
  );

  const tags = useMemo(() => {
    return (tagsQuery.data || [])
      .map((tag) => ({ id: tag.id, name: tag.name, color: tag.color }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [tagsQuery.data]);

  const selectedTeam = useMemo(
    () => (teamId ? teamsQuery.data?.find((item) => item.id === teamId) : undefined),
    [teamId, teamsQuery.data],
  );
  const teamFilterScope = resolvePipelineFilterScopeState({
    hasSelection: Boolean(teamId),
    loadEnabled:
      isFiltersHydrated &&
      !permissionsLoading &&
      canUseTeamFilters &&
      shouldLoadDynamicOptions,
    dataUpdatedAt: teamsQuery.dataUpdatedAt,
    selectionMatchesCachedOptions: Boolean(selectedTeam),
    queryError: teamsQuery.isError ? teamsQuery.error : null,
  });
  const isTeamScopeReady = teamFilterScope.ready;

  const selectedTeamUserIds = useMemo(() => {
    if (!teamId) return undefined;
    if (!isTeamScopeReady || !selectedTeam) return undefined;

    return Array.from(
      new Set(
        (selectedTeam.members || [])
          .map((member) => member.user_id)
          .filter((userId): userId is string => Boolean(userId)),
      ),
    ).sort();
  }, [isTeamScopeReady, selectedTeam, teamId]);

  useEffect(() => {
    if (!isFiltersHydrated || permissionsLoading || !teamId) return;

    const shouldClearTeam = !canUseTeamFilters || (
      shouldLoadDynamicOptions &&
      !teamsQuery.isFetching &&
      teamsQuery.isSuccess &&
      !selectedTeam
    );
    if (!shouldClearTeam) return;

    let isActive = true;
    queueMicrotask(() => {
      if (!isActive) return;
      setTeamId(null);
      setUserId(null);
    });
    return () => {
      isActive = false;
    };
  }, [
    canUseTeamFilters,
    isFiltersHydrated,
    permissionsLoading,
    selectedTeam,
    setTeamId,
    setUserId,
    shouldLoadDynamicOptions,
    teamId,
    teamsQuery.isFetching,
    teamsQuery.isSuccess,
  ]);

  useEffect(() => {
    if (!isFiltersHydrated || campaignId || (!adSetId && !adId)) return;

    let isActive = true;
    queueMicrotask(() => {
      if (!isActive) return;
      setAdSetId(null);
      setAdId(null);
    });
    return () => {
      isActive = false;
    };
  }, [adId, adSetId, campaignId, isFiltersHydrated, setAdId, setAdSetId]);

  useEffect(() => {
    if (!isFiltersHydrated || adSetId || !adId) return;

    let isActive = true;
    queueMicrotask(() => {
      if (isActive) setAdId(null);
    });
    return () => {
      isActive = false;
    };
  }, [adId, adSetId, isFiltersHydrated, setAdId]);

  useEffect(() => {
    if (!isFiltersHydrated) {
      wasMetaFilterCascadeHydratedRef.current = false;
      previousCampaignIdRef.current = campaignId;
      previousAdSetIdRef.current = adSetId;
      return;
    }
    if (!wasMetaFilterCascadeHydratedRef.current) {
      wasMetaFilterCascadeHydratedRef.current = true;
      previousCampaignIdRef.current = campaignId;
      previousAdSetIdRef.current = adSetId;
      return;
    }
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
  }, [adSetId, campaignId, isFiltersHydrated, setAdId, setAdSetId]);

  useEffect(() => {
    if (!isFiltersHydrated || !wasMetaFilterCascadeHydratedRef.current) {
      previousAdSetIdRef.current = adSetId;
      return;
    }
    if (previousAdSetIdRef.current === adSetId) return;
    previousAdSetIdRef.current = adSetId;

    let isActive = true;
    queueMicrotask(() => {
      if (isActive) setAdId(null);
    });
    return () => {
      isActive = false;
    };
  }, [adSetId, isFiltersHydrated, setAdId]);

  useEffect(() => {
    if (!isFiltersHydrated) {
      wasFiltersHydratedRef.current = false;
      previousTeamIdRef.current = teamId;
      return;
    }
    if (!wasFiltersHydratedRef.current) {
      wasFiltersHydratedRef.current = true;
      previousTeamIdRef.current = teamId;
      return;
    }
    if (previousTeamIdRef.current === teamId) return;
    previousTeamIdRef.current = teamId;

    let isActive = true;
    queueMicrotask(() => {
      if (isActive) setUserId(null);
    });
    return () => {
      isActive = false;
    };
  }, [isFiltersHydrated, setUserId, teamId]);

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
      tagIds,
      dealStatus,
      searchQuery,
    }),
    [datePreset, dateRange, teamId, userId, source, campaignId, adSetId, adId, tagIds, dealStatus, searchQuery],
  );

  const hasActiveFilters =
    teamId !== null ||
    (userId !== null && userId !== 'all') ||
    source !== null ||
    campaignId !== null ||
    adSetId !== null ||
    adId !== null ||
    tagIds.length > 0 ||
    dealStatus !== null ||
    searchQuery !== '' ||
    (hasDateRangeOverride ? Boolean(effectiveDateRange) : datePreset !== 'last30days');

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
    tagIds,
    setTagIds,
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
    isFiltersHydrated,
    isTeamScopeReady,
    teamScopeError: teamFilterScope.error,
    refetchTeams: teamsQuery.refetch,
    refetchLeadMetaFilters: leadMetaFiltersQuery.refetch,
    refetchTags: tagsQuery.refetch,
    hasTeamOptionsError: canUseTeamFilters && teamsQuery.isError,
    hasLeadMetaFiltersError: leadMetaFiltersQuery.isError,
    hasTagsError: tagsQuery.isError,
    hasDynamicOptionsError:
      leadMetaFiltersQuery.isError ||
      tagsQuery.isError ||
      (canUseTeamFilters && teamsQuery.isError),
    isRetryingDynamicOptions:
      leadMetaFiltersQuery.isFetching ||
      tagsQuery.isFetching ||
      (canUseTeamFilters && teamsQuery.isFetching),
    isLoadingSources: isLoadingLeadMetaFilters,
    isLoadingCampaigns: isLoadingLeadMetaFilters,
    isLoadingAdSets: isLoadingLeadMetaFilters,
    isLoadingAds: isLoadingLeadMetaFilters,
    isLoadingTags: tagsQuery.isLoading || tagsQuery.isFetching,
  };
}
