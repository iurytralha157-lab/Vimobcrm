"use client";

// Main screen for the pipelines domain.

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { FormEvent } from 'react';
import type { DropResult } from '@hello-pangea/dnd';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';

import { AppLayout } from '@/components/shared/layout/AppLayout';
import {
  buildStageCountMetaMap,
  buildStageValueMap,
  filterPipelineStages,
  getLeadTagsSignature,
  getOptimisticAutomationDealStatusForStage,
  getOptimisticDealStatusForStage,
  getPipelineErrorMessage,
  getVisualPendingMoveKey,
  isPipelineDealStatus,
  isUnsafePartialStageDrop,
  mergeMovedLeadResponse,
  NO_VISIBLE_USER_ID,
  PipelineBoard,
  PipelineDialogs,
  PipelineToolbar,
  PIPELINE_MOVE_PERSISTENCE_INTERVAL_MS,
  shouldApplyVisualPendingMove,
  shouldKeepLeadForDealStatusFilter,
  waitForPipelineMove,
  type PipelineStageSettingsValue,
  type VisualPendingPipelineMove,
} from '@/components/features/pipelines/pipeline-screen';
import { useAuth } from '@/contexts/AuthContext';
import { useSharedFilters } from '@/hooks/use-shared-filters';
import { cn } from '@/lib/utils';
import {
  useStages,
  useStagesWithLeads,
  usePipelines,
  useCreatePipeline,
  useCreateStage,
  useDeletePipeline,
} from '@/hooks/use-stages';
import { stageWithLeadsQueryKey } from '@/lib/pipeline-query-key';
import { getPipelineLeadPageCursor } from '@/lib/pipeline-pagination-state';
import { getOptimisticPipelineMoveOutcome } from '@/lib/pipeline-stage-outcome';
import { createPipelineStageSnapshot } from '@/lib/pipeline-stage-snapshot';
import { stageHexColorInputSchema } from '@/lib/validation';
import {
  applyPendingPipelineMoves,
  clearPendingPipelineMove,
  findPipelineLeadLocation,
  getPipelineBoardQueryKeyId,
  registerPendingPipelineMove,
  restorePipelineLeadSnapshot,
  type PendingPipelineMove,
} from '@/lib/pipeline-board-cache';
import type { PipelineLead, PipelineQueryFilters, StageWithLeads } from '@/hooks/use-stages';
import { useLoadMoreLeads } from '@/hooks/use-stages';
import { useOrganizationUsers } from '@/hooks/use-users';
import { useTags } from '@/hooks/use-tags';
import { useAssignLeadRoundRobin } from '@/hooks/use-assign-lead-roundrobin';
import { useIsMobile } from '@/hooks/use-mobile';
import { useCanEditCadences } from '@/hooks/use-can-edit-cadences';
import { useLeadVisibility } from '@/hooks/use-lead-visibility';
import { useUserPermissions } from '@/hooks/use-user-permissions';
import { useOrganizationModules } from '@/hooks/use-organization-modules';
import { PIPELINE_STAGE_COLOR_FALLBACK } from '@/config/pipeline-stage-colors';

import {
  notifyLeadRealtimeChange,
  preserveOptimisticPipelineBoard,
} from '@/contexts/LeadRealtimeBus';
import { toast } from 'sonner';
import { getClientRateLimitMessage } from '@/lib/client-action-rate-limit';
import { leadsAPI } from '@/lib/api/leads';
import { VimobAPIError } from '@/lib/api/vimob-client';
import { getLeadEnrichments } from '@/lib/api/lead-enrichments';
import { pipelinesAPI } from '@/lib/api/pipelines';
import { useStageAutomations } from '@/hooks/use-stage-automations';

export default function Pipelines() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { activeOrganization, profile } = useAuth();
  const [shouldLoadFilterOptions, setShouldLoadFilterOptions] = useState(false);
  const activeOrganizationId = activeOrganization.organizationId;
  const { hasPermission, isLoading: permissionLoading } = useUserPermissions();
  const { hasModule } = useOrganizationModules();
  const canOperateLeads = hasPermission('lead_operate');
  const canCreateLeads = hasPermission('lead_create');
  const hasWhatsAppModule = hasModule('whatsapp');
  const canOperateWhatsApp = hasWhatsAppModule && hasPermission('whatsapp_operate');
  const canViewWhatsApp =
    hasWhatsAppModule && (hasPermission('whatsapp_view') || canOperateWhatsApp);
  const [selectedLead, setSelectedLead] = useState<PipelineLead | null>(null);
  const [editingLead, setEditingLead] = useState<PipelineLead | null>(null);
  const [lostReasonLead, setLostReasonLead] = useState<PipelineLead | null>(null);
  const [pendingLostMove, setPendingLostMove] = useState<DropResult | null>(null);
  const [lostReasonPending, setLostReasonPending] = useState(false);
  const [newLeadDialogOpen, setNewLeadDialogOpen] = useState(false);
  const [newLeadStageId, setNewLeadStageId] = useState<string | null>(null);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null);
  const {
    filters: sharedFilters,
    datePreset,
    setDatePreset,
    customDateRange,
    setCustomDateRange,
    clearDateFilter,
    setTeamId,
    userId: filterUser,
    setUserId: setFilterUser,
    tagIds: filterTags,
    setTagIds: setFilterTags,
    dealStatus: filterDealStatus,
    setDealStatus: setFilterDealStatus,
    pageId: filterPage,
    setPageId: setFilterPage,
    campaignId: filterCampaign,
    setCampaignId: setFilterCampaign,
    adSetId: filterAdSet,
    setAdSetId: setFilterAdSet,
    adId: filterAd,
    setAdId: setFilterAd,
    source: filterSource,
    setSource: setFilterSource,
    searchQuery,
    setSearchQuery,
    clearFilters,
    hasActiveFilters: hasSharedActiveFilters,
    dynamicSources,
    pages,
    campaigns,
    adSets,
    ads,
    tags: allTagsFromHook,
    selectedTeamUserIds,
    isFiltersHydrated,
    isTeamScopeReady,
    teamScopeError,
    refetchTeams,
    refetchLeadMetaFilters,
    refetchTags,
    hasTeamOptionsError,
    hasLeadMetaFiltersError,
    hasTagsError,
    hasDynamicOptionsError,
    isRetryingDynamicOptions,
    isLoadingSources,
    isLoadingPages,
    isLoadingCampaigns,
    isLoadingAdSets,
    isLoadingAds,
    isLoadingTags,
  } = useSharedFilters({
    loadDynamicOptions: shouldLoadFilterOptions,
    pipelineId: selectedPipelineId,
    dateMode: 'origin',
  });
  const pipelineDateRange = sharedFilters.dateRange;

  const hasDynamicMetaFilterSelection = Boolean(
    (filterSource && filterSource !== 'all') ||
    (filterPage && filterPage !== 'all') ||
    (filterCampaign && filterCampaign !== 'all') ||
    (filterAdSet && filterAdSet !== 'all') ||
    (filterAd && filterAd !== 'all'),
  );
  const hasDynamicTagFilterSelection = filterTags.length > 0;
  const hasHydratedDynamicFilterSelection = isFiltersHydrated && Boolean(
    sharedFilters.teamId || filterUser || hasDynamicMetaFilterSelection || hasDynamicTagFilterSelection,
  );

  useEffect(() => {
    if (!hasHydratedDynamicFilterSelection) return;
    let isActive = true;
    queueMicrotask(() => {
      if (isActive) setShouldLoadFilterOptions(true);
    });
    return () => {
      isActive = false;
    };
  }, [hasHydratedDynamicFilterSelection]);

  const handleEnableFilterOptions = useCallback(() => {
    setShouldLoadFilterOptions(true);
    if (!shouldLoadFilterOptions) return;

    const retries = [
      ...(hasTeamOptionsError ? [refetchTeams()] : []),
      ...(hasLeadMetaFiltersError ? [refetchLeadMetaFilters()] : []),
      ...(hasTagsError ? [refetchTags()] : []),
    ];
    if (retries.length === 0) return;

    void Promise.all(retries)
      .then((results) => {
        const failedResult = results.find((result) => result.isError);
        if (failedResult?.isError) {
          toast.error(
            `Não foi possível atualizar as opções de filtro: ${getPipelineErrorMessage(failedResult.error)}`,
          );
        }
      })
      .catch((error: unknown) => {
        toast.error(
          `Não foi possível atualizar as opções de filtro: ${getPipelineErrorMessage(error)}`,
        );
      });
  }, [
    hasLeadMetaFiltersError,
    hasTagsError,
    hasTeamOptionsError,
    refetchLeadMetaFilters,
    refetchTags,
    refetchTeams,
    shouldLoadFilterOptions,
  ]);

  const [editingStageId, setEditingStageId] = useState<string | null>(null);
  const [editingStageName, setEditingStageName] = useState('');
  const [savingStageNameId, setSavingStageNameId] = useState<string | null>(null);
  const [settingsStage, setSettingsStage] = useState<StageWithLeads | null>(null);
  const [newPipelineDialogOpen, setNewPipelineDialogOpen] = useState(false);
  const [newPipelineName, setNewPipelineName] = useState('');
  const [newStageDialogOpen, setNewStageDialogOpen] = useState(false);
  const [newStageName, setNewStageName] = useState('');
  const [newStageColor, setNewStageColor] = useState<string>(PIPELINE_STAGE_COLOR_FALLBACK);
  const newStageColorValidation = useMemo(
    () => stageHexColorInputSchema.safeParse(newStageColor),
    [newStageColor],
  );
  const [pipelineToDelete, setPipelineToDelete] = useState<{ id: string; name: string } | null>(null);
  const [attentionSettingsOpen, setAttentionSettingsOpen] = useState(false);
  const [stagesEditorOpen, setStagesEditorOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [boardNowMs, setBoardNowMs] = useState(() => Date.now());

  useEffect(() => {
    const updateClock = () => {
      if (document.visibilityState === 'visible') setBoardNowMs(Date.now());
    };
    const intervalId = window.setInterval(updateClock, 30_000);
    document.addEventListener('visibilitychange', updateClock);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', updateClock);
    };
  }, []);

  const isDraggingRef = useRef(false);
  const stageNameUpdateInFlightRef = useRef(new Set<string>());
  const latestMoveVersionByLeadRef = useRef(new Map<string, number>());
  const nextMovePersistenceStartAtRef = useRef(0);
  const movePersistenceByLeadRef = useRef(new Map<string, Promise<void>>());
  const moveRollbackSnapshotByLeadRef = useRef(new Map<string, StageWithLeads[] | undefined>());
  const assigningLeadIdsRef = useRef(new Set<string>());
  const createPipelineInFlightRef = useRef(false);
  const createStageInFlightRef = useRef(false);
  const deletePipelineInFlightRef = useRef(false);
  const [visualPendingMoves, setVisualPendingMoves] = useState(
    () => new Map<string, VisualPendingPipelineMove>(),
  );
  const previousOrganizationIdRef = useRef(activeOrganizationId);

  useEffect(() => {
    const previousOrganizationId = previousOrganizationIdRef.current;
    previousOrganizationIdRef.current = activeOrganizationId;
    if (!previousOrganizationId || !activeOrganizationId || previousOrganizationId === activeOrganizationId) return;

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setSelectedPipelineId(null);
      setSelectedLead(null);
      setEditingLead(null);
      setLostReasonLead(null);
      setPendingLostMove(null);
      setLostReasonPending(false);
      setSettingsStage(null);
      setNewLeadDialogOpen(false);
      setNewPipelineDialogOpen(false);
      setNewStageDialogOpen(false);
      setPipelineToDelete(null);
      setAttentionSettingsOpen(false);
      setStagesEditorOpen(false);
      setVisualPendingMoves(new Map());
    });

    return () => {
      cancelled = true;
    };
  }, [activeOrganizationId]);

  const {
    data: pipelines = [],
    isLoading: pipelinesLoading,
    isFetching: pipelinesFetching,
    isLoadingError: pipelinesLoadingError,
    refetch: refetchPipelines,
  } = usePipelines();
  const createPipeline = useCreatePipeline();
  const createStage = useCreateStage();
  const deletePipeline = useDeletePipeline();
  const loadMoreLeads = useLoadMoreLeads();

  const selectedPipelineStorageKey = useMemo(() => {
    const organizationId = activeOrganizationId || 'global';
    const userId = profile?.id || 'anonymous';
    return `vimob:pipelines:selected:${organizationId}:${userId}`;
  }, [activeOrganizationId, profile?.id]);

  const handleSelectPipeline = useCallback((pipelineId: string | null) => {
    setSelectedPipelineId(pipelineId);
  }, []);

  useEffect(() => {
    if (!selectedPipelineId || !pipelines.some((pipeline) => pipeline.id === selectedPipelineId)) return;

    try {
      window.localStorage.setItem(selectedPipelineStorageKey, selectedPipelineId);
    } catch {
      // localStorage can be unavailable in restricted browser contexts.
    }
  }, [pipelines, selectedPipelineId, selectedPipelineStorageKey]);

  useEffect(() => {
    let isActive = true;

    if (pipelines.length === 0) {
      if (selectedPipelineId) {
        queueMicrotask(() => {
          if (isActive) handleSelectPipeline(null);
        });
      }

      return () => {
        isActive = false;
      };
    }

    const selectedStillExists = Boolean(selectedPipelineId && pipelines.some((pipeline) => pipeline.id === selectedPipelineId));
    if (selectedStillExists) {
      return () => {
        isActive = false;
      };
    }

    let storedPipelineId: string | null = null;
    try {
      storedPipelineId = window.localStorage.getItem(selectedPipelineStorageKey);
    } catch {
      storedPipelineId = null;
    }

    const storedPipeline = storedPipelineId
      ? pipelines.find((pipeline) => pipeline.id === storedPipelineId)
      : null;
    const fallbackPipeline = pipelines.find((pipeline) => pipeline.is_default) || pipelines[0];

    const nextPipelineId = (storedPipeline || fallbackPipeline)?.id || null;
    queueMicrotask(() => {
      if (isActive) handleSelectPipeline(nextPipelineId);
    });

    return () => {
      isActive = false;
    };
  }, [handleSelectPipeline, pipelines, selectedPipelineId, selectedPipelineStorageKey]);

  const {
    data: leadVisibility,
    isLoading: leadVisibilityLoading,
    isFetching: leadVisibilityFetching,
    isLoadingError: leadVisibilityLoadingError,
    refetch: refetchLeadVisibility,
  } = useLeadVisibility(profile?.id);
  const isDragDisabled = !canOperateLeads;

  const scopedVisibleUserIds = useMemo(() => {
    if (!leadVisibility || leadVisibility.canViewAll) return undefined;
    if (leadVisibility.teamMemberIds) return leadVisibility.teamMemberIds;
    if (leadVisibility.userId) return [leadVisibility.userId];
    return [];
  }, [leadVisibility]);
  const hasUserScope = Array.isArray(scopedVisibleUserIds);
  const isUnassignedFilter = filterUser === 'unassigned';
  const selectedFilterUserId = filterUser === 'all' || isUnassignedFilter
    ? undefined
    : (filterUser || undefined);
  const effectivePipelineFilterUserIds = useMemo(() => {
    if (isUnassignedFilter) return undefined;
    if (!Array.isArray(selectedTeamUserIds)) return scopedVisibleUserIds;
    if (!Array.isArray(scopedVisibleUserIds)) return selectedTeamUserIds;

    const visibleUserIds = new Set(scopedVisibleUserIds);
    return selectedTeamUserIds.filter((userId) => visibleUserIds.has(userId));
  }, [isUnassignedFilter, scopedVisibleUserIds, selectedTeamUserIds]);
  const selectedFilterUserAllowed = useMemo(() => {
    if (!selectedFilterUserId) return true;
    if (hasUserScope && !scopedVisibleUserIds.includes(selectedFilterUserId)) return false;
    if (Array.isArray(selectedTeamUserIds) && !selectedTeamUserIds.includes(selectedFilterUserId)) return false;
    return true;
  }, [hasUserScope, scopedVisibleUserIds, selectedFilterUserId, selectedTeamUserIds]);
  const effectivePipelineFilterUser = selectedFilterUserId
    ? (selectedFilterUserAllowed ? selectedFilterUserId : NO_VISIBLE_USER_ID)
    : undefined;

  useEffect(() => {
    if (!isFiltersHydrated || !selectedFilterUserId || selectedFilterUserAllowed) return;
    setFilterUser(null);
  }, [isFiltersHydrated, selectedFilterUserAllowed, selectedFilterUserId, setFilterUser]);

  const {
    data: baseStages = [],
    isLoading: baseStagesLoading,
    refetch: refetchBaseStages,
  } = useStages(selectedPipelineId || undefined);
  const { data: stageAutomations = [] } = useStageAutomations();

  const shouldLoadPipelineLeads =
    !!selectedPipelineId &&
    isFiltersHydrated &&
    isTeamScopeReady &&
    !permissionLoading &&
    !leadVisibilityLoading &&
    !!leadVisibility;
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const pipelineBoardFilters = useMemo<PipelineQueryFilters>(() => ({
    dateRange: pipelineDateRange,
    dateMode: pipelineDateRange ? 'origin' : undefined,
    filterTags,
    filterDealStatus: filterDealStatus && filterDealStatus !== 'all' ? filterDealStatus : undefined,
    searchQuery: deferredSearchQuery || undefined,
    filterPage: filterPage && filterPage !== 'all' ? filterPage : undefined,
    filterCampaign: filterCampaign && filterCampaign !== 'all' ? filterCampaign : undefined,
    filterAdSet: filterAdSet && filterAdSet !== 'all' ? filterAdSet : undefined,
    filterAd: filterAd && filterAd !== 'all' ? filterAd : undefined,
    filterSource: filterSource && filterSource !== 'all' ? filterSource : undefined,
    filterUserIds: effectivePipelineFilterUserIds,
    unassigned: isUnassignedFilter,
    teamId: isUnassignedFilter ? sharedFilters.teamId || undefined : undefined,
  }), [
    pipelineDateRange,
    filterTags,
    filterDealStatus,
    deferredSearchQuery,
    filterPage,
    filterCampaign,
    filterAdSet,
    filterAd,
    filterSource,
    effectivePipelineFilterUserIds,
    isUnassignedFilter,
    sharedFilters.teamId,
  ]);
  const pipelineBoardQueryKey = useMemo(
    () => stageWithLeadsQueryKey({
      organizationId: activeOrganizationId || undefined,
      pipelineId: selectedPipelineId || undefined,
      filterUserId: effectivePipelineFilterUser,
      filters: pipelineBoardFilters,
    }),
    [
      activeOrganizationId,
      selectedPipelineId,
      effectivePipelineFilterUser,
      pipelineBoardFilters,
    ],
  );
  const pipelineBoardQueryKeyId = useMemo(
    () => getPipelineBoardQueryKeyId(pipelineBoardQueryKey),
    [pipelineBoardQueryKey],
  );
  const boardScopeFingerprint = useMemo(
    () =>
      JSON.stringify({
        organizationId: activeOrganizationId,
        canViewAll: leadVisibility?.canViewAll ?? false,
        filterUserId: effectivePipelineFilterUser ?? null,
        filterUserIds: effectivePipelineFilterUserIds ?? null,
        unassigned: isUnassignedFilter,
        teamId: isUnassignedFilter ? sharedFilters.teamId : null,
      }),
    [
      activeOrganizationId,
      effectivePipelineFilterUser,
      effectivePipelineFilterUserIds,
      isUnassignedFilter,
      leadVisibility?.canViewAll,
      sharedFilters.teamId,
    ],
  );
  const previousBoardScopeRef = useRef<{
    organizationId: string;
    fingerprint: string;
  } | null>(null);

  useEffect(() => {
    if (
      !activeOrganizationId ||
      !isFiltersHydrated ||
      !isTeamScopeReady ||
      permissionLoading ||
      leadVisibilityLoading ||
      !leadVisibility
    ) {
      return;
    }

    const previousScope = previousBoardScopeRef.current;
    previousBoardScopeRef.current = {
      organizationId: activeOrganizationId,
      fingerprint: boardScopeFingerprint,
    };

    if (
      !previousScope ||
      previousScope.organizationId !== activeOrganizationId ||
      previousScope.fingerprint === boardScopeFingerprint
    ) {
      return;
    }

    void queryClient.invalidateQueries({
      queryKey: ['stages-with-leads', activeOrganizationId],
      refetchType: 'none',
    });
  }, [
    activeOrganizationId,
    boardScopeFingerprint,
    isFiltersHydrated,
    isTeamScopeReady,
    leadVisibility,
    leadVisibilityLoading,
    permissionLoading,
    queryClient,
  ]);

  const {
    data: stagesWithLeads = [],
    isLoading: leadsLoading,
    isFetching: leadsFetching,
    isLoadingError: leadsLoadingError,
    isRefetchError: leadsRefetchError,
    isPlaceholderData: leadsPlaceholderData,
    refetch,
  } = useStagesWithLeads(
    selectedPipelineId || undefined,
    effectivePipelineFilterUser,
    pipelineBoardFilters,
    { enabled: shouldLoadPipelineLeads }
  );

  const stages = useMemo<StageWithLeads[]>(() => {
    const canonicalStages = stagesWithLeads.length > 0
      ? stagesWithLeads
      : baseStages.filter((stage) => stage.is_active !== false).map(s => ({
          ...s,
          leads: [] as PipelineLead[],
          total_lead_count: s.lead_count || 0,
          has_more: false,
        }));
    const currentMoves = [...visualPendingMoves.values()]
      .filter((entry) => entry.queryKeyId === pipelineBoardQueryKeyId)
      .filter((entry) => shouldApplyVisualPendingMove(canonicalStages, entry))
      .map((entry) => entry.move);

    return applyPendingPipelineMoves(canonicalStages, currentMoves) ?? canonicalStages;
  }, [
    baseStages,
    stagesWithLeads,
    visualPendingMoves,
    pipelineBoardQueryKeyId,
  ]);

  useEffect(() => {
    const hasReleasedEntryToClean = [...visualPendingMoves.values()].some(
      (entry) =>
        entry.release &&
        entry.queryKeyId === pipelineBoardQueryKeyId &&
        !shouldApplyVisualPendingMove(stagesWithLeads, entry),
    );
    if (!hasReleasedEntryToClean) return;

    let isActive = true;
    queueMicrotask(() => {
      if (!isActive) return;
      setVisualPendingMoves((current) => {
        const next = new Map(current);
        current.forEach((entry, key) => {
          if (
            entry.release &&
            entry.queryKeyId === pipelineBoardQueryKeyId &&
            !shouldApplyVisualPendingMove(stagesWithLeads, entry)
          ) {
            next.delete(key);
          }
        });
        return next.size === current.size ? current : next;
      });
    });

    return () => {
      isActive = false;
    };
  }, [pipelineBoardQueryKeyId, stagesWithLeads, visualPendingMoves]);

  const shouldLoadLeadDialogResources = Boolean(selectedLead);
  const { data: users = [] } = useOrganizationUsers({ enabled: shouldLoadLeadDialogResources });
  const { data: allTags = [] } = useTags({ enabled: shouldLoadLeadDialogResources });
  const assignLeadRoundRobin = useAssignLeadRoundRobin();
  const assignLeadRoundRobinMutate = assignLeadRoundRobin.mutate;
  const canEditPipeline = useCanEditCadences();
  const canManageAttention = hasPermission('attention_view') && (
    hasPermission('pipeline_manage') || hasPermission('automations_manage')
  );
  const isMobile = useIsMobile();
  const [activeMobileStageId, setActiveMobileStageId] = useState<string | null>(null);

  const currentPipeline = pipelines.find(p => p.id === selectedPipelineId);
  const isLoading =
    pipelinesLoading ||
    baseStagesLoading ||
    permissionLoading ||
    leadVisibilityLoading ||
    !isFiltersHydrated ||
    (Boolean(sharedFilters.teamId) && !isTeamScopeReady && !teamScopeError);
  const isInitialLeadsLoading = leadsLoading && stagesWithLeads.length === 0;
  const isPipelineBoardTransitioning = shouldLoadPipelineLeads && (isInitialLeadsLoading || leadsPlaceholderData);
  const hasCriticalLoadError =
    (pipelinesLoadingError && pipelines.length === 0) ||
    (leadVisibilityLoadingError && !leadVisibility) ||
    (leadsLoadingError && stagesWithLeads.length === 0) ||
    Boolean(teamScopeError);
  const hasPipelineBoardError =
    !hasCriticalLoadError &&
    leadsRefetchError &&
    !isPipelineBoardTransitioning &&
    !leadsFetching &&
    !pipelinesFetching;
  const canShowColumnActions = canEditPipeline && Boolean(selectedPipelineId) && !isMobile && !isLoading;
  const canShowPipelineSettings = Boolean(selectedPipelineId) && !isLoading && (
    canEditPipeline || canManageAttention
  );

  const handleDragStart = useCallback(() => {
    isDraggingRef.current = true;
  }, []);

  const handleOpenLead = useCallback((lead: PipelineLead | { id: string }) => {
    setSelectedLead(lead as PipelineLead);
  }, []);

  const handleAssignLeadNow = useCallback((leadId: string) => {
    if (!canOperateLeads) {
      toast.error('Você não tem permissão para atribuir leads.');
      return;
    }
    if (assigningLeadIdsRef.current.has(leadId)) return;

    assigningLeadIdsRef.current.add(leadId);
    assignLeadRoundRobinMutate(leadId, {
      onSettled: () => assigningLeadIdsRef.current.delete(leadId),
    });
  }, [assignLeadRoundRobinMutate, canOperateLeads]);

  const enqueueLeadMovePersistence = useCallback((leadId: string, task: () => Promise<void>) => {
    const previousMove = movePersistenceByLeadRef.current.get(leadId) ?? Promise.resolve();
    const scheduledMove = previousMove
      .catch(() => undefined)
      .then(async () => {
        const now = Date.now();
        const scheduledAt = Math.max(
          now,
          nextMovePersistenceStartAtRef.current + PIPELINE_MOVE_PERSISTENCE_INTERVAL_MS,
        );
        nextMovePersistenceStartAtRef.current = scheduledAt;

        const delayMs = scheduledAt - Date.now();
        if (delayMs > 0) await waitForPipelineMove(delayMs);
        await task();
      });

    movePersistenceByLeadRef.current.set(leadId, scheduledMove);
    void scheduledMove.then(
      () => {
        if (movePersistenceByLeadRef.current.get(leadId) === scheduledMove) {
          movePersistenceByLeadRef.current.delete(leadId);
        }
      },
      () => {
        if (movePersistenceByLeadRef.current.get(leadId) === scheduledMove) {
          movePersistenceByLeadRef.current.delete(leadId);
        }
      },
    );

    return scheduledMove;
  }, []);

  const handleLoadMore = useCallback((stageId: string) => {
    if (!selectedPipelineId || loadMoreLeads.isPending) return;
    const stage = stages.find(s => s.id === stageId);
    if (!stage) return;
    const currentCount = stage.leads.length || 0;
    const lastLead = stage.leads.at(-1);
    const { cursorBefore, cursorBeforeId } = getPipelineLeadPageCursor(lastLead);

    loadMoreLeads.mutate(
      {
        pipelineId: selectedPipelineId,
        stageId,
        offset: currentCount,
        cursorBefore,
        cursorBeforeId,
        filterUserId: effectivePipelineFilterUser,
        filters: pipelineBoardFilters,
      },
      {
        onError: (error) => {
          toast.error('Não foi possível carregar mais leads: ' + getPipelineErrorMessage(error));
        },
      },
    );
  }, [selectedPipelineId, stages, loadMoreLeads, effectivePipelineFilterUser, pipelineBoardFilters]);

  useEffect(() => {
    if (!selectedLead || stages.length === 0) return;

    let nextLead: PipelineLead | null = null;
    for (const stage of stages) {
      const updatedLead = stage.leads.find((lead) => lead.id === selectedLead.id);
      if (!updatedLead) continue;

      const hasChanged =
        updatedLead.stage_id !== selectedLead.stage_id ||
        updatedLead.deal_status !== selectedLead.deal_status ||
        updatedLead.assigned_user_id !== selectedLead.assigned_user_id ||
        updatedLead.name !== selectedLead.name ||
        getLeadTagsSignature(updatedLead) !== getLeadTagsSignature(selectedLead) ||
        updatedLead.updated_at !== selectedLead.updated_at;

      if (hasChanged) nextLead = updatedLead;
      break;
    }

    if (!nextLead) return;

    let isActive = true;
    const leadToApply = nextLead;
    queueMicrotask(() => {
      if (isActive) setSelectedLead(leadToApply);
    });

    return () => {
      isActive = false;
    };
  }, [selectedLead, stages]);

  const searchParams = useSearchParams();
  const searchParamsString = searchParams.toString();

  useEffect(() => {
    const currentSearchParams = new URLSearchParams(searchParamsString);
    const leadId = currentSearchParams.get('lead_id') || currentSearchParams.get('lead');
    const activeOrganizationId = activeOrganization.organizationId;

    if (!leadId || !activeOrganizationId) return;

    const clearLeadParam = () => {
      const cleanParams = new URLSearchParams(searchParamsString);
      cleanParams.delete('lead_id');
      cleanParams.delete('lead');
      cleanParams.delete('t');
      const cleanSearch = cleanParams.toString();
      const cleanPath = `/crm/pipelines${cleanSearch ? `?${cleanSearch}` : ''}`;

      // Remove o identificador imediatamente para que um refresh nao tente abrir
      // novamente um lead que ja foi redistribuido. O Next integra a History API
      // ao App Router e sincroniza useSearchParams sem uma nova navegacao.
      if (typeof window !== 'undefined') {
        window.history.replaceState(null, '', cleanPath);
      }
    };

    let cancelled = false;
    const fetchLead = async () => {
      try {
        const { data: lead, error } = await leadsAPI.getLead(leadId, activeOrganizationId);

        if (cancelled) return;
        if (error) {
          clearLeadParam();
          toast.error('Não foi possível abrir o lead agora. Atualize a pipeline e tente novamente.');
          return;
        }
        if (!lead) {
          clearLeadParam();
          toast.info('Este lead não está mais disponível para você. Ele pode ter sido redistribuído para outro corretor.');
          return;
        }

        const leadRow = lead as PipelineLead;
        let enrichment: Awaited<ReturnType<typeof getLeadEnrichments>>[number] | undefined;
        try {
          [enrichment] = await getLeadEnrichments([leadRow.id], activeOrganizationId);
        } catch {
          if (cancelled) return;
          toast.warning('O lead foi aberto, mas alguns dados complementares podem demorar para aparecer.');
        }

        if (cancelled) return;

        const formattedLead: PipelineLead = {
          ...leadRow,
          assignee: enrichment?.assignee || leadRow.assignee || null,
          interest_property: enrichment?.interest_property || leadRow.interest_property || null,
          lead_meta: enrichment?.lead_meta || leadRow.lead_meta || [],
          tags: enrichment?.tags || leadRow.tags || [],
          tasks_count: enrichment?.tasks_count || leadRow.tasks_count || { pending: 0, completed: 0 },
        };

        queueMicrotask(() => {
          if (cancelled) return;
          if (formattedLead.pipeline_id) {
            setSelectedPipelineId(formattedLead.pipeline_id);
          }
          setSelectedLead(formattedLead);
          clearLeadParam();
        });
      } catch (error) {
        if (cancelled) return;
        clearLeadParam();
        if (error instanceof VimobAPIError && (error.status === 403 || error.status === 404)) {
          toast.info('Este lead não está mais disponível para você. Ele provavelmente foi redistribuído para outro corretor.');
          return;
        }
        toast.error('Não foi possível abrir o lead agora. Atualize a pipeline e tente novamente.');
      }
    };

    fetchLead();
    return () => { cancelled = true; };
  }, [searchParamsString, activeOrganization.organizationId, router]);

  const realtimeOrganizationId = activeOrganization.organizationId || '';

  const executeLeadMove = useCallback((result: DropResult, lostReason?: string) => {
    if (!canOperateLeads || isMobile) {
      isDraggingRef.current = false;
      return;
    }

    isDraggingRef.current = true;

    const { destination, source, draggableId } = result;
    if (!destination) {
      isDraggingRef.current = false;
      return;
    }

    const newStageId = destination.droppableId;
    const oldStageId = source.droppableId;
    const isSameStage = newStageId === oldStageId;
    const sourceStage = stages.find((stage) => stage.id === oldStageId);
    const newStage = stages.find((stage) => stage.id === newStageId);
    const movedLead = sourceStage?.leads.find((lead) => lead.id === draggableId);
    if (!sourceStage || !newStage || !movedLead) {
      isDraggingRef.current = false;
      return;
    }

    const configuredDestinationDealStatus =
      getOptimisticDealStatusForStage(newStage) ||
      getOptimisticAutomationDealStatusForStage(stageAutomations, newStageId);
    const optimisticMovedDealStatus = getOptimisticPipelineMoveOutcome({
      isSameStage,
      currentDealStatus: movedLead.deal_status,
      destinationOutcome: configuredDestinationDealStatus,
    });
    const optimisticStatusChangedAt = new Date().toISOString();
    const getLeadOrderDate = (lead: PipelineLead) => {
      const rawDate = lead?.board_order_at || lead?.stage_entered_at || lead?.created_at;
      const time = rawDate ? new Date(rawDate).getTime() : NaN;
      return Number.isFinite(time) ? time : Date.now();
    };
    const getBoardOrderAtForIndex = (leads: PipelineLead[], targetIndex: number) => {
      if (targetIndex <= 0) return new Date().toISOString();
      const above = leads[targetIndex - 1];
      const below = leads[targetIndex];
      const aboveTime = getLeadOrderDate(above);
      const belowTime = below ? getLeadOrderDate(below) : aboveTime - 2000;
      const nextTime = Math.min(aboveTime - 1, Math.max(belowTime + 1, Math.floor((aboveTime + belowTime) / 2)));
      return new Date(nextTime).toISOString();
    };

    const effectiveFilterDealStatus = filterDealStatus && filterDealStatus !== 'all' ? filterDealStatus : undefined;
    const shouldKeepOptimisticMovedLead =
      isSameStage || shouldKeepLeadForDealStatusFilter(optimisticMovedDealStatus, effectiveFilterDealStatus);

    const queryKey = pipelineBoardQueryKey;
    const queryKeyId = pipelineBoardQueryKeyId;
    const previousData = queryClient.getQueryData<StageWithLeads[]>(queryKey);
    if (!movePersistenceByLeadRef.current.has(draggableId)) {
      moveRollbackSnapshotByLeadRef.current.set(draggableId, previousData);
    }
    const rollbackData = moveRollbackSnapshotByLeadRef.current.get(draggableId) ?? previousData;
    const moveVersion = (latestMoveVersionByLeadRef.current.get(draggableId) ?? 0) + 1;
    latestMoveVersionByLeadRef.current.set(draggableId, moveVersion);
    const isLatestMoveForLead = () => latestMoveVersionByLeadRef.current.get(draggableId) === moveVersion;

    const destinationLeads = newStage.leads.filter((lead) => lead.id !== draggableId);
    const targetIndex = Math.min(Math.max(destination.index, 0), destinationLeads.length);
    const nextBoardOrderAt = getBoardOrderAtForIndex(destinationLeads, targetIndex);
    const optimisticPatch: Partial<PipelineLead> = {
      stage_id: newStageId,
      stage_entered_at: isSameStage ? movedLead.stage_entered_at : optimisticStatusChangedAt,
      board_order_at: nextBoardOrderAt,
      stage: createPipelineStageSnapshot(newStage),
      ...(optimisticMovedDealStatus === 'won'
        ? {
            deal_status: 'won' as const,
            won_at: optimisticStatusChangedAt,
            lost_at: null,
            lost_reason: null,
            updated_at: optimisticStatusChangedAt,
          }
        : optimisticMovedDealStatus === 'lost'
          ? {
              deal_status: 'lost' as const,
              lost_at: optimisticStatusChangedAt,
              won_at: null,
              lost_reason: lostReason || null,
              updated_at: optimisticStatusChangedAt,
            }
          : optimisticMovedDealStatus === 'open'
            ? {
                deal_status: 'open' as const,
                won_at: null,
                lost_at: null,
                lost_reason: null,
                updated_at: optimisticStatusChangedAt,
              }
            : {}),
    };
    const pendingMove: PendingPipelineMove<PipelineLead> = {
      leadId: draggableId,
      sourceStageId: oldStageId,
      destinationStageId: newStageId,
      destinationIndex: targetIndex,
      fallbackLead: movedLead,
      optimisticPatch,
      keepInDestination: shouldKeepOptimisticMovedLead,
      version: moveVersion,
    };
    const visualMoveKey = getVisualPendingMoveKey(queryKeyId, draggableId);

    void queryClient.cancelQueries({ queryKey, exact: true });
    registerPendingPipelineMove(queryKey, pendingMove);
    setVisualPendingMoves((current) => {
      const next = new Map(current);
      current.forEach((entry, key) => {
        if (!entry.release) return;
        if (
          entry.queryKeyId !== queryKeyId ||
          !shouldApplyVisualPendingMove(stagesWithLeads, entry)
        ) {
          next.delete(key);
        }
      });
      next.set(visualMoveKey, {
        queryKeyId,
        move: pendingMove,
        release: null,
      });
      return next;
    });
    queryClient.setQueryData<StageWithLeads[]>(queryKey, (old) =>
      applyPendingPipelineMoves(old, [pendingMove]),
    );

    window.setTimeout(() => {
      if (isLatestMoveForLead()) {
        isDraggingRef.current = false;
      }
    }, 150);

    preserveOptimisticPipelineBoard(realtimeOrganizationId, draggableId);

    return enqueueLeadMovePersistence(draggableId, async () => {
      const currentStages = queryClient.getQueryData<StageWithLeads[]>(queryKey) || stages;
      const persistedStage = currentStages.find((stage) => stage.id === newStageId);
      const persistedLead = persistedStage?.leads?.find((lead) => lead.id === draggableId);
      const persistedBoardOrderAt =
        persistedLead?.board_order_at ||
        optimisticPatch.board_order_at ||
        new Date().toISOString();

      const updateResult = await leadsAPI.moveLeadStage(draggableId, {
        stageId: newStageId,
        boardOrderAt: persistedBoardOrderAt,
        lostReason,
      }, realtimeOrganizationId);

      if (updateResult.error) throw updateResult.error;

      if (!isLatestMoveForLead()) return;

      // Any GET started before the transaction committed must not win after
      // the mutation response. A fresh request after this point is safe.
      await queryClient.cancelQueries({ queryKey, exact: true });
      if (!isLatestMoveForLead()) return;

      const movedLeadFromRpc = updateResult.data as unknown as Partial<PipelineLead> | null;
      let confirmedMove = pendingMove;

      if (movedLeadFromRpc) {
        const currentBoard = queryClient.getQueryData<StageWithLeads[]>(queryKey) || stages;
        const currentLocation = findPipelineLeadLocation<PipelineLead, StageWithLeads>(
          currentBoard,
          draggableId,
        );
        const confirmedStageId =
          typeof movedLeadFromRpc.stage_id === 'string' && movedLeadFromRpc.stage_id
            ? movedLeadFromRpc.stage_id
            : newStageId;
        const confirmedStage = currentBoard.find((stage) => stage.id === confirmedStageId);
        const responseStatus = isPipelineDealStatus(movedLeadFromRpc.deal_status)
          ? movedLeadFromRpc.deal_status
          : optimisticMovedDealStatus;
        const confirmedLead = {
          ...mergeMovedLeadResponse(
            currentLocation?.lead || { ...movedLead, ...optimisticPatch },
            movedLeadFromRpc,
          ),
          stage_id: confirmedStageId,
          stage: confirmedStage
            ? createPipelineStageSnapshot(confirmedStage)
            : movedLeadFromRpc.stage || optimisticPatch.stage,
        } as PipelineLead;

        confirmedMove = {
          ...pendingMove,
          destinationStageId: confirmedStageId,
          destinationIndex:
            confirmedStageId === newStageId ? targetIndex : 0,
          fallbackLead: confirmedLead,
          optimisticPatch: confirmedLead,
          keepInDestination:
            isSameStage ||
            shouldKeepLeadForDealStatusFilter(responseStatus, effectiveFilterDealStatus),
        };
      }

      registerPendingPipelineMove(queryKey, confirmedMove);
      setVisualPendingMoves((current) => {
        const entry = current.get(visualMoveKey);
        if (!entry || entry.move.version !== moveVersion) return current;

        const next = new Map(current);
        next.set(visualMoveKey, {
          ...entry,
          move: confirmedMove,
          release: { kind: 'confirmed' },
        });
        return next;
      });
      queryClient.setQueryData<StageWithLeads[]>(queryKey, (old) =>
        applyPendingPipelineMoves(old, [confirmedMove]),
      );
      clearPendingPipelineMove(queryKey, draggableId, moveVersion);

      notifyLeadRealtimeChange({
        organizationId: realtimeOrganizationId,
        leadId: draggableId,
        reason: isSameStage ? 'pipeline.order' : 'pipeline.stage',
      });

      if (isSameStage) {
        queryClient.invalidateQueries({ queryKey: ['stages-with-leads'], refetchType: 'none' });
        moveRollbackSnapshotByLeadRef.current.delete(draggableId);
        return;
      }

      queryClient.invalidateQueries({ queryKey: ['activities', draggableId] });
      queryClient.invalidateQueries({ queryKey: ['lead-timeline', draggableId] });
      queryClient.invalidateQueries({ queryKey: ['home'] });
      queryClient.invalidateQueries({ queryKey: ['stages-with-leads'], refetchType: 'none' });
      moveRollbackSnapshotByLeadRef.current.delete(draggableId);
    }).catch(async (error: unknown) => {
      if (!isLatestMoveForLead()) return;

      await queryClient.cancelQueries({ queryKey, exact: true });
      if (!isLatestMoveForLead()) return;

      clearPendingPipelineMove(queryKey, draggableId, moveVersion);
      queryClient.setQueryData<StageWithLeads[]>(queryKey, (current) =>
        restorePipelineLeadSnapshot(current, rollbackData, draggableId),
      );
      const rollbackLocation = findPipelineLeadLocation<PipelineLead, StageWithLeads>(
        rollbackData,
        draggableId,
      );
      setVisualPendingMoves((current) => {
        const entry = current.get(visualMoveKey);
        if (!entry || entry.move.version !== moveVersion) return current;

        const next = new Map(current);
        if (!rollbackLocation) {
          next.delete(visualMoveKey);
        } else {
          next.set(visualMoveKey, {
            ...entry,
            release: {
              kind: 'rollback',
              stageId: rollbackLocation.stageId,
            },
          });
        }
        return next;
      });
      moveRollbackSnapshotByLeadRef.current.delete(draggableId);
      void queryClient.invalidateQueries({
        queryKey,
        exact: true,
        refetchType: 'active',
      });
      if (
        !lostReason &&
        error instanceof VimobAPIError &&
        error.code === 'lead_lost_reason_required'
      ) {
        setPendingLostMove(result);
        setLostReasonLead(movedLead);
      } else {
        const rateLimitMessage = getClientRateLimitMessage(error);
        toast.error(rateLimitMessage || 'Erro ao mover lead: ' + getPipelineErrorMessage(error));
      }
      throw error;
    });
  }, [
    stages,
    stagesWithLeads,
    stageAutomations,
    filterDealStatus,
    pipelineBoardQueryKey,
    pipelineBoardQueryKeyId,
    queryClient,
    realtimeOrganizationId,
    enqueueLeadMovePersistence,
    canOperateLeads,
    isMobile,
  ]);

  const handleDragEnd = useCallback(async (result: DropResult) => {
    const { destination, source, draggableId } = result;

    if (!destination) {
      isDraggingRef.current = false;
      return;
    }
    if (
      destination.droppableId === source.droppableId &&
      destination.index === source.index
    ) {
      isDraggingRef.current = false;
      return;
    }

    const sourceStage = stages.find((stage) => stage.id === source.droppableId);
    const destinationStage = stages.find((stage) => stage.id === destination.droppableId);
    const movedLead = sourceStage?.leads.find((lead) => lead.id === draggableId);
    if (!sourceStage || !destinationStage || !movedLead) {
      isDraggingRef.current = false;
      return;
    }

    if (isUnsafePartialStageDrop(destinationStage, destination.index, draggableId)) {
      isDraggingRef.current = false;
      toast.warning('Carregue todos os leads desta coluna antes de soltar no final.');
      return;
    }

    const destinationOutcome =
      getOptimisticDealStatusForStage(destinationStage) ||
      getOptimisticAutomationDealStatusForStage(stageAutomations, destinationStage.id);
    if (destination.droppableId !== source.droppableId && destinationOutcome === 'lost') {
      isDraggingRef.current = false;
      setPendingLostMove(result);
      setLostReasonLead(movedLead);
      return;
    }

    try {
      await executeLeadMove(result);
    } catch {
      // executeLeadMove already restores the board and reports the error.
    }
  }, [executeLeadMove, stageAutomations, stages]);

  const handleManualRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const results = await Promise.all([
        refetchPipelines(),
        refetchLeadVisibility(),
        ...(sharedFilters.teamId ? [refetchTeams()] : []),
        ...(selectedPipelineId ? [refetchBaseStages()] : []),
        ...(shouldLoadPipelineLeads ? [refetch()] : []),
      ]);
      const failedResult = results.find((result) => result.isError);
      if (failedResult?.isError) {
        toast.error(`Não foi possível atualizar: ${getPipelineErrorMessage(failedResult.error)}`);
        return;
      }

      toast.success('Atualizado!', { duration: 1500 });
    } catch (error: unknown) {
      toast.error(`Não foi possível atualizar: ${getPipelineErrorMessage(error)}`);
    } finally {
      setIsRefreshing(false);
    }
  }, [
    refetch,
    refetchBaseStages,
    refetchLeadVisibility,
    refetchPipelines,
    refetchTeams,
    selectedPipelineId,
    sharedFilters.teamId,
    shouldLoadPipelineLeads,
  ]);

  const handlePipelineBoardRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const result = await refetch();
      if (result.isError) {
        toast.error(`Não foi possível atualizar os leads: ${getPipelineErrorMessage(result.error)}`);
        return;
      }

      toast.success('Leads atualizados!', { duration: 1500 });
    } catch (error: unknown) {
      toast.error(`Não foi possível atualizar os leads: ${getPipelineErrorMessage(error)}`);
    } finally {
      setIsRefreshing(false);
    }
  }, [refetch]);

  const handleCriticalLoadRetry = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const results = await Promise.all([
        ...(pipelinesLoadingError ? [refetchPipelines()] : []),
        ...(leadVisibilityLoadingError ? [refetchLeadVisibility()] : []),
        ...(teamScopeError ? [refetchTeams()] : []),
        ...(selectedPipelineId && baseStages.length === 0 ? [refetchBaseStages()] : []),
        ...(shouldLoadPipelineLeads && leadsLoadingError ? [refetch()] : []),
      ]);
      const failedResult = results.find((result) => result.isError);
      if (failedResult?.isError) {
        toast.error(`Não foi possível carregar a pipeline: ${getPipelineErrorMessage(failedResult.error)}`);
      }
    } catch (error: unknown) {
      toast.error(`Não foi possível carregar a pipeline: ${getPipelineErrorMessage(error)}`);
    } finally {
      setIsRefreshing(false);
    }
  }, [
    baseStages.length,
    leadVisibilityLoadingError,
    leadsLoadingError,
    pipelinesLoadingError,
    refetch,
    refetchBaseStages,
    refetchLeadVisibility,
    refetchPipelines,
    refetchTeams,
    selectedPipelineId,
    shouldLoadPipelineLeads,
    teamScopeError,
  ]);

  const openNewLeadDialog = (stageId?: string) => {
    if (!canCreateLeads) return;
    setNewLeadStageId(stageId || null);
    setNewLeadDialogOpen(true);
  };

  useEffect(() => {
    if (searchParams.get('new') !== 'lead' || !canCreateLeads) return;

    const cleanParams = new URLSearchParams(searchParams.toString());
    cleanParams.delete('new');
    const cleanSearch = cleanParams.toString();

    let isActive = true;
    queueMicrotask(() => {
      if (!isActive) return;
      setNewLeadStageId(null);
      setNewLeadDialogOpen(true);
      router.replace(`/crm/pipelines${cleanSearch ? `?${cleanSearch}` : ''}`);
    });

    return () => {
      isActive = false;
    };
  }, [canCreateLeads, searchParams, router]);

  const handleStageName = async (stageId: string) => {
    if (stageNameUpdateInFlightRef.current.has(stageId)) return;

    const nextStageName = editingStageName.trim();
    if (!nextStageName) {
      setEditingStageId(null);
      return;
    }

    const currentStageName = stages.find((stage) => stage.id === stageId)?.name.trim();
    if (currentStageName === nextStageName) {
      setEditingStageId(null);
      return;
    }

    stageNameUpdateInFlightRef.current.add(stageId);
    setSavingStageNameId(stageId);

    try {
      await pipelinesAPI.updateStage(
        stageId,
        { name: nextStageName },
        activeOrganization.organizationId || undefined,
      );
      toast.success('Nome atualizado!');
      void queryClient.invalidateQueries({
        queryKey: ['stages', activeOrganizationId, selectedPipelineId],
        exact: true,
      });
      void queryClient.invalidateQueries(
        {
          queryKey: ['stages-with-leads', activeOrganizationId],
          refetchType: 'active',
        },
        { cancelRefetch: false },
      );
    } catch (error: unknown) {
      toast.error('Não foi possível atualizar o nome: ' + getPipelineErrorMessage(error));
    } finally {
      stageNameUpdateInFlightRef.current.delete(stageId);
      setSavingStageNameId((current) => current === stageId ? null : current);
      setEditingStageId((current) => current === stageId ? null : current);
    }
  };

  const deferredSearch = deferredSearchQuery;

  const filteredStages = useMemo(
    () =>
      filterPipelineStages({
        stages,
        searchQuery,
        deferredSearch,
        serverSearchResults: [],
      }),
    [deferredSearch, searchQuery, stages],
  );

  useEffect(() => {
    if (!isMobile || filteredStages.length === 0) return;
    const activeExists = activeMobileStageId && filteredStages.some((stage) => stage.id === activeMobileStageId);
    if (activeExists) return;

    let isActive = true;
    const nextStageId = filteredStages[0].id;
    queueMicrotask(() => {
      if (isActive) setActiveMobileStageId(nextStageId);
    });

    return () => {
      isActive = false;
    };
  }, [isMobile, filteredStages, activeMobileStageId]);

  const visibleStages = useMemo<StageWithLeads[]>(() => {
    if (!isMobile) return filteredStages;
    const activeStage = filteredStages.find((stage) => stage.id === activeMobileStageId);
    return activeStage ? [activeStage] : filteredStages.slice(0, 1);
  }, [isMobile, filteredStages, activeMobileStageId]);

  const activeMobileStageIndex = useMemo(() => {
    if (!isMobile || filteredStages.length === 0) return -1;

    const activeStageId = activeMobileStageId || filteredStages[0].id;
    const index = filteredStages.findIndex((stage) => stage.id === activeStageId);
    return index >= 0 ? index : 0;
  }, [isMobile, filteredStages, activeMobileStageId]);

  const hasPreviousMobileStage = isMobile && activeMobileStageIndex > 0;
  const hasNextMobileStage = isMobile && activeMobileStageIndex >= 0 && activeMobileStageIndex < filteredStages.length - 1;

  const handleMobileStageNavigation = useCallback((direction: 'previous' | 'next') => {
    if (!isMobile || filteredStages.length === 0 || activeMobileStageIndex < 0) return;

    const nextIndex = direction === 'previous'
      ? Math.max(0, activeMobileStageIndex - 1)
      : Math.min(filteredStages.length - 1, activeMobileStageIndex + 1);

    if (nextIndex === activeMobileStageIndex) return;
    setActiveMobileStageId(filteredStages[nextIndex].id);
  }, [activeMobileStageIndex, filteredStages, isMobile]);

  const settingsStageForDialog = useMemo<PipelineStageSettingsValue | null>(() => {
    if (!settingsStage) return null;
    return {
      id: settingsStage.id,
      name: settingsStage.name,
      color: settingsStage.color || PIPELINE_STAGE_COLOR_FALLBACK,
      stage_key: settingsStage.stage_key || '',
      pipeline_id: settingsStage.pipeline_id || undefined,
      is_qualified: settingsStage.is_qualified || false,
      is_won: settingsStage.is_won || false,
      is_lost: settingsStage.is_lost || false,
      is_active: settingsStage.is_active !== false,
    };
  }, [settingsStage]);

  const stageValueMap = useMemo(
    () => buildStageValueMap(filteredStages),
    [filteredStages],
  );

  const stageCountMetaMap = useMemo(
    () => buildStageCountMetaMap(filteredStages),
    [filteredStages],
  );

  const handleCreatePipeline = async (e: FormEvent) => {
    e.preventDefault();
    if (createPipelineInFlightRef.current) return;
    const normalizedName = newPipelineName.trim();
    if (normalizedName.length < 2) {
      toast.error('O nome da pipeline deve ter pelo menos 2 caracteres.');
      return;
    }

    createPipelineInFlightRef.current = true;
    try {
      const pipeline = await createPipeline.mutateAsync({ name: normalizedName });
      handleSelectPipeline(pipeline.id);
      setNewPipelineDialogOpen(false);
      setNewPipelineName('');
      toast.success('Pipeline criada com sucesso!');
    } catch (error: unknown) {
      toast.error('Erro ao criar pipeline: ' + getPipelineErrorMessage(error));
    } finally {
      createPipelineInFlightRef.current = false;
    }
  };

  const handleCreateStage = async (event: FormEvent) => {
    event.preventDefault();
    if (createStageInFlightRef.current) return;
    const normalizedName = newStageName.trim();
    if (!selectedPipelineId) return;
    if (normalizedName.length < 2) {
      toast.error('O nome da coluna deve ter pelo menos 2 caracteres.');
      return;
    }
    if (!newStageColorValidation.success) {
      toast.error(
        newStageColorValidation.error.issues[0]?.message ||
          'Informe uma cor válida.',
      );
      return;
    }

    createStageInFlightRef.current = true;
    try {
      await createStage.mutateAsync({
        pipelineId: selectedPipelineId,
        name: normalizedName,
        color: newStageColorValidation.data,
      });
      setNewStageDialogOpen(false);
      setNewStageName('');
      setNewStageColor(PIPELINE_STAGE_COLOR_FALLBACK);
      toast.success('Coluna criada com sucesso!');
    } catch (error: unknown) {
      toast.error('Erro ao criar coluna: ' + getPipelineErrorMessage(error));
    } finally {
      createStageInFlightRef.current = false;
    }
  };

  const handleDeletePipeline = async () => {
    const target = pipelineToDelete;
    if (!target || deletePipeline.isPending || deletePipelineInFlightRef.current) return;

    deletePipelineInFlightRef.current = true;
    try {
      await deletePipeline.mutateAsync(target.id);
      const nextPipeline = pipelines.find((pipeline) => pipeline.id !== target.id) || null;

      if (selectedPipelineId === target.id) {
        handleSelectPipeline(nextPipeline?.id || null);
      }

      setPipelineToDelete(null);
      toast.success('Pipeline excluída com sucesso!');
    } catch (error: unknown) {
      toast.error('Erro ao excluir pipeline: ' + getPipelineErrorMessage(error));
    } finally {
      deletePipelineInFlightRef.current = false;
    }
  };

  const handleLostReasonConfirm = async (reason: string) => {
    if (!lostReasonLead || !pendingLostMove || lostReasonPending) return;
    setLostReasonPending(true);
    try {
      await executeLeadMove(pendingLostMove, reason);
      setPendingLostMove(null);
      setLostReasonLead(null);
    } catch {
      // executeLeadMove preserves the dialog and reports the failure.
    } finally {
      setLostReasonPending(false);
    }
  };

  return (
    <AppLayout title="Pipeline" disableMainScroll>
      <div
        data-tour="pipeline-overview"
        className={cn(
          'flex h-full flex-col overflow-hidden bg-transparent',
          isMobile && 'pb-2',
        )}
      >
        <PipelineToolbar
          pipelines={pipelines}
          selectedPipelineId={selectedPipelineId}
          currentPipeline={currentPipeline}
          canEditPipeline={canEditPipeline}
          canManageAttention={canManageAttention}
          canShowPipelineSettings={canShowPipelineSettings}
          canCreateLeads={canCreateLeads}
          isMobile={isMobile}
          isRefreshing={isRefreshing}
          hasCriticalLoadError={hasCriticalLoadError}
          datePreset={datePreset}
          onDatePresetChange={setDatePreset}
          onClearDatePreset={clearDateFilter}
          customDateRange={customDateRange}
          onCustomDateRangeChange={setCustomDateRange}
          teamId={sharedFilters.teamId}
          onTeamChange={setTeamId}
          userId={filterUser}
          onUserChange={setFilterUser}
          source={filterSource}
          onSourceChange={setFilterSource}
          pageId={filterPage}
          onPageChange={setFilterPage}
          campaignId={filterCampaign}
          onCampaignChange={setFilterCampaign}
          adSetId={filterAdSet}
          onAdSetChange={setFilterAdSet}
          adId={filterAd}
          onAdChange={setFilterAd}
          tagIds={filterTags}
          onTagsChange={setFilterTags}
          dealStatus={filterDealStatus}
          onDealStatusChange={setFilterDealStatus}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onClearFilters={clearFilters}
          hasActiveFilters={hasSharedActiveFilters}
          dynamicSources={dynamicSources}
          pages={pages}
          campaigns={campaigns}
          adSets={adSets}
          ads={ads}
          tags={allTagsFromHook}
          isLoadingSources={isLoadingSources}
          isLoadingPages={isLoadingPages}
          isLoadingCampaigns={isLoadingCampaigns}
          isLoadingAdSets={isLoadingAdSets}
          isLoadingAds={isLoadingAds}
          isLoadingTags={isLoadingTags}
          hasTagsError={hasTagsError}
          hasDynamicOptionsError={hasDynamicOptionsError}
          isRetryingDynamicOptions={isRetryingDynamicOptions}
          shouldLoadFilterOptions={shouldLoadFilterOptions}
          onEnableFilterOptions={handleEnableFilterOptions}
          onRetryDynamicOptions={handleEnableFilterOptions}
          onSelectPipeline={handleSelectPipeline}
          onRequestDeletePipeline={setPipelineToDelete}
          onRequestNewPipeline={() => setNewPipelineDialogOpen(true)}
          onRequestAttentionSettings={() => setAttentionSettingsOpen(true)}
          onRequestStagesEditor={() => setStagesEditorOpen(true)}
          onRefresh={() => void handleManualRefresh()}
          onCreateLead={() => openNewLeadDialog()}
        />

        <PipelineBoard
          stages={stages}
          filteredStages={filteredStages}
          visibleStages={visibleStages}
          stageValueMap={stageValueMap}
          stageCountMetaMap={stageCountMetaMap}
          selectedPipelineId={selectedPipelineId}
          isMobile={isMobile}
          isLoading={isLoading}
          isInitialLeadsLoading={isInitialLeadsLoading}
          isPipelineBoardTransitioning={isPipelineBoardTransitioning}
          leadsPlaceholderData={leadsPlaceholderData}
          hasCriticalLoadError={hasCriticalLoadError}
          hasPipelineBoardError={hasPipelineBoardError}
          isRefreshing={isRefreshing}
          pipelinesFetching={pipelinesFetching}
          leadVisibilityFetching={leadVisibilityFetching}
          hasPreviousMobileStage={hasPreviousMobileStage}
          hasNextMobileStage={hasNextMobileStage}
          canEditPipeline={canEditPipeline}
          hasWhatsAppModule={hasWhatsAppModule}
          canViewWhatsApp={canViewWhatsApp}
          canOperateWhatsApp={canOperateWhatsApp}
          canShowColumnActions={canShowColumnActions}
          isDragDisabled={isDragDisabled}
          nowMs={boardNowMs}
          editingStageId={editingStageId}
          editingStageName={editingStageName}
          savingStageNameId={savingStageNameId}
          loadMoreIsPending={loadMoreLeads.isPending}
          loadingMoreStageId={loadMoreLeads.variables?.stageId}
          onDragStart={handleDragStart}
          onDragEnd={(result) => void handleDragEnd(result)}
          onCriticalLoadRetry={() => void handleCriticalLoadRetry()}
          onBoardRefresh={() => void handlePipelineBoardRefresh()}
          onMobileStageNavigation={handleMobileStageNavigation}
          onEditingStageNameChange={setEditingStageName}
          onStartEditingStage={(stage) => {
            setEditingStageId(stage.id);
            setEditingStageName(stage.name);
          }}
          onCommitStageName={(stageId) => void handleStageName(stageId)}
          onCancelEditingStage={() => {
            setEditingStageId(null);
            setEditingStageName('');
          }}
          onOpenStageSettings={setSettingsStage}
          onOpenLead={handleOpenLead}
          onAssignLeadNow={handleAssignLeadNow}
          onLoadMore={handleLoadMore}
          onCreateStage={() => setNewStageDialogOpen(true)}
          onCreatePipeline={() => setNewPipelineDialogOpen(true)}
        />

        <PipelineDialogs
          selectedLead={selectedLead}
          editingLead={editingLead}
          lostReasonLead={lostReasonLead}
          lostReasonPending={lostReasonPending}
          stages={stages}
          allTags={allTags}
          users={users}
          settingsStage={settingsStage}
          settingsStageForDialog={settingsStageForDialog}
          newLeadDialogOpen={newLeadDialogOpen}
          newLeadStageId={newLeadStageId}
          selectedPipelineId={selectedPipelineId}
          newPipelineDialogOpen={newPipelineDialogOpen}
          newPipelineName={newPipelineName}
          createPipelinePending={createPipeline.isPending}
          newStageDialogOpen={newStageDialogOpen}
          newStageName={newStageName}
          newStageColor={newStageColor}
          newStageColorIsValid={newStageColorValidation.success}
          normalizedNewStageColor={
            newStageColorValidation.success
              ? newStageColorValidation.data
              : PIPELINE_STAGE_COLOR_FALLBACK
          }
          createStagePending={createStage.isPending}
          attentionSettingsOpen={attentionSettingsOpen}
          stagesEditorOpen={stagesEditorOpen}
          currentPipelineName={currentPipeline?.name || ''}
          pipelineToDelete={pipelineToDelete}
          deletePipelinePending={deletePipeline.isPending}
          onCloseSelectedLead={() => setSelectedLead(null)}
          onEditSelectedLead={(leadToEdit) => {
            setEditingLead({
              ...selectedLead,
              ...leadToEdit,
              assignee: selectedLead?.assignee,
              stage: selectedLead?.stage,
              tags: selectedLead?.tags,
            } as PipelineLead);
          }}
          onCloseEditingLead={() => setEditingLead(null)}
          onEditingLeadSaved={(updatedLead) => {
            setSelectedLead((current) =>
              current?.id === updatedLead.id
                ? {
                    ...current,
                    ...updatedLead,
                    tags: current.tags,
                    assignee: current.assignee,
                    stage: current.stage,
                  }
                : current,
            );
          }}
          onSettingsStageClose={() => setSettingsStage(null)}
          onSettingsStageUpdate={() => {
            setSettingsStage(null);
          }}
          onNewLeadDialogOpenChange={setNewLeadDialogOpen}
          onLostReasonOpenChange={(open) => {
            if (!open && !lostReasonPending) {
              setPendingLostMove(null);
              setLostReasonLead(null);
            }
          }}
          onLostReasonConfirm={handleLostReasonConfirm}
          onNewPipelineDialogOpenChange={setNewPipelineDialogOpen}
          onNewPipelineNameChange={setNewPipelineName}
          onCreatePipeline={(event) => void handleCreatePipeline(event)}
          onNewStageDialogOpenChange={setNewStageDialogOpen}
          onNewStageNameChange={setNewStageName}
          onNewStageColorChange={setNewStageColor}
          onCreateStage={(event) => void handleCreateStage(event)}
          onAttentionSettingsOpenChange={setAttentionSettingsOpen}
          onStagesEditorOpenChange={setStagesEditorOpen}
          onPipelineToDeleteOpenChange={(open) => {
            if (!open && !deletePipeline.isPending) setPipelineToDelete(null);
          }}
          onDeletePipeline={() => void handleDeletePipeline()}
        />
      </div>
    </AppLayout>
  );
}
