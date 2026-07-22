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
  LayoutGrid,
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
import { useStages, useStagesWithLeads, usePipelines, useCreatePipeline, useCreateStage, useDeletePipeline } from '@/hooks/use-stages';
import type { PipelineLead, StageWithLeads } from '@/hooks/use-stages';
import { useLoadMoreLeads } from '@/hooks/use-stages';
import { useOrganizationUsers } from '@/hooks/use-users';
import { useTags } from '@/hooks/use-tags';
import { useAssignLeadRoundRobin } from '@/hooks/use-assign-lead-roundrobin';
import { useIsMobile } from '@/hooks/use-mobile';
import { useCanEditCadences } from '@/hooks/use-can-edit-cadences';
import { useLeadVisibility } from '@/hooks/use-lead-visibility';
import { useUserPermissions } from '@/hooks/use-user-permissions';

import { useHasPermission } from '@/hooks/use-organization-roles';
import { notifyLeadRealtimeChange } from '@/contexts/LeadRealtimeBus';
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
const PipelineSlaSettings = dynamic(
  () => import('@/components/features/pipelines/PipelineSlaSettings').then((mod) => mod.PipelineSlaSettings),
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

function reconcileMovedLeadInBoard(
  current: StageWithLeads[] | undefined,
  leadId: string,
  movedLead: Partial<PipelineLead>,
  filterDealStatus?: string,
) {
  if (!current) return current;

  const responseStatus = isPipelineDealStatus(movedLead.deal_status) ? movedLead.deal_status : null;
  return current.map((stage) => {
    if (!Array.isArray(stage.leads)) return stage;

    let stageChanged = false;
    let removedFromStage = false;
    const nextLeads = stage.leads.reduce<PipelineLead[]>((acc, lead) => {
      if (lead.id !== leadId) {
        acc.push(lead);
        return acc;
      }

      stageChanged = true;
      if (!shouldKeepLeadForDealStatusFilter(responseStatus, filterDealStatus)) {
        removedFromStage = true;
        return acc;
      }

      acc.push(mergeMovedLeadResponse(lead, movedLead));
      return acc;
    }, []);

    if (!stageChanged) return stage;
    if (!removedFromStage) {
      return { ...stage, leads: nextLeads };
    }

    const totalLeadCount = Number(stage.total_lead_count ?? stage.leads.length);
    const nextTotal = Math.max(totalLeadCount - 1, 0);

    return {
      ...stage,
      leads: nextLeads,
      total_lead_count: nextTotal,
      has_more: nextTotal > nextLeads.length,
    };
  });
}

function restoreLeadFromBoardSnapshot(
  current: StageWithLeads[] | undefined,
  snapshot: StageWithLeads[] | undefined,
  leadId: string,
) {
  if (!snapshot) return current;
  if (!current) return snapshot;

  let snapshotStageId: string | null = null;
  let snapshotLeadIndex = -1;
  let snapshotLead: PipelineLead | null = null;

  for (const stage of snapshot) {
    const leadIndex = stage.leads?.findIndex((lead) => lead.id === leadId) ?? -1;
    if (leadIndex === -1) continue;

    snapshotStageId = stage.id;
    snapshotLeadIndex = leadIndex;
    snapshotLead = stage.leads[leadIndex];
    break;
  }

  if (!snapshotStageId || !snapshotLead) return current;

  let currentStageId: string | null = null;
  const stagesWithoutLead = current.map((stage) => {
    if (!Array.isArray(stage.leads)) return stage;

    const nextLeads = stage.leads.filter((lead) => {
      if (lead.id !== leadId) return true;
      currentStageId = stage.id;
      return false;
    });

    return nextLeads.length === stage.leads.length ? stage : { ...stage, leads: nextLeads };
  });

  const targetStageIndex = stagesWithoutLead.findIndex((stage) => stage.id === snapshotStageId);
  if (targetStageIndex === -1) return current;

  const targetStage = stagesWithoutLead[targetStageIndex];
  const targetLeads = [...(targetStage.leads || [])];
  targetLeads.splice(Math.min(snapshotLeadIndex, targetLeads.length), 0, snapshotLead);

  return stagesWithoutLead.map((stage, index) => {
    const isTargetStage = index === targetStageIndex;
    const leads = isTargetStage ? targetLeads : stage.leads;
    let countDelta = 0;

    if (isTargetStage && currentStageId !== snapshotStageId) {
      countDelta += 1;
    }
    if (currentStageId && stage.id === currentStageId && currentStageId !== snapshotStageId) {
      countDelta -= 1;
    }

    if (!isTargetStage && countDelta === 0) return stage;

    const leadCount = Array.isArray(leads) ? leads.length : 0;
    const totalLeadCount = Math.max(Number(stage.total_lead_count ?? stage.leads?.length ?? leadCount) + countDelta, leadCount);

    return {
      ...stage,
      leads,
      total_lead_count: totalLeadCount,
      has_more: totalLeadCount > leadCount,
    };
  });
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
          <DialogContent className="app-card max-w-md rounded-[6px] text-[var(--app-text-primary)]">
            <DialogHeader>
              <DialogTitle className="font-extralight tracking-wide text-foreground">{chunkError ? 'Aplicativo atualizado' : 'Não foi possível abrir o lead'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-sm font-extralight tracking-wide text-muted-foreground">
              <p>{chunkError ? 'Uma versão nova do Vimob foi publicada. Recarregue para continuar com os arquivos atualizados.' : 'O lead não pôde ser carregado agora. Feche esta janela e tente novamente.'}</p>
              <Button onClick={chunkError ? () => window.location.reload() : this.props.onClose} className="h-12 w-full rounded-[6px] border-0 bg-transparent text-[12px] font-extralight uppercase tracking-[0.08em] text-muted-foreground hover:bg-[var(--app-surface-hover)] hover:text-foreground">{chunkError ? 'Recarregar' : 'Fechar'}</Button>
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
  const { hasPermission } = useUserPermissions();
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
  const [settingsStage, setSettingsStage] = useState<StageWithLeads | null>(null);
  const [newPipelineDialogOpen, setNewPipelineDialogOpen] = useState(false);
  const [newPipelineName, setNewPipelineName] = useState('');
  const [newStageDialogOpen, setNewStageDialogOpen] = useState(false);
  const [newStageName, setNewStageName] = useState('');
  const [newStageColor, setNewStageColor] = useState('#6b7280');
  const [pipelineToDelete, setPipelineToDelete] = useState<{ id: string; name: string } | null>(null);
  const [slaSettingsOpen, setSlaSettingsOpen] = useState(false);
  const [stagesEditorOpen, setStagesEditorOpen] = useState(false);
  const dateRange = sharedFilters.dateRange;

  const [isRefreshing, setIsRefreshing] = useState(false);

  const isDraggingRef = useRef(false);
  const latestMoveVersionByLeadRef = useRef(new Map<string, number>());
  const nextMovePersistenceStartAtRef = useRef(0);

  const { data: pipelines = [], isLoading: pipelinesLoading } = usePipelines();
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
    if (!selectedPipelineId) return;

    try {
      window.localStorage.setItem(selectedPipelineStorageKey, selectedPipelineId);
    } catch {
      // localStorage can be unavailable in restricted browser contexts.
    }
  }, [selectedPipelineId, selectedPipelineStorageKey]);

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

  const { isLoading: permissionLoading } = useHasPermission('lead_view_all');
  const { data: leadVisibility, isLoading: leadVisibilityLoading } = useLeadVisibility(profile?.id);
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

  const { data: baseStages = [], isLoading: baseStagesLoading } = useStages(selectedPipelineId || undefined);
  const { data: stageAutomations = [] } = useStageAutomations();

  const shouldLoadPipelineLeads = !!selectedPipelineId && filterUser !== null && !permissionLoading && !leadVisibilityLoading && !!leadVisibility;
  const deferredSearchQuery = useDeferredValue(searchQuery);

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
    {
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
    { enabled: shouldLoadPipelineLeads }
  );

  const stages = useMemo<StageWithLeads[]>(() => {
    if (stagesWithLeads.length > 0) return stagesWithLeads;
    return baseStages.map(s => ({ ...s, leads: [] as PipelineLead[], total_lead_count: s.lead_count || 0, has_more: false }));
  }, [baseStages, stagesWithLeads]);

  useEffect(() => {
    if (!leadsError || !shouldLoadPipelineLeads) return;

    const retryTimer = window.setTimeout(() => {
      void refetch();
    }, 2500);

    return () => window.clearTimeout(retryTimer);
  }, [leadsError, refetch, shouldLoadPipelineLeads]);

  const shouldLoadLeadDialogResources = Boolean(selectedLead);
  const { data: users = [] } = useOrganizationUsers({ enabled: shouldLoadLeadDialogResources });
  const { data: allTags = [] } = useTags({ enabled: shouldLoadLeadDialogResources });
  const assignLeadRoundRobin = useAssignLeadRoundRobin();
  const assignLeadRoundRobinMutate = assignLeadRoundRobin.mutate;
  const shouldLoadPipelineManagementAccess = Boolean(selectedPipelineId) && (!leadsLoading || stagesWithLeads.length > 0);
  const canEditPipeline = useCanEditCadences({ enabled: shouldLoadPipelineManagementAccess });
  const isMobile = useIsMobile();
  const [activeMobileStageId, setActiveMobileStageId] = useState<string | null>(null);

  const currentPipeline = pipelines.find(p => p.id === selectedPipelineId);
  const isLoading = pipelinesLoading || baseStagesLoading;
  const isInitialLeadsLoading = leadsLoading && stagesWithLeads.length === 0;
  const isPipelineBoardTransitioning = shouldLoadPipelineLeads && (isInitialLeadsLoading || leadsPlaceholderData);
  const isPipelineBoardRetrying = leadsError && !isPipelineBoardTransitioning && !leadsFetching;
  const canShowColumnActions = canEditPipeline && Boolean(selectedPipelineId) && !isMobile && !isLoading;

  const handleDragStart = useCallback(() => {
    isDraggingRef.current = true;
  }, []);

  const handleOpenLead = useCallback((lead: PipelineLead | { id: string }) => {
    setSelectedLead(lead as PipelineLead);
  }, []);

  const handleAssignLeadNow = useCallback((leadId: string) => {
    assignLeadRoundRobinMutate(leadId);
  }, [assignLeadRoundRobinMutate]);

  const enqueueLeadMovePersistence = useCallback((task: () => Promise<void>) => {
    const now = Date.now();
    const scheduledAt = Math.max(now, nextMovePersistenceStartAtRef.current + PIPELINE_MOVE_PERSISTENCE_INTERVAL_MS);
    nextMovePersistenceStartAtRef.current = scheduledAt;

    return (async () => {
      const delayMs = scheduledAt - Date.now();
      if (delayMs > 0) await wait(delayMs);
      await task();
    })();
  }, []);

  const handleLoadMore = useCallback((stageId: string) => {
    if (!selectedPipelineId) return;
    const stage = stages.find(s => s.id === stageId);
    if (!stage) return;
    const currentCount = stage.leads.length || 0;

    loadMoreLeads.mutate({
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
    });
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
      router.replace(`/crm/pipelines${cleanSearch ? `?${cleanSearch}` : ''}`);
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
        const [enrichment] = await getLeadEnrichments([leadRow.id], activeOrganizationId);

        if (cancelled) return;

        const formattedLead: PipelineLead = {
          ...leadRow,
          assignee: enrichment?.assignee || null,
          interest_property: enrichment?.interest_property || null,
          lead_meta: enrichment?.lead_meta || [],
          tags: enrichment?.tags || [],
          tasks_count: enrichment?.tasks_count || { pending: 0, completed: 0 },
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

  const executeLeadMove = useCallback((
    result: DropResult,
    options?: { isOwnResource?: boolean }
  ) => {
    isDraggingRef.current = true;

    const { destination, source, draggableId } = result;
    if (!destination) {
      isDraggingRef.current = false;
      return;
    }

    const newStageId = destination.droppableId;
    const oldStageId = source.droppableId;
    const isSameStage = newStageId === oldStageId;
    const newStage = stages.find(s => s.id === newStageId);
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

    const dateFromISO = dateRange.from.toISOString();
    const dateToISO = dateRange.to.toISOString();
    const effectiveFilterTag = filterTag !== 'all' ? filterTag : undefined;
    const effectiveFilterDealStatus = filterDealStatus && filterDealStatus !== 'all' ? filterDealStatus : undefined;
    const effectiveSearchQuery = deferredSearchQuery || undefined;
    const effectiveFilterCampaign = filterCampaign !== 'all' ? filterCampaign : undefined;
    const effectiveFilterAdSet = filterAdSet !== 'all' ? filterAdSet : undefined;
    const effectiveFilterAd = filterAd !== 'all' ? filterAd : undefined;
    const effectiveFilterSource = filterSource !== 'all' ? filterSource : undefined;
    const effectiveFilterUser = effectivePipelineFilterUser;
    const effectiveScopedUserIds = effectivePipelineFilterUserIds?.join(',');
    const shouldKeepOptimisticMovedLead =
      isSameStage || shouldKeepLeadForDealStatusFilter(optimisticMovedDealStatus, effectiveFilterDealStatus);

    const queryKey = [
      'stages-with-leads',
      activeOrganizationId,
      selectedPipelineId,
      effectiveFilterUser,
      dateFromISO,
      dateToISO,
      effectiveFilterTag,
      effectiveFilterDealStatus,
      effectiveSearchQuery,
      effectiveFilterCampaign,
      effectiveFilterAdSet,
      effectiveFilterAd,
      effectiveFilterSource,
      effectiveScopedUserIds
    ];
    const previousData = queryClient.getQueryData<StageWithLeads[]>(queryKey);
    const moveVersion = (latestMoveVersionByLeadRef.current.get(draggableId) ?? 0) + 1;
    latestMoveVersionByLeadRef.current.set(draggableId, moveVersion);
    const isLatestMoveForLead = () => latestMoveVersionByLeadRef.current.get(draggableId) === moveVersion;

    void queryClient.cancelQueries({ queryKey, exact: true });
    queryClient.setQueryData<StageWithLeads[]>(queryKey, (old) => {
      if (!old) return old;

      const sourceStageIndex = old.findIndex(s => s.id === oldStageId);
      const destStageIndex = old.findIndex(s => s.id === newStageId);

      if (sourceStageIndex === -1 || destStageIndex === -1) return old;

      const newStages = old.map(stage => ({
        ...stage,
        leads: [...(stage.leads || [])],
      }));

      const leadIndex = newStages[sourceStageIndex].leads.findIndex((lead) => lead.id === draggableId);
      if (leadIndex === -1) return old;

      const [movedLead] = newStages[sourceStageIndex].leads.splice(leadIndex, 1);
      const targetIndex = Math.min(destination.index, newStages[destStageIndex].leads.length);
      const nextBoardOrderAt = getBoardOrderAtForIndex(newStages[destStageIndex].leads, targetIndex);

      const updatedLead = {
        ...movedLead,
        stage_id: newStageId,
        stage_entered_at: isSameStage ? movedLead.stage_entered_at : new Date().toISOString(),
        board_order_at: nextBoardOrderAt,
        stage: newStages[destStageIndex],
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

      if (shouldKeepOptimisticMovedLead) {
        newStages[destStageIndex].leads.splice(targetIndex, 0, updatedLead);
      }
      if (!isSameStage) {
        newStages[sourceStageIndex].total_lead_count = Math.max((newStages[sourceStageIndex].total_lead_count || 0) - 1, 0);
        if (shouldKeepOptimisticMovedLead) {
          newStages[destStageIndex].total_lead_count = (newStages[destStageIndex].total_lead_count || 0) + 1;
        }
      }
      newStages[sourceStageIndex].has_more = (newStages[sourceStageIndex].total_lead_count || 0) > newStages[sourceStageIndex].leads.length;
      newStages[destStageIndex].has_more = (newStages[destStageIndex].total_lead_count || 0) > newStages[destStageIndex].leads.length;

      return newStages;
    });

    window.setTimeout(() => {
      if (isLatestMoveForLead()) {
        isDraggingRef.current = false;
      }
    }, 150);

    void enqueueLeadMovePersistence(async () => {
      const currentStages = queryClient.getQueryData<StageWithLeads[]>(queryKey) || stages;
      const persistedStage = currentStages.find((stage) => stage.id === newStageId);
      const persistedLead = persistedStage?.leads?.find((lead) => lead.id === draggableId);
      const persistedBoardOrderAt = persistedLead?.board_order_at || new Date().toISOString();

      const updateResult = await leadsAPI.moveLeadStage(draggableId, {
        stageId: newStageId,
        isOwnResource: options?.isOwnResource ?? null,
        boardOrderAt: persistedBoardOrderAt,
      }, realtimeOrganizationId);

      if (updateResult.error) throw updateResult.error;

      if (!isLatestMoveForLead()) return;

      const movedLeadFromRpc = updateResult.data as unknown as Partial<PipelineLead> | null;
      if (movedLeadFromRpc) {
        queryClient.setQueryData<StageWithLeads[]>(queryKey, (old) =>
          reconcileMovedLeadInBoard(old, draggableId, movedLeadFromRpc, effectiveFilterDealStatus),
        );
      }

      notifyLeadRealtimeChange({
        organizationId: realtimeOrganizationId,
        leadId: draggableId,
        reason: isSameStage ? 'pipeline.order' : 'pipeline.stage',
      });

      if (isSameStage) {
        queryClient.invalidateQueries({ queryKey: ['stages-with-leads'], refetchType: 'none' });
        return;
      }

      queryClient.invalidateQueries({ queryKey: ['activities', draggableId] });
      queryClient.invalidateQueries({ queryKey: ['lead-timeline', draggableId] });
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
    }).catch((error: unknown) => {
      if (!isLatestMoveForLead()) return;

      queryClient.setQueryData<StageWithLeads[]>(queryKey, (current) =>
        restoreLeadFromBoardSnapshot(current, previousData, draggableId),
      );
      const rateLimitMessage = getClientRateLimitMessage(error);
      toast.error(rateLimitMessage || 'Erro ao mover lead: ' + getErrorMessage(error));
    });
  }, [stages, stageAutomations, dateRange, filterTag, filterDealStatus, deferredSearchQuery, filterCampaign, filterAdSet, filterAd, filterSource, selectedPipelineId, activeOrganizationId, effectivePipelineFilterUser, effectivePipelineFilterUserIds, queryClient, realtimeOrganizationId, enqueueLeadMovePersistence]);

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
      await refetch();
      toast.success('Atualizado!', { duration: 1500 });
    } finally {
      setIsRefreshing(false);
    }
  }, [refetch]);

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
    if (!editingStageName.trim()) {
      setEditingStageId(null);
      return;
    }

    try {
      await pipelinesAPI.updateStage(stageId, { name: editingStageName.trim() }, organization?.id || profile?.organization_id || undefined);
      toast.success('Nome atualizado!');
      refetch();
    } catch (error: unknown) {
      toast.error('Erro: ' + getErrorMessage(error));
    }
    setEditingStageId(null);
  };

  const deferredSearch = deferredSearchQuery;
  const hasMoreLeads = stages.some((stage) => stage.has_more);
  const [serverSearchResults, setServerSearchResults] = useState<PipelineLead[]>([]);
  const [, setIsServerSearching] = useState(false);

  useEffect(() => {
    if (!deferredSearch || !hasMoreLeads || !selectedPipelineId) {
      let isActive = true;
      queueMicrotask(() => {
        if (isActive) setServerSearchResults([]);
      });

      return () => {
        isActive = false;
      };
    }

    let cancelled = false;
    const doSearch = async () => {
      setIsServerSearching(true);
      try {
        const searchedStages = await getPipelineBoard({
          organizationId: activeOrganizationId,
          pipelineId: selectedPipelineId,
          filters: {
            searchQuery: deferredSearch,
            filterTag: filterTag && filterTag !== 'all' ? filterTag : undefined,
            filterDealStatus: filterDealStatus && filterDealStatus !== 'all' ? filterDealStatus : undefined,
            filterCampaign: filterCampaign && filterCampaign !== 'all' ? filterCampaign : undefined,
            filterAdSet: filterAdSet && filterAdSet !== 'all' ? filterAdSet : undefined,
            filterAd: filterAd && filterAd !== 'all' ? filterAd : undefined,
            filterSource: filterSource && filterSource !== 'all' ? filterSource : undefined,
            filterUserIds: effectivePipelineFilterUserIds,
          },
          limit: 50,
        });

        if (!cancelled) {
          setServerSearchResults(searchedStages.flatMap((stage) => stage.leads) as PipelineLead[]);
        }
      } catch {
      } finally {
        if (!cancelled) setIsServerSearching(false);
      }
    };

    doSearch();
    return () => { cancelled = true; };
  }, [activeOrganizationId, deferredSearch, hasMoreLeads, selectedPipelineId, filterTag, filterDealStatus, filterCampaign, filterAdSet, filterAd, filterSource, effectivePipelineFilterUserIds]);

  const filteredStages = useMemo<StageWithLeads[]>(() => {
    return stages.map(stage => {
      let stageLeads: PipelineLead[] = [...(stage.leads || [])];

      if (searchQuery) {
        const lowerSearch = normalizeSearchText(searchQuery);
        stageLeads = stageLeads.filter((lead) => {
          const nameMatch = searchTextIncludes(lead.name, lowerSearch);
          const phoneMatch = (lead.phone || '').includes(lowerSearch);
          const emailMatch = searchTextIncludes(lead.email, lowerSearch);
          return nameMatch || phoneMatch || emailMatch;
        });
      }

      if (deferredSearch && serverSearchResults.length > 0) {
        const loadedIds = new Set(stageLeads.map((lead) => lead.id));
        const extraLeads = serverSearchResults.filter(
          (lead) => lead.stage_id === stage.id && !loadedIds.has(lead.id)
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
      color: settingsStage.color || '#6b7280',
      stage_key: settingsStage.stage_key || '',
      pipeline_id: settingsStage.pipeline_id || undefined,
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
    if (!newPipelineName.trim()) return;

    try {
      const pipeline = await createPipeline.mutateAsync({ name: newPipelineName.trim() });
      handleSelectPipeline(pipeline.id);
      setNewPipelineDialogOpen(false);
      setNewPipelineName('');
      toast.success('Pipeline criada com sucesso!');
    } catch (error: unknown) {
      toast.error('Erro ao criar pipeline: ' + getErrorMessage(error));
    }
  };

  const handleDeletePipeline = async () => {
    if (!pipelineToDelete) return;

    try {
      await deletePipeline.mutateAsync(pipelineToDelete.id);
      const nextPipeline = pipelines.find((pipeline) => pipeline.id !== pipelineToDelete.id) || null;

      if (selectedPipelineId === pipelineToDelete.id) {
        handleSelectPipeline(nextPipeline?.id || null);
      }

      setPipelineToDelete(null);
      toast.success('Pipeline excluída com sucesso!');
    } catch (error: unknown) {
      toast.error('Erro ao excluir pipeline: ' + getErrorMessage(error));
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
              <div className="flex h-8 min-w-0 items-center overflow-hidden rounded-[6px] bg-[var(--app-surface)] text-[var(--app-text-primary)]">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button data-tour="pipeline-selector" variant="ghost" className="h-8 min-w-0 gap-2 rounded-none border-0 bg-transparent px-2.5 font-extralight tracking-wide text-[var(--app-text-primary)] shadow-none transition-colors hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)] focus-visible:ring-1 focus-visible:ring-primary/30">
                      <LayoutGrid className="h-4 w-4 text-[#FF4529]" />
                      <span className="truncate max-w-[96px] sm:max-w-[200px]">{currentPipeline?.name || 'Pipeline'}</span>
                      <ChevronDown className="h-3 w-3 text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    sideOffset={8}
                    collisionPadding={12}
                    className="pipeline-selector-menu w-64 overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-0 text-[var(--app-text-primary)]"
                  >
                    <p className="px-3 pb-1.5 pt-3 text-[10px] font-extralight text-muted-foreground uppercase tracking-widest">Suas Pipelines</p>
                    <div className="pipeline-selector-scroll max-h-[320px] overflow-y-auto px-1 pb-1">
                      {pipelines.map(pipeline => (
                        <DropdownMenuItem
                          key={pipeline.id}
                          onSelect={() => handleSelectPipeline(pipeline.id)}
                          className={cn(
                            "group flex cursor-pointer items-center justify-between gap-2 rounded-[6px] py-2 pl-2 pr-1 text-muted-foreground outline-none hover:bg-[var(--app-surface-hover)] focus:bg-[var(--app-surface-hover)] focus:text-foreground font-extralight tracking-wide",
                            pipeline.id === selectedPipelineId && "bg-[var(--app-surface-soft)] text-[#FF4529] font-normal focus:text-[#FF4529]"
                          )}
                        >
                          <span className="min-w-0 flex-1 truncate">{pipeline.name}</span>
                          <span className="flex h-6 shrink-0 items-center gap-1">
                            {pipeline.id === selectedPipelineId && <Check className="h-3.5 w-3.5" />}
                            {canEditPipeline && (
                              <button
                                type="button"
                                aria-label={`Excluir pipeline ${pipeline.name}`}
                                className="inline-flex h-6 w-6 items-center justify-center rounded-[6px] text-muted-foreground opacity-0 transition-colors hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus:opacity-100"
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  setPipelineToDelete({ id: pipeline.id, name: pipeline.name });
                                }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </span>
                        </DropdownMenuItem>
                      ))}
                    </div>
                    {canEditPipeline && (
                      <>
                        <DropdownMenuSeparator className="my-1 bg-[var(--app-border)]" />
                        <DropdownMenuItem
                          onClick={() => setNewPipelineDialogOpen(true)}
                          className="cursor-pointer rounded-[6px] bg-primary/10 py-2 font-extralight tracking-wide text-primary hover:bg-primary/15 focus:bg-primary/15 focus:text-primary"
                        >
                          <Plus className="h-4 w-4 mr-2" />
                          Nova Pipeline
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>

                {canShowColumnActions && (
                  <>
                    <div className="h-4 w-px bg-[var(--app-border)]" />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-none border-0 bg-transparent text-muted-foreground shadow-none transition-colors hover:bg-[var(--app-surface-hover)] hover:text-foreground focus-visible:ring-1 focus-visible:ring-primary/30"
                      onClick={() => setStagesEditorOpen(true)}
                      disabled={!selectedPipelineId}
                      title="Configurar colunas"
                    >
                      <Settings className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              </div>
            </div>

            <div className="flex min-w-0 flex-nowrap items-center justify-end gap-2">
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
                />
              </div>

              <Button
                data-tour="pipeline-refresh"
                variant="outline"
                size="icon"
                className={cn(
                  "h-8 w-8 shrink-0 rounded-[6px] border-0 bg-[var(--app-surface)] text-muted-foreground shadow-none transition-colors hover:bg-[var(--app-surface-hover)] hover:text-foreground",
                  isRefreshing && "bg-primary/10 text-[#FF4529]"
                )}
                onClick={handleManualRefresh}
                disabled={isRefreshing}
                title="Atualizar pipeline"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} />
              </Button>

              {!isMobile && canCreateLeads && (
                <Button
                  data-tour="pipeline-new-lead"
                  size="sm"
                  className="h-8 px-4 bg-[#FF4529] text-[11px] font-extralight uppercase tracking-[0.08em] text-white outline-none transition-opacity hover:opacity-90 rounded-[6px]"
                  onClick={() => openNewLeadDialog()}
                >
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  {newButtonLabel}
                </Button>
              )}
            </div>
          </div>
        </div>

        {stages.length === 0 && (
          <Card className="app-card mx-2">
            <CardContent className="py-12 text-center">
              <h3 className="mb-2 font-extralight tracking-wide text-foreground">
                {isLoading
                  ? "Carregando estrutura do pipeline"
                  : selectedPipelineId
                    ? "Nenhum estágio configurado"
                    : "Nenhuma pipeline configurada"}
              </h3>
              <p className="text-muted-foreground text-sm font-extralight">
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
          {isPipelineBoardTransitioning && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-[var(--app-bg)]/70 backdrop-blur-[2px]">
              <div className="flex items-center gap-2 rounded-[8px] bg-[var(--app-surface-solid)] px-4 py-3 text-xs font-extralight tracking-wide text-[var(--app-text-primary)] shadow-[0_18px_40px_rgb(0_0_0_/_0.18)]">
                <Loader2 className="h-4 w-4 animate-spin text-[#FF4529]" />
                <span>{leadsPlaceholderData ? 'Carregando pipeline...' : 'Carregando leads...'}</span>
              </div>
            </div>
          )}

          {isPipelineBoardRetrying && (
            <div className="absolute right-3 top-2 z-30 flex items-center gap-2 rounded-[8px] bg-amber-500/12 px-3 py-2 text-[11px] font-extralight tracking-wide text-amber-700 ring-1 ring-amber-500/25 dark:text-amber-200">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              <span>API demorou. Tentando atualizar novamente...</span>
            </div>
          )}

          {isMobile && filteredStages.length > 1 && hasPreviousMobileStage && (
            <button
              type="button"
              aria-label="Ver coluna anterior"
              className="absolute left-2 top-1/2 z-20 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-[7px] border-0 bg-[#FF4529] text-white shadow-[0_6px_14px_rgb(255_69_41_/_0.14)] outline-none transition-all hover:bg-[#ff5a42] focus-visible:ring-2 focus-visible:ring-primary/35"
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
                "absolute right-2 top-1/2 z-20 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-[7px] border-0 bg-[#FF4529] text-white shadow-[0_6px_14px_rgb(255_69_41_/_0.14)] outline-none transition-all hover:bg-[#ff5a42] focus-visible:ring-2 focus-visible:ring-primary/35",
                !hasNextMobileStage && "cursor-not-allowed opacity-35 hover:bg-[#FF4529]"
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
                    "flex-shrink-0 flex h-full flex-col overflow-hidden rounded-[6px] border-0 bg-[var(--app-surface)]",
                    isMobile ? "w-full min-w-0" : "w-[280px] sm:w-72"
                  )}
                >
                  <div
                    className="flex items-center justify-between border-b border-[var(--app-border)] px-3 py-2"
                  >
                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                      <div
                        className="h-2.5 w-2.5 rounded-full shrink-0 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]"
                        style={{ backgroundColor: stage.color || '#6b7280' }}
                      />
                      {editingStageId === stage.id && canEditPipeline ? (
                        <Input
                          value={editingStageName}
                          onChange={(e) => setEditingStageName(e.target.value)}
                          onBlur={() => handleStageName(stage.id)}
                          onKeyDown={(e) => e.key === 'Enter' && handleStageName(stage.id)}
                          className="h-7 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-2 !text-[13px] font-extralight text-foreground focus:border-[#FF4529]"
                          autoFocus
                        />
                      ) : (
                        <h3
                          className={cn(
                            "truncate !text-[13px] font-extralight tracking-wide text-foreground transition-colors",
                            canEditPipeline && "cursor-pointer hover:text-[#FF4529]"
                          )}
                          onClick={() => {
                            if (canEditPipeline) {
                              setEditingStageId(stage.id);
                              setEditingStageName(stage.name);
                            }
                          }}
                        >
                          {stage.name}
                        </h3>
                      )}
                      <Badge
                        variant="secondary"
                        className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-[4px] border-0 bg-[var(--app-surface-soft)] px-1.5 py-0 !text-[11px] font-extralight text-muted-foreground"
                      >
                        {stageCountMetaMap.get(stage.id)?.total ?? stage.total_lead_count ?? stage.leads.length ?? 0}
                      </Badge>
                      {(stageValueMap.get(stage.id)?.totalValue || 0) > 0 ? (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge
                                variant="secondary"
                                className="flex h-[18px] shrink-0 items-center rounded-[4px] border-0 bg-[#FF4529] px-1.5 py-0 !text-[11px] font-extralight text-white shadow-none"
                              >
                                {formatCompactCurrency(stageValueMap.get(stage.id)?.totalValue || 0)}
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent className="app-card rounded-[6px] text-foreground">
                              <p className="text-xs font-extralight">Valor total dos leads neste estágio</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        data-tour={stageIndex === 0 ? "pipeline-column-settings" : undefined}
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground hover:bg-[var(--app-surface-hover)] rounded-[6px]"
                        onClick={() => setSettingsStage(stage)}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                      <Button
                        data-tour={stageIndex === 0 ? "pipeline-column-new-lead" : undefined}
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground hover:bg-[var(--app-surface-hover)] rounded-[6px]"
                        onClick={() => openNewLeadDialog(stage.id)}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
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
                          className="w-full text-xs font-extralight tracking-wide text-muted-foreground hover:text-foreground hover:bg-[var(--app-surface-hover)] rounded-[6px]"
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
                  className="group flex h-full min-h-[360px] w-[280px] flex-shrink-0 items-center justify-center rounded-[6px] border border-dashed border-[var(--app-border)] bg-transparent text-muted-foreground opacity-60 outline-none transition-all duration-200 hover:border-primary/40 hover:bg-[var(--app-surface-soft)] hover:text-primary hover:opacity-100 focus-visible:ring-1 focus-visible:ring-primary/30 sm:w-72"
                  aria-label="Criar nova coluna"
                >
                  <span className="inline-flex items-center gap-2 rounded-[6px] bg-[var(--app-surface)] px-4 py-2 text-sm font-extralight tracking-wide transition-colors group-hover:bg-primary/10">
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

        <Dialog open={newPipelineDialogOpen} onOpenChange={setNewPipelineDialogOpen}>
            <DialogContent className="max-w-sm w-[90%] sm:w-full rounded-[6px] border-0 bg-[var(--app-surface-solid)] text-[var(--app-text-primary)]">
            <DialogHeader>
              <DialogTitle className="font-extralight tracking-wide">Nova Pipeline</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreatePipeline} className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label className="text-sm font-extralight tracking-wide text-foreground">Nome da Pipeline *</Label>
                <Input
                  value={newPipelineName}
                  onChange={(e) => setNewPipelineName(e.target.value)}
                  placeholder="Ex: Locação, Vendas..."
                  required
                  autoFocus
                  className="h-12 w-full rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-4 text-sm font-extralight tracking-wide text-foreground placeholder:text-muted-foreground outline-none transition-colors focus:border-[#FF4529]"
                />
              </div>
              <div className="flex gap-3 pt-4">
                <Button type="button" variant="outline" className="h-12 w-[40%] rounded-[6px] border-0 text-[12px] font-extralight uppercase tracking-[0.08em] text-muted-foreground bg-transparent hover:bg-[var(--app-surface-hover)] hover:text-foreground focus-visible:border-[#FF4529]" onClick={() => setNewPipelineDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" className="h-12 w-[60%] rounded-[6px] bg-[#FF4529] text-[12px] font-extralight uppercase tracking-[0.08em] text-white outline-none transition-opacity hover:opacity-90 disabled:opacity-50" disabled={createPipeline.isPending}>
                  {createPipeline.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Criar Pipeline
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog open={newStageDialogOpen} onOpenChange={setNewStageDialogOpen}>
          <DialogContent className="w-[90%] sm:max-w-sm sm:w-full rounded-[6px] border-0 bg-[var(--app-surface-solid)] text-[var(--app-text-primary)]">
            <DialogHeader>
              <DialogTitle className="font-extralight tracking-wide">Nova Coluna</DialogTitle>
            </DialogHeader>
            <form onSubmit={async (e) => {
              e.preventDefault();
              if (!newStageName.trim() || !selectedPipelineId) return;

              try {
                await createStage.mutateAsync({
                  pipelineId: selectedPipelineId,
                  name: newStageName.trim(),
                  color: newStageColor,
                });
                await refetch();
                setNewStageDialogOpen(false);
                setNewStageName('');
                setNewStageColor('#6b7280');
                toast.success('Coluna criada com sucesso!');
              } catch (error: unknown) {
                toast.error('Erro ao criar coluna: ' + getErrorMessage(error));
              }
            }} className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label className="text-sm font-extralight tracking-wide text-foreground">Nome da Coluna *</Label>
                <Input
                  value={newStageName}
                  onChange={(e) => setNewStageName(e.target.value)}
                  placeholder="Ex: Qualificado, Em Negociação..."
                  required
                  autoFocus
                  className="h-12 w-full rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-4 text-sm font-extralight tracking-wide text-foreground placeholder:text-muted-foreground outline-none transition-colors focus:border-[#FF4529]"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-extralight tracking-wide text-foreground">Cor</Label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={newStageColor}
                    onChange={(e) => setNewStageColor(e.target.value)}
                    className="w-12 h-12 rounded-[6px] cursor-pointer border-0 bg-[var(--app-surface-soft)] p-1"
                  />
                  <Input
                    value={newStageColor}
                    onChange={(e) => setNewStageColor(e.target.value)}
                    placeholder="#6b7280"
                    className="h-12 flex-1 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-4 text-sm font-extralight tracking-wide text-foreground placeholder:text-muted-foreground outline-none transition-colors focus:border-[#FF4529]"
                  />
                </div>
              </div>
              <div className="flex gap-3 pt-4">
                <Button type="button" variant="outline" className="h-12 w-[40%] rounded-[6px] border-0 text-[12px] font-extralight uppercase tracking-[0.08em] text-muted-foreground bg-transparent hover:bg-[var(--app-surface-hover)] hover:text-foreground focus-visible:border-[#FF4529]" onClick={() => setNewStageDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" className="h-12 w-[60%] rounded-[6px] bg-[#FF4529] text-[12px] font-extralight uppercase tracking-[0.08em] text-white outline-none transition-opacity hover:opacity-90 disabled:opacity-50" disabled={createStage.isPending}>
                  {createStage.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Criar Coluna
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {selectedPipelineId && slaSettingsOpen && (
          <PipelineSlaSettings
            open={slaSettingsOpen}
            onOpenChange={setSlaSettingsOpen}
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
              color: s.color || '#6b7280',
              position: s.position,
              lead_count: s.leads.length || 0,
              stage_key: s.stage_key || undefined,
            }))}
            onStagesUpdated={() => refetch()}
          />
        )}
        <AlertDialog open={!!pipelineToDelete} onOpenChange={(open) => !open && setPipelineToDelete(null)}>
          <AlertDialogContent className="w-[90%] sm:max-w-md rounded-[8px] border-0 bg-[var(--app-surface-solid)] text-[var(--app-text-primary)] shadow-none">
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir pipeline?</AlertDialogTitle>
              <AlertDialogDescription>
                A pipeline &quot;{pipelineToDelete?.name}&quot; será removida. Se ela tiver leads, o sistema vai bloquear a exclusão para proteger os dados.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="rounded-[6px] border-0 bg-transparent hover:bg-[var(--app-surface-hover)]">
                Cancelar
              </AlertDialogCancel>
              <AlertDialogAction
                className="rounded-[6px] bg-destructive text-destructive-foreground hover:bg-destructive/90"
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
