import { PIPELINE_STAGE_COLOR_FALLBACK } from '@/config/pipeline-stage-colors';

export interface StageSettingsSnapshot {
  id: string;
  name: string;
  color: string;
  is_qualified?: boolean;
  updated_at?: string | null;
}

export interface StageGeneralValues { name: string; color: string; isQualified: boolean }

export function stageGeneralChanges(base: StageSettingsSnapshot, values: StageGeneralValues) {
  const changes: { name?: string; color?: string; isQualified?: boolean } = {};
  if (values.name.trim() !== base.name) changes.name = values.name.trim();
  if (values.color !== (base.color || PIPELINE_STAGE_COLOR_FALLBACK)) changes.color = values.color;
  if (values.isQualified !== Boolean(base.is_qualified)) changes.isQualified = values.isQualified;
  return changes;
}

export function stageSettingsRevision(base: StageSettingsSnapshot) {
  if (!base.updated_at) throw new Error('Reabra a configuração para carregar a versão atual da coluna. Seu rascunho foi mantido.');
  return base.updated_at;
}
