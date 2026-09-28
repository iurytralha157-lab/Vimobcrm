export type StageEditorDraft<T> = {
  pipelineId: string
  sourceKey: string
  sourceStages: T[]
  stages: T[]
  hasChanges: boolean
}

export function resolveStageEditorDraft<T>(
  draft: StageEditorDraft<T> | null,
  pipelineId: string,
  sourceKey: string,
  latestStages: T[],
) {
  const belongsToPipeline = draft?.pipelineId === pipelineId
  const useDraft = belongsToPipeline && (draft.hasChanges || draft.sourceKey === sourceKey)
  return {
    stages: useDraft ? draft.stages : latestStages,
    sourceStages: useDraft ? draft.sourceStages : latestStages,
    hasChanges: Boolean(useDraft && draft.hasChanges),
    isStale: Boolean(useDraft && draft.hasChanges && draft.sourceKey !== sourceKey),
  }
}

export function updateStageEditorDraft<T>(
  draft: StageEditorDraft<T> | null,
  pipelineId: string,
  sourceKey: string,
  latestStages: T[],
  stages: T[],
  hasChanges: boolean,
): StageEditorDraft<T> {
  const preserveSource = hasChanges && draft?.pipelineId === pipelineId && draft.hasChanges
  return {
    pipelineId,
    sourceKey: preserveSource ? draft.sourceKey : sourceKey,
    sourceStages: preserveSource ? draft.sourceStages : latestStages,
    stages,
    hasChanges,
  }
}
