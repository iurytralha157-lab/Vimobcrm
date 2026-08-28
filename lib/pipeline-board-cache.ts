import { replaceEqualDeep } from '@tanstack/react-query';

export type PipelineBoardQueryKey = readonly unknown[];

export interface PipelineBoardLeadLike {
  id: string;
  stage_id?: string | null;
}

export interface PipelineBoardStageLike<TLead extends PipelineBoardLeadLike> {
  id: string;
  leads: TLead[];
  total_lead_count: number;
  has_more: boolean;
}

export interface PendingPipelineMove<TLead extends PipelineBoardLeadLike> {
  leadId: string;
  sourceStageId: string;
  destinationStageId: string;
  destinationIndex: number;
  fallbackLead: TLead;
  optimisticPatch: Partial<TLead>;
  keepInDestination: boolean;
  version: number;
}

const pendingMovesByQuery = new Map<
  string,
  Map<string, PendingPipelineMove<PipelineBoardLeadLike>>
>();

export function getPipelineBoardQueryKeyId(queryKey: PipelineBoardQueryKey) {
  return JSON.stringify(queryKey);
}

export function registerPendingPipelineMove<TLead extends PipelineBoardLeadLike>(
  queryKey: PipelineBoardQueryKey,
  move: PendingPipelineMove<TLead>,
) {
  const queryKeyId = getPipelineBoardQueryKeyId(queryKey);
  const currentMoves = pendingMovesByQuery.get(queryKeyId);
  const nextMoves = new Map(currentMoves);
  const currentMove = nextMoves.get(move.leadId);

  if (currentMove && currentMove.version > move.version) return;

  // Reinsert so multiple moves are always applied in the order they were made.
  nextMoves.delete(move.leadId);
  nextMoves.set(
    move.leadId,
    move as PendingPipelineMove<PipelineBoardLeadLike>,
  );
  pendingMovesByQuery.set(queryKeyId, nextMoves);
}

export function clearPendingPipelineMove(
  queryKey: PipelineBoardQueryKey,
  leadId: string,
  version?: number,
) {
  const queryKeyId = getPipelineBoardQueryKeyId(queryKey);
  const currentMoves = pendingMovesByQuery.get(queryKeyId);
  const currentMove = currentMoves?.get(leadId);

  if (!currentMoves || !currentMove) return false;
  if (version !== undefined && currentMove.version !== version) return false;

  const nextMoves = new Map(currentMoves);
  nextMoves.delete(leadId);

  if (nextMoves.size === 0) {
    pendingMovesByQuery.delete(queryKeyId);
  } else {
    pendingMovesByQuery.set(queryKeyId, nextMoves);
  }

  return true;
}

export function clearPendingPipelineMoves(queryKey: PipelineBoardQueryKey) {
  pendingMovesByQuery.delete(getPipelineBoardQueryKeyId(queryKey));
}

export function getPendingPipelineMoves<TLead extends PipelineBoardLeadLike>(
  queryKey: PipelineBoardQueryKey,
) {
  const moves = pendingMovesByQuery.get(getPipelineBoardQueryKeyId(queryKey));
  return (moves
    ? [...moves.values()]
    : []) as PendingPipelineMove<TLead>[];
}

export function applyPendingPipelineMoves<
  TLead extends PipelineBoardLeadLike,
  TStage extends PipelineBoardStageLike<TLead>,
>(
  board: TStage[] | undefined,
  moves: readonly PendingPipelineMove<TLead>[],
): TStage[] | undefined {
  if (!board || moves.length === 0) return board;

  return moves.reduce<TStage[]>(
    (currentBoard, move) => applyPendingPipelineMove(currentBoard, move),
    board,
  );
}

export function reconcilePipelineBoardSnapshot<
  TLead extends PipelineBoardLeadLike,
  TStage extends PipelineBoardStageLike<TLead>,
>(
  previousBoard: TStage[] | undefined,
  incomingBoard: TStage[],
  moves: readonly PendingPipelineMove<TLead>[],
) {
  const protectedBoard = applyPendingPipelineMoves(incomingBoard, moves) ?? incomingBoard;
  return replaceEqualDeep(previousBoard, protectedBoard);
}

export function pipelineBoardMatchesMove<
  TLead extends PipelineBoardLeadLike,
  TStage extends PipelineBoardStageLike<TLead>,
>(
  board: readonly TStage[],
  move: PendingPipelineMove<TLead>,
) {
  const locations = board.flatMap((stage) =>
    stage.leads
      .filter((lead) => lead.id === move.leadId)
      .map(() => stage.id),
  );

  if (!move.keepInDestination) return locations.length === 0;

  return locations.length === 1 && locations[0] === move.destinationStageId;
}

export function findPipelineLeadLocation<
  TLead extends PipelineBoardLeadLike,
  TStage extends PipelineBoardStageLike<TLead>,
>(
  board: readonly TStage[] | undefined,
  leadId: string,
) {
  if (!board) return null;

  for (const stage of board) {
    const leadIndex = stage.leads.findIndex((lead) => lead.id === leadId);
    if (leadIndex !== -1) {
      return {
        stageId: stage.id,
        leadIndex,
        lead: stage.leads[leadIndex],
      };
    }
  }

  return null;
}

export function restorePipelineLeadSnapshot<
  TLead extends PipelineBoardLeadLike,
  TStage extends PipelineBoardStageLike<TLead>,
>(
  current: TStage[] | undefined,
  snapshot: TStage[] | undefined,
  leadId: string,
) {
  if (!snapshot) return current;
  if (!current) return snapshot;

  const snapshotLocation = findPipelineLeadLocation<TLead, TStage>(snapshot, leadId);
  if (!snapshotLocation) return current;

  const currentLocation = findPipelineLeadLocation<TLead, TStage>(current, leadId);
  const withoutLead = current.map((stage) => {
    const leads = stage.leads.filter((lead) => lead.id !== leadId);
    return leads.length === stage.leads.length ? stage : { ...stage, leads };
  });
  const targetStageIndex = withoutLead.findIndex(
    (stage) => stage.id === snapshotLocation.stageId,
  );

  if (targetStageIndex === -1) return current;

  const targetStage = withoutLead[targetStageIndex];
  const targetLeads = [...targetStage.leads];
  targetLeads.splice(
    Math.min(snapshotLocation.leadIndex, targetLeads.length),
    0,
    snapshotLocation.lead,
  );

  return withoutLead.map((stage, index) => {
    const isTargetStage = index === targetStageIndex;
    const leads = isTargetStage ? targetLeads : stage.leads;
    let countDelta = 0;

    if (isTargetStage && currentLocation?.stageId !== snapshotLocation.stageId) {
      countDelta += 1;
    }
    if (
      currentLocation &&
      stage.id === currentLocation.stageId &&
      currentLocation.stageId !== snapshotLocation.stageId
    ) {
      countDelta -= 1;
    }

    if (!isTargetStage && countDelta === 0) return stage;

    const totalLeadCount = Math.max(
      Number(stage.total_lead_count ?? stage.leads.length) + countDelta,
      leads.length,
      0,
    );

    return {
      ...stage,
      leads,
      total_lead_count: totalLeadCount,
      has_more: totalLeadCount > leads.length,
    };
  });
}

function applyPendingPipelineMove<
  TLead extends PipelineBoardLeadLike,
  TStage extends PipelineBoardStageLike<TLead>,
>(
  board: TStage[],
  move: PendingPipelineMove<TLead>,
) {
  if (!board.some((stage) => stage.id === move.destinationStageId)) return board;

  const visibleLocations = new Set<string>();
  let visibleLead: TLead | undefined;

  const withoutLead = board.map((stage) => {
    const nextLeads: TLead[] = [];
    let stageChanged = false;

    stage.leads.forEach((lead) => {
      if (lead.id !== move.leadId) {
        nextLeads.push(lead);
        return;
      }

      stageChanged = true;
      visibleLocations.add(stage.id);
      if (!visibleLead || stage.id === move.destinationStageId) {
        visibleLead = lead;
      }
    });

    return stageChanged ? { ...stage, leads: nextLeads } : stage;
  });

  const optimisticLead = {
    ...move.fallbackLead,
    ...(visibleLead ?? {}),
    ...move.optimisticPatch,
    id: move.leadId,
    stage_id: move.destinationStageId,
  } as TLead;

  const withDestination = withoutLead.map((stage) => {
    if (!move.keepInDestination || stage.id !== move.destinationStageId) {
      return stage;
    }

    const leads = [...stage.leads];
    leads.splice(Math.min(Math.max(move.destinationIndex, 0), leads.length), 0, optimisticLead);
    return { ...stage, leads };
  });

  const hadVisibleLead = visibleLocations.size > 0;
  return withDestination.map((stage) => {
    const currentTotal = Number.isFinite(Number(stage.total_lead_count))
      ? Number(stage.total_lead_count)
      : stage.leads.length;
    const actualPresence = visibleLocations.has(stage.id) ? 1 : 0;
    const desiredPresence =
      move.keepInDestination && stage.id === move.destinationStageId ? 1 : 0;
    const countDelta = hadVisibleLead ? desiredPresence - actualPresence : 0;
    const totalLeadCount = Math.max(
      currentTotal + countDelta,
      stage.leads.length,
      0,
    );
    const hasMore = totalLeadCount > stage.leads.length;

    if (
      totalLeadCount === stage.total_lead_count &&
      hasMore === stage.has_more
    ) {
      return stage;
    }

    return {
      ...stage,
      total_lead_count: totalLeadCount,
      has_more: hasMore,
    };
  });
}
