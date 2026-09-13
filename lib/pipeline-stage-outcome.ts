export type PipelineStageOutcome = 'open' | 'won' | 'lost';

export function getOptimisticPipelineMoveOutcome(params: {
  isSameStage: boolean;
  currentDealStatus?: string | null;
  destinationOutcome?: PipelineStageOutcome | null;
}): PipelineStageOutcome | null {
  if (params.isSameStage) return null;
  if (params.destinationOutcome) return params.destinationOutcome;
  return params.currentDealStatus === 'won' || params.currentDealStatus === 'lost'
    ? 'open'
    : null;
}

type PipelineStageOutcomeStage = {
  id?: string | null;
  is_won?: boolean | null;
  is_lost?: boolean | null;
};

type PipelineStageOutcomeAutomation = {
  stage_id?: string | null;
  is_active?: boolean | null;
  automation_type?: string | null;
  action_config?: Record<string, unknown> | null;
  config?: Record<string, unknown> | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function getAutomationOutcome(automation: PipelineStageOutcomeAutomation) {
  const config = asRecord(automation.config);
  const nestedActionConfig = asRecord(config?.action_config);
  const actionConfig = asRecord(automation.action_config) ?? nestedActionConfig ?? config;
  const rawStatus = actionConfig?.deal_status;
  return rawStatus === 'open' || rawStatus === 'won' || rawStatus === 'lost'
    ? rawStatus
    : null;
}

export function getPipelineStageOutcome(
  stage: PipelineStageOutcomeStage | null | undefined,
  automations?: readonly PipelineStageOutcomeAutomation[],
): PipelineStageOutcome | null {
  if (stage?.is_lost) return 'lost';

  const outcomes = (automations || [])
    .filter((automation) =>
      automation.stage_id === stage?.id &&
      automation.is_active !== false &&
      automation.automation_type === 'change_deal_status_on_enter',
    )
    .map(getAutomationOutcome);

  // A lost outcome always requires the preflight reason, even if stale or
  // conflicting configuration also contains a won action.
  if (outcomes.includes('lost')) return 'lost';
  if (stage?.is_won || outcomes.includes('won')) return 'won';
  if (outcomes.includes('open')) return 'open';
  return null;
}
