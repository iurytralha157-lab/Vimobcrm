import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/contexts/AuthContext';
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
import type { Tables } from '@/integrations/supabase/types';

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
  has_more: boolean;
};

export interface PipelineQueryFilters {
  dateRange?: { from: Date; to: Date } | null;
  filterTag?: string;
  filterDealStatus?: string;
  searchQuery?: string;
  filterCampaign?: string;
  filterAdSet?: string;
  filterAd?: string;
  filterSource?: string;
  filterUserIds?: string[];
}

interface FilteredStageCountsParams extends PipelineQueryFilters {
  pipelineId?: string;
  stageIds: string[];
  filterUser?: string;
}

const LEADS_PER_STAGE = 12;

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

  return useQuery({
    queryKey: ['stages', organizationId, pipelineId],
    queryFn: async () => {
      const stages = await pipelinesAPI.getStages(pipelineId, organizationId);

      return stages.map((stage) => ({
        ...stage,
        lead_count: 0,
      })) as Stage[];
    },
    staleTime: 1000 * 60 * 10,
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

  return useQuery({
    queryKey: stageWithLeadsQueryKey({ pipelineId, filterUserId, filters }),
    staleTime: 30_000,
    gcTime: 1000 * 60 * 15,
    placeholderData: keepPreviousData,
    enabled: options?.enabled ?? true,
    queryFn: async () => {
      try {
        return (await getPipelineBoard({
          organizationId,
          pipelineId,
          filterUserId,
          filters: filters as PipelineBoardFilters,
          limit: LEADS_PER_STAGE,
        })) as StageWithLeads[];
      } catch (err) {
        console.error('[Pipeline filters] useStagesWithLeads error:', err);
        return [] as StageWithLeads[];
      }
    },
  });
}

export function useLeadMetaFilters(dateRange?: { from: Date; to: Date } | null) {
  const organizationId = useOrganizationId();

  return useQuery({
    queryKey: ['lead-meta-filters', organizationId, dateRange?.from?.toISOString(), dateRange?.to?.toISOString()],
    queryFn: async () => {
      if (!organizationId) return { campaigns: [], adsets: [], ads: [] };
      return getLeadMetaFiltersFromAPI({ organizationId, dateRange });
    },
    staleTime: 1000 * 60 * 5,
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
  filterCampaign,
  filterAdSet,
  filterAd,
  filterSource,
  filterUserIds,
}: FilteredStageCountsParams) {
  const organizationId = useOrganizationId();
  const filters = {
    dateRange,
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
      filterCampaign,
      filterAdSet,
      filterAd,
      filterSource,
      filterUserIds?.join(','),
    ],
    enabled: !!pipelineId && stageIds.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      if (!pipelineId || stageIds.length === 0) return {} as Record<string, number>;

      try {
        return await getPipelineStageCounts({
          organizationId,
          pipelineId,
          stageIds,
          filterUserId: filterUser,
          filters: filters as PipelineBoardFilters,
        });
      } catch (err) {
        console.error('[Pipeline filters] useFilteredStageCounts error:', err);
        return Object.fromEntries(stageIds.map((stageId) => [stageId, 0]));
      }
    },
  });
}

export function usePipelines() {
  const organizationId = useOrganizationId();

  return useQuery({
    queryKey: ['pipelines', organizationId],
    queryFn: () => pipelinesAPI.getPipelines(organizationId),
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
    mutationFn: ({ id, name, color, stageKey, isWon, isLost, isActive }: {
      id: string;
      name?: string;
      color?: string;
      stageKey?: string;
      isWon?: boolean;
      isLost?: boolean;
      isActive?: boolean;
    }) => {
      return pipelinesAPI.updateStage(id, { name, color, stageKey, isWon, isLost, isActive }, organizationId);
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

  return useMutation({
    mutationFn: async ({
      pipelineId,
      stageId,
      offset,
      filterUserId,
      filters,
    }: {
      pipelineId: string;
      stageId: string;
      offset: number;
      filterUserId?: string;
      filters?: PipelineQueryFilters;
    }) => {
      try {
        return (await getPipelineStageLeads({
          organizationId,
          pipelineId,
          stageId,
          offset,
          filterUserId,
          filters: filters as PipelineBoardFilters,
          limit: LEADS_PER_STAGE,
        })) as { stageId: string; leads: PipelineLead[] };
      } catch (err) {
        console.error('[Pipeline filters] useLoadMoreLeads error:', err);
        return { stageId, leads: [] };
      }
    },
    onSuccess: ({ stageId, leads }, { pipelineId, filterUserId, filters }) => {
      queryClient.setQueryData(
        stageWithLeadsQueryKey({ pipelineId, filterUserId, filters }),
        (old: StageWithLeads[] | undefined) => {
          if (!old) return old;

          return old.map((stage) => {
            if (stage.id !== stageId) return stage;

            const existingIds = new Set((stage.leads || []).map((lead) => lead.id));
            const newLeads = leads.filter((lead) => !existingIds.has(lead.id));

            return {
              ...stage,
              leads: [...(stage.leads || []), ...newLeads],
              has_more: stage.total_lead_count > (stage.leads?.length || 0) + newLeads.length,
            };
          });
        },
      );
    },
  });
}

function useOrganizationId() {
  const { organization, profile } = useAuth();
  return organization?.id || profile?.organization_id || undefined;
}

function stageWithLeadsQueryKey(params: {
  pipelineId?: string;
  filterUserId?: string;
  filters?: PipelineQueryFilters;
}) {
  const { pipelineId, filterUserId, filters } = params;

  return [
    'stages-with-leads',
    pipelineId,
    filterUserId,
    filters?.dateRange?.from?.toISOString(),
    filters?.dateRange?.to?.toISOString(),
    filters?.filterTag,
    filters?.filterDealStatus,
    filters?.searchQuery,
    filters?.filterCampaign,
    filters?.filterAdSet,
    filters?.filterAd,
    filters?.filterSource,
    filters?.filterUserIds?.join(','),
  ];
}

function invalidatePipelineQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['pipelines'] });
  queryClient.invalidateQueries({ queryKey: ['stages'] });
  queryClient.invalidateQueries({ queryKey: ['stages-with-leads'] });
}
