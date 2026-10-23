"use client";

import { usePipelines } from "@/hooks/use-stages";

export function useFilterOptionsPipelineId(selectedPipelineId?: string | null) {
  const { data: pipelines = [] } = usePipelines();
  const fallbackPipeline = pipelines.find((pipeline) => pipeline.is_default) || pipelines[0];
  return selectedPipelineId || fallbackPipeline?.id || null;
}
