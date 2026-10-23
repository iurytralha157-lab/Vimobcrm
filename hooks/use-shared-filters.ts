import { useDeferredValue, useMemo } from 'react';
import { useQueryWithDataTrust, type QueryDataTrustScope } from '@/hooks/shared/use-query-data-trust';
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
import { isTenantContextForOrganization } from '@/lib/access/tenant-navigation';
import { createTenantQueryAccessSignature } from '@/lib/access/tenant-query-cache';
import { buildPipelineLeadMetaFilterQueryKey } from '@/lib/pipeline-board-query';
import { validateDateRangeLimit } from '@/lib/filters/date-range-limits';
import { isSharedFilterOptionsAccessDenied } from '@/lib/filters/shared-filter-options';

export interface SharedFilters {
  datePreset: DatePreset | null;
  dateRange: { from: Date; to: Date } | null;
  pipelineId: string | null;
  teamId: string | null;
  userId: string | null;
  source: string | null;
  pageId: string | null;
  campaignId: string | null;
  campaignIds: string[];
  adSetId: string | null;
  adId: string | null;
  tagIds: string[];
  dealStatus: string | null;
  searchQuery: string;
}

function labelize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function uniqueOptions(items: Array<{ id?: string | null; name?: string | null }>, allowOpaqueMetaIds = false) {
  const map = new Map<string, string>();
  items.forEach((item) => {
    const id = item.id || item.name;
    const name = item.name?.trim();
    if (id && name && (allowOpaqueMetaIds || !isOpaqueMetaId(name))) map.set(id, name);
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
    map.set(JSON.stringify([campaignId, id]), { id, name, campaignId });
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
    map.set(JSON.stringify([campaignId, adsetId, id]), { id, name, adsetId, campaignId });
  });
  return Array.from(map.values());
}

const EMPTY_LEAD_META_FILTERS = { sources: [], pages: [], campaigns: [], adsets: [], ads: [] };

export function useSharedFilters(options?: {
  cacheTrustScope?: QueryDataTrustScope;
  loadDynamicOptions?: boolean;
  pipelineId?: string | null;
  dateMode?: PipelineDateMode;
  dateRangeOverride?: { from: Date; to: Date } | null;
  entryMode?: boolean;
  scopeMetaOptionsToBoard?: boolean;
  multiCampaigns?: boolean;
  dateRangeMaxDays?: number;
}) {
  const { activeOrganization, user, profile, tenantContext, isSuperAdmin, impersonating } = useAuth();
  const { hasPermission, isLoading: permissionsLoading } = useUserPermissions();
  const organizationId = activeOrganization.organizationId;
  const {
    isHydrated: isFiltersHydrated,
    datePreset,
    setDatePreset,
    customDateRange,
    setCustomDateRange,
    clearDateFilter,
    activeDateRange: dateRange,
    pipelineId: sharedPipelineId,
    setPipelineId,
    teamId,
    setTeamId,
    userId,
    setUserId,
    source,
    setSource,
    pageId,
    setPageId,
    campaignId,
    setCampaignId,
    campaignIds,
    setCampaignIds,
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

  const multiCampaigns = options?.multiCampaigns === true;
  const selectedCampaignIds = useMemo(
    () => multiCampaigns ? campaignIds : campaignId ? [campaignId] : [],
    [campaignId, campaignIds, multiCampaigns],
  );
  const selectedCampaignIdSet = useMemo(
    () => new Set(selectedCampaignIds),
    [selectedCampaignIds],
  );

  const requestedDynamicOptions = options?.loadDynamicOptions ?? true;
  const hasHydratedDynamicSelection = isFiltersHydrated && Boolean(
    teamId ||
    (userId && userId !== 'all' && userId !== 'unassigned') ||
    (source && source !== 'all') ||
    (pageId && pageId !== 'all') ||
    selectedCampaignIds.length > 0 ||
    (adSetId && adSetId !== 'all') ||
    (adId && adId !== 'all') ||
    tagIds.length > 0
  );
  const shouldLoadDynamicOptions =
    requestedDynamicOptions || hasHydratedDynamicSelection;
  const canUseTeamFilters = hasPermission('lead_view_all') || hasPermission('lead_view_team');
  const pipelineId = Object.prototype.hasOwnProperty.call(options ?? {}, 'pipelineId')
    ? options?.pipelineId ?? null
    : sharedPipelineId;
  const entryMode = options?.entryMode === true;
  const scopeMetaOptionsToBoard = options?.scopeMetaOptionsToBoard === true && !entryMode;
  const isScopedMetaOptions = entryMode || scopeMetaOptionsToBoard;
  const currentTenantContext = isTenantContextForOrganization(organizationId, tenantContext)
    ? tenantContext
    : null;
  const metaAccessSignature = isScopedMetaOptions ? createTenantQueryAccessSignature({
    userId: user?.id ?? profile?.id,
    organizationId,
    memberRole: currentTenantContext?.memberRole,
    permissions: currentTenantContext?.permissions,
    enabledModules: currentTenantContext?.enabledModules,
    isTeamLeader: currentTenantContext?.isTeamLeader,
    ledTeamIds: currentTenantContext?.ledTeamIds,
    ledUserIds: currentTenantContext?.ledUserIds,
    ledPipelineIds: currentTenantContext?.ledPipelineIds,
    isSuperAdmin: currentTenantContext?.isSuperAdmin ?? isSuperAdmin,
    impersonatedOrganizationId: impersonating?.orgId,
  }) : null;
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const metaSearchQuery = scopeMetaOptionsToBoard ? deferredSearchQuery : searchQuery;
  const hasDateRangeOverride = Object.prototype.hasOwnProperty.call(
    options || {},
    'dateRangeOverride',
  );
  const effectiveDateRange = hasDateRangeOverride
    ? options?.dateRangeOverride ?? null
    : dateRange;
  const periodError = options?.dateRangeMaxDays === undefined
    ? null
    : validateDateRangeLimit(effectiveDateRange, options.dateRangeMaxDays);
  const dateMode = resolvePipelineDateModeForRange(effectiveDateRange, options?.dateMode);
  const dateFromStr = effectiveDateRange?.from.toISOString();
  const dateToStr = effectiveDateRange?.to.toISOString();
  const teamsQuery = useTeams({
    cacheTrustScope: options?.cacheTrustScope,
    catalog: true,
    enabled:
      isFiltersHydrated &&
      !permissionsLoading &&
      shouldLoadDynamicOptions &&
      canUseTeamFilters,
  });

  const leadMetaFilterQueryKey = buildPipelineLeadMetaFilterQueryKey({
    organizationId,
    pipelineId,
    pageId,
    dateFrom: dateFromStr,
    dateTo: dateToStr,
    dateMode,
    entryMode,
    scopeToBoard: scopeMetaOptionsToBoard,
    accessSignature: metaAccessSignature,
    teamId,
    userId,
    dealStatus,
    tagIds,
    searchQuery: metaSearchQuery,
  });
  const leadMetaFiltersQuery = useQueryWithDataTrust({
    // A report's guarded observer must not share fetch/cache policy with an
    // unrestricted Pipeline or WhatsApp observer for the same period.
    queryKey: options?.dateRangeMaxDays === undefined
      ? leadMetaFilterQueryKey
      : [...leadMetaFilterQueryKey, 'report-period-limit-days', options.dateRangeMaxDays],
    enabled: isFiltersHydrated && !periodError && shouldLoadDynamicOptions && !!organizationId && (!entryMode || !!currentTenantContext),
    queryFn: ({ signal }) => {
      if (periodError) throw new Error(periodError);
      return getLeadMetaFilters({
        organizationId,
        dateRange: effectiveDateRange,
        dateMode,
        pipelineId,
        filterPage: pageId,
        entryMode,
        scopeToBoard: scopeMetaOptionsToBoard,
        teamId,
        userId,
        dealStatus,
        tagIds,
        searchQuery: metaSearchQuery,
        signal,
      });
    },
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 60,
    refetchOnWindowFocus: false,
    refetchOnMount: true,
    retry: (failureCount, error) => !periodError && shouldRetryPipelineQuery(failureCount, error),
    retryDelay: 800,
    placeholderData: EMPTY_LEAD_META_FILTERS,
  }, options?.cacheTrustScope);

  const tagsQuery = useTags({ cacheTrustScope: options?.cacheTrustScope, catalog: true, enabled: isFiltersHydrated && shouldLoadDynamicOptions });
  const leadMetaFilters = periodError || leadMetaFiltersQuery.isAccessBlocked || isSharedFilterOptionsAccessDenied(leadMetaFiltersQuery.error)
    ? EMPTY_LEAD_META_FILTERS
    : leadMetaFiltersQuery.displayData;
  const visibleTags = isSharedFilterOptionsAccessDenied(tagsQuery.error) ? undefined
    : options?.cacheTrustScope ? tagsQuery.displayData : tagsQuery.data;
  const visibleTeams = isSharedFilterOptionsAccessDenied(teamsQuery.error) ? undefined
    : options?.cacheTrustScope ? teamsQuery.displayData : teamsQuery.data;

  const dynamicSources = useMemo(() => {
    const sources = new Set(leadMetaFilters?.sources || []);
    return Array.from(sources).map((value) => ({ value, label: labelize(value) }));
  }, [leadMetaFilters?.sources]);

  const campaigns = useMemo(
    () =>
      uniqueOptions(
        (leadMetaFilters?.campaigns || []).map((item) => ({
          id: item.id,
          name: item.name,
        })),
        entryMode,
      ),
    [entryMode, leadMetaFilters],
  );

  const adSets = useMemo(
    () =>
      uniqueAdSetOptions(
        (leadMetaFilters?.adsets || [])
          .map((item) => ({
            id: item.id,
            name: item.name,
            campaignId: item.campaignId,
          }))
          .filter((item) => selectedCampaignIdSet.size === 0 || selectedCampaignIdSet.has(item.campaignId || '')),
      ),
    [leadMetaFilters, selectedCampaignIdSet],
  );

  const ads = useMemo(
    () =>
      uniqueAdOptions(
        (leadMetaFilters?.ads || [])
          .map((item) => ({
            id: item.id,
            name: item.name,
            adsetId: item.adsetId,
            campaignId: item.campaignId,
          }))
          .filter((item) => (
            (selectedCampaignIdSet.size === 0 || selectedCampaignIdSet.has(item.campaignId || '')) &&
            (!adSetId || item.adsetId === adSetId)
          )),
      ),
    [adSetId, leadMetaFilters, selectedCampaignIdSet],
  );

  const tags = useMemo(() => {
    return (visibleTags || [])
      .map((tag) => ({ id: tag.id, name: tag.name, color: tag.color }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [visibleTags]);

  const selectedTeam = useMemo(
    () => (teamId ? visibleTeams?.find((item) => item.id === teamId) : undefined),
    [teamId, visibleTeams],
  );

  const pages = useMemo(() => {
    const options = new Map<string, string>();
    (leadMetaFilters?.pages || []).forEach((item) => {
      const id = item.id?.trim();
      if (id) options.set(id, item.name?.trim() || id);
    });
    if (pageId && !options.has(pageId)) options.set(pageId, pageId);
    return Array.from(options.entries()).map(([id, name]) => ({ id, name }));
  }, [leadMetaFilters, pageId]);
  const unavailableTeamError = useMemo(() => {
    if (!isFiltersHydrated || permissionsLoading || !teamId) return null;
    if (!canUseTeamFilters) return new Error('O filtro de equipe selecionado não está disponível para sua permissão atual. Remova esse critério para continuar.');
    if (shouldLoadDynamicOptions && teamsQuery.isSuccess && !teamsQuery.isFetching && !selectedTeam) {
      return new Error('A equipe selecionada não está disponível. Remova ou altere esse critério para continuar.');
    }
    return null;
  }, [isFiltersHydrated, permissionsLoading, teamId, canUseTeamFilters, shouldLoadDynamicOptions, teamsQuery.isSuccess, teamsQuery.isFetching, selectedTeam]);
  const teamFilterScope = resolvePipelineFilterScopeState({
    hasSelection: Boolean(teamId),
    loadEnabled:
      isFiltersHydrated &&
      !permissionsLoading &&
      canUseTeamFilters &&
      shouldLoadDynamicOptions,
    dataUpdatedAt: teamsQuery.dataUpdatedAt,
    selectionMatchesCachedOptions: Boolean(selectedTeam),
    queryError: unavailableTeamError ?? ((teamsQuery.isError || (Boolean(options?.cacheTrustScope) && teamsQuery.isAccessBlocked)) ? teamsQuery.error : null),
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

  const filters: SharedFilters = useMemo(
    () => ({
      datePreset,
      dateRange,
      pipelineId: sharedPipelineId,
      teamId,
      userId,
      source,
      pageId,
      campaignId,
      campaignIds,
      adSetId,
      adId,
      tagIds,
      dealStatus,
      searchQuery,
    }),
    [datePreset, dateRange, sharedPipelineId, teamId, userId, source, pageId, campaignId, campaignIds, adSetId, adId, tagIds, dealStatus, searchQuery],
  );

  const hasActiveFilters =
    sharedPipelineId !== null ||
    teamId !== null ||
    (userId !== null && userId !== 'all') ||
    source !== null ||
    pageId !== null ||
    selectedCampaignIds.length > 0 ||
    adSetId !== null ||
    adId !== null ||
    tagIds.length > 0 ||
    dealStatus !== null ||
    searchQuery !== '' ||
    Boolean(effectiveDateRange);

  const isLoadingLeadMetaFilters = leadMetaFiltersQuery.isLoading || leadMetaFiltersQuery.isFetching;
  return {
    filters,
    datePreset,
    setDatePreset,
    customDateRange,
    setCustomDateRange,
    clearDateFilter,
    pipelineId: sharedPipelineId,
    setPipelineId,
    teamId,
    setTeamId,
    userId,
    setUserId,
    source,
    setSource,
    pageId,
    setPageId,
    campaignId,
    setCampaignId,
    campaignIds,
    setCampaignIds,
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
    pages,
    campaigns,
    adSets,
    ads,
    tags,
    selectedTeamUserIds,
    isFiltersHydrated,
    periodError,
    isTeamScopeReady,
    teamScopeError: unavailableTeamError ?? teamFilterScope.error,
    refetchTeams: teamsQuery.refetch,
    refetchLeadMetaFilters: leadMetaFiltersQuery.refetch,
    refetchTags: tagsQuery.refetch,
    hasTeamOptionsError: canUseTeamFilters && (teamsQuery.isError || (Boolean(options?.cacheTrustScope) && teamsQuery.isAccessBlocked)),
    hasLeadMetaFiltersError: (leadMetaFiltersQuery.isError || leadMetaFiltersQuery.isAccessBlocked),
    hasTagsError: (tagsQuery.isError || (Boolean(options?.cacheTrustScope) && tagsQuery.isAccessBlocked)),
    hasDynamicOptionsError:
      (leadMetaFiltersQuery.isError || leadMetaFiltersQuery.isAccessBlocked) ||
      (tagsQuery.isError || (Boolean(options?.cacheTrustScope) && tagsQuery.isAccessBlocked)) ||
      (canUseTeamFilters && (teamsQuery.isError || (Boolean(options?.cacheTrustScope) && teamsQuery.isAccessBlocked))),
    isRetryingDynamicOptions:
      leadMetaFiltersQuery.isFetching ||
      tagsQuery.isFetching ||
      (canUseTeamFilters && teamsQuery.isFetching),
    isLoadingSources: isLoadingLeadMetaFilters,
    isLoadingPages: isLoadingLeadMetaFilters,
    isLoadingCampaigns: isLoadingLeadMetaFilters,
    isLoadingAdSets: isLoadingLeadMetaFilters,
    isLoadingAds: isLoadingLeadMetaFilters,
    isLoadingTags: tagsQuery.isLoading || tagsQuery.isFetching,
  };
}
