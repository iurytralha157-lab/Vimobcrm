import type { PipelineLead, StageWithLeads } from '@/hooks/use-stages';
import type { StageAutomation } from '@/hooks/use-stage-automations';
import type { PendingPipelineMove } from '@/lib/pipeline-board-cache';
import { getPipelineStageOutcome } from '@/lib/pipeline-stage-outcome';
export { getErrorObjectMessage as getPipelineErrorMessage } from '@/lib/api/vimob-error';
export { formatCompactBRLCurrency as formatCompactCurrency } from '@/lib/utils/formatting';

export type PipelineDealStatus = 'open' | 'won' | 'lost';

export type PipelineSummary = {
  id: string;
  name: string;
  is_default?: boolean | null;
};

export type VisualPendingPipelineMove = {
  queryKeyId: string;
  move: PendingPipelineMove<PipelineLead>;
  release:
    | null
    | { kind: 'confirmed' }
    | { kind: 'rollback'; stageId: string | null };
};

export type ServerSearchSnapshot = {
  queryKeyId: string;
  leads: PipelineLead[];
};

export type StageCountMeta = {
  total: number;
  visible: number;
  remaining: number;
  canLoadMore: boolean;
};

export const NO_VISIBLE_USER_ID = '00000000-0000-0000-0000-000000000000';

export const PIPELINE_AUTO_SCROLLER_OPTIONS = {
  startFromPercentage: 0.2,
  maxScrollAtPercentage: 0.05,
  maxPixelScroll: 12,
  durationDampening: {
    accelerateAt: 260,
    stopDampeningAt: 900,
  },
};

export const PIPELINE_MOVE_PERSISTENCE_INTERVAL_MS = 135;

export const waitForPipelineMove = (ms: number) =>
  new Promise((resolve) => window.setTimeout(resolve, ms));

export function getLeadTagsSignature(lead?: Pick<PipelineLead, 'tags'> | null) {
  if (!Array.isArray(lead?.tags)) return '';

  return lead.tags
    .map((tag) => `${tag?.id || ''}:${tag?.name || ''}:${tag?.color || ''}`)
    .sort()
    .join('|');
}

export function mergeMovedLeadResponse(
  currentLead: PipelineLead,
  movedLead: Partial<PipelineLead>,
): PipelineLead {
  const responseHasTags = Array.isArray(movedLead.tags);
  const shouldPreserveTags =
    !responseHasTags ||
    (movedLead.tags?.length === 0 && (currentLead.tags?.length || 0) > 0);

  return {
    ...currentLead,
    ...movedLead,
    tags: shouldPreserveTags ? currentLead.tags : movedLead.tags,
    stage: currentLead.stage,
  };
}

export function isPipelineDealStatus(status: unknown): status is PipelineDealStatus {
  return status === 'open' || status === 'won' || status === 'lost';
}

export function getOptimisticDealStatusForStage(
  stage?: StageWithLeads | null,
): PipelineDealStatus | null {
  return getPipelineStageOutcome(stage);
}

export function getOptimisticAutomationDealStatusForStage(
  automations: StageAutomation[] | undefined,
  stageId?: string | null,
): PipelineDealStatus | null {
  return getPipelineStageOutcome({ id: stageId }, automations);
}

export function isUnsafePartialStageDrop(
  stage: Pick<StageWithLeads, 'leads' | 'has_more'> | undefined,
  destinationIndex: number,
  movedLeadId: string,
) {
  if (!stage?.has_more) return false;
  const visibleDestinationCount = stage.leads.filter((lead) => lead.id !== movedLeadId).length;
  return destinationIndex >= visibleDestinationCount;
}

export function shouldKeepLeadForDealStatusFilter(
  status: PipelineDealStatus | null | undefined,
  filter?: string,
) {
  return !filter || !status || filter === status;
}

export function getVisualPendingMoveKey(queryKeyId: string, leadId: string) {
  return `${queryKeyId}\u0000${leadId}`;
}

export function buildStageValueMap(stages: StageWithLeads[]) {
  const map = new Map<string, { totalValue: number }>();

  for (const stage of stages) {
    const apiTotalValue = Number(stage.total_value || 0);
    if (Number.isFinite(apiTotalValue) && apiTotalValue > 0) {
      map.set(stage.id, { totalValue: apiTotalValue });
      continue;
    }

    let totalValue = 0;
    for (const lead of stage.leads || []) {
      if (!lead) continue;

      const interestValue = Number(lead.valor_interesse || 0);
      const propertyPrice =
        lead.interest_property && typeof lead.interest_property === 'object'
          ? Number(lead.interest_property.preco || 0)
          : 0;
      const leadValue =
        Number.isFinite(interestValue) && interestValue > 0
          ? interestValue
          : Number.isFinite(propertyPrice) && propertyPrice > 0
            ? propertyPrice
            : 0;
      totalValue += leadValue;
    }

    if (totalValue > 0) map.set(stage.id, { totalValue });
  }

  return map;
}

export function buildStageCountMetaMap(stages: StageWithLeads[]) {
  const map = new Map<string, StageCountMeta>();

  for (const stage of stages) {
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
}
