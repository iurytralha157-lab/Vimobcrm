import type { Stage, StageWithLeads } from '@/hooks/use-stages';
import { PIPELINE_STAGE_COLOR_FALLBACK } from '@/config/pipeline-stage-colors';

export type StageEditorValue = {
  id: string;
  name: string;
  color: string;
  position: number;
  lead_count?: number;
  stage_key?: string;
  updated_at?: string | null;
};

export function toStageEditorValues(stages: Array<Stage | StageWithLeads>): StageEditorValue[] {
  return stages.map((stage) => ({
    id: stage.id,
    name: stage.name,
    color: stage.color || PIPELINE_STAGE_COLOR_FALLBACK,
    position: stage.position ?? 0,
    lead_count: 'total_lead_count' in stage ? stage.total_lead_count ?? stage.leads.length : stage.lead_count ?? 0,
    stage_key: stage.stage_key || undefined,
    updated_at: stage.updated_at,
  }));
}

export function toStageEditorSaveValues(stages: StageEditorValue[], originals: StageEditorValue[]) {
  const originalsById = new Map(originals.map((stage) => [stage.id, stage]));
  return stages.map((stage) => ({
    id: stage.id,
    name: stage.name,
    color: stage.color,
    stage_key: stage.stage_key,
    isNew: !originalsById.has(stage.id),
    expectedUpdatedAt: originalsById.get(stage.id)?.updated_at || undefined,
  }));
}
