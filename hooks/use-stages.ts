import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/contexts/AuthContext';
import { getGlobalSignOutSessionId } from '@/lib/auth/global-sign-out';
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
import { useStageDeleteIntent, type DeleteStageData } from '@/hooks/pipelines/use-stage-delete-intent';
import { usePipelineCreateMutation, usePipelineDeleteMutation, usePipelineUpdateMutation, useStageCreateMutation, useStageUpdateMutation, useStagesReorderMutation } from '@/hooks/pipelines/use-pipeline-mutations';
import { useLeadRequestScope, type LeadRequestOperation } from '@/hooks/leads/use-lead-request-scope';
import { refreshExpandedPipelineBoard } from '@/hooks/pipelines/refresh-expanded-pipeline-board';
import { capturePipelinePageLease } from '@/lib/pipeline-page-lease';
import {
  buildPipelineStageRestorePlans,
  createPipelinePaginationStorageKey,
  getPipelineStageLoadedCountsFromBoard,
  getPipelineStagePaginationAfterPage,
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
  page_id?: string | null;
  page_name?: string | null;
  campaign_name?: string | null;
  campaign_id?: string | null;
  adset_name?: string | null;
  adset_id?: string | null;
  ad_name?: string | null;
  ad_id?: string | null;
  platform?: string | null;
};

export type PipelineLead = Partial<Tables<'leads'>> & {
  queue_pool?: import('@/lib/validation/queue-runtime').QueuePool | null;
  id: string;
  stage_id: string | null;
  can_operate?: boolean;
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
  pagination_count_is_estimate?: boolean;
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
  identity: object;
  generation: number;
  filters?: PipelineQueryFilters;
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
    refetchOnMount: true,
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
  const { profile, user, session } = useAuth();
  const queryClient = useQueryClient();
  const requestScope = useLeadRequestScope();
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
  const [restoreError, setRestoreError] = useState<{
    queryKeyId: string;
    generation: number;
    identity: object;
    error: unknown;
  } | null>(null);
  const sessionId = getGlobalSignOutSessionId(session);
  const restoreIdentity = useMemo(() => ({ queryKeyId, queryClient, paginationStorageKey, isBoardEnabled, userId: user?.id, sessionId }),
    [queryKeyId, queryClient, paginationStorageKey, isBoardEnabled, user?.id, sessionId]);
  const restoreVisitRef = useRef<{ identity: typeof restoreIdentity; controller: AbortController } | null>(null);
  useLayoutEffect(() => {
    const visit = { identity: restoreIdentity, controller: new AbortController() };
    restoreVisitRef.current = visit;
    return () => {
      visit.controller.abort();
      if (restoreVisitRef.current === visit) restoreVisitRef.current = null;
    };
  }, [restoreIdentity]);

  const boardQuery = useQuery<StageWithLeads[]>({
    queryKey,
    staleTime: PIPELINE_BOARD_STALE_TIME_MS,
    // Keep manually expanded boards in the access-scoped tab cache.
    gcTime: queryClient.getQueryData<StageWithLeads[]>(queryKey)?.some(stage => stage.leads?.length > LEADS_PER_STAGE)
      ? Infinity
      : PIPELINE_CACHE_TIME_MS,
    placeholderData: (previousData, previousQuery) =>
      reusePreviousDataWhenKeyPartsMatch(
        previousData,
        previousQuery?.queryKey,
        queryKey,
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
      ),
    enabled: isBoardEnabled,
    refetchOnMount: (query) => {
      const board = query.state.data;
      // A route change may have canceled a cold restore after page one was cached.
      return board && buildPipelineStageRestorePlans(board, readPipelineStageLoadedCounts(paginationStorageKey)).length > 0
        ? 'always'
        : true;
    },
    structuralSharing: (oldData, newData) =>
      reconcilePipelineBoardSnapshot(
        oldData as StageWithLeads[] | undefined,
        newData as StageWithLeads[],
        getPendingPipelineMoves<PipelineLead>(queryKey),
      ),
    queryFn: async ({ signal }) => {
      setRestoreError(null);
      const cachedBoard = queryClient.getQueryData<StageWithLeads[]>(queryKey);
      const desiredLoadedCounts = mergePipelineStageLoadedCounts(
        readPipelineStageLoadedCounts(paginationStorageKey),
        getPipelineStageLoadedCountsFromBoard(cachedBoard),
      );
      const restoreFilters = filters ? structuredClone(filters) : undefined;
      const boardFilters = restoreFilters as PipelineBoardFilters | undefined;

      if (cachedBoard && pipelineId && Object.keys(desiredLoadedCounts).length > 0) {
        // Keep the current board visible until the fresh expanded snapshot is ready.
        backgroundRestoreStateRef.current = null;
        const operation = requestScope.capture();
        const assertCurrent = () => {
          signal.throwIfAborted();
          if (!operation.isCurrent() || restoreVisitRef.current?.identity !== restoreIdentity) {
            throw new DOMException('A atualização do quadro perdeu o escopo atual.', 'AbortError');
          }
        };
        assertCurrent();
        const freshBoard = (await getPipelineBoard({
          organizationId: operation.organizationId,
          pipelineId,
          filterUserId,
          filters: boardFilters,
          limit: LEADS_PER_STAGE,
          signal,
          intent: operation.intent,
        })) as StageWithLeads[];
        assertCurrent();
        const refreshedBoard = await refreshExpandedPipelineBoard({
          freshBoard,
          cachedBoard,
          savedCounts: desiredLoadedCounts,
          organizationId: operation.organizationId,
          pipelineId,
          readPage: async (plan) => {
            assertCurrent();
            const page = await getPipelineStageLeads({
              ...plan,
              organizationId: operation.organizationId,
              pipelineId,
              filterUserId,
              filters: boardFilters,
              intent: operation.intent,
              signal,
            });
            assertCurrent();
            return page as { stageId: string; leads: PipelineLead[]; hasMore?: boolean };
          },
        });
        assertCurrent();
        return refreshedBoard;
      }

      const previousRestoreState = backgroundRestoreStateRef.current;
      backgroundRestoreStateRef.current = {
        queryKeyId,
        identity: restoreIdentity,
        generation:
          previousRestoreState?.queryKeyId === queryKeyId
            ? previousRestoreState.generation + 1
            : 1,
        filters: restoreFilters,
        desiredLoadedCounts,
        attemptedStageIds: new Set(),
      };

      return (await getPipelineBoard({
        organizationId,
        pipelineId,
        filterUserId,
        filters: boardFilters,
        limit: LEADS_PER_STAGE,
        signal,
      })) as StageWithLeads[];
    },
    retry: shouldRetryPipelineQuery,
    retryDelay: (attemptIndex) => Math.min(800 * 2 ** attemptIndex, 8000),
  });

  useEffect(() => {
    if (!boardQuery.data || !organizationId || !pipelineId || !isBoardEnabled
      || boardQuery.fetchStatus !== 'idle' || boardQuery.isPlaceholderData || boardQuery.isError) return;

    const restoreState = backgroundRestoreStateRef.current;
    if (!restoreState || restoreState.queryKeyId !== queryKeyId || restoreState.identity !== restoreIdentity) return;
    const visit = restoreVisitRef.current;
    if (!visit || visit.identity !== restoreIdentity || !restoreIdentity.isBoardEnabled) return;
    const isCurrentRestore = () => restoreVisitRef.current === visit && !visit.controller.signal.aborted
      && backgroundRestoreStateRef.current === restoreState && getPendingPipelineMoves(queryKey).length === 0;

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
        if (!isCurrentRestore()) return;
        // A prior column's accepted append creates a new snapshot. Bind the next
        // column to that current snapshot rather than to the effect's old data.
        const currentPlan = buildPipelineStageRestorePlans(
          queryClient.getQueryData<StageWithLeads[]>(queryKey) || [],
          restoreState.desiredLoadedCounts,
        ).find(candidate => candidate.stageId === plan.stageId);
        if (!currentPlan) continue;
        let operation: LeadRequestOperation | undefined;
        let lease: ReturnType<typeof capturePipelinePageLease> | undefined;
        try {
          operation = requestScope.capture();
          if (operation.organizationId !== organizationId || !isCurrentRestore()) return;
          lease = capturePipelinePageLease(queryClient, queryKey, { ...currentPlan, signal: visit.controller.signal });
          const abortLease = () => visit.controller.abort();
          operation.intent.signal?.addEventListener('abort', abortLease, { once: true });
          let response: { stageId: string; leads: PipelineLead[]; hasMore?: boolean };
          try {
            response = (await getPipelineStageLeads({
              organizationId: operation.organizationId,
              pipelineId,
              stageId: currentPlan.stageId,
              offset: currentPlan.offset,
              cursorBefore: currentPlan.cursorBefore,
              cursorBeforeId: currentPlan.cursorBeforeId,
              filterUserId,
              filters: restoreState.filters as PipelineBoardFilters | undefined,
              limit: currentPlan.limit,
              intent: operation.intent,
              signal: lease.signal,
            })) as { stageId: string; leads: PipelineLead[]; hasMore?: boolean };
          } finally {
            operation.intent.signal?.removeEventListener('abort', abortLease);
          }
          if (!isCurrentRestore() || !operation.isCurrent() || !lease.isCurrent()) return;
          if (response.stageId !== currentPlan.stageId || response.leads.some(lead =>
            (lead.stage_id && lead.stage_id !== currentPlan.stageId)
            || (lead.organization_id && lead.organization_id !== operation!.organizationId)
            || (lead.pipeline_id && lead.pipeline_id !== pipelineId))) {
            throw new Error('A página recebida não corresponde à coluna atual. Atualize o quadro.');
          }
          const currentIds = new Set((queryClient.getQueryData<StageWithLeads[]>(queryKey) || [])
            .flatMap(stage => stage.leads.map(lead => lead.id)));
          if ((response.hasMore === true && response.leads.length === 0)
            || (response.leads.length > 0 && response.leads.every(lead => currentIds.has(lead.id)))) {
            throw new Error('O quadro mudou. Atualize os leads para continuar o carregamento.');
          }

          // Release before our own synchronous write, which retires concurrent pages.
          lease.release();
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
                ...getPipelineStagePaginationAfterPage({
                  totalCount: stage.total_lead_count,
                  loadedCount: leads.length,
                  receivedCount: response.leads.length,
                  addedCount: uniqueLeads.length,
                  requestedCount: currentPlan.limit,
                  hasMore: response.hasMore,
                  countIsEstimate: stage.pagination_count_is_estimate,
                }),
              };
            });
          });

          if (loadedCount) {
            persistPipelineStageLoadedCount(paginationStorageKey, response.stageId, loadedCount);
          }
        } catch (error) {
          // An obsolete request cannot change pagination, persistence or notices.
          if (!isCurrentRestore() || (operation && !operation.isCurrent()) || (lease && !lease.isCurrent())) return;
          // Keep the initial page usable. Only a refresh starts another attempt.
          setRestoreError((current) => current?.generation === restoreState.generation && current.queryKeyId === queryKeyId
            && current.identity === restoreIdentity
            ? current : { queryKeyId, generation: restoreState.generation, identity: restoreIdentity, error });
        } finally {
          lease?.release();
        }
      }
    })();
  }, [
    boardQuery.data,
    boardQuery.dataUpdatedAt,
    boardQuery.fetchStatus,
    boardQuery.isError,
    boardQuery.isPlaceholderData,
    filterUserId,
    filters,
    isBoardEnabled,
    organizationId,
    paginationStorageKey,
    pipelineId,
    queryClient,
    queryKey,
    queryKeyId,
    requestScope,
    restoreIdentity,
  ]);

  return {
    ...boardQuery,
    restoreError: restoreError?.queryKeyId === queryKeyId && restoreError.identity === restoreIdentity ? restoreError : null,
  };
}

export function useLeadMetaFilters(
  dateRange?: { from: Date; to: Date } | null,
  dateMode?: PipelineQueryFilters['dateMode'],
  filterPage?: string | null,
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
      filterPage || undefined,
    ],
    enabled: Boolean(organizationId),
    queryFn: async ({ signal }) => {
      if (!organizationId) return { sources: [], pages: [], campaigns: [], adsets: [], ads: [] };
      return getLeadMetaFiltersFromAPI({
        organizationId,
        dateRange,
        dateMode: resolvedDateMode,
        filterPage,
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
          filterPage || undefined,
        ],
        [1, 2, 3, 4, 5],
      ),
  });
}

export function useFilteredStageCounts({
  pipelineId,
  stageIds,
  filterUser,
  filterTags,
  filterDealStatus,
  searchQuery,
  dateRange,
  dateMode,
  filterPage,
  filterCampaign,
  filterCampaigns,
  filterAdSet,
  filterAd,
  filterSource,
  filterUserIds,
  unassigned,
  teamId,
}: FilteredStageCountsParams) {
  const organizationId = useOrganizationId();
  const filters = {
    dateRange,
    dateMode,
    filterPage,
    filterTags,
    filterDealStatus,
    searchQuery,
    filterCampaign,
    filterCampaigns,
    filterAdSet,
    filterAd,
    filterSource,
    filterUserIds,
    unassigned,
    teamId,
  };
  const filterTagKey = Array.isArray(filterTags)
    ? [...new Set(filterTags.map((tagId) => tagId.trim()).filter(Boolean))]
        .sort()
        .join(',')
    : undefined;

  return useQuery({
    queryKey: [
      'filtered-stage-counts',
      organizationId,
      pipelineId,
      stageIds.join(','),
      filterUser,
      filterTagKey,
      filterDealStatus,
      searchQuery,
      dateRange?.from.toISOString(),
      dateRange?.to.toISOString(),
      dateMode,
      filterPage,
      filterCampaign,
      filterCampaigns?.length ? JSON.stringify([...new Set(filterCampaigns)].sort()) : undefined,
      filterAdSet,
      filterAd,
      filterSource,
      filterUserIds?.join(','),
      unassigned || undefined,
      teamId,
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
    refetchOnMount: true,
    staleTime: PIPELINE_REFERENCE_STALE_TIME_MS,
    gcTime: PIPELINE_CACHE_TIME_MS,
    retry: shouldRetryPipelineQuery,
    retryDelay: (attemptIndex) => Math.min(800 * 2 ** attemptIndex, 8000),
  });
}

export function useCreatePipeline() {
  return usePipelineCreateMutation();
}

export function useUpdatePipeline() {
  return usePipelineUpdateMutation();
}

export function useDeletePipeline() {
  return usePipelineDeleteMutation();
}

export function useCreateStage() {
  return useStageCreateMutation();
}

export function useUpdateStage() {
  return useStageUpdateMutation();
}

export function useDeleteStage(pipelineId?: string) {
  const requestScope = useStageDeleteIntent(pipelineId);
  const mutation = useMutation({
    mutationFn: async (input: DeleteStageData) => {
      const operation = requestScope.require(input);
      await pipelinesAPI.deleteStage(input.id, input.expectedUpdatedAt, operation.organizationId, operation.intent);
      requestScope.require(input);
    },
    retry: false,
    onSettled: (_data, _error, input) => requestScope.settled(input),
  });
  return { ...mutation, capture: requestScope.capture, discard: requestScope.discard, isCurrent: requestScope.isCurrent, isScopeCurrent: requestScope.isScopeCurrent };
}

export function useReorderStages() {
  return useStagesReorderMutation();
}

export function useLoadMoreLeads() {
  const queryClient = useQueryClient();
  const organizationId = useOrganizationId();
  const { profile, user, session } = useAuth();
  const requestScope = useLeadRequestScope();
  const sessionId = getGlobalSignOutSessionId(session);
  const access = useMemo(() => ({ queryClient, organizationId, viewerId: profile?.id || user?.id, sessionId }),
    [queryClient, organizationId, profile?.id, user?.id, sessionId]);
  type Variables = {
    pipelineId: string;
    stageId: string;
    offset: number;
    cursorBefore?: string;
    cursorBeforeId?: string;
    filterUserId?: string;
    filters?: PipelineQueryFilters;
  };
  type Captured = {
    client: typeof queryClient;
    operation?: LeadRequestOperation;
    lease?: ReturnType<typeof capturePipelinePageLease>;
    queryKey: ReturnType<typeof stageWithLeadsQueryKey>;
    viewerId?: string;
    error?: unknown;
    applied?: boolean;
  };
  const captured = useRef(new WeakMap<Variables, Captured>());
  const capture = (input: Variables) => {
    // Freeze the request's filter values before React Query awaits global onMutate.
    const variables: Variables = { ...input, filters: input.filters ? structuredClone(input.filters) : undefined };
    const queryKey = stageWithLeadsQueryKey({ organizationId, pipelineId: variables.pipelineId, filterUserId: variables.filterUserId, filters: variables.filters });
    const state: Captured = { client: queryClient, queryKey, viewerId: profile?.id || user?.id };
    captured.current.set(variables, state);
    try {
      state.operation = requestScope.capture();
      if (state.operation.organizationId !== organizationId || getPendingPipelineMoves(queryKey).length) throw new Error('Aguarde a atualização do quadro antes de carregar mais leads.');
      state.lease = capturePipelinePageLease(queryClient, queryKey, { ...variables, signal: state.operation.intent.signal! });
    } catch (error) { state.error = error; }
    return variables;
  };
  const requireCaptured = (variables: Variables) => {
    const state = captured.current.get(variables);
    if (state?.error) throw state.error;
    if (!state?.operation?.isCurrent() || !state.lease?.isCurrent() || getPendingPipelineMoves(state.queryKey).length) throw new Error('O quadro mudou. Carregue os leads novamente.');
    return { ...state, operation: state.operation, lease: state.lease };
  };

  const mutation = useMutation({
    mutationFn: async (variables: Variables) => {
      const state = requireCaptured(variables);
      const {
        pipelineId,
        stageId,
        offset,
        cursorBefore,
        cursorBeforeId,
        filterUserId,
        filters,
      } = variables;
      return (await getPipelineStageLeads({
        organizationId: state.operation.organizationId,
        pipelineId,
        stageId,
        offset,
        cursorBefore,
        cursorBeforeId,
        filterUserId,
        filters: filters as PipelineBoardFilters,
        limit: LEADS_PER_STAGE,
        intent: state.operation.intent,
        signal: state.lease.signal,
      })) as { stageId: string; leads: PipelineLead[]; hasMore?: boolean };
    },
    onSuccess: ({ stageId, leads, hasMore }, variables) => {
      const state = captured.current.get(variables);
      if (!state?.operation?.isCurrent() || !state.lease?.isCurrent() || getPendingPipelineMoves(state.queryKey).length) return;
      if (stageId !== variables.stageId || leads.some(lead => (lead.stage_id && lead.stage_id !== stageId)
        || (lead.organization_id && lead.organization_id !== state.operation!.organizationId))) return;
      const destination = state.client.getQueryData<StageWithLeads[]>(state.queryKey)?.find(stage => stage.id === stageId);
      // A partial snapshot can still show these IDs in the source column. Recover
      // the whole board rather than exhaust an empty destination through dedup.
      if (destination?.has_more && destination.leads.length === 0) return;
      if (hasMore === true && leads.length === 0) return;
      // No awaits between the final check and the append; this page's own write may retire other pages.
      state.lease.release();
      const queryKey = state.queryKey;
      let loadedCount: number | undefined;
      state.client.setQueryData(
        queryKey,
        (old: StageWithLeads[] | undefined) => {
          if (!old) return old;

          const existingIds = new Set(
            old.flatMap((stage) => (stage.leads || []).map((lead) => lead.id)),
          );

          return old.map((stage) => {
            if (stage.id !== stageId) return stage;

            const newLeads = leads.filter((lead) => !existingIds.has(lead.id));
            // Reconcile a stale projection rather than exhaust an unadvanced cursor.
            if (leads.length > 0 && newLeads.length === 0) return stage;
            state.applied = true;
            loadedCount = (stage.leads?.length || 0) + newLeads.length;

            return {
              ...stage,
              leads: [...(stage.leads || []), ...newLeads],
              ...getPipelineStagePaginationAfterPage({
                totalCount: stage.total_lead_count,
                loadedCount,
                receivedCount: leads.length,
                addedCount: newLeads.length,
                requestedCount: LEADS_PER_STAGE,
                hasMore,
                countIsEstimate: stage.pagination_count_is_estimate,
              }),
            };
          });
        },
      );
      const viewerId = state.viewerId;
      if (viewerId && loadedCount) {
        persistPipelineStageLoadedCount(
          createPipelinePaginationStorageKey(viewerId, queryKey),
          stageId,
          loadedCount,
        );
      }
    },
    onSettled: (_data, _error, variables) => {
      const state = captured.current.get(variables);
      if (!state) return;
      const needsRefresh = !state.applied;
      state.lease?.release();
      if (needsRefresh && state.operation?.canReconcileCapturedAccess()) void state.client.invalidateQueries({
        queryKey: state.queryKey, exact: true, refetchType: state.operation.isCurrent() ? 'active' : 'none',
      }, { cancelRefetch: false });
      captured.current.delete(variables);
    },
    retry: shouldRetryPipelineQuery,
    retryDelay: (attemptIndex) => Math.min(800 * 2 ** attemptIndex, 8000),
  });
  const reset = mutation.reset;
  useLayoutEffect(() => { reset(); }, [reset, access]);
  const bindOptions = (variables: Variables, options?: Parameters<typeof mutation.mutate>[1]) => {
    const state = captured.current.get(variables);
    if (!options) return options;
    return {
      ...options,
      onSuccess: options.onSuccess ? (...args: Parameters<NonNullable<typeof options.onSuccess>>) => {
        if (state?.operation?.isCurrent() && state.applied) options.onSuccess!(...args);
      } : undefined,
      onError: options.onError ? (...args: Parameters<NonNullable<typeof options.onError>>) => {
        if (state?.operation?.isCurrent() && (state.error || state.lease?.isCurrent())) options.onError!(...args);
      } : undefined,
      onSettled: options.onSettled ? (...args: Parameters<NonNullable<typeof options.onSettled>>) => {
        if (state?.operation?.isCurrent()) options.onSettled!(...args);
      } : undefined,
    };
  };
  return {
    ...mutation,
    mutate: (input: Variables, options?: Parameters<typeof mutation.mutate>[1]) => {
      const variables = capture(input);
      mutation.mutate(variables, bindOptions(variables, options));
    },
    mutateAsync: (input: Variables, options?: Parameters<typeof mutation.mutateAsync>[1]) => {
      const variables = capture(input);
      return mutation.mutateAsync(variables, bindOptions(variables, options));
    },
  };
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
