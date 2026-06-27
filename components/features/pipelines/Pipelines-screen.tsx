"use client";

import { Component, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { useDeferredValue } from 'react';
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
import { StageSettingsDialog } from '@/components/features/pipelines/StageSettingsDialog';
import { PipelineSlaSettings } from '@/components/features/pipelines/PipelineSlaSettings';
import { StagesEditorDialog } from '@/components/features/pipelines/StagesEditorDialog';
import { SharedFilters } from '@/components/shared/SharedFilters';
import { useSharedFilters } from '@/hooks/use-shared-filters';

import { LeadCard } from '@/components/features/leads/LeadCard';
import { LeadDetailDialog } from '@/components/features/leads/LeadDetailDialog';

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
import { CreateLeadDialog } from '@/components/features/leads/CreateLeadDialog';
import { useOrganizationUsers } from '@/hooks/use-users';
import { useTags } from '@/hooks/use-tags';
import { useAssignLeadRoundRobin } from '@/hooks/use-assign-lead-roundrobin';
import { useIsMobile } from '@/hooks/use-mobile';
import { useCanEditCadences } from '@/hooks/use-can-edit-cadences';
import { useLeadVisibility } from '@/hooks/use-lead-visibility';

import { useHasPermission } from '@/hooks/use-organization-roles';
import { notifyLeadRealtimeChange } from '@/contexts/LeadRealtimeBus';
import { toast } from 'sonner';
import { enforceClientActionRateLimit, getClientRateLimitMessage } from '@/lib/client-action-rate-limit';
import { leadsAPI } from '@/lib/api/leads';
import { getLeadEnrichments } from '@/lib/api/lead-enrichments';
import { pipelinesAPI } from '@/lib/api/pipelines';
import { getPipelineBoard } from '@/lib/api/pipeline-board';

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

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error && 'message' in error) {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === 'string') return maybeMessage;
  }
  return 'Erro desconhecido';
};

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
  }

  render() {
    if (this.state.error) {
      return (
        <Dialog open onOpenChange={() => this.props.onClose()}>
          <DialogContent className="app-card max-w-md rounded-[6px] text-[var(--app-text-primary)]">
            <DialogHeader>
              <DialogTitle className="font-extralight tracking-wide text-foreground">Erro ao abrir lead</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-sm font-extralight tracking-wide text-muted-foreground">
              <p>O card deste lead encontrou um dado incompleto ao carregar.</p>
              <pre className="max-h-40 overflow-auto rounded-[6px] border-0 bg-[var(--app-surface-soft)] p-3 text-xs text-muted-foreground whitespace-pre-wrap">
                {this.state.error.message}
              </pre>
              <Button onClick={this.props.onClose} className="w-full h-12 rounded-[6px] border-0 text-[12px] font-extralight uppercase tracking-[0.08em] text-muted-foreground hover:bg-[var(--app-surface-hover)] hover:text-foreground bg-transparent">Fechar</Button>
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
  const { profile, organization, isSuperAdmin, userOrganizations } = useAuth();
  const [shouldLoadFilterOptions, setShouldLoadFilterOptions] = useState(false);
  const activeOrganizationId = organization?.id || profile?.organization_id;
  const activeMemberRole = userOrganizations.find((org) => org.organization_id === activeOrganizationId)?.member_role;
  const isAdmin =
    isSuperAdmin ||
    profile?.role === 'admin' ||
    activeMemberRole === 'admin' ||
    activeMemberRole === 'owner';
  const newButtonLabel = 'Novo Lead';

  const [selectedLead, setSelectedLead] = useState<PipelineLead | null>(null);
  const [newLeadDialogOpen, setNewLeadDialogOpen] = useState(false);
  const [newLeadStageId, setNewLeadStageId] = useState<string | null>(null);
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
    isLoadingSources,
    isLoadingCampaigns,
    isLoadingAdSets,
    isLoadingAds,
  } = useSharedFilters({ loadDynamicOptions: shouldLoadFilterOptions });

  const [editingStageId, setEditingStageId] = useState<string | null>(null);
  const [editingStageName, setEditingStageName] = useState('');
  const [settingsStage, setSettingsStage] = useState<StageWithLeads | null>(null);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null);
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
  const [confirmationDialogOpen, setConfirmationDialogOpen] = useState(false);
  const [pendingDragResult, setPendingDragResult] = useState<DropResult | null>(null);
  const [contractResourceConfirmed, setContractResourceConfirmed] = useState(false);

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
  const { data: hasPipelineLock = false } = useHasPermission('pipeline_lock');
  const isDragDisabled = hasPipelineLock && !isAdmin;

  const scopedVisibleUserIds = useMemo(() => {
    if (!leadVisibility || leadVisibility.canViewAll) return undefined;
    if (leadVisibility.teamMemberIds) return leadVisibility.teamMemberIds;
    if (leadVisibility.userId) return [leadVisibility.userId];
    return [];
  }, [leadVisibility]);
  const hasUserScope = Array.isArray(scopedVisibleUserIds);
  const selectedFilterUserId = filterUser === 'all' ? undefined : (filterUser || undefined);
  const effectivePipelineFilterUser = hasUserScope
    ? (selectedFilterUserId ? (scopedVisibleUserIds.includes(selectedFilterUserId) ? selectedFilterUserId : NO_VISIBLE_USER_ID) : undefined)
    : selectedFilterUserId;

  useEffect(() => {
    if (!hasUserScope || !selectedFilterUserId) return;
    if (scopedVisibleUserIds.includes(selectedFilterUserId)) return;
    setFilterUser(scopedVisibleUserIds.length === 1 ? scopedVisibleUserIds[0] : 'all');
  }, [hasUserScope, selectedFilterUserId, scopedVisibleUserIds, setFilterUser]);

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

  const shouldLoadPipelineLeads = !!selectedPipelineId && filterUser !== null && !permissionLoading && !leadVisibilityLoading && !!leadVisibility;
  const deferredSearchQuery = useDeferredValue(searchQuery);

  const { data: stagesWithLeads = [], isLoading: leadsLoading, refetch } = useStagesWithLeads(
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
      filterUserIds: scopedVisibleUserIds,
    },
    { enabled: shouldLoadPipelineLeads }
  );

  const stages = useMemo<StageWithLeads[]>(() => {
    if (stagesWithLeads.length > 0) return stagesWithLeads;
    return baseStages.map(s => ({ ...s, leads: [] as PipelineLead[], total_lead_count: s.lead_count || 0, has_more: false }));
  }, [baseStages, stagesWithLeads]);

  const { data: users = [] } = useOrganizationUsers();
  const visibleUsers = hasUserScope
    ? users.filter((candidate) => scopedVisibleUserIds.includes(candidate.id))
    : users;
  const { data: allTags = [] } = useTags();
  const assignLeadRoundRobin = useAssignLeadRoundRobin();
  const canEditPipeline = useCanEditCadences();
  const isMobile = useIsMobile();
  const [activeMobileStageId, setActiveMobileStageId] = useState<string | null>(null);

  const currentPipeline = pipelines.find(p => p.id === selectedPipelineId);
  const isLoading = pipelinesLoading || baseStagesLoading;
  const isInitialLeadsLoading = leadsLoading && stagesWithLeads.length === 0;

  const handleDragStart = useCallback(() => {
    isDraggingRef.current = true;
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
        filterUserIds: scopedVisibleUserIds,
      },
    });
  }, [selectedPipelineId, stages, loadMoreLeads, effectivePipelineFilterUser, dateRange, filterTag, filterDealStatus, deferredSearchQuery, filterCampaign, filterAdSet, filterAd, filterSource, scopedVisibleUserIds]);

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

    if (stages.length > 0) {
      for (const stage of stages) {
        const lead = stage.leads.find((stageLead) => stageLead.id === leadId);
        if (lead) {
          let isActive = true;
          queueMicrotask(() => {
            if (!isActive) return;
            if (lead.pipeline_id && lead.pipeline_id !== selectedPipelineId) {
              setSelectedPipelineId(lead.pipeline_id);
            }
            setSelectedLead(lead);
            clearLeadParam();
          });

          return () => {
            isActive = false;
          };
        }
      }
    }

    let cancelled = false;
    const fetchLead = async () => {
      try {
        const { data: lead, error } = await leadsAPI.getLead(leadId, activeOrganizationId);

        if (cancelled) return;
        if (error || !lead) return;

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
          if (formattedLead.pipeline_id && formattedLead.pipeline_id !== selectedPipelineId) {
            setSelectedPipelineId(formattedLead.pipeline_id);
          }
          setSelectedLead(formattedLead);
          clearLeadParam();
        });
      } catch {}
    };

    fetchLead();
    return () => { cancelled = true; };
  }, [searchParamsString, stages, organization?.id, profile?.organization_id, selectedPipelineId, router]);

  const queryClient = useQueryClient();
  const realtimeOrganizationId = organization?.id || profile?.organization_id || '';

  const executeLeadMove = useCallback(async (
    result: DropResult,
    options?: { isOwnResource?: boolean }
  ) => {
    isDraggingRef.current = true;

    const { destination, source, draggableId } = result;
    if (!destination) {
      isDraggingRef.current = false;
      return;
    }

    try {
      enforceClientActionRateLimit(`lead:move:${profile?.id || 'anonymous'}:${draggableId}`, [
        { limit: 2, windowMs: 1000 },
        { limit: 30, windowMs: 60_000 },
      ]);
    } catch (error) {
      const rateLimitMessage = getClientRateLimitMessage(error);
      if (rateLimitMessage) toast.error(rateLimitMessage);
      isDraggingRef.current = false;
      return;
    }

    const newStageId = destination.droppableId;
    const oldStageId = source.droppableId;
    const isSameStage = newStageId === oldStageId;
    const newStage = stages.find(s => s.id === newStageId);
    const getLeadOrderDate = (lead: PipelineLead) => {
      const rawDate = lead?.stage_entered_at || lead?.created_at;
      const time = rawDate ? new Date(rawDate).getTime() : NaN;
      return Number.isFinite(time) ? time : Date.now();
    };
    const getStageEnteredAtForIndex = (leads: PipelineLead[], targetIndex: number) => {
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
    const effectiveFilterDealStatus = filterDealStatus !== 'all' ? filterDealStatus : undefined;
    const effectiveSearchQuery = searchQuery || undefined;
    const effectiveFilterCampaign = filterCampaign !== 'all' ? filterCampaign : undefined;
    const effectiveFilterAdSet = filterAdSet !== 'all' ? filterAdSet : undefined;
    const effectiveFilterAd = filterAd !== 'all' ? filterAd : undefined;
    const effectiveFilterSource = filterSource !== 'all' ? filterSource : undefined;
    const effectiveFilterUser = effectivePipelineFilterUser;
    const effectiveScopedUserIds = scopedVisibleUserIds?.join(',');

    const queryKey = [
      'stages-with-leads',
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
      const nextStageEnteredAt = getStageEnteredAtForIndex(newStages[destStageIndex].leads, targetIndex);

      const updatedLead = {
        ...movedLead,
        stage_id: newStageId,
        stage_entered_at: nextStageEnteredAt,
        stage: newStages[destStageIndex],
      };

      newStages[destStageIndex].leads.splice(targetIndex, 0, updatedLead);
      if (!isSameStage) {
        newStages[sourceStageIndex].total_lead_count = Math.max((newStages[sourceStageIndex].total_lead_count || 0) - 1, 0);
        newStages[destStageIndex].total_lead_count = (newStages[destStageIndex].total_lead_count || 0) + 1;
      }
      newStages[sourceStageIndex].has_more = (newStages[sourceStageIndex].total_lead_count || 0) > newStages[sourceStageIndex].leads.length;
      newStages[destStageIndex].has_more = (newStages[destStageIndex].total_lead_count || 0) > newStages[destStageIndex].leads.length;

      return newStages;
    });

    try {
      const currentStages = queryClient.getQueryData<StageWithLeads[]>(queryKey) || stages;
      const persistedStage = currentStages.find((stage) => stage.id === newStageId);
      const persistedLead = persistedStage?.leads?.find((lead) => lead.id === draggableId);
      const persistedStageEnteredAt = persistedLead?.stage_entered_at || new Date().toISOString();

      const updateResult = await leadsAPI.moveLeadStage(draggableId, {
        stageId: newStageId,
        isOwnResource: options?.isOwnResource ?? null,
        stageEnteredAt: persistedStageEnteredAt,
      }, realtimeOrganizationId);

      if (updateResult.error) throw updateResult.error;

      const movedLeadFromRpc = updateResult.data as unknown as Partial<PipelineLead> | null;
      if (movedLeadFromRpc) {
        queryClient.setQueryData<StageWithLeads[]>(queryKey, (old) => {
          if (!old) return old;
          return old.map(stage => ({
            ...stage,
            leads: (stage.leads || []).map((lead) =>
              lead.id === draggableId
                ? {
                    ...lead,
                    ...movedLeadFromRpc,
                    stage: lead.stage,
                  }
                : lead
            ),
          }));
        });
      }

      notifyLeadRealtimeChange({
        organizationId: realtimeOrganizationId,
        leadId: draggableId,
        reason: isSameStage ? 'pipeline.order' : 'pipeline.stage',
      });

      if (isSameStage) {
        toast.success('Ordem do lead atualizada');
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
      const wasAssigneeChanged = Boolean(
        movedLeadFromRpc?.assigned_user_id &&
        movedLeadFromRpc.assigned_user_id !== originalLead?.assigned_user_id
      );

      if (newDealStatus) {
        const statusLabels: Record<string, string> = {
          won: 'Ganho',
          lost: 'Perdido',
          open: 'Aberto'
        };
        const statusLabel = statusLabels[newDealStatus] || newDealStatus;
        toast.success(`Lead alterado para ${statusLabel}`, {
          description: `Movido para ${newStage?.name || 'nova etapa'}`
        });
      } else if (wasAssigneeChanged) {
        toast.success(`Lead movido para ${newStage?.name || 'nova etapa'}`, {
          description: 'Responsável atualizado pela automação da coluna'
        });
      } else {
        toast.success(`Lead movido para ${newStage?.name || 'nova etapa'}`);
      }

      queryClient.invalidateQueries({ queryKey: ['stages-with-leads'], refetchType: 'none' });

    } catch (error: unknown) {
      queryClient.setQueryData(queryKey, previousData);
      const rateLimitMessage = getClientRateLimitMessage(error);
      toast.error(rateLimitMessage || 'Erro ao mover lead: ' + getErrorMessage(error));
    } finally {
      setTimeout(() => {
        isDraggingRef.current = false;
      }, 500);
    }
  }, [stages, dateRange, filterTag, filterDealStatus, searchQuery, filterCampaign, filterAdSet, filterAd, filterSource, selectedPipelineId, effectivePipelineFilterUser, scopedVisibleUserIds, queryClient, profile, realtimeOrganizationId]);

  const handleDragEnd = useCallback(async (result: DropResult) => {
    isDraggingRef.current = false;

    const { destination, source } = result;

    if (!destination) return;
    if (
      destination.droppableId === source.droppableId &&
      destination.index === source.index
    ) {
      return;
    }

    const targetStage = stages.find(s => s.id === destination.droppableId);
    if (
      destination.droppableId !== source.droppableId &&
      targetStage &&
      (targetStage.name.toLowerCase().includes('fechamento') || targetStage.name.toLowerCase().includes('contrato'))
    ) {
      setPendingDragResult(result);
      setContractResourceConfirmed(false);
      setConfirmationDialogOpen(true);
      return;
    }

    executeLeadMove(result);
  }, [executeLeadMove, stages]);

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
    setNewLeadStageId(stageId || null);
    setNewLeadDialogOpen(true);
  };

  useEffect(() => {
    if (searchParams.get('new') !== 'lead') return;

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
  }, [searchParams, router]);

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
            filterUserIds: hasUserScope ? scopedVisibleUserIds : undefined,
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
  }, [activeOrganizationId, deferredSearch, hasMoreLeads, selectedPipelineId, hasUserScope, scopedVisibleUserIds]);

  const filteredStages = useMemo<StageWithLeads[]>(() => {
    return stages.map(stage => {
      let stageLeads: PipelineLead[] = [...(stage.leads || [])];

      if (searchQuery) {
        const lowerSearch = searchQuery.toLowerCase();
        stageLeads = stageLeads.filter((lead) => {
          const nameMatch = (lead.name || '').toLowerCase().includes(lowerSearch);
          const phoneMatch = (lead.phone || '').includes(lowerSearch);
          const emailMatch = (lead.email || '').toLowerCase().includes(lowerSearch);
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

  const stageVGVMap = useMemo(() => {
    const map = new Map<string, { openVGV: number }>();
    for (const stage of filteredStages) {
      let openVGV = 0;
      for (const lead of stage.leads || []) {
        if (!lead || lead.deal_status === 'won' || lead.deal_status === 'lost') {
          continue;
        }
        const propertyPrice = lead.interest_property && typeof lead.interest_property === 'object'
          ? Number(lead.interest_property.preco || 0)
          : 0;
        openVGV += Number(lead.valor_interesse || 0) || propertyPrice || 0;
      }
      if (openVGV > 0) map.set(stage.id, { openVGV });
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
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button data-tour="pipeline-selector" variant="ghost" className="h-9 min-w-0 gap-2 rounded-[6px] border border-transparent px-2 font-extralight tracking-wide text-foreground transition-colors hover:border-primary/40 hover:bg-[var(--app-surface-hover)]">
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

              <div className="hidden lg:block h-6 w-px bg-[var(--app-border)] mx-1" />

              {canEditPipeline && selectedPipelineId && !isMobile && (
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 rounded-[6px] border-0 bg-transparent text-muted-foreground transition-colors hover:bg-[var(--app-surface-hover)] hover:text-foreground"
                  onClick={() => setStagesEditorOpen(true)}
                  disabled={!selectedPipelineId}
                  title="Configurar colunas"
                >
                  <Settings className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>

            <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
              <Button
                data-tour="pipeline-refresh"
                variant="outline"
                size="icon"
                className={cn(
                  "h-8 w-8 ml-1 rounded-[6px] border-0 bg-transparent text-muted-foreground transition-colors hover:bg-[var(--app-surface-hover)] hover:text-foreground",
                  isRefreshing && "text-[#FF4529] border-[#FF4529]"
                )}
                onClick={handleManualRefresh}
                disabled={isRefreshing}
                title="Atualizar pipeline"
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
                  onFiltersOpenChange={(open) => {
                    if (open) setShouldLoadFilterOptions(true);
                  }}
                />
              </div>

              {!isMobile && (
                <Button
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
                    className="flex items-center justify-between border-b border-[var(--app-border)] p-3"
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <div
                        className="w-3 h-3 rounded-full shrink-0 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]"
                        style={{ backgroundColor: stage.color || '#6b7280' }}
                      />
                      {editingStageId === stage.id && canEditPipeline ? (
                        <Input
                          value={editingStageName}
                          onChange={(e) => setEditingStageName(e.target.value)}
                          onBlur={() => handleStageName(stage.id)}
                          onKeyDown={(e) => e.key === 'Enter' && handleStageName(stage.id)}
                          className="h-7 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-2 text-sm font-extralight text-foreground focus:border-[#FF4529]"
                          autoFocus
                        />
                      ) : (
                        <h3
                          className={cn(
                            "font-extralight tracking-wide text-sm truncate transition-colors text-foreground",
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
                        className="shrink-0 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-1.5 py-0 text-[10px] font-extralight text-muted-foreground"
                      >
                        {stageCountMetaMap.get(stage.id)?.total ?? stage.total_lead_count ?? stage.leads.length ?? 0}
                      </Badge>
                      {(stageVGVMap.get(stage.id)?.openVGV || 0) > 0 ? (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge
                                variant="outline"
                                className="text-[10px] shrink-0 bg-[#FF4529]/10 text-[#FF4529] border-[#FF4529]/20 font-extralight rounded-[6px]"
                              >
                                {formatCompactCurrency(stageVGVMap.get(stage.id)?.openVGV || 0)}
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent className="app-card rounded-[6px] text-foreground">
                              <p className="text-xs font-extralight">VGV em aberto neste estágio</p>
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
                              "flex-1 min-h-0 overflow-y-auto px-2 pb-2 space-y-2 pt-2 scrollbar-thin",
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
                                  tourTarget={stageIndex === 0 && index === 0 ? "pipeline-card" : undefined}
                                  lead={lead}
                                  index={index}
                                  onClick={() => setSelectedLead(lead)}
                                  onAssignNow={(leadId) => assignLeadRoundRobin.mutate(leadId)}
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

              {canEditPipeline && selectedPipelineId && !isMobile && (
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

        <LeadDialogErrorBoundary leadId={selectedLead?.id} onClose={() => setSelectedLead(null)}>
          <LeadDetailDialog
            lead={selectedLead}
            stages={stages}
            onClose={() => setSelectedLead(null)}
            allTags={allTags}
            allUsers={visibleUsers}
            refetchStages={refetch}
          />
        </LeadDialogErrorBoundary>

        <StageSettingsDialog
          open={!!settingsStage}
          onOpenChange={(open) => !open && setSettingsStage(null)}
          stage={settingsStageForDialog}
          onStageUpdate={() => {
            refetch();
            setSettingsStage(null);
          }}
        />

        <CreateLeadDialog
          open={newLeadDialogOpen}
          onOpenChange={setNewLeadDialogOpen}
          defaultStageId={newLeadStageId}
          defaultPipelineId={selectedPipelineId}
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

        {selectedPipelineId && (
          <PipelineSlaSettings
            open={slaSettingsOpen}
            onOpenChange={setSlaSettingsOpen}
            pipelineId={selectedPipelineId}
            pipelineName={currentPipeline?.name || ''}
          />
        )}

        {selectedPipelineId && (
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
      <Dialog open={confirmationDialogOpen} onOpenChange={(open) => {
        setConfirmationDialogOpen(open);
        if (!open) {
          setPendingDragResult(null);
          setContractResourceConfirmed(false);
        }
      }}>
        <DialogContent className="sm:max-w-[425px] rounded-[6px] border-0 bg-[var(--app-surface-solid)] text-[var(--app-text-primary)]">
          <DialogHeader>
            <DialogTitle className="font-extralight tracking-wide">Confirmação de Contrato</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm font-extralight tracking-wide text-muted-foreground">
              Você está movendo este lead para a etapa de Contrato/Fechamento.
            </p>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="recurso_proprio"
                className="h-4 w-4 rounded-[4px] border-0 bg-[var(--app-surface-soft)] text-[#FF4529] focus:ring-[#FF4529] focus:ring-offset-0"
                checked={contractResourceConfirmed}
                onChange={(event) => setContractResourceConfirmed(event.target.checked)}
              />
              <Label htmlFor="recurso_proprio" className="text-sm font-extralight tracking-wide cursor-pointer text-foreground">
                Confirmo que o cliente possui recurso próprio validado.
              </Label>
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="outline" className="h-12 rounded-[6px] border-0 text-[12px] font-extralight uppercase tracking-[0.08em] text-muted-foreground bg-transparent hover:bg-[var(--app-surface-hover)] hover:text-foreground focus-visible:border-[#FF4529]" onClick={() => {
              setConfirmationDialogOpen(false);
              setPendingDragResult(null);
              setContractResourceConfirmed(false);
            }}>
              Cancelar
            </Button>
            <Button className="h-12 rounded-[6px] bg-[#FF4529] text-[12px] font-extralight uppercase tracking-[0.08em] text-white outline-none transition-opacity hover:opacity-90 disabled:opacity-50" disabled={!contractResourceConfirmed} onClick={() => {
              if (pendingDragResult) {
                executeLeadMove(pendingDragResult, { isOwnResource: true });
              }
              setConfirmationDialogOpen(false);
              setPendingDragResult(null);
              setContractResourceConfirmed(false);
            }}>
              Confirmar e Mover
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
