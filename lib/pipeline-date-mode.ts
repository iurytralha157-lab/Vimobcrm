export const PIPELINE_DATE_MODES = ['operational', 'origin'] as const;

export type PipelineDateMode = (typeof PIPELINE_DATE_MODES)[number];

export const DEFAULT_PIPELINE_DATE_MODE: PipelineDateMode = 'operational';

export function isPipelineDateMode(value: unknown): value is PipelineDateMode {
  return PIPELINE_DATE_MODES.includes(value as PipelineDateMode);
}

export function resolvePipelineDateModeForRange(
  dateRange?: { from: Date; to: Date } | null,
  requestedMode?: PipelineDateMode,
) {
  if (!dateRange) return undefined;
  return requestedMode ?? DEFAULT_PIPELINE_DATE_MODE;
}
