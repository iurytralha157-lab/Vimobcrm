"use client";

import { Component, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { useDeferredValue } from 'react';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/shared/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Plus,
  MoreHorizontal,
  Loader2,
  RefreshCw,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Settings,
  BellRing,
  LayoutGrid,
  Target,
  Trash2
} from 'lucide-react';
import { SharedFilters } from '@/components/shared/SharedFilters';
import { useSharedFilters } from '@/hooks/use-shared-filters';
import { normalizeSearchText, searchTextIncludes } from '@/lib/search-text';

import { LeadCard } from '@/components/features/leads/LeadCard';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { DragDropContext, Droppable, DropResult } from '@hello-pangea/dnd';
import {
  useStages,
  useStagesWithLeads,
  usePipelines,
  useCreatePipeline,
  useCreateStage,
  useDeletePipeline,
} from '@/hooks/use-stages';
import { stageWithLeadsQueryKey } from '@/lib/pipeline-query-key';
import { createPipelineStageSnapshot } from '@/lib/pipeline-stage-snapshot';
import { stageHexColorInputSchema } from '@/lib/validation';
import {
  applyPendingPipelineMoves,
  clearPendingPipelineMove,
  findPipelineLeadLocation,
  getPipelineBoardQueryKeyId,
  pipelineBoardMatchesMove,
  registerPendingPipelineMove,
  restorePipelineLeadSnapshot,
  type PendingPipelineMove,
} from '@/lib/pipeline-board-cache';
import type { PipelineLead, StageWithLeads } from '@/hooks/use-stages';
import { useLoadMoreLeads } from '@/hooks/use-stages';
import { useOrganizationUsers } from '@/hooks/use-users';
import { useTags } from '@/hooks/use-tags';
import { useAssignLeadRoundRobin } from '@/hooks/use-assign-lead-roundrobin';
import { useIsMobile } from '@/hooks/use-mobile';
import { useCanEditCadences } from '@/hooks/use-can-edit-cadences';
import { useLeadVisibility } from '@/hooks/use-lead-visibility';
import { useUserPermissions } from '@/hooks/use-user-permissions';
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
import { getPipelineBoard } from '@/lib/api/pipeline-board';
import { useDealStatusChange } from '@/hooks/use-deal-status-change';
import { LostReasonDialog } from '@/components/features/leads/LostReasonDialog';
import { useStageAutomations, type StageAutomation } from '@/hooks/use-stage-automations';

const StageSettingsDialog = dynamic(
  () => import('@/components/features/pipelines/StageSettingsDialog').then((mod) => mod.StageSettingsDialog),
  { loading: () => null },
);
const PipelineAttentionSettings = dynamic(
  () => import('@/components/features/pipelines/PipelineAttentionSettings').then((mod) => mod.PipelineAttentionSettings),
  { loading: () => null },
);
const StagesEditorDialog = dynamic(
  () => import('@/components/features/pipelines/StagesEditorDialog').then((mod) => mod.StagesEditorDialog),
  { loading: () => null },
);
const LeadDetailDialog = dynamic(
  () => import('@/components/features/leads/LeadDetailDialog').then((mod) => mod.LeadDetailDialog),
  { loading: () => null },
);
const CreateLeadDialog = dynamic(
  () => import('@/components/features/leads/CreateLeadDialog').then((mod) => mod.CreateLeadDialog),
  { loading: () => null },
);

// Helper to format currency compactly (pt-BR locale)
const formatCompactCurrency = (value: number): string => {
  if (value >= 1_000_000) {
    const v = value / 1_000_000;
    const formatted = v.toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: v % 1 === 0 ? 0 : 1 });
    return `R$${formatted}M`;
  } else if (value >= 1_000) {
    const v = value / 1_000;
    const formatted = v.toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 0 });
    return `R$${formatted}K`;
  }
  return `R$${value.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
};

const getLeadTagsSignature = (lead?: Pick<PipelineLead, 'tags'> | null) => {
  if (!Array.isArray(lead?.tags)) return '';

  return lead.tags
    .map((tag) => `${tag?.id || ''}:${tag?.name || ''}:${tag?.color || ''}`)
    .sort()
    .join('|');
};

const mergeMovedLeadResponse = (currentLead: PipelineLead, movedLead: Partial<PipelineLead>): PipelineLead => {
  const responseHasTags = Array.isArray(movedLead.tags);
  const shouldPreserveTags = !responseHasTags || (movedLead.tags?.length === 0 && (currentLead.tags?.length || 0) > 0);

  return {
    ...currentLead,
    ...movedLead,
    tags: shouldPreserveTags ? currentLead.tags : movedLead.tags,
    stage: currentLead.stage,
  };
};

type PipelineDealStatus = 'open' | 'won' | 'lost';

function isPipelineDealStatus(status: unknown): status is PipelineDealStatus {
  return status === 'open' || status === 'won' || status === 'lost';
}

function getOptimisticDealStatusForStage(stage?: StageWithLeads | null): PipelineDealStatus | null {
  if (stage?.is_won) return 'won';
  return null;
}

function getOptimisticAutomationDealStatusForStage(
  automations: StageAutomation[] | undefined,
  stageId?: string | null,
): PipelineDealStatus | null {
  const automation = automations?.find((item) => {
    const config = item.action_config || item.config || {};
    return (
      item.stage_id === stageId &&
      item.is_active !== false &&
      item.automation_type === 'change_deal_status_on_enter' &&
      config.deal_status === 'won'
    );
  });

  return automation ? 'won' : null;
}

function shouldKeepLeadForDealStatusFilter(status: PipelineDealStatus | null | undefined, filter?: string) {
  return !filter || !status || filter === status;
}

type VisualPendingPipelineMove = {
  queryKeyId: string;
  move: PendingPipelineMove<PipelineLead>;
  release:
    | null
    | { kind: 'confirmed' }
    | { kind: 'rollback'; stageId: string | null };
};

type ServerSearchSnapshot = {
  queryKeyId: string;
  leads: PipelineLead[];
};

const getVisualPendingMoveKey = (queryKeyId: string, leadId: string) =>
  `${queryKeyId}\u0000${leadId}`;

function shouldApplyVisualPendingMove(
  board: StageWithLeads[],
  entry: VisualPendingPipelineMove,
) {
  if (!entry.release) return true;
  if (entry.release.kind === 'confirmed') {
    return !pipelineBoardMatchesMove(board, entry.move);
  }

  return (
    findPipelineLeadLocation<PipelineLead, StageWithLeads>(
      board,
      entry.move.leadId,
    )?.stageId !== entry.release.stageId
  );
}

const NO_VISIBLE_USER_ID = '00000000-0000-0000-0000-000000000000';
const PIPELINE_AUTO_SCROLLER_OPTIONS = {
  startFromPercentage: 0.2,
  maxScrollAtPercentage: 0.05,
  maxPixelScroll: 12,
  durationDampening: {
    accelerateAt: 260,
    stopDampeningAt: 900,
  },
};
const PIPELINE_MOVE_PERSISTENCE_INTERVAL_MS = 135;
const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error && 'message' in error) {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === 'string') return maybeMessage;
  }
  return 'Erro desconhecido';
};

const LEAD_DIALOG_CHUNK_RELOAD_KEY = 'vimob:lead-dialog-chunk-reload-at';
const LEAD_DIALOG_CHUNK_RELOAD_WINDOW_MS = 5 * 60 * 1000;

function isChunkLoadError(error: unknown) {
  const message = getErrorMessage(error).toLowerCase();
  return message.includes('failed to load chunk') || message.includes('chunkloaderror') || message.includes('/_next/static/chunks/');
}

type LeadDialogBoundaryProps = {
  leadId?: string | null;
  onClose: () => void;
  children: ReactNode;
};

type LeadDialogBoundaryState = {
  error: Error | null;
  leadId?: string | null;
};

class LeadDialogErrorBoundary extends Component<LeadDialogBoundaryProps, LeadDialogBoundaryState> {
  state: LeadDialogBoundaryState = { error: null, leadId: this.props.leadId };

  static getDerivedStateFromError(error: Error): Partial<LeadDialogBoundaryState> {
    return { error };
  }

  static getDerivedStateFromProps(
    props: LeadDialogBoundaryProps,
    state: LeadDialogBoundaryState
  ): Partial<LeadDialogBoundaryState> | null {
    if (props.leadId !== state.leadId) {
      return { error: null, leadId: props.leadId };
    }

    return null;
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[LeadDialogErrorBoundary] Erro ao abrir lead', error, errorInfo);
    if (!isChunkLoadError(error) || typeof window === 'undefined') return;

    const previousAttempt = Number(window.sessionStorage.getItem(LEAD_DIALOG_CHUNK_RELOAD_KEY) || 0);
    if (!previousAttempt || Date.now() - previousAttempt > LEAD_DIALOG_CHUNK_RELOAD_WINDOW_MS) {
      window.sessionStorage.setItem(LEAD_DIALOG_CHUNK_RELOAD_KEY, String(Date.now()));
      window.location.reload();
    }
  }

  render() {
    if (this.state.error) {
      const chunkError = isChunkLoadError(this.state.error);
      return (
        <Dialog open onOpenChange={() => this.props.onClose()}>
          <DialogContent className="app-card w-[calc(100vw-32px)] max-w-md rounded-[8px] !bg-[var(--app-surface-solid)] p-5 text-[var(--app-text-primary)] !shadow-none sm:w-full">
            <DialogHeader className="space-y-1.5 text-left">
              <DialogTitle className="text-[14px] font-normal leading-5 text-foreground">
                {chunkError ? 'Aplicativo atualizado' : 'Não foi possível abrir o lead'}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 text-[12px] font-light leading-[18px] text-muted-foreground">
              <p>{chunkError ? 'Uma versão nova do Vimob foi publicada. Recarregue para continuar com os arquivos atualizados.' : 'O lead não pôde ser carregado agora. Feche esta janela e tente novamente.'}</p>
              <Button
                onClick={chunkError ? () => window.location.reload() : this.props.onClose}
                className="h-10 w-full rounded-[6px] border-0 bg-primary/50 px-3 text-[12px] font-light text-white shadow-none transition-colors hover:bg-primary focus-visible:ring-1 focus-visible:ring-primary/40"
              >
                {chunkError ? 'Recarregar' : 'Fechar'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      );
    }

    return this.props.children;
  }
}

export default function Pipelines() {
  const router = useRouter();
  const { profile, organization } = useAuth();
  const [shouldLoadFilterOptions, setShouldLoadFilterOptions] = useState(false);
  const activeOrganizationId = organization?.id || profile?.organization_id;
  const { hasPermission, isLoading: permissionLoading } = useUserPermissions();
  const canOperateLeads = hasPermission('lead_operate');
  const canCreateLeads = hasPermission('lead_create');
  const newButtonLabel = 'Novo Lead';

  const [selectedLead, setSelectedLead] = useState<PipelineLead | null>(null);
  const [editingLead, setEditingLead] = useState<PipelineLead | null>(null);
  const [lostReasonLead, setLostReasonLead] = useState<PipelineLead | null>(null);
  const dealStatusChange = useDealStatusChange();
  const [newLeadDialogOpen, setNewLeadDialogOpen] = useState(false);
  const [newLeadStageId, setNewLeadStageId] = useState<string | null>(null);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null);
  const {
    filters: sharedFilters,
    datePreset,
    setDatePreset,
    customDateRange,
    setCustomDateRange,
    setTeamId,
    userId: filterUser,
    setUserId: setFilterUser,
    tagId: filterTag,
    setTagId: setFilterTag,
    dealStatus: filterDealStatus,
    setDealStatus: setFilterDealStatus,
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
    campaigns,
    adSets,
    ads,
    tags: allTagsFromHook,
    selectedTeamUserIds,
    isLoadingSources,
    isLoadingCampaigns,
    isLoadingAdSets,
    isLoadingAds,
  } = useSharedFilters({ loadDynamicOptions: shouldLoadFilterOptions, pipelineId: selectedPipelineId });

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
  const dateRange = sharedFilters.dateRange;

  const [isRefreshing, setIsRefreshing] = useState(false);

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
    isError: pipelinesError,
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
    isError: leadVisibilityError,
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
  const selectedFilterUserId = filterUser === 'all' ? undefined : (filterUser || undefined);
  const effectivePipelineFilterUserIds = useMemo(() => {
    if (!Array.isArray(selectedTeamUserIds)) return scopedVisibleUserIds;
    if (!Array.isArray(scopedVisibleUserIds)) return selectedTeamUserIds;

    const visibleUserIds = new Set(scopedVisibleUserIds);
    return selectedTeamUserIds.filter((userId) => visibleUserIds.has(userId));
  }, [scopedVisibleUserIds, selectedTeamUserIds]);
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
    if (!selectedFilterUserId || selectedFilterUserAllowed) return;
    setFilterUser('all');
  }, [selectedFilterUserAllowed, selectedFilterUserId, setFilterUser]);

  useEffect(() => {
    if (!profile?.id || permissionLoading || leadVisibilityLoading || !leadVisibility) return;
    if (filterUser !== null) return;
    const canSeeExpandedScope = leadVisibility.canViewAll || Boolean(leadVisibility.teamMemberIds?.length);
    if (canSeeExpandedScope) {
      setFilterUser('all');
    } else {
      setFilterUser(profile?.id);
    }
  }, [profile?.id, permissionLoading, leadVisibilityLoading, leadVisibility, filterUser, setFilterUser]);

  const {
    data: baseStages = [],
    isLoading: baseStagesLoading,
    isFetching: baseStagesFetching,
    isError: baseStagesError,
    refetch: refetchBaseStages,
  } = useStages(selectedPipelineId || undefined);
  const { data: stageAutomations = [] } = useStageAutomations();

  const shouldLoadPipelineLeads = !!selectedPipelineId && filterUser !== null && !permissionLoading && !leadVisibilityLoading && !!leadVisibility;
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const pipelineBoardFilters = useMemo(() => ({
    dateRange,
    filterTag: filterTag && filterTag !== 'all' ? filterTag : undefined,
    filterDealStatus: filterDealStatus && filterDealStatus !== 'all' ? filterDealStatus : undefined,
    searchQuery: deferredSearchQuery || undefined,
    filterCampaign: filterCampaign && filterCampaign !== 'all' ? filterCampaign : undefined,
    filterAdSet: filterAdSet && filterAdSet !== 'all' ? filterAdSet : undefined,
    filterAd: filterAd && filterAd !== 'all' ? filterAd : undefined,
    filterSource: filterSource && filterSource !== 'all' ? filterSource : undefined,
    filterUserIds: effectivePipelineFilterUserIds,
  }), [
    dateRange,
    filterTag,
    filterDealStatus,
    deferredSearchQuery,
    filterCampaign,
    filterAdSet,
    filterAd,
    filterSource,
    effectivePipelineFilterUserIds,
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

  const {
    data: stagesWithLeads = [],
    isLoading: leadsLoading,
    isFetching: leadsFetching,
    isError: leadsError,
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
      : baseStages.map(s => ({
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

  const shouldLoadLeadDialogResources = Boolean(selectedLead);
  const { data: users = [] } = useOrganizationUsers({ enabled: shouldLoadLeadDialogResources });
  const { data: allTags = [] } = useTags({ enabled: shouldLoadLeadDialogResources });
  const assignLeadRoundRobin = useAssignLeadRoundRobin();
  const assignLeadRoundRobinMutate = assignLeadRoundRobin.mutate;
  const shouldLoadPipelineManagementAccess = Boolean(selectedPipelineId) && (!leadsLoading || stagesWithLeads.length > 0);
  const canEditPipeline = useCanEditCadences({ enabled: shouldLoadPipelineManagementAccess });
  const canManageAttention = hasPermission('attention_view') && (
    hasPermission('pipeline_manage') || hasPermission('automations_manage')
  );
  const isMobile = useIsMobile();
  const [activeMobileStageId, setActiveMobileStageId] = useState<string | null>(null);

  const currentPipeline = pipelines.find(p => p.id === selectedPipelineId);
  const isLoading = pipelinesLoading || baseStagesLoading || permissionLoading || leadVisibilityLoading;
  const isInitialLeadsLoading = leadsLoading && stagesWithLeads.length === 0;
  const isPipelineBoardTransitioning = shouldLoadPipelineLeads && (isInitialLeadsLoading || leadsPlaceholderData);
  const hasCriticalLoadError =
    (pipelinesError && pipelines.length === 0) ||
    (leadVisibilityError && !leadVisibility);
  const hasPipelineBoardError =
    !hasCriticalLoadError &&
    (leadsError || pipelinesError || baseStagesError || leadVisibilityError) &&
    !isPipelineBoardTransitioning &&
    !leadsFetching &&
    !pipelinesFetching &&
    !baseStagesFetching &&
    !leadVisibilityFetching;
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
        if (delayMs > 0) await wait(delayMs);
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

    loadMoreLeads.mutate(
      {
        pipelineId: selectedPipelineId,
        stageId,
        offset: currentCount,
        filterUserId: effectivePipelineFilterUser,
        filters: {
          dateRange,
          filterTag: filterTag && filterTag !== 'all' ? filterTag : undefined,
          filterDealStatus: filterDealStatus && filterDealStatus !== 'all' ? filterDealStatus : undefined,
          searchQuery: deferredSearchQuery || undefined,
          filterCampaign: filterCampaign && filterCampaign !== 'all' ? filterCampaign : undefined,
          filterAdSet: filterAdSet && filterAdSet !== 'all' ? filterAdSet : undefined,
          filterAd: filterAd && filterAd !== 'all' ? filterAd : undefined,
          filterSource: filterSource && filterSource !== 'all' ? filterSource : undefined,
          filterUserIds: effectivePipelineFilterUserIds,
        },
      },
      {
        onError: (error) => {
          toast.error('Não foi possível carregar mais leads: ' + getErrorMessage(error));
        },
      },
    );
  }, [selectedPipelineId, stages, loadMoreLeads, effectivePipelineFilterUser, dateRange, filterTag, filterDealStatus, deferredSearchQuery, filterCampaign, filterAdSet, filterAd, filterSource, effectivePipelineFilterUserIds]);

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
    const activeOrganizationId = organization?.id || profile?.organization_id;

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
  }, [searchParamsString, organization?.id, profile?.organization_id, router]);

  const queryClient = useQueryClient();
  const realtimeOrganizationId = organization?.id || profile?.organization_id || '';

  const executeLeadMove = useCallback((result: DropResult) => {
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

    const optimisticMovedDealStatus =
      getOptimisticDealStatusForStage(newStage) ||
      getOptimisticAutomationDealStatusForStage(stageAutomations, newStageId);
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

    void enqueueLeadMovePersistence(draggableId, async () => {
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
      const sourceStage = stages.find(s => s.id === oldStageId);
      const originalLead = sourceStage?.leads?.find((lead) => lead.id === draggableId);
      const newDealStatus = movedLeadFromRpc?.deal_status && movedLeadFromRpc.deal_status !== originalLead?.deal_status
        ? movedLeadFromRpc.deal_status as string
        : null;
      if (newDealStatus) {
        if (newDealStatus === 'lost') {
          const sourceStage = stages.find(s => s.id === oldStageId);
          const originalLead = sourceStage?.leads?.find((lead) => lead.id === draggableId);
          setLostReasonLead(originalLead || { id: draggableId, name: 'Lead' } as PipelineLead);
        }
      }

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
      const rateLimitMessage = getClientRateLimitMessage(error);
      toast.error(rateLimitMessage || 'Erro ao mover lead: ' + getErrorMessage(error));
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
    const { destination, source } = result;

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

    executeLeadMove(result);
  }, [executeLeadMove]);

  const handleManualRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const results = await Promise.all([
        refetchPipelines(),
        refetchBaseStages(),
        refetchLeadVisibility(),
        refetch(),
      ]);
      const failedResult = results.find((result) => result.isError);
      if (failedResult?.isError) {
        toast.error(`Não foi possível atualizar: ${getErrorMessage(failedResult.error)}`);
        return;
      }

      toast.success('Atualizado!', { duration: 1500 });
    } catch (error: unknown) {
      toast.error(`Não foi possível atualizar: ${getErrorMessage(error)}`);
    } finally {
      setIsRefreshing(false);
    }
  }, [refetch, refetchBaseStages, refetchLeadVisibility, refetchPipelines]);

  const handleCriticalLoadRetry = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const results = await Promise.all([
        refetchPipelines(),
        refetchLeadVisibility(),
      ]);
      const failedResult = results.find((result) => result.isError);
      if (failedResult?.isError) {
        toast.error(`Não foi possível carregar a pipeline: ${getErrorMessage(failedResult.error)}`);
      }
    } catch (error: unknown) {
      toast.error(`Não foi possível carregar a pipeline: ${getErrorMessage(error)}`);
    } finally {
      setIsRefreshing(false);
    }
  }, [refetchLeadVisibility, refetchPipelines]);

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
        organization?.id || profile?.organization_id || undefined,
      );
      toast.success('Nome atualizado!');
      void queryClient.invalidateQueries({
        queryKey: ['stages', activeOrganizationId, selectedPipelineId],
        exact: true,
      });
      void refetch();
    } catch (error: unknown) {
      toast.error('Não foi possível atualizar o nome: ' + getErrorMessage(error));
    } finally {
      stageNameUpdateInFlightRef.current.delete(stageId);
      setSavingStageNameId((current) => current === stageId ? null : current);
      setEditingStageId((current) => current === stageId ? null : current);
    }
  };

  const deferredSearch = deferredSearchQuery;
  const hasMoreLeads = stages.some((stage) => stage.has_more);
  const [serverSearchSnapshot, setServerSearchSnapshot] = useState<ServerSearchSnapshot | null>(null);
  const serverSearchResults = useMemo(
    () =>
      deferredSearch &&
      hasMoreLeads &&
      serverSearchSnapshot?.queryKeyId === pipelineBoardQueryKeyId
        ? serverSearchSnapshot.leads
        : [],
    [deferredSearch, hasMoreLeads, pipelineBoardQueryKeyId, serverSearchSnapshot],
  );

  useEffect(() => {
    if (!deferredSearch || !hasMoreLeads || !selectedPipelineId) {
      return;
    }

    let cancelled = false;
    const doSearch = async () => {
      try {
        const searchedStages = await getPipelineBoard({
          organizationId: activeOrganizationId,
          pipelineId: selectedPipelineId,
          filterUserId: effectivePipelineFilterUser,
          filters: pipelineBoardFilters,
          limit: 50,
        });

        if (!cancelled) {
          setServerSearchSnapshot({
            queryKeyId: pipelineBoardQueryKeyId,
            leads: searchedStages.flatMap((stage) => stage.leads) as PipelineLead[],
          });
        }
      } catch {
        if (!cancelled) {
          setServerSearchSnapshot({ queryKeyId: pipelineBoardQueryKeyId, leads: [] });
        }
      }
    };

    doSearch();
    return () => { cancelled = true; };
  }, [
    activeOrganizationId,
    deferredSearch,
    effectivePipelineFilterUser,
    hasMoreLeads,
    pipelineBoardFilters,
    pipelineBoardQueryKeyId,
    selectedPipelineId,
  ]);

  const filteredStages = useMemo<StageWithLeads[]>(() => {
    return stages.map(stage => {
      let stageLeads: PipelineLead[] = [...(stage.leads || [])];
      const normalizedSearch = searchQuery ? normalizeSearchText(searchQuery) : '';
      const matchesCurrentSearch = (lead: PipelineLead) => {
        if (!normalizedSearch) return true;
        const nameMatch = searchTextIncludes(lead.name, normalizedSearch);
        const phoneMatch = (lead.phone || '').includes(normalizedSearch);
        const emailMatch = searchTextIncludes(lead.email, normalizedSearch);
        return nameMatch || phoneMatch || emailMatch;
      };

      if (searchQuery) {
        stageLeads = stageLeads.filter(matchesCurrentSearch);
      }

      if (deferredSearch && serverSearchResults.length > 0) {
        const loadedIds = new Set(stageLeads.map((lead) => lead.id));
        const extraLeads = serverSearchResults.filter(
          (lead) =>
            lead.stage_id === stage.id &&
            !loadedIds.has(lead.id) &&
            matchesCurrentSearch(lead),
        );
        stageLeads = [...stageLeads, ...extraLeads];
      }

      return {
        ...stage,
        leads: stageLeads,
      };
    });
  }, [stages, searchQuery, deferredSearch, serverSearchResults]);

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

  const settingsStageForDialog = useMemo(() => {
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

  const stageValueMap = useMemo(() => {
    const map = new Map<string, { totalValue: number }>();
    for (const stage of filteredStages) {
      const apiTotalValue = Number(stage.total_value || 0);
      if (Number.isFinite(apiTotalValue) && apiTotalValue > 0) {
        map.set(stage.id, { totalValue: apiTotalValue });
        continue;
      }

      let totalValue = 0;
      for (const lead of stage.leads || []) {
        if (!lead) {
          continue;
        }
        const interestValue = Number(lead.valor_interesse || 0);
        const propertyPrice = lead.interest_property && typeof lead.interest_property === 'object'
          ? Number(lead.interest_property.preco || 0)
          : 0;
        const leadValue = Number.isFinite(interestValue) && interestValue > 0
          ? interestValue
          : Number.isFinite(propertyPrice) && propertyPrice > 0
            ? propertyPrice
            : 0;
        totalValue += leadValue;
      }
      if (totalValue > 0) map.set(stage.id, { totalValue });
    }
    return map;
  }, [filteredStages]);

  const stageCountMetaMap = useMemo(() => {
    const map = new Map<string, { total: number; visible: number; remaining: number; canLoadMore: boolean }>();

    for (const stage of filteredStages) {
      const visible = stage.leads.length || 0;
      const total = stage.total_lead_count ?? visible;
      const remaining = Math.max(total - visible, 0);

      map.set(stage.id, {
        total,
        visible,
        remaining,
        canLoadMore: visible > 0 && remaining > 0,
      });
    }

    return map;
  }, [filteredStages]);

  const handleCreatePipeline = async (e: React.FormEvent) => {
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
      toast.error('Erro ao criar pipeline: ' + getErrorMessage(error));
    } finally {
      createPipelineInFlightRef.current = false;
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
      toast.error('Erro ao excluir pipeline: ' + getErrorMessage(error));
    } finally {
      deletePipelineInFlightRef.current = false;
    }
  };

  return (
    <AppLayout title="Pipeline" disableMainScroll>
      <div data-tour="pipeline-overview" className={cn(
        "flex flex-col h-full overflow-hidden bg-transparent",
        isMobile && "pb-2"
      )}>
        <div className={cn("flex flex-col gap-2 px-2 pt-2", isMobile ? "mb-2" : "mb-4")}>
          <div className="flex flex-row items-center justify-between gap-2 lg:gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-10 min-w-0 items-center overflow-hidden rounded-[8px] bg-[var(--app-surface-solid)] p-1 text-[var(--app-text-primary)] shadow-none">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button data-tour="pipeline-selector" variant="ghost" className="h-8 min-w-0 gap-2 rounded-[6px] border-0 bg-transparent px-2.5 text-[12px] font-light text-[var(--app-text-primary)] shadow-none transition-colors hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)] focus-visible:ring-1 focus-visible:ring-primary/30">
                      <LayoutGrid className="h-4 w-4 text-primary" />
                      <span className="truncate max-w-[96px] sm:max-w-[200px]">{currentPipeline?.name || 'Pipeline'}</span>
                      <ChevronDown className="h-3 w-3 text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    sideOffset={8}
                    collisionPadding={12}
                    className="app-header-popover w-64 overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-0 text-[var(--app-text-primary)]"
                  >
                    <p className="px-3 pb-1.5 pt-3 text-[10px] font-light text-muted-foreground">Suas pipelines</p>
                    <div className="pipeline-selector-scroll max-h-[320px] overflow-y-auto px-1 pb-1">
                      {pipelines.map((pipeline) => (
                        <div key={pipeline.id} role="none" className="group flex min-w-0 items-center gap-1">
                          <DropdownMenuItem
                            onSelect={() => handleSelectPipeline(pipeline.id)}
                            className={cn(
                              "flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-2 rounded-[6px] px-2 py-2 text-[12px] font-light text-muted-foreground outline-none hover:bg-[var(--app-surface-hover)] focus:bg-[var(--app-surface-hover)] focus:text-foreground",
                              pipeline.id === selectedPipelineId && "bg-[var(--app-surface-soft)] font-normal text-primary focus:text-primary"
                            )}
                          >
                            <span className="min-w-0 flex-1 truncate">{pipeline.name}</span>
                            {pipeline.id === selectedPipelineId && <Check className="h-3.5 w-3.5 shrink-0" />}
                          </DropdownMenuItem>
                          {canEditPipeline && (
                            <DropdownMenuItem
                              aria-label={`Excluir pipeline ${pipeline.name}`}
                              title={`Excluir pipeline ${pipeline.name}`}
                              onSelect={() => setPipelineToDelete({ id: pipeline.id, name: pipeline.name })}
                              className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-[6px] p-0 text-muted-foreground opacity-100 outline-none transition-colors hover:bg-destructive/10 hover:text-destructive focus:bg-destructive/10 focus:text-destructive sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                              <span className="sr-only">Excluir pipeline {pipeline.name}</span>
                            </DropdownMenuItem>
                          )}
                        </div>
                      ))}
                    </div>
                    {canEditPipeline && (
                      <>
                        <DropdownMenuSeparator className="my-1 bg-[var(--app-border)]" />
                        <DropdownMenuItem
                          onClick={() => setNewPipelineDialogOpen(true)}
                          className="cursor-pointer rounded-[6px] bg-primary/10 py-2 text-[12px] font-light text-primary hover:bg-primary/15 focus:bg-primary/15 focus:text-primary"
                        >
                          <Plus className="h-4 w-4 mr-2" />
                          Nova Pipeline
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>

                {canShowPipelineSettings && (
                  <>
                    <div className="h-4 w-px bg-[var(--app-border)]" aria-hidden="true" />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 rounded-[6px] border-0 bg-transparent text-muted-foreground shadow-none transition-colors hover:bg-[var(--app-surface-hover)] hover:text-foreground focus-visible:ring-1 focus-visible:ring-primary/30"
                          disabled={!selectedPipelineId}
                          title="Configurar pipeline"
                          aria-label="Configurar pipeline"
                        >
                          <Settings className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="app-header-popover w-56 rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-1">
                        {canManageAttention && (
                          <DropdownMenuItem
                            onSelect={() => setAttentionSettingsOpen(true)}
                            className="cursor-pointer rounded-[6px] px-2.5 py-2 text-[12px] font-light focus:bg-[var(--app-surface-hover)]"
                          >
                            <BellRing className="mr-2 h-3.5 w-3.5 text-primary" />
                            Prioridades e atenção
                          </DropdownMenuItem>
                        )}
                        {canEditPipeline && (
                          <DropdownMenuItem
                            onSelect={() => setStagesEditorOpen(true)}
                            className="cursor-pointer rounded-[6px] px-2.5 py-2 text-[12px] font-light focus:bg-[var(--app-surface-hover)]"
                          >
                            <LayoutGrid className="mr-2 h-3.5 w-3.5 text-[var(--app-text-secondary)]" />
                            Gerenciar colunas
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                )}
              </div>
            </div>

            <div className="flex min-w-0 flex-nowrap items-center justify-end gap-2">
              <Button
                data-tour="pipeline-refresh"
                variant="outline"
                size="icon"
                className={cn(
                  "h-8 w-8 shrink-0 rounded-[6px] border-0 bg-[var(--app-surface-solid)] text-muted-foreground shadow-none transition-colors hover:bg-[var(--app-surface-hover)] hover:text-foreground",
                  isRefreshing && "bg-primary/10 text-primary"
                )}
                onClick={handleManualRefresh}
                disabled={isRefreshing || !selectedPipelineId || hasCriticalLoadError}
                title="Atualizar pipeline"
                aria-label="Atualizar pipeline"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} />
              </Button>

              <div data-tour="pipeline-filters">
                <SharedFilters
                  datePreset={datePreset}
                  onDatePresetChange={setDatePreset}
                  customDateRange={customDateRange}
                  onCustomDateRangeChange={setCustomDateRange}
                  teamId={sharedFilters.teamId}
                  onTeamChange={(id) => setTeamId(id)}
                  userId={filterUser}
                  onUserChange={setFilterUser}
                  source={filterSource}
                  onSourceChange={setFilterSource}
                  campaignId={filterCampaign}
                  onCampaignChange={setFilterCampaign}
                  adSetId={filterAdSet}
                  onAdSetChange={setFilterAdSet}
                  adId={filterAd}
                  onAdChange={setFilterAd}
                  tagId={filterTag}
                  onTagChange={setFilterTag}
                  dealStatus={filterDealStatus}
                  onDealStatusChange={setFilterDealStatus}
                  searchQuery={searchQuery}
                  onSearchChange={setSearchQuery}
                  onClear={clearFilters}
                  hasActiveFilters={hasSharedActiveFilters}
                  dynamicSources={dynamicSources}
                  campaigns={campaigns}
                  adSets={adSets}
                  ads={ads}
                  tags={allTagsFromHook}
                  isLoadingSources={isLoadingSources}
                  isLoadingCampaigns={isLoadingCampaigns}
                  isLoadingAdSets={isLoadingAdSets}
                  isLoadingAds={isLoadingAds}
                  loadDynamicOptions={shouldLoadFilterOptions}
                  onFiltersOpenChange={(open) => {
                    if (open) setShouldLoadFilterOptions(true);
                  }}
                  tourPrefix="pipeline"
                  mobileIconOnly
                  triggerClassName="!text-[10px] !font-light !leading-[15px]"
                />
              </div>

              {!isMobile && canCreateLeads && (
                <Button
                  data-tour="pipeline-new-lead"
                  size="sm"
                  className="h-8 rounded-[6px] bg-primary/50 px-4 text-[12px] font-light text-white shadow-none transition-colors hover:bg-primary focus-visible:ring-1 focus-visible:ring-primary/40"
                  onClick={() => openNewLeadDialog()}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  {newButtonLabel}
                </Button>
              )}
            </div>
          </div>
        </div>

        {!hasCriticalLoadError && stages.length === 0 && (
          <Card className="app-card mx-2 rounded-[8px] shadow-none">
            <CardContent className="py-12 text-center">
              <h3 className="mb-1 text-[14px] font-normal text-foreground">
                {isLoading
                  ? "Carregando estrutura do pipeline"
                  : selectedPipelineId
                    ? "Nenhum estágio configurado"
                    : "Nenhuma pipeline configurada"}
              </h3>
              <p className="text-[12px] font-light leading-[18px] text-muted-foreground">
                {isLoading
                  ? "Buscando pipelines e colunas disponíveis."
                  : selectedPipelineId
                    ? "Configure os estágios do pipeline nas configurações"
                    : "Crie uma pipeline antes de adicionar colunas."}
              </p>
            </CardContent>
          </Card>
        )}

        <div className="relative flex min-h-0 flex-1 flex-col">
          {hasCriticalLoadError && (
            <div className="absolute inset-0 z-40 flex items-center justify-center bg-[var(--app-bg)] px-4">
              <div
                role="alert"
                className="app-card flex w-full max-w-md flex-col items-center gap-3 rounded-[8px] px-5 py-8 text-center shadow-none"
              >
                <RefreshCw className="h-6 w-6 text-destructive" aria-hidden="true" />
                <div className="space-y-1">
                  <h3 className="text-[14px] font-normal text-[var(--app-text-primary)]">
                    Não foi possível carregar a pipeline
                  </h3>
                  <p className="text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
                    Verifique sua conexão e tente novamente. Nenhum dado foi tratado como lista vazia.
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="h-9 rounded-[6px] bg-primary/50 px-3 text-[12px] font-light text-white shadow-none hover:bg-primary"
                  onClick={() => void handleCriticalLoadRetry()}
                  disabled={isRefreshing || pipelinesFetching || leadVisibilityFetching}
                >
                  {(isRefreshing || pipelinesFetching || leadVisibilityFetching) && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  )}
                  Tentar novamente
                </Button>
              </div>
            </div>
          )}

          {isPipelineBoardTransitioning && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-[var(--app-bg)]/70">
              <div className="flex items-center gap-2 rounded-[8px] bg-[var(--app-surface-solid)] px-4 py-3 text-[12px] font-light text-[var(--app-text-primary)] shadow-none">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span>{leadsPlaceholderData ? 'Carregando pipeline...' : 'Carregando leads...'}</span>
              </div>
            </div>
          )}

          {hasPipelineBoardError && (
            <div
              role="alert"
              className="absolute right-3 top-2 z-30 flex max-w-[calc(100%-24px)] flex-wrap items-center gap-2 rounded-[8px] bg-amber-500/12 px-3 py-2 text-[11px] font-light text-amber-700 ring-1 ring-amber-500/25 dark:text-amber-200"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Não foi possível atualizar a pipeline.</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 rounded-[6px] bg-[var(--app-surface-solid)] px-2.5 text-[11px] font-light text-[var(--app-text-primary)] shadow-none hover:bg-[var(--app-surface-hover)]"
                onClick={handleManualRefresh}
                disabled={isRefreshing}
              >
                {isRefreshing ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                )}
                Tentar novamente
              </Button>
            </div>
          )}

          {isMobile && filteredStages.length > 1 && hasPreviousMobileStage && (
            <button
              type="button"
              aria-label="Ver coluna anterior"
              className="absolute left-2 top-1/2 z-20 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-[6px] border-0 bg-primary/50 text-primary-foreground shadow-none outline-none transition-colors hover:bg-primary focus-visible:ring-2 focus-visible:ring-primary/35"
              onClick={() => handleMobileStageNavigation('previous')}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
          )}

          {isMobile && filteredStages.length > 1 && (
            <button
              type="button"
              aria-label="Ver próxima coluna"
              className={cn(
                "absolute right-2 top-1/2 z-20 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-[6px] border-0 bg-primary/50 text-primary-foreground shadow-none outline-none transition-colors hover:bg-primary focus-visible:ring-2 focus-visible:ring-primary/35",
                !hasNextMobileStage && "cursor-not-allowed opacity-35 hover:bg-primary/50"
              )}
              onClick={() => handleMobileStageNavigation('next')}
              disabled={!hasNextMobileStage}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          )}

          <DragDropContext
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            autoScrollerOptions={PIPELINE_AUTO_SCROLLER_OPTIONS}
          >
            <div className={cn(
              "flex-1 min-h-0 scrollbar-thin",
              isMobile ? "overflow-y-auto overflow-x-visible px-1 pb-2" : "overflow-x-auto overflow-y-auto px-2 pb-2"
            )}>
              <div className={cn("flex gap-3 h-full", isMobile ? "min-w-0" : "min-w-max")}>
              {visibleStages.map((stage, stageIndex) => (
                <div
                  key={stage.id}
                  data-tour={stageIndex === 0 ? "pipeline-column" : undefined}
                  className={cn(
                    "flex-shrink-0 flex h-full flex-col overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none",
                    isMobile ? "w-full min-w-0" : "w-[280px] sm:w-72"
                  )}
                >
                  <div
                    className="flex items-center justify-between border-b border-[var(--app-border)] px-3 py-2"
                  >
                    <div className="flex flex-1 min-w-0 flex-wrap items-center gap-1.5">
                      <div
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: stage.color || PIPELINE_STAGE_COLOR_FALLBACK }}
                      />
                      {editingStageId === stage.id && canEditPipeline ? (
                        <Input
                          value={editingStageName}
                          onChange={(e) => setEditingStageName(e.target.value)}
                          onBlur={() => void handleStageName(stage.id)}
                          onKeyDown={(event) => {
                            if (event.key !== 'Enter') return;
                            event.preventDefault();
                            void handleStageName(stage.id);
                            event.currentTarget.blur();
                          }}
                          disabled={savingStageNameId === stage.id}
                          aria-busy={savingStageNameId === stage.id}
                          className="h-7 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-2 !text-[13px] font-normal text-foreground shadow-none focus-visible:ring-1 focus-visible:ring-primary/40"
                          autoFocus
                        />
                      ) : canEditPipeline ? (
                        <button
                          type="button"
                          className="min-w-0 flex-1 truncate text-left !text-[13px] font-normal text-foreground outline-none transition-colors hover:text-primary focus-visible:text-primary focus-visible:underline disabled:cursor-wait disabled:opacity-60"
                          onClick={() => {
                            setEditingStageId(stage.id);
                            setEditingStageName(stage.name);
                          }}
                          disabled={Boolean(savingStageNameId)}
                          aria-label={`Renomear coluna ${stage.name}`}
                        >
                          {stage.name}
                        </button>
                      ) : (
                        <h3 className="min-w-0 flex-1 truncate !text-[13px] font-normal text-foreground">
                          {stage.name}
                        </h3>
                      )}
                      <Badge
                        variant="secondary"
                        className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-[4px] border-0 bg-[var(--app-surface-soft)] px-1.5 py-0 !text-[11px] font-light text-muted-foreground shadow-none"
                      >
                        {stageCountMetaMap.get(stage.id)?.total ?? stage.total_lead_count ?? stage.leads.length ?? 0}
                      </Badge>
                      {stage.is_qualified ? (
                        <div className="order-last basis-full pl-4">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge
                                  variant="secondary"
                                  aria-label="Etapa de lead qualificado"
                                  className="flex h-[19px] w-fit items-center gap-1 rounded-[4px] border-0 bg-[var(--app-surface-hover)] px-1.5 py-0 !text-[10px] font-normal text-[var(--app-text-primary)] shadow-none"
                                >
                                  <Target className="h-2.5 w-2.5 text-primary" aria-hidden="true" />
                                  Qualificado
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent className="app-header-popover rounded-[8px] text-foreground">
                                <p className="text-[11px] font-light">Etapa qualificada desta pipeline</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                      ) : null}
                      {(stageValueMap.get(stage.id)?.totalValue || 0) > 0 ? (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge
                                variant="secondary"
                                className="flex h-[18px] shrink-0 items-center rounded-[4px] border-0 bg-primary/50 px-1.5 py-0 !text-[11px] font-light text-white shadow-none"
                              >
                                {formatCompactCurrency(stageValueMap.get(stage.id)?.totalValue || 0)}
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent className="app-header-popover rounded-[8px] text-foreground">
                              <p className="text-[11px] font-light">Valor total dos leads neste estágio</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        data-tour={stageIndex === 0 ? "pipeline-column-settings" : undefined}
                        aria-label={`Configurar coluna ${stage.name}`}
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground hover:bg-[var(--app-surface-hover)] rounded-[6px]"
                        onClick={() => setSettingsStage(stage)}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                      {canCreateLeads && (
                        <Button
                          data-tour={stageIndex === 0 ? "pipeline-column-new-lead" : undefined}
                          aria-label={`Adicionar lead na coluna ${stage.name}`}
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground hover:bg-[var(--app-surface-hover)] rounded-[6px]"
                          onClick={() => openNewLeadDialog(stage.id)}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>

                  <Droppable droppableId={stage.id}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                          className="flex-1 overflow-hidden flex flex-col min-h-0"
                        >
                          <div
                            className={cn(
                              "flex flex-1 min-h-0 flex-col gap-2 overflow-y-auto px-2 pb-2 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
                              snapshot.isDraggingOver && "bg-[var(--app-surface-soft)]"
                            )}
                          >
                            {isInitialLeadsLoading ? (
                              Array.from({ length: 3 }).map((_, i) => (
                                <div key={i} className="bg-[var(--app-surface-soft)] animate-pulse rounded-[6px] h-24 w-full" />
                              ))
                            ) : (
                              stage.leads.map((lead, index) => (
                                <LeadCard
                                  key={lead.id}
                                  tourTarget={stageIndex === 0 && index === 0 ? "pipeline-lead-card" : undefined}
                                  lead={lead}
                                  index={index}
                                  onClick={handleOpenLead}
                                  onAssignNow={handleAssignLeadNow}
                                  isDragDisabled={isDragDisabled || isMobile}
                                />
                              ))
                            )}
                            {provided.placeholder}
                          </div>
                        </div>
                      )}
                  </Droppable>
                    {stageCountMetaMap.get(stage.id)?.canLoadMore && (
                      <div className="px-2 pb-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-full rounded-[6px] text-[12px] font-light text-muted-foreground shadow-none hover:bg-[var(--app-surface-hover)] hover:text-foreground"
                          onClick={() => handleLoadMore(stage.id)}
                          disabled={loadMoreLeads.isPending}
                        >
                          {loadMoreLeads.isPending && loadMoreLeads.variables.stageId === stage.id ? (
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          ) : (
                            <ChevronDown className="h-3 w-3 mr-1" />
                          )}
                            Carregar mais ({stageCountMetaMap.get(stage.id)?.remaining ?? 0} restantes)
                        </Button>
                      </div>
                    )}
                  </div>
              ))}

              {canShowColumnActions && (
                <button
                  type="button"
                  onClick={() => setNewStageDialogOpen(true)}
                  className="group flex h-full min-h-[360px] w-[280px] flex-shrink-0 items-center justify-center rounded-[8px] border border-dashed border-[var(--app-border)] bg-transparent text-muted-foreground opacity-60 outline-none transition-colors duration-200 hover:border-primary/40 hover:bg-[var(--app-surface-soft)] hover:text-primary hover:opacity-100 focus-visible:ring-1 focus-visible:ring-primary/30 sm:w-72"
                  aria-label="Criar nova coluna"
                >
                  <span className="inline-flex items-center gap-2 rounded-[6px] bg-[var(--app-surface-solid)] px-4 py-2 text-[12px] font-light transition-colors group-hover:bg-primary/10">
                    <Plus className="h-4 w-4" />
                    Criar nova coluna
                  </span>
                </button>
              )}
              </div>
            </div>
          </DragDropContext>
        </div>

        {selectedLead && (
          <LeadDialogErrorBoundary leadId={selectedLead.id} onClose={() => setSelectedLead(null)}>
            <LeadDetailDialog
              lead={selectedLead}
              stages={stages}
              onClose={() => setSelectedLead(null)}
              onEdit={(leadToEdit) => {
                setEditingLead({
                  ...selectedLead,
                  ...leadToEdit,
                  assignee: selectedLead.assignee,
                  stage: selectedLead.stage,
                  tags: selectedLead.tags,
                });
              }}
              allTags={allTags}
              allUsers={users}
              refetchStages={refetch}
            />
          </LeadDialogErrorBoundary>
        )}

        {settingsStageForDialog && (
          <StageSettingsDialog
            open={!!settingsStage}
            onOpenChange={(open) => !open && setSettingsStage(null)}
            stage={settingsStageForDialog}
            onStageUpdate={() => {
              refetch();
              setSettingsStage(null);
            }}
          />
        )}

        {newLeadDialogOpen && (
          <CreateLeadDialog
            open={newLeadDialogOpen}
            onOpenChange={setNewLeadDialogOpen}
            defaultStageId={newLeadStageId}
            defaultPipelineId={selectedPipelineId}
          />
        )}

        {editingLead && (
          <CreateLeadDialog
            open={!!editingLead}
            onOpenChange={(nextOpen) => {
              if (!nextOpen) setEditingLead(null);
            }}
            lead={editingLead}
            onSaved={(updatedLead) => {
              setSelectedLead((current) => current?.id === updatedLead.id ? {
                ...current,
                ...updatedLead,
                tags: current.tags,
                assignee: current.assignee,
                stage: current.stage,
              } : current);
              void refetch();
            }}
          />
        )}

        <LostReasonDialog
          open={!!lostReasonLead}
          onOpenChange={(open) => {
            if (!open) setLostReasonLead(null);
          }}
          onConfirm={async (reason) => {
            if (!lostReasonLead) return;
            try {
              await dealStatusChange.mutateAsync({
                leadId: lostReasonLead.id,
                newStatus: 'lost',
                organizationId: activeOrganizationId || '',
                organizationName: organization?.name || null,
                userId: lostReasonLead.assigned_user_id ?? null,
                propertyId: lostReasonLead.property_id ?? null,
                valorInteresse: lostReasonLead.valor_interesse ?? null,
                commissionPercentage: lostReasonLead.commission_percentage ?? null,
                leadName: lostReasonLead.name || 'Lead',
                lostReason: reason,
              });
              setLostReasonLead(null);
            } catch {
              // The mutation hook already restores optimistic state and shows the toast.
            }
          }}
          leadName={lostReasonLead?.name}
        />

        <Dialog
          open={newPipelineDialogOpen}
          onOpenChange={(open) => {
            if (!open && createPipeline.isPending) return;
            setNewPipelineDialogOpen(open);
          }}
        >
          <DialogContent className="w-[calc(100vw-32px)] max-w-sm rounded-[8px] border-0 !bg-[var(--app-surface-solid)] p-5 text-[var(--app-text-primary)] !shadow-none sm:w-full">
            <DialogHeader className="text-left">
              <DialogTitle className="text-[14px] font-normal leading-5">Nova pipeline</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreatePipeline} className="mt-2 space-y-4">
              <div className="space-y-2">
                <Label className="text-[12px] font-light text-foreground">Nome da pipeline *</Label>
                <Input
                  value={newPipelineName}
                  onChange={(e) => setNewPipelineName(e.target.value)}
                  placeholder="Ex: Locação, Vendas..."
                  required
                  autoFocus
                  disabled={createPipeline.isPending}
                  className="h-10 w-full rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-[12px] font-light text-foreground shadow-none placeholder:text-muted-foreground outline-none transition-colors focus-visible:ring-1 focus-visible:ring-primary/40"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <Button type="button" variant="outline" className="h-10 flex-1 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-[12px] font-light text-muted-foreground shadow-none hover:bg-[var(--app-surface-hover)] hover:text-foreground focus-visible:ring-1 focus-visible:ring-primary/40" onClick={() => setNewPipelineDialogOpen(false)} disabled={createPipeline.isPending}>
                  Cancelar
                </Button>
                <Button type="submit" className="h-10 flex-1 rounded-[6px] bg-primary/50 px-3 text-[12px] font-light text-white shadow-none outline-none transition-colors hover:bg-primary focus-visible:ring-1 focus-visible:ring-primary/40 disabled:opacity-50" disabled={createPipeline.isPending}>
                  {createPipeline.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Criar pipeline
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog
          open={newStageDialogOpen}
          onOpenChange={(open) => {
            if (!open && createStage.isPending) return;
            setNewStageDialogOpen(open);
          }}
        >
          <DialogContent className="w-[calc(100vw-32px)] max-w-sm rounded-[8px] border-0 !bg-[var(--app-surface-solid)] p-5 text-[var(--app-text-primary)] !shadow-none sm:w-full">
            <DialogHeader className="text-left">
              <DialogTitle className="text-[14px] font-normal leading-5">Nova coluna</DialogTitle>
            </DialogHeader>
            <form onSubmit={async (e) => {
              e.preventDefault();
              if (createStageInFlightRef.current) return;
              const normalizedName = newStageName.trim();
              if (!selectedPipelineId) return;
              if (normalizedName.length < 2) {
                toast.error('O nome da coluna deve ter pelo menos 2 caracteres.');
                return;
              }
              if (!newStageColorValidation.success) {
                toast.error(newStageColorValidation.error.issues[0]?.message || 'Informe uma cor válida.');
                return;
              }

              createStageInFlightRef.current = true;
              try {
                await createStage.mutateAsync({
                  pipelineId: selectedPipelineId,
                  name: normalizedName,
                  color: newStageColorValidation.data,
                });
                await refetch();
                setNewStageDialogOpen(false);
                setNewStageName('');
                setNewStageColor(PIPELINE_STAGE_COLOR_FALLBACK);
                toast.success('Coluna criada com sucesso!');
              } catch (error: unknown) {
                toast.error('Erro ao criar coluna: ' + getErrorMessage(error));
              } finally {
                createStageInFlightRef.current = false;
              }
            }} className="mt-2 space-y-4">
              <div className="space-y-2">
                <Label className="text-[12px] font-light text-foreground">Nome da coluna *</Label>
                <Input
                  value={newStageName}
                  onChange={(e) => setNewStageName(e.target.value)}
                  placeholder="Ex: Qualificado, Em Negociação..."
                  required
                  autoFocus
                  disabled={createStage.isPending}
                  className="h-10 w-full rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-[12px] font-light text-foreground shadow-none placeholder:text-muted-foreground outline-none transition-colors focus-visible:ring-1 focus-visible:ring-primary/40"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-[12px] font-light text-foreground">Cor</Label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={newStageColorValidation.success ? newStageColorValidation.data : PIPELINE_STAGE_COLOR_FALLBACK}
                    onChange={(e) => setNewStageColor(e.target.value)}
                    aria-label="Selecionar cor da coluna"
                    disabled={createStage.isPending}
                    className="h-10 w-10 cursor-pointer rounded-[6px] border-0 bg-[var(--app-surface-soft)] p-1 shadow-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                  />
                  <Input
                    value={newStageColor}
                    onChange={(e) => setNewStageColor(e.target.value.trim())}
                    placeholder={PIPELINE_STAGE_COLOR_FALLBACK}
                    required
                    pattern="^#[0-9A-Fa-f]{6}$"
                    title="Use uma cor hexadecimal no formato #RRGGBB"
                    aria-invalid={!newStageColorValidation.success}
                    aria-describedby={!newStageColorValidation.success ? 'new-stage-color-error' : undefined}
                    autoComplete="off"
                    spellCheck={false}
                    disabled={createStage.isPending}
                    className="h-10 flex-1 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-[12px] font-light text-foreground shadow-none placeholder:text-muted-foreground outline-none transition-colors focus-visible:ring-1 focus-visible:ring-primary/40"
                  />
                </div>
                {!newStageColorValidation.success && (
                  <p id="new-stage-color-error" role="alert" className="text-[11px] font-light text-destructive">
                    Use uma cor hexadecimal no formato #RRGGBB.
                  </p>
                )}
              </div>
              <div className="flex gap-2 pt-2">
                <Button type="button" variant="outline" className="h-10 flex-1 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-[12px] font-light text-muted-foreground shadow-none hover:bg-[var(--app-surface-hover)] hover:text-foreground focus-visible:ring-1 focus-visible:ring-primary/40" onClick={() => setNewStageDialogOpen(false)} disabled={createStage.isPending}>
                  Cancelar
                </Button>
                <Button type="submit" className="h-10 flex-1 rounded-[6px] bg-primary/50 px-3 text-[12px] font-light text-white shadow-none outline-none transition-colors hover:bg-primary focus-visible:ring-1 focus-visible:ring-primary/40 disabled:opacity-50" disabled={createStage.isPending || !newStageColorValidation.success}>
                  {createStage.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Criar coluna
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {selectedPipelineId && attentionSettingsOpen && (
          <PipelineAttentionSettings
            open={attentionSettingsOpen}
            onOpenChange={setAttentionSettingsOpen}
            pipelineId={selectedPipelineId}
            pipelineName={currentPipeline?.name || ''}
          />
        )}

        {selectedPipelineId && stagesEditorOpen && (
          <StagesEditorDialog
            open={stagesEditorOpen}
            onOpenChange={setStagesEditorOpen}
            pipelineId={selectedPipelineId}
            pipelineName={currentPipeline?.name || ''}
            stages={stages.map(s => ({
              id: s.id,
              name: s.name,
              color: s.color || PIPELINE_STAGE_COLOR_FALLBACK,
              position: s.position,
              lead_count: s.total_lead_count ?? s.leads.length ?? 0,
              stage_key: s.stage_key || undefined,
            }))}
            onStagesUpdated={() => refetch()}
          />
        )}
        <AlertDialog
          open={!!pipelineToDelete}
          onOpenChange={(open) => {
            if (!open && !deletePipeline.isPending) setPipelineToDelete(null);
          }}
        >
          <AlertDialogContent className="w-[calc(100vw-32px)] max-w-md rounded-[8px] border-0 !bg-[var(--app-surface-solid)] p-5 text-[var(--app-text-primary)] !shadow-none sm:w-full">
            <AlertDialogHeader className="space-y-1.5 text-left">
              <AlertDialogTitle className="text-[14px] font-normal leading-5">Excluir pipeline?</AlertDialogTitle>
              <AlertDialogDescription className="text-[12px] font-light leading-[18px] text-muted-foreground">
                A pipeline &quot;{pipelineToDelete?.name}&quot; será removida. Se ela tiver leads, o sistema vai bloquear a exclusão para proteger os dados.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="gap-2 sm:space-x-0">
              <AlertDialogCancel disabled={deletePipeline.isPending} className="h-10 flex-1 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-[12px] font-light text-muted-foreground shadow-none hover:bg-[var(--app-surface-hover)] hover:text-foreground">
                Cancelar
              </AlertDialogCancel>
              <AlertDialogAction
                className="h-10 flex-1 rounded-[6px] bg-destructive/80 px-3 text-[12px] font-light text-destructive-foreground shadow-none hover:bg-destructive"
                onClick={(event) => {
                  event.preventDefault();
                  void handleDeletePipeline();
                }}
                disabled={deletePipeline.isPending}
              >
                {deletePipeline.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Excluir
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AppLayout>
  );
}
