export type PipelineFilterScopeState = {
  ready: boolean;
  error: unknown | null;
};

export function resolvePipelineFilterScopeState(input: {
  hasSelection: boolean;
  loadEnabled: boolean;
  dataUpdatedAt: number;
  selectionMatchesCachedOptions: boolean;
  queryError: unknown | null;
}): PipelineFilterScopeState {
  if (!input.hasSelection) {
    return { ready: true, error: null };
  }

  const hasUsableCachedOptions =
    input.dataUpdatedAt > 0 && input.selectionMatchesCachedOptions;

  if (input.loadEnabled && input.queryError && !hasUsableCachedOptions) {
    return { ready: false, error: input.queryError };
  }

  return {
    ready: input.loadEnabled && hasUsableCachedOptions,
    error: null,
  };
}
