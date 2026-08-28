export type PipelineStageSnapshot<TStage extends { leads: unknown }> = Omit<TStage, 'leads'>;

export function createPipelineStageSnapshot<TStage extends { leads: unknown }>(
  stage: TStage,
): PipelineStageSnapshot<TStage> {
  const { leads, ...snapshot } = stage;
  void leads;
  return snapshot;
}
