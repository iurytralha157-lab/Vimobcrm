import { useEffect, useMemo, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/contexts/AuthContext';
import { useOptionalActiveOrganizationId as useOrganizationId } from '@/hooks/use-active-organization';
import { pipelinesAPI } from '@/lib/api/pipelines';
import type { PropertySummary } from '@/lib/api/property-support';
import type { UserSummary } from '@/lib/api/user-summaries';
import {
  getLeadMetaFilters as getLeadMetaFiltersFromAPI,
  getPipelineBoard,
  getPipelineStageCounts,
  getPipelineStageLeads,
  type PipelineBoardFilters,
} from '@/lib/api/pipeline-board';
import {
  stageWithLeadsQueryKey,
  type PipelineQueryKeyFilters,
} from '@/lib/pipeline-query-key';
import {
  getPipelineBoardQueryKeyId,
  getPendingPipelineMoves,
  reconcilePipelineBoardSnapshot,
} from '@/lib/pipeline-board-cache';
import type { Tables } from '@/lib/supabase/types';
import { reusePreviousDataWhenKeyPartsMatch } from '@/lib/query-placeholder-safety';
import { resolvePipelineDateModeForRange } from '@/lib/pipeline-date-mode';
import { shouldRetryPipelineQuery } from '@/lib/pipeline-reliability';
import {
  buildPipelineStageRestorePlans,
  createPipelinePaginationStorageKey,
  getPipelineStageLoadedCountsFromBoard,
  mergePipelineStageLoadedCounts,
  parsePipelineStageLoadedCounts,
  type PipelineStageLoadedCounts,
} from '@/lib/pipeline-pagination-state';

export type Stage = Tables<'stages'> & {
  lead_count?: number;
};

type LeadTag = {
  id?: string;
  name?: string | null;
  color?: string | null;
};

type LeadMetaRow = {
  lead_id: string;
  campaign_name?: string | null;
  campaign_id?: string | null;
  adset_name?: string | null;
  adset_id?: string | null;
  ad_name?: string | null;
  ad_id?: string | null;
  platform?: string | null;
};

export type PipelineLead = Partial<Tables<'leads'>> & {
  id: string;
  stage_id: string | null;
  board_sort_at?: string | null;
  assigned_user_id?: string | null;
  interest_property_id?: string | null;
  assignee?: UserSummary | null;
  interest_property?: PropertySummary | null;
  stage?: Stage | null;
  lead_meta?: LeadMetaRow[];
  tags?: LeadTag[];
  tasks_count?: { pending: number; completed: number };
};

export type StageWithLeads = Stage & {
  leads: PipelineLead[];
  total_lead_count: number;
  total_value?: number;
  has_more: boolean;
};

export type PipelineQueryFilters = PipelineQueryKeyFilters;

interface FilteredStageCountsParams extends PipelineQueryFilters {
  pipelineId?: string;
  stageIds: string[];
  filterUser?: string;
}

const LEADS_PER_STAGE = 12;
const PIPELINE_REFERENCE_STALE_TIME_MS = 1000 * 60 * 10;
const PIPELINE_BOARD_STALE_TIME_MS = 1000 * 60 * 10;
const PIPELINE_CACHE_TIME_MS = 1000 * 60 * 60;

type PipelineBackgroundRestoreState = {
  queryKeyId: string;
  generation: number;
  desiredLoadedCounts: PipelineStageLoadedCounts;
  attemptedStageIds: Set<string>;
};

export async function buildPipelineLeadQueryFilters(): Promise<{
  filteredLeadIds: string[] | null;
  isEmpty: boolean;
  apply: <TQuery>(query: TQuery) => TQuery;
}> {
  return {
    filteredLeadIds: null,
    isEmpty: false,
    apply: (query) => query,
  };
}

export function useStages(pipelineId?: string) {
  const organizationId = useOrganizationId();

  return useQuery<Stage[]>({
    queryKey: ['stages', organizationId, pipelineId],
    enabled: Boolean(organizationId && pipelineId),
    queryFn: async ({ signal }) => {
      const stages = await pipelinesAPI.getStages(pipelineId, organizationId, signal);

      return stages.map((stage) => ({
        ...stage,
        lead_count: 0,
      })) as Stage[];
    },
    staleTime: PIPELINE_REFERENCE_STALE_TIME_MS,
    gcTime: PIPELINE_CACHE_TIME_MS,
    retry: shouldRetryPipelineQuery,
    retryDelay: (attemptIndex) => Math.min(800 * 2 ** attemptIndex, 8000),
  });
}

export function useStagesWithLeads(
  pipelineId?: string,
  filterUserId?: string,
  filters?: PipelineQueryFilters,
  options?: {
    enabled?: boolean;
  },
) {
  const organizationId = useOrganizationId();
  const { profile, user } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => stageWithLeadsQueryKey({
      organizationId,
      pipelineId,
      filterUserId,
      filters,
    }),
    [filterUserId, filters, organizationId, pipelineId],
  );
  const queryKeyId = getPipelineBoardQueryKeyId(queryKey);
  const paginationStorageKey = profile?.id || user?.id
    ? createPipelinePaginationStorageKey(profile?.id || user?.id || '', queryKey)
    : null;
  const isBoardEnabled = Boolean(
    organizationId && pipelineId && (options?.enabled ?? true),
  );
  const backgroundRestoreStateRef = useRef<PipelineBackgroundRestoreState | null>(null);
  const restoreLifecycleRef = useRef(true);
  const restoreAllowedRef = useRef(isBoardEnabled);

  useEffect(() => {
    restoreLifecycleRef.current = true;
    return () => {
      restoreLifecycleRef.current = false;
    };
  }, []);

  useEffect(() => {
    restoreAllowedRef.current = isBoardEnabled;
  }, [isBoardEnabled]);

  const boardQuery = useQuery<StageWithLeads[]>({
    queryKey,
    staleTime: PIPELINE_BOARD_STALE_TIME_MS,
    gcTime: PIPELINE_CACHE_TIME_MS,
    placeholderData: (previousData, previousQuery) =>
      reusePreviousDataWhenKeyPartsMatch(
        previousData,
        previousQuery?.queryKey,
        queryKey,
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
      ),
    enabled: isBoardEnabled,
    refetchOnMount: true,
    structuralSharing: (oldData, newData) =>
      reconcilePipelineBoardSnapshot(
        oldData as StageWithLeads[] | undefined,
        newData as StageWithLeads[],
        getPendingPipelineMoves<PipelineLead>(queryKey),
      ),
    queryFn: async ({ signal }) => {
      const cachedBoard = queryClient.getQueryData<StageWithLeads[]>(queryKey);
      const desiredLoadedCounts = mergePipelineStageLoadedCounts(
        readPipelineStageLoadedCounts(paginationStorageKey),
        getPipelineStageLoadedCountsFromBoard(cachedBoard),
      );
      const previousRestoreState = backgroundRestoreStateRef.current;
      backgroundRestoreStateRef.current = {
        queryKeyId,
        generation:
          previousRestoreState?.queryKeyId === queryKeyId
            ? previousRestoreState.generation + 1
            : 1,
        desiredLoadedCounts,
        attemptedStageIds: new Set(),
      };

      return (await getPipelineBoard({
        organizationId,
        pipelineId,
        filterUserId,
        filters: filters as PipelineBoardFilters,
        limit: LEADS_PER_STAGE,
        signal,
      })) as StageWithLeads[];
    },
    retry: shouldRetryPipelineQuery,
    retryDelay: (attemptIndex) => Math.min(800 * 2 ** attemptIndex, 8000),
  });

  useEffect(() => {
    if (!boardQuery.data || !organizationId || !pipelineId || !isBoardEnabled) return;

    const restoreState = backgroundRestoreStateRef.current;
    if (!restoreState || restoreState.queryKeyId !== queryKeyId) return;

    const restorePlans = buildPipelineStageRestorePlans(
      boardQuery.data,
      restoreState.desiredLoadedCounts,
    ).filter((plan) => !restoreState.attemptedStageIds.has(plan.stageId));
    if (restorePlans.length === 0) return;

    restorePlans.forEach((plan) => {
      restoreState.attemptedStageIds.add(plan.stageId);
    });

    void (async () => {
      // Restore one column at a time. The first 12 cards are already visible,
      // and a saved deep board cannot fan out into many simultaneous requests.
      for (const plan of restorePlans) {
        if (
          !restoreLifecycleRef.current ||
          !restoreAllowedRef.current ||
          backgroundRestoreStateRef.current !== restoreState
        ) {
          return;
        }

        let response: { stageId: string; leads: PipelineLead[] };
        try {
          response = (await getPipelineStageLeads({
            organizationId,
            pipelineId,
            stageId: plan.stageId,
            offset: plan.offset,
            cursorBefore: plan.cursorBefore,
            cursorBeforeId: plan.cursorBeforeId,
            filterUserId,
            filters: filters as PipelineBoardFilters,
            limit: plan.limit,
          })) as { stageId: string; leads: PipelineLead[] };
        } catch {
          // The initial page remains usable. A manual refresh starts a new,
          // bounded restore generation instead of retrying in a tight loop.
          continue;
        }

        if (
          !restoreLifecycleRef.current ||
          !restoreAllowedRef.current ||
          backgroundRestoreStateRef.current !== restoreState
        ) {
          return;
        }

        let loadedCount: number | undefined;
        queryClient.setQueryData<StageWithLeads[]>(queryKey, (current) => {
          if (!current) return current;

          const existingIds = new Set(
            current.flatMap((stage) => stage.leads.map((lead) => lead.id)),
          );

          return current.map((stage) => {
            if (stage.id !== response.stageId) return stage;

            const uniqueLeads = response.leads.filter(
              (lead) => !existingIds.has(lead.id),
            );
            const leads = [...stage.leads, ...uniqueLeads];
            loadedCount = leads.length;

            return {
              ...stage,
              leads,
              has_more: stage.total_lead_count > leads.length,
            };
          });
        });

        if (loadedCount) {
          persistPipelineStageLoadedCount(
            paginationStorageKey,
            response.stageId,
            loadedCount,
          );
        }
      }
    })();
  }, [
    boardQuery.data,
    boardQuery.dataUpdatedAt,
    filterUserId,
    filters,
    isBoardEnabled,
    organizationId,
    paginationStorageKey,
    pipelineId,
    queryClient,
    queryKey,
    queryKeyId,
  ]);

  return boardQuery;
}

export function useLeadMetaFilters(
  dateRange?: { from: Date; to: Date } | null,
  dateMode?: PipelineQueryFilters['dateMode'],
) {
  const organizationId = useOrganizationId();
  const resolvedDateMode = resolvePipelineDateModeForRange(dateRange, dateMode);

  return useQuery({
    queryKey: [
      'lead-meta-filters',
      organizationId,
      dateRange?.from?.toISOString(),
      dateRange?.to?.toISOString(),
      resolvedDateMode,
    ],
    enabled: Boolean(organizationId),
    queryFn: async ({ signal }) => {
      if (!organizationId) return { sources: [], campaigns: [], adsets: [], ads: [] };
      return getLeadMetaFiltersFromAPI({
        organizationId,
        dateRange,
        dateMode: resolvedDateMode,
        signal,
      });
    },
    staleTime: PIPELINE_REFERENCE_STALE_TIME_MS,
    gcTime: PIPELINE_CACHE_TIME_MS,
    retry: shouldRetryPipelineQuery,
    retryDelay: 800,
    placeholderData: (previousData, previousQuery) =>
      reusePreviousDataWhenKeyPartsMatch(
        previousData,
        previousQuery?.queryKey,
        [
          'lead-meta-filters',
          organizationId,
          dateRange?.from?.toISOString(),
          dateRange?.to?.toISOString(),
          resolvedDateMode,
        ],
        [1, 2, 3, 4],
      ),
  });
}

export function useFilteredStageCounts({
  pipelineId,
  stageIds,
  filterUser,
  filterTag,
  filterDealStatus,
  searchQuery,
  dateRange,
  dateMode,
  filterCampaign,
  filterAdSet,
  filterAd,
  filterSource,
  filterUserIds,
}: FilteredStageCountsParams) {
  const organizationId = useOrganizationId();
  const filters = {
    dateRange,
    dateMode,
    filterTag,
    filterDealStatus,
    searchQuery,
    filterCampaign,
    filterAdSet,
    filterAd,
    filterSource,
    filterUserIds,
  };

  return useQuery({
    queryKey: [
      'filtered-stage-counts',
      organizationId,
      pipelineId,
      stageIds.join(','),
      filterUser,
      filterTag,
      filterDealStatus,
      searchQuery,
      dateRange?.from.toISOString(),
      dateRange?.to.toISOString(),
      dateMode,
      filterCampaign,
      filterAdSet,
      filterAd,
      filterSource,
      filterUserIds?.join(','),
    ],
    enabled: Boolean(organizationId && pipelineId && stageIds.length > 0),
    staleTime: PIPELINE_BOARD_STALE_TIME_MS,
    gcTime: PIPELINE_CACHE_TIME_MS,
    queryFn: async ({ signal }) => {
      if (!pipelineId || stageIds.length === 0) return {} as Record<string, number>;

      return getPipelineStageCounts({
        organizationId,
        pipelineId,
        stageIds,
        filterUserId: filterUser,
        filters: filters as PipelineBoardFilters,
        signal,
      });
    },
    retry: shouldRetryPipelineQuery,
    retryDelay: (attemptIndex) => Math.min(800 * 2 ** attemptIndex, 8000),
  });
}

export function usePipelines() {
  const organizationId = useOrganizationId();

  return useQuery({
    queryKey: ['pipelines', organizationId],
    enabled: Boolean(organizationId),
    queryFn: ({ signal }) => pipelinesAPI.getPipelines(organizationId, signal),
    staleTime: PIPELINE_REFERENCE_STALE_TIME_MS,
    gcTime: PIPELINE_CACHE_TIME_MS,
    retry: shouldRetryPipelineQuery,
    retryDelay: (attemptIndex) => Math.min(800 * 2 ** attemptIndex, 8000),
  });
}

export function useCreatePipeline() {
  const queryClient = useQueryClient();
  const organizationId = useOrganizationId();

  return useMutation({
    mutationFn: ({ name, isDefault = false }: { name: string; isDefault?: boolean }) => {
      return pipelinesAPI.createPipeline({ name, isDefault }, organizationId);
    },
    onSuccess: () => invalidatePipelineQueries(queryClient),
  });
}

export function useUpdatePipeline() {
  const queryClient = useQueryClient();
  const organizationId = useOrganizationId();

  return useMutation({
    mutationFn: ({ id, name, isDefault }: { id: string; name?: string; isDefault?: boolean }) => {
      return pipelinesAPI.updatePipeline(id, { name, isDefault }, organizationId);
    },
    onSuccess: () => invalidatePipelineQueries(queryClient),
  });
}

export function useDeletePipeline() {
  const queryClient = useQueryClient();
  const organizationId = useOrganizationId();

  return useMutation({
    mutationFn: (id: string) => pipelinesAPI.deletePipeline(id, organizationId),
    onSuccess: () => invalidatePipelineQueries(queryClient),
  });
}

export function useCreateStage() {
  const queryClient = useQueryClient();
  const organizationId = useOrganizationId();

  return useMutation({
    mutationFn: ({ pipelineId, name, color }: { pipelineId: string; name: string; color?: string }) => {
      return pipelinesAPI.createStage({ pipelineId, name, color }, organizationId);
    },
    onSuccess: () => invalidatePipelineQueries(queryClient),
  });
}

export function useUpdateStage() {
  const queryClient = useQueryClient();
  const organizationId = useOrganizationId();

  return useMutation({
    mutationFn: ({ id, name, color, stageKey, isWon, isLost, isQualified, isActive }: {
      id: string;
      name?: string;
      color?: string;
      stageKey?: string;
      isWon?: boolean;
      isLost?: boolean;
      isQualified?: boolean;
      isActive?: boolean;
    }) => {
      return pipelinesAPI.updateStage(id, { name, color, stageKey, isWon, isLost, isQualified, isActive }, organizationId);
    },
    onSuccess: () => invalidatePipelineQueries(queryClient),
  });
}

export function useDeleteStage() {
  const queryClient = useQueryClient();
  const organizationId = useOrganizationId();

  return useMutation({
    mutationFn: (id: string) => pipelinesAPI.deleteStage(id, organizationId),
    onSuccess: () => invalidatePipelineQueries(queryClient),
  });
}

export function useReorderStages() {
  const queryClient = useQueryClient();
  const organizationId = useOrganizationId();

  return useMutation({
    mutationFn: ({ pipelineId, stages }: {
      pipelineId: string;
      stages: Array<{ id: string; name: string; color?: string | null; stage_key?: string | null }>;
    }) => pipelinesAPI.reorderStages(pipelineId, stages, organizationId),
    onSuccess: () => invalidatePipelineQueries(queryClient),
  });
}

export function useLoadMoreLeads() {
  const queryClient = useQueryClient();
  const organizationId = useOrganizationId();
  const { profile, user } = useAuth();

  return useMutation({
    mutationFn: async ({
      pipelineId,
      stageId,
      offset,
      cursorBefore,
      cursorBeforeId,
      filterUserId,
      filters,
    }: {
      pipelineId: string;
      stageId: string;
      offset: number;
      cursorBefore?: string;
      cursorBeforeId?: string;
      filterUserId?: string;
      filters?: PipelineQueryFilters;
    }) => {
      return (await getPipelineStageLeads({
        organizationId,
        pipelineId,
        stageId,
        offset,
        cursorBefore,
        cursorBeforeId,
        filterUserId,
        filters: filters as PipelineBoardFilters,
        limit: LEADS_PER_STAGE,
      })) as { stageId: string; leads: PipelineLead[] };
    },
    onSuccess: ({ stageId, leads }, { pipelineId, filterUserId, filters }) => {
      const queryKey = stageWithLeadsQueryKey({ organizationId, pipelineId, filterUserId, filters });
      let loadedCount: number | undefined;
      queryClient.setQueryData(
        queryKey,
        (old: StageWithLeads[] | undefined) => {
          if (!old) return old;

          const existingIds = new Set(
            old.flatMap((stage) => (stage.leads || []).map((lead) => lead.id)),
          );

          return old.map((stage) => {
            if (stage.id !== stageId) return stage;

            const newLeads = leads.filter((lead) => !existingIds.has(lead.id));
            loadedCount = (stage.leads?.length || 0) + newLeads.length;

            return {
              ...stage,
              leads: [...(stage.leads || []), ...newLeads],
              has_more: stage.total_lead_count > loadedCount,
            };
          });
        },
      );
      const viewerId = profile?.id || user?.id;
      if (viewerId && loadedCount) {
        persistPipelineStageLoadedCount(
          createPipelinePaginationStorageKey(viewerId, queryKey),
          stageId,
          loadedCount,
        );
      }
    },
    retry: shouldRetryPipelineQuery,
    retryDelay: (attemptIndex) => Math.min(800 * 2 ** attemptIndex, 8000),
  });
}

function readPipelineStageLoadedCounts(storageKey: string | null): PipelineStageLoadedCounts {
  if (!storageKey || typeof window === 'undefined') return {};
  try {
    return parsePipelineStageLoadedCounts(window.sessionStorage.getItem(storageKey));
  } catch {
    return {};
  }
}

function persistPipelineStageLoadedCount(
  storageKey: string | null,
  stageId: string,
  loadedCount: number,
) {
  if (!storageKey || typeof window === 'undefined') return;

  try {
    const nextCounts = mergePipelineStageLoadedCounts(
      readPipelineStageLoadedCounts(storageKey),
      { [stageId]: loadedCount },
    );
    window.sessionStorage.setItem(storageKey, JSON.stringify(nextCounts));
  } catch {
    // Pagination still works when sessionStorage is unavailable.
  }
}

function invalidatePipelineQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries(
    { queryKey: ['pipelines'] },
    { cancelRefetch: false },
  );
  queryClient.invalidateQueries(
    { queryKey: ['stages'] },
    { cancelRefetch: false },
  );
  queryClient.invalidateQueries(
    { queryKey: ['stages-with-leads'] },
    { cancelRefetch: false },
  );
}
