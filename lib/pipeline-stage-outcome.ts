export type PipelineStageOutcome = 'open' | 'won' | 'lost';

export function getOptimisticPipelineMoveOutcome(params: {
  isSameStage: boolean;
  currentDealStatus?: string | null;
  destinationOutcome?: PipelineStageOutcome | null;
  sourceStage: PipelineStageOutcomeStage | null | undefined;
  stageAutomations?: readonly PipelineStageOutcomeAutomation[];
}): PipelineStageOutcome | null {
  if (params.isSameStage) return null;
  if (params.destinationOutcome) return params.destinationOutcome;
  const status = params.currentDealStatus;
  if (status !== 'won' && status !== 'lost') return null;
  const sourceOutcomes = getConfiguredStageOutcomes(params.sourceStage, params.stageAutomations);
  return sourceOutcomes.size === 1 && sourceOutcomes.has(status) ? 'open' : null;
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

function getConfiguredStageOutcomes(
  stage: PipelineStageOutcomeStage | null | undefined,
  automations: readonly PipelineStageOutcomeAutomation[] = [],
): Set<PipelineStageOutcome> {
  const outcomes = new Set<PipelineStageOutcome>();
  if (stage?.is_lost) outcomes.add('lost');
  if (stage?.is_won) outcomes.add('won');
  for (const automation of automations) {
    if (!stage?.id || automation.stage_id !== stage.id || automation.is_active === false ||
        automation.automation_type !== 'change_deal_status_on_enter') continue;
    const outcome = getAutomationOutcome(automation);
    if (outcome) outcomes.add(outcome);
  }
  return outcomes;
}

export function getPipelineStageOutcome(
  stage: PipelineStageOutcomeStage | null | undefined,
  automations?: readonly PipelineStageOutcomeAutomation[],
): PipelineStageOutcome | null {
  const outcomes = getConfiguredStageOutcomes(stage, automations);
  // A lost outcome always requires the preflight reason, even if stale or
  // conflicting configuration also contains a won action.
  if (outcomes.has('lost')) return 'lost';
  if (outcomes.has('won')) return 'won';
  if (outcomes.has('open')) return 'open';
  return null;
}
