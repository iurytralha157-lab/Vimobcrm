import type { PipelineLead, StageWithLeads } from '@/hooks/use-stages';
import {
  getPipelineLeadPageCursor,
  getPipelineStagePaginationAfterPage,
  type PipelineStageLoadedCounts,
  type PipelineStageRestorePlan,
} from '@/lib/pipeline-pagination-state';

// The stage endpoint caps a single page at 100 leads.
const MAX_STAGE_PAGE_SIZE = 100;

type ExpandedBoardRefresh = {
  freshBoard: StageWithLeads[];
  cachedBoard: StageWithLeads[];
  savedCounts: PipelineStageLoadedCounts;
  organizationId: string;
  pipelineId: string;
  readPage: (plan: PipelineStageRestorePlan) => Promise<{
    stageId: string;
    leads: PipelineLead[];
    hasMore?: boolean;
  }>;
};

export async function refreshExpandedPipelineBoard({
  freshBoard,
  cachedBoard,
  savedCounts,
  organizationId,
  pipelineId,
  readPage,
}: ExpandedBoardRefresh): Promise<StageWithLeads[]> {
  const cachedCounts = new Map(cachedBoard.map(stage => [stage.id, stage.leads.length]));
  const seen = new Set(freshBoard.flatMap(stage => stage.leads.map(lead => lead.id)));
  const refreshed: StageWithLeads[] = [];

  for (const freshStage of freshBoard) {
    const desiredCount = Math.max(cachedCounts.get(freshStage.id) ?? 0, savedCounts[freshStage.id] ?? 0);
    let stage = freshStage;

    while (stage.has_more && stage.leads.length < desiredCount) {
      const offset = stage.leads.length;
      const limit = Math.min(desiredCount - offset, MAX_STAGE_PAGE_SIZE);
      const response = await readPage({
        stageId: stage.id,
        offset,
        limit,
        ...getPipelineLeadPageCursor(stage.leads.at(-1)),
      });

      if (response.stageId !== stage.id || response.leads.some(lead =>
        (lead.stage_id && lead.stage_id !== stage.id)
        || (lead.organization_id && lead.organization_id !== organizationId)
        || (lead.pipeline_id && lead.pipeline_id !== pipelineId))) {
        throw new Error('A página recebida não corresponde à coluna atual. Atualize o quadro.');
      }

      const added = response.leads.filter(lead => {
        if (seen.has(lead.id)) return false;
        seen.add(lead.id);
        return true;
      });
      if (added.length === 0 && (response.hasMore === true || response.leads.length > 0)) {
        throw new Error('O quadro mudou. Atualize os leads para continuar o carregamento.');
      }

      const leads = [...stage.leads, ...added];
      stage = {
        ...stage,
        leads,
        ...getPipelineStagePaginationAfterPage({
          totalCount: stage.total_lead_count,
          loadedCount: leads.length,
          receivedCount: response.leads.length,
          addedCount: added.length,
          requestedCount: limit,
          hasMore: response.hasMore,
          countIsEstimate: stage.pagination_count_is_estimate,
        }),
      };
    }

    refreshed.push(stage);
  }

  return refreshed;
}
