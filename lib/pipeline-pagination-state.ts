export const PIPELINE_STAGE_PAGE_SIZE = 12;
export const PIPELINE_STAGE_RESTORE_LIMIT = 60;

export type PipelinePaginationLead = {
  id: string;
  board_sort_at?: string | null;
  board_order_at?: string | null;
  stage_entered_at?: string | null;
  created_at?: string | null;
};

export type PipelinePaginationStage = {
  id: string;
  leads: PipelinePaginationLead[];
  total_lead_count: number;
  has_more?: boolean;
};

export type PipelineStageLoadedCounts = Record<string, number>;

export type PipelineStageRestorePlan = {
  stageId: string;
  offset: number;
  limit: number;
  cursorBefore?: string;
  cursorBeforeId?: string;
};

export function getPipelineLeadPageCursor(lead?: PipelinePaginationLead | null) {
  if (!lead) return {};

  const cursorBefore =
    lead.board_sort_at ||
    lead.board_order_at ||
    lead.stage_entered_at ||
    lead.created_at ||
    undefined;

  return {
    cursorBefore,
    cursorBeforeId: cursorBefore ? lead.id : undefined,
  };
}

export function normalizePipelineStageLoadedCounts(
  value: unknown,
): PipelineStageLoadedCounts {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const normalized: PipelineStageLoadedCounts = {};
  for (const [stageId, rawCount] of Object.entries(value)) {
    const count = Number(rawCount);
    if (!stageId || !Number.isFinite(count)) continue;

    const boundedCount = Math.min(
      Math.max(Math.trunc(count), 0),
      PIPELINE_STAGE_RESTORE_LIMIT,
    );
    if (boundedCount > PIPELINE_STAGE_PAGE_SIZE) {
      normalized[stageId] = boundedCount;
    }
  }

  return normalized;
}

export function parsePipelineStageLoadedCounts(
  rawValue: string | null,
): PipelineStageLoadedCounts {
  if (!rawValue) return {};

  try {
    return normalizePipelineStageLoadedCounts(JSON.parse(rawValue));
  } catch {
    return {};
  }
}

export function mergePipelineStageLoadedCounts(
  ...snapshots: Array<PipelineStageLoadedCounts | null | undefined>
): PipelineStageLoadedCounts {
  const merged: PipelineStageLoadedCounts = {};

  for (const snapshot of snapshots) {
    const normalized = normalizePipelineStageLoadedCounts(snapshot);
    for (const [stageId, count] of Object.entries(normalized)) {
      merged[stageId] = Math.max(merged[stageId] || 0, count);
    }
  }

  return merged;
}

export function getPipelineStageLoadedCountsFromBoard(
  stages?: PipelinePaginationStage[] | null,
) {
  return normalizePipelineStageLoadedCounts(
    Object.fromEntries(
      (stages || []).map((stage) => [stage.id, stage.leads?.length || 0]),
    ),
  );
}

export function buildPipelineStageRestorePlans(
  stages: PipelinePaginationStage[],
  desiredCounts: PipelineStageLoadedCounts,
): PipelineStageRestorePlan[] {
  const normalizedCounts = normalizePipelineStageLoadedCounts(desiredCounts);

  return stages.flatMap((stage) => {
    if (stage.has_more === false) return [];

    const loadedCount = stage.leads?.length || 0;
    const desiredCount = Math.min(
      normalizedCounts[stage.id] || loadedCount,
      Math.max(Number(stage.total_lead_count) || 0, loadedCount),
      PIPELINE_STAGE_RESTORE_LIMIT,
    );
    const missingCount = desiredCount - loadedCount;
    if (missingCount <= 0) return [];

    const cursor = getPipelineLeadPageCursor(stage.leads.at(-1));
    return [{
      stageId: stage.id,
      offset: loadedCount,
      limit: missingCount,
      ...cursor,
    }];
  });
}

export function createPipelinePaginationStorageKey(
  viewerId: string,
  queryKey: readonly unknown[],
) {
  const fingerprint = JSON.stringify(queryKey);
  return `vimob:pipeline:loaded:${viewerId}:${hashPipelinePaginationScope(fingerprint)}`;
}

function hashPipelinePaginationScope(value: string) {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }

  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
}
