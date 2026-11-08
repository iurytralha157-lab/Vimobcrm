"use client";

// Main screen for the pipelines domain.

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { FormEvent } from 'react';
import type { DragStart, DropResult } from '@hello-pangea/dnd';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';

import { AppLayout } from '@/components/shared/layout/AppLayout';
import type { StageSettingsTab } from '@/components/features/pipelines/StageSettingsDialog';
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
  preloadPipelineLeadDialog,
  PipelineToolbar,
  PIPELINE_MOVE_PERSISTENCE_INTERVAL_MS,
  shouldApplyVisualPendingMove,
  shouldKeepLeadForDealStatusFilter,
  waitForPipelineMove,
  type PipelineStageSettingsValue,
  type VisualPendingPipelineMove,
} from '@/components/features/pipelines/pipeline-screen';
import { useAuth } from '@/contexts/AuthContext';
import { useFilters } from '@/contexts/FilterContext';
import { useSharedFilters } from '@/hooks/use-shared-filters';
import {
  useStages,
  useStagesWithLeads,
  usePipelines,
  useCreatePipeline,
  useCreateStage,
  useUpdateStage,
  useDeletePipeline,
} from '@/hooks/use-stages';
import { stageWithLeadsQueryKey } from '@/lib/pipeline-query-key';
import { getPipelineLeadPageCursor } from '@/lib/pipeline-pagination-state';
import { getPipelineBoardOrderAtForIndex } from '@/lib/pipeline-board-order';
import { getOptimisticPipelineMoveOutcome } from '@/lib/pipeline-stage-outcome';
import { getLeadStatusFinancialReviewMessage } from '@/lib/lead-financial-review';
import { createPipelineStageSnapshot } from '@/lib/pipeline-stage-snapshot';
import { pipelineRevisionSchema, stageHexColorInputSchema } from '@/lib/validation';
import {
  applyPendingPipelineMoves,
  clearPendingPipelineMove,
  findPipelineLeadLocation,
  getPipelineBoardQueryKeyId,
  registerPendingPipelineMove,
  restorePipelineLeadSnapshot,
  type PendingPipelineMove,
} from '@/lib/pipeline-board-cache';
import {
  handlePipelineSelectedLeadAccessFailure,
  canRetainPipelineLeadDraft,
  isPipelineLeadAccessDenied,
  removeCachedPipelineLeadDetail,
} from '@/lib/pipeline-selected-lead-access';
import type { PipelineLead, PipelineQueryFilters, StageWithLeads } from '@/hooks/use-stages';
import { useLoadMoreLeads } from '@/hooks/use-stages';
import type { PipelineDeleteData } from '@/hooks/pipelines/use-pipeline-mutations';
import { usePipelineEditorVisit, type PipelineEditorOperation } from '@/hooks/pipelines/use-pipeline-editor-visit';
import { usePipelineCriticalLoadRetry } from '@/hooks/pipelines/use-pipeline-critical-load-retry';
import { usePipelineRefresh } from '@/hooks/pipelines/use-pipeline-refresh';
import { getPipelineBoardScrollMemory } from '@/hooks/pipelines/use-pipeline-board-scroll';
import { useOrganizationUsers } from '@/hooks/use-users';
import { useTags } from '@/hooks/use-tags';
import { useAssignLeadRoundRobin } from '@/hooks/use-assign-lead-roundrobin';
import { useLeadRequestScope, type LeadRequestOperation } from '@/hooks/leads/use-lead-request-scope';
import { useLeadMoveContract } from '@/hooks/leads/use-lead-move-contract';
import {
  capturePipelineMoveRevision,
  resolvePipelineMoveRevision,
  PipelineMoveRevisionConflict,
  type PipelineMoveReceipt,
  type PipelineMoveRevision,
} from '@/lib/pipeline-move-revision';
import { useIsMobile } from '@/hooks/use-mobile';
import { canManagePipeline } from '@/lib/access/pipeline-settings-access';
import { useLeadVisibility } from '@/hooks/use-lead-visibility';
import { useSelectedPipelineLeadAccess } from '@/hooks/pipelines';
import { matchesVerifiedLeadReadScope } from '@/lib/lead-read-snapshot';
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
import { useStageAutomations } from '@/hooks/use-stage-automations';
import { getGlobalSignOutSessionId } from '@/lib/auth/global-sign-out';

type PipelineMoveSnapshot = {
  lead: PipelineLead;
  revision: PipelineMoveRevision;
  operation: LeadRequestOperation;
  queryKeyId: string;
};

export default function Pipelines() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const leadMoveRequestScope = useLeadRequestScope();
  const { activeOrganization, profile, tenantContext, user, session } = useAuth();
  const [shouldLoadFilterOptions, setShouldLoadFilterOptions] = useState(false);
  const activeOrganizationId = activeOrganization.organizationId;
  const { hasPermission, isLoading: permissionLoading } = useUserPermissions();
  const { hasModule } = useOrganizationModules();
  const canOperateLeads = hasPermission('lead_operate');
  const moveContract = useLeadMoveContract(canOperateLeads);
  const canCreateLeads = hasPermission('lead_create');
  const hasWhatsAppModule = hasModule('whatsapp');
  const canOperateWhatsApp = hasWhatsAppModule && hasPermission('whatsapp_operate');
  const canViewWhatsApp =
    hasWhatsAppModule && (hasPermission('whatsapp_view') || canOperateWhatsApp);
  const [selectedLead, setSelectedLead] = useState<PipelineLead | null>(null);
  const [selectedLeadAccessVersion, setSelectedLeadAccessVersion] = useState(0);
  const [editingLead, setEditingLead] = useState<PipelineLead | null>(null);
  const [lostReasonLead, setLostReasonLead] = useState<PipelineLead | null>(null);
  const [pendingLostMove, setPendingLostMove] = useState<{ result: DropResult; snapshot: PipelineMoveSnapshot } | null>(null);
  const [lostReasonPending, setLostReasonPending] = useState(false);
  const [newLeadDialogOpen, setNewLeadDialogOpen] = useState(false);
  const [newLeadStageId, setNewLeadStageId] = useState<string | null>(null);
  const { pipelineId: globalPipelineId, setPipelineId: setGlobalPipelineId } = useFilters();
  const [localPipelineId, setLocalPipelineId] = useState<string | null>(null);
  const selectedPipelineId = globalPipelineId ?? localPipelineId;
  const setSelectedPipelineId = useCallback((pipelineId: string | null) => {
    setLocalPipelineId(pipelineId);
    setGlobalPipelineId(pipelineId);
  }, [setGlobalPipelineId]);
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
    campaignIds: filterCampaigns,
    setCampaignIds: setFilterCampaigns,
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
    scopeMetaOptionsToBoard: true,
    multiCampaigns: true,
  });
  const pipelineDateRange = sharedFilters.dateRange;

  const hasDynamicMetaFilterSelection = Boolean(
    (filterSource && filterSource !== 'all') ||
    (filterPage && filterPage !== 'all') ||
    (filterCampaign && filterCampaign !== 'all') ||
    filterCampaigns.length > 0 ||
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

  const [editingStageId, setEditingStageId] = useState<string | null>(null);
  const [editingStageName, setEditingStageName] = useState('');
  // Keep the opening revision. Follow-up split: this inline editor belongs in a
  // dedicated hooks/pipelines/use-stage-name-editor.ts, reducing this screen.
  const editingStageBaseRef = useRef<{ id: string; name: string; updatedAt?: string | null } | null>(null);
  const [savingStageName, setSavingStageName] = useState<{ id: string; operation: PipelineEditorOperation } | null>(null);
  const [settingsStage, setSettingsStage] = useState<StageWithLeads | null>(null);
  // Menu routing stays with stage selection until this legacy screen's UI state is extracted into pipeline-screen.
  const [settingsStageEntry, setSettingsStageEntry] = useState<{
    tab: StageSettingsTab;
    returnFocusElement: HTMLButtonElement | null;
  }>({ tab: 'general', returnFocusElement: null });
  const [newPipelineDialogOpen, setNewPipelineDialogOpen] = useState(false);
  const [newPipelineName, setNewPipelineName] = useState('');
  const [newStageDialogOpen, setNewStageDialogOpen] = useState(false);
  const [newStageName, setNewStageName] = useState('');
  const [newStageColor, setNewStageColor] = useState<string>(PIPELINE_STAGE_COLOR_FALLBACK);
  const newStageColorValidation = useMemo(
    () => stageHexColorInputSchema.safeParse(newStageColor),
    [newStageColor],
  );
  const [pipelineToDelete, setPipelineToDelete] = useState<PipelineDeleteData | null>(null);
  const pipelineDeletionRef = useRef<PipelineDeleteData | null>(null);
  const [deletePipelineBlocked, setDeletePipelineBlocked] = useState(false);
  const [deletePipelineError, setDeletePipelineError] = useState<string | null>(null);
  const [attentionSettingsOpen, setAttentionSettingsOpen] = useState(false);
  const [stagesEditorOpen, setStagesEditorOpen] = useState(false);
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
  // Keep gesture/CAS ownership here until the legacy move queue is extracted into hooks/pipelines.
  const dragMoveSnapshotRef = useRef<PipelineMoveSnapshot | null>(null);
  const moveRevisionReceiptByLeadRef = useRef(new Map<string, {
    queryKeyId: string; operation: LeadRequestOperation; receipt: PipelineMoveReceipt;
  }>());
  const stageNameUpdateInFlightRef = useRef(new Map<string, PipelineEditorOperation>());
  const latestMoveVersionByLeadRef = useRef(new Map<string, number>());
  const nextMovePersistenceStartAtRef = useRef(0);
  const movePersistenceByLeadRef = useRef(new Map<string, Promise<void>>());
  const moveRollbackSnapshotByLeadRef = useRef(new Map<string, StageWithLeads[] | undefined>());
  const assigningLeadIdsRef = useRef(new Set<string>());
  const createPipelineInFlightRef = useRef<PipelineEditorOperation | null>(null);
  const createStageInFlightRef = useRef<PipelineEditorOperation | null>(null);
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
      setLocalPipelineId(null);
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
    isError: pipelinesError,
    refetch: refetchPipelines,
  } = usePipelines();
  const pipelineNavigationRef = useRef({ selectedPipelineId, pipelines });
  useLayoutEffect(() => { pipelineNavigationRef.current = { selectedPipelineId, pipelines }; }, [selectedPipelineId, pipelines]);
  const createPipeline = useCreatePipeline();
  const createStage = useCreateStage();
  const updateStageName = useUpdateStage();
  const createPipelineVisit = usePipelineEditorVisit(createPipeline.scopeKey, JSON.stringify([newPipelineDialogOpen, selectedPipelineId]), createPipeline.captureScopeGuard);
  const createStageVisit = usePipelineEditorVisit(createStage.scopeKey, JSON.stringify([newStageDialogOpen, selectedPipelineId]), createStage.captureScopeGuard);
  const stageNameVisit = usePipelineEditorVisit(updateStageName.scopeKey, JSON.stringify([selectedPipelineId, editingStageId]), updateStageName.captureScopeGuard);
  const savingStageNameId = savingStageName?.operation.visit === stageNameVisit.key ? savingStageName.id : null;
  const deletePipeline = useDeletePipeline();
  const loadMoreLeads = useLoadMoreLeads();

  const handleSelectPipeline = useCallback((pipelineId: string | null) => {
    setSelectedPipelineId(pipelineId);
  }, [setSelectedPipelineId]);

  useEffect(() => {
    if (!isFiltersHydrated || pipelinesLoading || pipelinesFetching || pipelinesError) return;
    let isActive = true;

    if (pipelines.length === 0) {
      if (selectedPipelineId) {
        queueMicrotask(() => {
          if (isActive) {
            setLocalPipelineId(null);
            if (globalPipelineId) setGlobalPipelineId(null);
          }
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

    const fallbackPipeline = pipelines.find((pipeline) => pipeline.is_default) || pipelines[0];

    const nextPipelineId = fallbackPipeline?.id || null;
    queueMicrotask(() => {
      if (isActive) {
        // A default board is local. Visiting Pipeline must preserve the global
        // "All pipelines" selection used by Dashboard and Contacts.
        setLocalPipelineId(nextPipelineId);
        if (globalPipelineId) setGlobalPipelineId(null);
      }
    });

    return () => {
      isActive = false;
    };
  }, [globalPipelineId, setGlobalPipelineId, isFiltersHydrated, pipelines, pipelinesLoading, pipelinesFetching, pipelinesError, selectedPipelineId]);

  const {
    data: leadVisibility,
    isLoading: leadVisibilityLoading,
    isFetching: leadVisibilityFetching,
    isError: leadVisibilityError,
    refetch: refetchLeadVisibility,
  } = useLeadVisibility(profile?.id);
  // Readiness errors must not remove the drag handle; executeLeadMove checks the contract before any write.
  const isDragDisabled = !canOperateLeads;

  const scopedVisibleUserIds = useMemo(() => {
    if (!leadVisibility || leadVisibility.canViewAll) return undefined;
    if (leadVisibility.teamMemberIds) return leadVisibility.teamMemberIds;
    if (leadVisibility.userId) return [leadVisibility.userId];
    return [];
  }, [leadVisibility]);
  const selectedLeadSessionId = getGlobalSignOutSessionId(session);
  const visibilityScopeKey = useMemo(() => JSON.stringify({
    userId: profile?.id ?? null,
    actorId: user?.id ?? null,
    sessionId: selectedLeadSessionId,
    canViewAll: leadVisibility?.canViewAll ?? false,
    visibleUserIds: [...(scopedVisibleUserIds ?? [])].sort(),
    ledTeamIds: [...(tenantContext?.ledTeamIds ?? [])].sort(),
  }), [profile?.id, user?.id, selectedLeadSessionId, leadVisibility?.canViewAll, scopedVisibleUserIds, tenantContext?.ledTeamIds]);
  const previousLeadScopeRef = useRef<{
    organizationId: string | null;
    visibilityScopeKey: string;
  } | null>(null);
  useEffect(() => {
    const previousScope = previousLeadScopeRef.current;
    previousLeadScopeRef.current = {
      organizationId: activeOrganizationId,
      visibilityScopeKey,
    };
    if (!previousScope || (
      previousScope.organizationId === activeOrganizationId &&
      previousScope.visibilityScopeKey === visibilityScopeKey
    )) return;
    if (selectedLead?.id) {
      const cachedOrganizationId = previousScope.organizationId || activeOrganizationId;
      if (cachedOrganizationId) {
        removeCachedPipelineLeadDetail(queryClient, cachedOrganizationId, selectedLead.id);
      }
    }
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setSelectedLead(null);
      setEditingLead(null);
      setLostReasonLead(null);
      setPendingLostMove(null);
    });
    return () => { active = false; };
  }, [activeOrganizationId, queryClient, selectedLead?.id, visibilityScopeKey]);
  const hasUserScope = Array.isArray(scopedVisibleUserIds);
  const isUnassignedFilter = filterUser === 'unassigned';
  const selectedFilterUserId = filterUser === 'all' || isUnassignedFilter
    ? undefined
    : (filterUser || undefined);
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
  const {
    data: stageAutomations = [],
    refetch: refetchStageAutomations,
    isEnabled: canRefreshStageAutomations,
  } = useStageAutomations();

  const shouldLoadPipelineLeads =
    !!selectedPipelineId &&
    isFiltersHydrated &&
    isTeamScopeReady &&
    !permissionLoading &&
    !leadVisibilityLoading &&
    !leadVisibilityError &&
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
    filterCampaigns,
    filterAdSet: filterAdSet && filterAdSet !== 'all' ? filterAdSet : undefined,
    filterAd: filterAd && filterAd !== 'all' ? filterAd : undefined,
    filterSource: filterSource && filterSource !== 'all' ? filterSource : undefined,
    unassigned: isUnassignedFilter,
    teamId: sharedFilters.teamId || undefined,
    visibilityScopeKey,
  }), [
    pipelineDateRange,
    filterTags,
    filterDealStatus,
    deferredSearchQuery,
    filterPage,
    filterCampaign,
    filterCampaigns,
    filterAdSet,
    filterAd,
    filterSource,
    isUnassignedFilter,
    sharedFilters.teamId,
    visibilityScopeKey,
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
  const { run: runPipelineRefresh, isRefreshing } = usePipelineRefresh(pipelineBoardQueryKeyId);
  const { run: runFilterOptionsRetry } = usePipelineRefresh(pipelineBoardQueryKeyId);
  const handleEnableFilterOptions = useCallback(() => {
    setShouldLoadFilterOptions(true);
    if (!shouldLoadFilterOptions) return;

    const retries = [
      ...(hasTeamOptionsError ? [refetchTeams] : []),
      ...(hasLeadMetaFiltersError ? [refetchLeadMetaFilters] : []),
      ...(hasTagsError ? [refetchTags] : []),
    ];
    if (retries.length === 0) return;

    void runFilterOptionsRetry({
      reads: retries,
      onSuccess: () => undefined,
      onError: () => toast.error(
        'Não foi possível atualizar as opções de filtro. Tente novamente em instantes.',
      ),
    });
  }, [
    hasLeadMetaFiltersError,
    hasTagsError,
    hasTeamOptionsError,
    refetchLeadMetaFilters,
    refetchTags,
    refetchTeams,
    runFilterOptionsRetry,
    shouldLoadFilterOptions,
  ]);
  const boardScopeFingerprint = useMemo(
    () =>
      JSON.stringify({
        organizationId: activeOrganizationId,
        visibilityScopeKey,
        filterUserId: effectivePipelineFilterUser ?? null,
        unassigned: isUnassignedFilter,
        teamId: sharedFilters.teamId ?? null,
      }),
    [
      activeOrganizationId,
      effectivePipelineFilterUser,
      isUnassignedFilter,
      sharedFilters.teamId,
      visibilityScopeKey,
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
    error: leadsError,
    isPlaceholderData: leadsPlaceholderData,
    restoreError: boardRestoreError,
    refetch,
  } = useStagesWithLeads(
    selectedPipelineId || undefined,
    effectivePipelineFilterUser,
    pipelineBoardFilters,
    { enabled: shouldLoadPipelineLeads }
  );
  const boardAccessRevoked = leadsRefetchError && leadsError instanceof VimobAPIError &&
    (leadsError.status === 401 || leadsError.status === 403);

  useEffect(() => {
    if (!leadVisibilityError && !boardAccessRevoked) return;
    if (activeOrganizationId && selectedLead?.id) {
      removeCachedPipelineLeadDetail(queryClient, activeOrganizationId, selectedLead.id);
    }
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setSelectedLead(null);
      setEditingLead(null);
      setLostReasonLead(null);
      setPendingLostMove(null);
    });
    return () => { active = false; };
  }, [activeOrganizationId, boardAccessRevoked, leadVisibilityError, queryClient, selectedLead?.id]);

  const stages = useMemo<StageWithLeads[]>(() => {
    if (leadVisibilityError || boardAccessRevoked) return [];
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
    leadVisibilityError,
    boardAccessRevoked,
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

  const selectedLeadAccess = useSelectedPipelineLeadAccess({
    organizationId: activeOrganizationId,
    leadId: selectedLead?.id,
    selectionVersion: selectedLeadAccessVersion,
    visibilityScopeKey,
    enabled: Boolean(leadVisibility && !leadVisibilityError),
  });
  const verifiedLeadRead = matchesVerifiedLeadReadScope(selectedLeadAccess.data, {
    organizationId: activeOrganizationId,
    leadId: selectedLead?.id,
    selectionVersion: selectedLeadAccessVersion,
    visibilityScopeKey,
  }) ? selectedLeadAccess.data : undefined;
  const authorizedSelectedLead = !leadVisibilityError && !boardAccessRevoked &&
    selectedLeadAccess.isSuccess && !selectedLeadAccess.isError && verifiedLeadRead
    ? selectedLead
    : null;
  const selectedLeadAccessStatus = selectedLeadAccess.error instanceof VimobAPIError ? selectedLeadAccess.error.status : undefined;
  const selectedLeadAccessBlocked = selectedLeadAccess.isError;
  const retainedSelectedLead = !leadVisibilityError && !boardAccessRevoked && selectedLeadAccessBlocked &&
    canRetainPipelineLeadDraft(Boolean(verifiedLeadRead), selectedLeadAccessStatus) ? selectedLead : null;

  useEffect(() => {
    if (!selectedLead?.id || !activeOrganizationId) return;
    const selectedLeadId = selectedLead.id;
    const onLeadChanged = (event: Event) => {
      const change = (event as CustomEvent<{
        organizationId?: string;
        leadId?: string | null;
      }>).detail;
      if (change?.organizationId !== activeOrganizationId) return;
      if (change.leadId && change.leadId !== selectedLeadId) return;
      void queryClient.invalidateQueries({
        queryKey: ['pipeline-selected-lead-access', activeOrganizationId, selectedLeadId],
        refetchType: 'active',
      });
    };
    window.addEventListener('vimob:lead-realtime-change', onLeadChanged);
    return () => window.removeEventListener('vimob:lead-realtime-change', onLeadChanged);
  }, [activeOrganizationId, queryClient, selectedLead?.id]);

  useEffect(() => {
    if (!selectedLead || !activeOrganizationId || !selectedLeadAccess.isError) return;
    const selectedLeadId = selectedLead.id;
    const status = selectedLeadAccess.error instanceof VimobAPIError
      ? selectedLeadAccess.error.status
      : undefined;
    const unavailable = isPipelineLeadAccessDenied(status);
    if (unavailable) {
      removeCachedPipelineLeadDetail(queryClient, activeOrganizationId, selectedLeadId);
    }
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      handlePipelineSelectedLeadAccessFailure({
        queryClient,
        organizationId: activeOrganizationId,
        leadId: selectedLeadId,
        status,
        closeDetail: () => {
          setSelectedLead(null);
          setEditingLead(null);
        },
      });
      toast.warning(unavailable
        ? 'Este lead não está mais disponível para você.'
        : 'Não foi possível confirmar o acesso. Tente novamente para continuar a edição.');
    });
    return () => { active = false; };
  }, [activeOrganizationId, queryClient, selectedLead, selectedLeadAccess.error, selectedLeadAccess.isError]);

  useEffect(() => {
    if (!boardRestoreError) return;
    toast.warning('Alguns leads adicionais não foram carregados. Atualize a Pipeline para tentar novamente.');
  }, [boardRestoreError]);

  const shouldLoadLeadDialogResources = Boolean(authorizedSelectedLead);
  const organizationUsersQuery = useOrganizationUsers({ enabled: shouldLoadLeadDialogResources });
  const users = organizationUsersQuery.data || [];
  const { data: allTags = [] } = useTags({ enabled: shouldLoadLeadDialogResources });
  const assignLeadRoundRobin = useAssignLeadRoundRobin();
  const assignLeadRoundRobinMutate = assignLeadRoundRobin.mutate;
  const canEditPipeline = canManagePipeline(hasPermission);
  const canManageAttention = hasPermission('attention_view') && (
    hasPermission('pipeline_manage') || hasPermission('automations_manage')
  );
  const isMobile = useIsMobile();
  const scrollMemory = useMemo(
    () => shouldLoadPipelineLeads ? getPipelineBoardScrollMemory(queryClient, pipelineBoardQueryKeyId, isMobile) : null,
    [isMobile, pipelineBoardQueryKeyId, queryClient, shouldLoadPipelineLeads],
  );
  const [mobileStageSelection, setMobileStageSelection] = useState<{
    memory: typeof scrollMemory;
    stageId: string;
  } | null>(null);
  const activeMobileStageId = mobileStageSelection?.memory === scrollMemory
    ? mobileStageSelection?.stageId
    : scrollMemory?.mobileStageId;

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
    leadVisibilityError ||
    boardAccessRevoked ||
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

  const handleDragStart = useCallback((start: DragStart) => {
    isDraggingRef.current = true;
    dragMoveSnapshotRef.current = null;
    const lead = stages.find((stage) => stage.id === start.source.droppableId)?.leads
      .find((item) => item.id === start.draggableId);
    if (!lead || lead.can_operate !== true) return;
    let operation: LeadRequestOperation;
    try { operation = leadMoveRequestScope.capture(); } catch { return; }
    const pending = moveRevisionReceiptByLeadRef.current.get(lead.id);
    const predecessor = pending?.queryKeyId === pipelineBoardQueryKeyId && pending.operation.isCurrent()
      ? pending.receipt : undefined;
    const revision = capturePipelineMoveRevision(lead, start.source.droppableId, predecessor);
    if (revision) dragMoveSnapshotRef.current = { lead: { ...lead }, revision, operation, queryKeyId: pipelineBoardQueryKeyId };
  }, [stages, leadMoveRequestScope, pipelineBoardQueryKeyId]);

  const handleOpenLead = useCallback((lead: PipelineLead | { id: string }) => {
    preloadPipelineLeadDialog();
    setSelectedLeadAccessVersion((current) => current + 1);
    setSelectedLead(lead as PipelineLead);
  }, []);

  const handleAssignLeadNow = useCallback((leadId: string) => {
    const lead = findPipelineLeadLocation<PipelineLead, StageWithLeads>(stages, leadId)?.lead;
    if (!canOperateLeads || lead?.can_operate !== true) {
      toast.error('Você não tem permissão para atribuir leads.');
      return;
    }
    if (assigningLeadIdsRef.current.has(leadId)) return;

    assigningLeadIdsRef.current.add(leadId);
    assignLeadRoundRobinMutate(leadId, {
      onSettled: () => assigningLeadIdsRef.current.delete(leadId),
    });
  }, [assignLeadRoundRobinMutate, canOperateLeads, stages]);

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
    if (!stage?.has_more) return;
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
        updatedLead.can_operate !== selectedLead.can_operate ||
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
          setSelectedLeadAccessVersion((current) => current + 1);
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
  }, [searchParamsString, activeOrganization.organizationId, router, setSelectedPipelineId]);

  const realtimeOrganizationId = activeOrganization.organizationId || '';

  const executeLeadMove = useCallback(async (result: DropResult, snapshot: PipelineMoveSnapshot, lostReason?: string) => {
    const requestOperation = snapshot.operation;
    if (!requestOperation.isCurrent() || snapshot.queryKeyId !== pipelineBoardQueryKeyId) return;
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
    const movedLead = snapshot.lead;
    const currentLead = sourceStage?.leads.find((lead) => lead.id === draggableId);
    if (!sourceStage || !newStage || !currentLead || snapshot.revision.leadId !== draggableId || snapshot.revision.sourceStageId !== oldStageId) {
      isDraggingRef.current = false;
      return;
    }
    if (movedLead.can_operate !== true || currentLead.can_operate !== true) {
      isDraggingRef.current = false;
      return;
    }

    let moveStageContract;
    try {
      // A warm proof keeps the optimistic drop synchronous; a cold read cannot move the card yet.
      moveStageContract = moveContract.getCurrent(requestOperation) ?? await moveContract.ensureCompatible(requestOperation);
      if (!requestOperation.isCurrent() || snapshot.queryKeyId !== pipelineBoardQueryKeyId) return;
      const latestBoard = queryClient.getQueryData<StageWithLeads[]>(pipelineBoardQueryKey) || stages;
      const latestSource = latestBoard.find(stage => stage.id === oldStageId)?.leads.find(lead => lead.id === draggableId);
      if (!latestSource || latestSource.can_operate !== true) throw new PipelineMoveRevisionConflict();
    } catch (error) {
      isDraggingRef.current = false;
      if (requestOperation.isCurrent()) toast.error(getPipelineErrorMessage(error));
      throw error;
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
    const destinationLeads = newStage.leads.filter((lead) => lead.id !== draggableId);
    const targetIndex = Math.min(Math.max(destination.index, 0), destinationLeads.length);
    const nextBoardOrderAt = getPipelineBoardOrderAtForIndex(destinationLeads, targetIndex, Date.now());
    if (!nextBoardOrderAt) {
      isDraggingRef.current = false;
      void queryClient.invalidateQueries({ queryKey: pipelineBoardQueryKey, exact: true }, { cancelRefetch: false });
      toast.warning('A posição não foi confirmada. O quadro será atualizado; tente mover o lead novamente.');
      return;
    }

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
    const receipt: PipelineMoveReceipt = { status: 'pending' };
    moveRevisionReceiptByLeadRef.current.set(draggableId, { queryKeyId, operation: requestOperation, receipt });

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
    const reconcileEndedMove = () => {
      clearPendingPipelineMove(queryKey, draggableId, moveVersion);
      if (!isLatestMoveForLead()) return;
      moveRollbackSnapshotByLeadRef.current.delete(draggableId);
      setVisualPendingMoves((current) => {
        const entry = current.get(visualMoveKey);
        if (!entry || entry.move.version !== moveVersion) return current;
        const next = new Map(current);
        next.delete(visualMoveKey);
        return next;
      });
      void queryClient.invalidateQueries({ queryKey, exact: true, refetchType: 'active' });
    };

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
      if (requestOperation.isCurrent() && isLatestMoveForLead()) {
        isDraggingRef.current = false;
      }
    }, 150);

    preserveOptimisticPipelineBoard(realtimeOrganizationId, draggableId);

    return enqueueLeadMovePersistence(draggableId, async () => {
      if (!requestOperation.isCurrent()) { reconcileEndedMove(); return; }
      const expectedUpdatedAt = resolvePipelineMoveRevision(snapshot.revision);
      if (!expectedUpdatedAt) throw new PipelineMoveRevisionConflict();
      const currentStages = queryClient.getQueryData<StageWithLeads[]>(queryKey) || stages;
      const persistedStage = currentStages.find((stage) => stage.id === newStageId);
      const persistedLead = persistedStage?.leads?.find((lead) => lead.id === draggableId);
      const persistedBoardOrderAt =
        persistedLead?.board_order_at ||
        optimisticPatch.board_order_at ||
        new Date().toISOString();

      const updateResult = await leadsAPI.moveLeadStage(draggableId, {
        stageId: newStageId,
        expectedStageId: oldStageId,
        expectedUpdatedAt,
        boardOrderAt: persistedBoardOrderAt,
        lostReason,
      }, realtimeOrganizationId, requestOperation.intent, moveStageContract);

      if (!requestOperation.isCurrent()) { reconcileEndedMove(); return; }
      if (updateResult.error) throw updateResult.error;

      const movedLeadFromRpc = updateResult.data as unknown as Partial<PipelineLead> | null;
      receipt.status = 'confirmed';
      receipt.stageId = movedLeadFromRpc?.stage_id;
      receipt.updatedAt = movedLeadFromRpc?.updated_at;
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

      // A queued second move may already be visible. Its rollback must land on
      // this confirmed stage, not on the snapshot from before the first move.
      const previousConfirmedBoard = moveRollbackSnapshotByLeadRef.current.get(draggableId);
      if (previousConfirmedBoard) {
        moveRollbackSnapshotByLeadRef.current.set(
          draggableId,
          applyPendingPipelineMoves(previousConfirmedBoard, [confirmedMove]),
        );
      }
      if (!isLatestMoveForLead()) return;

      // Any GET started before the transaction committed must not win after
      // the mutation response. A fresh request after this point is safe.
      await queryClient.cancelQueries({ queryKey, exact: true });
      if (!requestOperation.isCurrent()) { reconcileEndedMove(); return; }
      if (!isLatestMoveForLead()) return;

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

      if (movedLeadFromRpc) {
        const financialReview = getLeadStatusFinancialReviewMessage(movedLead, movedLeadFromRpc);
        if (financialReview) toast.warning(financialReview);
      }

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
      receipt.status = 'failed';
      if (!requestOperation.isCurrent()) { reconcileEndedMove(); return; }
      if (!isLatestMoveForLead()) return;

      await queryClient.cancelQueries({ queryKey, exact: true });
      if (!requestOperation.isCurrent()) { reconcileEndedMove(); return; }
      if (!isLatestMoveForLead()) return;

      clearPendingPipelineMove(queryKey, draggableId, moveVersion);
      const latestRollbackData = moveRollbackSnapshotByLeadRef.current.get(draggableId) ?? rollbackData;
      queryClient.setQueryData<StageWithLeads[]>(queryKey, (current) =>
        restorePipelineLeadSnapshot(current, latestRollbackData, draggableId),
      );
      const rollbackLocation = findPipelineLeadLocation<PipelineLead, StageWithLeads>(
        latestRollbackData,
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
        setPendingLostMove({ result, snapshot });
        setLostReasonLead(movedLead);
      } else {
        const rateLimitMessage = getClientRateLimitMessage(error);
        const changedInAnotherSession = error instanceof PipelineMoveRevisionConflict || (error instanceof VimobAPIError && ['lead_stage_changed', 'lead_changed'].includes(error.code || ''));
        toast.error(changedInAnotherSession
          ? 'Este lead foi atualizado em outra sessão. A Pipeline será atualizada; confira os dados antes de mover novamente.'
          : rateLimitMessage || 'Erro ao mover lead: ' + getPipelineErrorMessage(error));
        if (changedInAnotherSession) {
          setPendingLostMove(null);
          setLostReasonLead(null);
        }
      }
      throw error;
    }).finally(() => {
      if (receipt.status === 'pending') receipt.status = 'failed';
      if (moveRevisionReceiptByLeadRef.current.get(draggableId)?.receipt === receipt) {
        moveRevisionReceiptByLeadRef.current.delete(draggableId);
      }
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
    moveContract,
  ]);

  const handleDragEnd = useCallback(async (result: DropResult) => {
    const { destination, source, draggableId } = result;
    const snapshot = dragMoveSnapshotRef.current;
    dragMoveSnapshotRef.current = null;

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

    if (!snapshot || snapshot.revision.leadId !== draggableId || snapshot.revision.sourceStageId !== source.droppableId) {
      isDraggingRef.current = false;
      toast.error('Atualize a Pipeline antes de mover este lead.');
      void queryClient.invalidateQueries({ queryKey: pipelineBoardQueryKey, exact: true });
      return;
    }
    if (!snapshot.operation.isCurrent() || snapshot.queryKeyId !== pipelineBoardQueryKeyId) {
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
    if (!canOperateLeads || movedLead.can_operate !== true) {
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
      setPendingLostMove({ result, snapshot });
      setLostReasonLead(movedLead);
      return;
    }

    try {
      await executeLeadMove(result, snapshot);
    } catch {
      // executeLeadMove already restores the board and reports the error.
    }
  }, [canOperateLeads, executeLeadMove, stageAutomations, stages, queryClient, pipelineBoardQueryKey, pipelineBoardQueryKeyId]);

  const handleManualRefresh = useCallback(() => runPipelineRefresh({
    reads: [
      refetchPipelines,
      refetchLeadVisibility,
      ...(sharedFilters.teamId ? [refetchTeams] : []),
      ...(shouldLoadFilterOptions ? [refetchLeadMetaFilters, refetchTags] : []),
      ...(selectedPipelineId ? [refetchBaseStages] : []),
      ...(canRefreshStageAutomations ? [refetchStageAutomations] : []),
      ...(shouldLoadPipelineLeads ? [refetch] : []),
    ],
    onSuccess: () => toast.success('Atualizado!', { duration: 1500 }),
    onError: error => toast.error(`Não foi possível atualizar: ${getPipelineErrorMessage(error)}`),
  }), [
    canRefreshStageAutomations,
    refetch,
    refetchBaseStages,
    refetchLeadVisibility,
    refetchLeadMetaFilters,
    refetchPipelines,
    refetchStageAutomations,
    refetchTags,
    refetchTeams,
    runPipelineRefresh,
    selectedPipelineId,
    sharedFilters.teamId,
    shouldLoadFilterOptions,
    shouldLoadPipelineLeads,
  ]);

  useEffect(() => {
    if (!activeOrganizationId || !selectedPipelineId) return;
    let lastReconciliationAt = Date.now();
    const reconcileVisibleBoard = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastReconciliationAt < 60_000) return;
      lastReconciliationAt = now;
      void Promise.allSettled([
        refetchPipelines(),
        refetchBaseStages(),
        ...(sharedFilters.teamId ? [refetchTeams()] : []),
        ...(canRefreshStageAutomations ? [refetchStageAutomations()] : []),
        ...(shouldLoadPipelineLeads ? [refetch()] : []),
      ]);
    };
    const intervalId = window.setInterval(reconcileVisibleBoard, 120_000);
    window.addEventListener('focus', reconcileVisibleBoard);
    document.addEventListener('visibilitychange', reconcileVisibleBoard);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', reconcileVisibleBoard);
      document.removeEventListener('visibilitychange', reconcileVisibleBoard);
    };
  }, [
    activeOrganizationId,
    canRefreshStageAutomations,
    refetch,
    refetchBaseStages,
    refetchPipelines,
    refetchStageAutomations,
    refetchTeams,
    selectedPipelineId,
    sharedFilters.teamId,
    shouldLoadPipelineLeads,
  ]);

  const { retry: handleCriticalLoadRetry, isRetrying: isCriticalLoadRetrying } = usePipelineCriticalLoadRetry({
    organizationId: activeOrganizationId,
    resourceKey: pipelineBoardQueryKeyId,
    selectedPipelineId,
    catalogHasError: pipelinesError,
    boardError: leadsError,
    refetchPipelines,
    reads: [
      ...(leadVisibilityError ? [refetchLeadVisibility] : []),
      ...(teamScopeError ? [refetchTeams] : []),
      ...(selectedPipelineId && baseStages.length === 0 ? [refetchBaseStages] : []),
      ...(shouldLoadPipelineLeads && (leadsLoadingError || leadsRefetchError || boardAccessRevoked) ? [refetch] : []),
    ],
    onError: error => toast.error(`Não foi possível carregar a pipeline: ${getPipelineErrorMessage(error)}`),
  });

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
    const operation = stageNameVisit.capture();
    if (!operation.isCurrent() || stageNameUpdateInFlightRef.current.get(stageId)?.visit === operation.visit) return;

    const nextStageName = editingStageName.trim();
    if (nextStageName.length < 2 || nextStageName.length > 120) {
      toast.error('O nome da coluna deve ter entre 2 e 120 caracteres.');
      return;
    }

    const base = editingStageBaseRef.current;
    if (base?.id !== stageId) return;
    const currentStageName = base.name.trim();
    if (currentStageName === nextStageName) {
      if (editingStageBaseRef.current === base) editingStageBaseRef.current = null;
      setEditingStageId(null);
      return;
    }

    stageNameUpdateInFlightRef.current.set(stageId, operation);
    setSavingStageName({ id: stageId, operation });

    try {
      if (!base.updatedAt) throw new Error('Reabra a edição para carregar a versão atual da coluna.');
      await updateStageName.mutateAsync({ id: stageId, name: nextStageName, expectedUpdatedAt: base.updatedAt });
      if (!operation.isCurrent()) return;
      if (editingStageBaseRef.current === base) editingStageBaseRef.current = null;
      setEditingStageId((current) => current === stageId ? null : current);
      toast.success('Nome atualizado!');
    } catch (error: unknown) {
      if (!operation.isCurrent()) return;
      toast.error('Não foi possível atualizar o nome: ' + getPipelineErrorMessage(error));
    } finally {
      if (stageNameUpdateInFlightRef.current.get(stageId) === operation) stageNameUpdateInFlightRef.current.delete(stageId);
      if (operation.isCurrent()) setSavingStageName(current => current?.operation === operation ? null : current);
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
    const stageId = filteredStages[nextIndex].id;
    scrollMemory?.rememberMobileStage(stageId);
    setMobileStageSelection({ memory: scrollMemory, stageId });
  }, [activeMobileStageIndex, filteredStages, isMobile, scrollMemory]);

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
      updated_at: settingsStage.updated_at,
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
    const operation = createPipelineVisit.capture();
    if (!newPipelineDialogOpen || !operation.isCurrent() || createPipelineInFlightRef.current?.visit === operation.visit) return;
    const normalizedName = newPipelineName.trim();
    if (normalizedName.length < 2) {
      toast.error('O nome da pipeline deve ter pelo menos 2 caracteres.');
      return;
    }

    createPipelineInFlightRef.current = operation;
    try {
      const pipeline = await createPipeline.mutateAsync({ name: normalizedName });
      if (!operation.isCurrent()) return;
      handleSelectPipeline(pipeline.id);
      setNewPipelineDialogOpen(false);
      setNewPipelineName('');
      toast.success('Pipeline criada com sucesso!');
    } catch (error: unknown) {
      if (!operation.isCurrent()) return;
      toast.error('Erro ao criar pipeline: ' + getPipelineErrorMessage(error));
    } finally {
      if (createPipelineInFlightRef.current === operation) createPipelineInFlightRef.current = null;
    }
  };

  const handleCreateStage = async (event: FormEvent) => {
    event.preventDefault();
    const operation = createStageVisit.capture();
    if (!newStageDialogOpen || !operation.isCurrent() || createStageInFlightRef.current?.visit === operation.visit) return;
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

    createStageInFlightRef.current = operation;
    try {
      await createStage.mutateAsync({
        pipelineId: selectedPipelineId,
        name: normalizedName,
        color: newStageColorValidation.data,
      });
      if (!operation.isCurrent()) return;
      setNewStageDialogOpen(false);
      setNewStageName('');
      setNewStageColor(PIPELINE_STAGE_COLOR_FALLBACK);
      toast.success('Coluna criada com sucesso!');
    } catch (error: unknown) {
      if (!operation.isCurrent()) return;
      toast.error('Erro ao criar coluna: ' + getPipelineErrorMessage(error));
    } finally {
      if (createStageInFlightRef.current === operation) createStageInFlightRef.current = null;
    }
  };

  const closePipelineDeletion = (target: PipelineDeleteData | null) => {
    if (pipelineDeletionRef.current !== target) return;
    if (target) deletePipeline.discard(target);
    pipelineDeletionRef.current = null;
    setPipelineToDelete(null);
    setDeletePipelineBlocked(false);
    setDeletePipelineError(null);
  };

  const handleRequestDeletePipeline = (pipeline: { id: string; name: string; revision?: string }) => {
    if (!canEditPipeline || !deletePipeline.isScopeCurrent() || deletePipeline.isPending || deletePipelineInFlightRef.current) return;
    const revision = pipelineRevisionSchema.safeParse(pipeline.revision);
    if (!revision.success) {
      toast.error('Não foi possível confirmar a versão desta pipeline. Atualize a lista antes de excluir.');
      return;
    }
    try {
      const captured = deletePipeline.capture({ id: pipeline.id, name: pipeline.name, expectedRevision: revision.data });
      closePipelineDeletion(pipelineDeletionRef.current);
      pipelineDeletionRef.current = captured;
      setPipelineToDelete(captured);
    } catch (error) {
      if (deletePipeline.isScopeCurrent()) toast.error(getPipelineErrorMessage(error));
    }
  };

  const handleDeletePipeline = async () => {
    const target = pipelineToDelete;
    if (!canEditPipeline || !target || pipelineDeletionRef.current !== target || !deletePipeline.isCurrent(target) || deletePipelineBlocked || deletePipeline.isPending || deletePipelineInFlightRef.current) return;

    deletePipelineInFlightRef.current = true;
    setDeletePipelineError(null);
    try {
      await deletePipeline.mutateAsync(target);
      if (pipelineDeletionRef.current !== target || !deletePipeline.isCurrent(target)) return;
      const currentNavigation = pipelineNavigationRef.current;
      const nextPipeline = currentNavigation.pipelines.find((pipeline) => pipeline.id !== target.id) || null;

      if (currentNavigation.selectedPipelineId === target.id) {
        handleSelectPipeline(nextPipeline?.id || null);
      }

      closePipelineDeletion(target);
      toast.success('Pipeline excluída com sucesso!');
    } catch (error: unknown) {
      if (pipelineDeletionRef.current !== target || !deletePipeline.isCurrent(target)) return;
      const conflict = error instanceof VimobAPIError && error.code === 'pipeline_changed';
      if (conflict) {
        // Retire the original intent too: previously rendered callbacks may
        // still hold the unblocked state after the conflict is displayed.
        deletePipeline.discard(target);
        setDeletePipelineBlocked(true);
      }
      const message = conflict ? 'A pipeline ou suas colunas mudaram. Feche esta confirmação, atualize a lista e confira antes de excluir.'
        : 'Erro ao excluir pipeline: ' + getPipelineErrorMessage(error);
      setDeletePipelineError(message);
      toast.error(message);
    } finally {
      deletePipelineInFlightRef.current = false;
    }
  };

  const pendingMoveLeadIds = useMemo(() => new Set([...visualPendingMoves.values()]
    .filter(entry => entry.queryKeyId === pipelineBoardQueryKeyId && entry.release === null)
    .map(entry => entry.move.leadId)), [pipelineBoardQueryKeyId, visualPendingMoves]);

  const handleLostReasonConfirm = async (reason: string) => {
    if (!lostReasonLead || !pendingLostMove || lostReasonPending) return;
    setLostReasonPending(true);
    try {
      await executeLeadMove(pendingLostMove.result, pendingLostMove.snapshot, reason);
      setPendingLostMove(null);
      setLostReasonLead(null);
    } catch {
      // Conflicts discard the stale intent; other failures keep the reason dialog available.
    } finally {
      setLostReasonPending(false);
    }
  };

  return (
    <AppLayout title="Pipeline" disableMainScroll>
      <div
        data-tour="pipeline-overview"
        className="flex h-full flex-col overflow-hidden bg-transparent"
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
          isRefreshing={isRefreshing || isCriticalLoadRetrying}
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
          campaignIds={filterCampaigns}
          onCampaignsChange={setFilterCampaigns}
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
          onRequestDeletePipeline={handleRequestDeletePipeline}
          onRequestNewPipeline={() => setNewPipelineDialogOpen(true)}
          onRequestAttentionSettings={() => setAttentionSettingsOpen(true)}
          onRequestStagesEditor={() => setStagesEditorOpen(true)}
          onRefresh={() => void handleManualRefresh()}
          onCreateLead={() => openNewLeadDialog()}
        />

        <PipelineBoard
          scrollMemory={scrollMemory}
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
          isRefreshing={isRefreshing || isCriticalLoadRetrying}
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
          pendingMoveLeadIds={pendingMoveLeadIds}
          nowMs={boardNowMs}
          editingStageId={editingStageId}
          editingStageName={editingStageName}
          savingStageNameId={savingStageNameId}
          loadMoreIsPending={loadMoreLeads.isPending}
          loadingMoreStageId={loadMoreLeads.variables?.stageId}
          onDragStart={handleDragStart}
          onDragEnd={(result) => void handleDragEnd(result)}
          onCriticalLoadRetry={() => void handleCriticalLoadRetry()}
          onBoardRefresh={() => void handleCriticalLoadRetry()}
          onMobileStageNavigation={handleMobileStageNavigation}
          onEditingStageNameChange={setEditingStageName}
          onStartEditingStage={(stage) => {
            editingStageBaseRef.current = { id: stage.id, name: stage.name, updatedAt: stage.updated_at };
            setEditingStageId(stage.id);
            setEditingStageName(stage.name);
          }}
          onCommitStageName={(stageId) => void handleStageName(stageId)}
          onCancelEditingStage={() => {
            editingStageBaseRef.current = null;
            setEditingStageId(null);
            setEditingStageName('');
          }}
          onOpenStageSettings={(stage, tab, returnFocusElement) => { setSettingsStageEntry({ tab, returnFocusElement }); setSettingsStage(stage); }}
          onOpenLead={handleOpenLead}
          onAssignLeadNow={handleAssignLeadNow}
          onLoadMore={handleLoadMore}
          onCreateStage={() => setNewStageDialogOpen(true)}
          onCreatePipeline={() => setNewPipelineDialogOpen(true)}
        />


        <PipelineDialogs
          selectedLead={authorizedSelectedLead || retainedSelectedLead}
          selectedLeadLoading={Boolean(selectedLead && !authorizedSelectedLead && !isPipelineLeadAccessDenied(selectedLeadAccessStatus) && !leadVisibilityError && !boardAccessRevoked)}
          verifiedLeadRead={verifiedLeadRead}
          selectedLeadAccessPending={selectedLeadAccess.isFetching}
          selectedLeadAccessBlocked={selectedLeadAccessBlocked}
          onRetrySelectedLeadAccess={() => { void selectedLeadAccess.refetch(); }}
          editingLead={authorizedSelectedLead || retainedSelectedLead ? editingLead : null}
          lostReasonLead={leadVisibilityError || boardAccessRevoked ? null : lostReasonLead}
          lostReasonPending={lostReasonPending}
          stages={stages}
          allTags={allTags}
          users={users}
          usersState={{ loading: organizationUsersQuery.isPending, error: organizationUsersQuery.isError,
            retrying: organizationUsersQuery.isFetching, retry: () => { void organizationUsersQuery.refetch({ cancelRefetch: false }); } }}
          settingsStage={settingsStage}
          settingsStageTab={settingsStageEntry.tab}
          settingsStageReturnFocus={settingsStageEntry.returnFocusElement}
          archivedStages={baseStages.filter((stage) => stage.is_active === false)}
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
          deletePipelineBlocked={deletePipelineBlocked}
          deletePipelineError={deletePipelineError}
          onCloseSelectedLead={() => { setSelectedLead(null); setEditingLead(null); }}
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
            if (!open && !deletePipeline.isPending) closePipelineDeletion(pipelineToDelete);
          }}
          onDeletePipeline={() => void handleDeletePipeline()}
        />
      </div>
    </AppLayout>
  );
}
