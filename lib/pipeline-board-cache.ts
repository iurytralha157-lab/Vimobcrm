import { replaceEqualDeep } from '@tanstack/react-query';

export type PipelineBoardQueryKey = readonly unknown[];

export interface PipelineBoardLeadLike {
  id: string;
  stage_id?: string | null;
  assigned_user_id?: string | null;
  team_id?: string | null;
  deal_status?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  source?: string | null;
  created_at?: string | null;
  won_at?: string | null;
  lost_at?: string | null;
  tags?: Array<{ id?: string | null }> | null;
  lead_meta?: Array<{
    campaign_id?: string | null;
    campaign_name?: string | null;
    adset_id?: string | null;
    adset_name?: string | null;
    ad_id?: string | null;
    ad_name?: string | null;
    platform?: string | null;
  }> | null;
  valor_interesse?: number | null;
  interest_property?: { preco?: number | null } | null;
  property?: { preco?: number | null } | null;
}

export function pipelineLeadMatchesQueryKeyScope(
  queryKey: PipelineBoardQueryKey,
  lead: PipelineBoardLeadLike,
) {
  const isUnassignedFilter = queryKey[15] === true;
  const filterUserId = typeof queryKey[3] === 'string' ? queryKey[3] : undefined;
  if (
    !isUnassignedFilter &&
    filterUserId &&
    filterUserId !== 'all' &&
    filterUserId !== lead.assigned_user_id
  ) {
    return false;
  }

  const dealStatus = typeof queryKey[7] === 'string' ? queryKey[7] : undefined;
  if (dealStatus && dealStatus !== 'all' && dealStatus !== lead.deal_status) {
    return false;
  }

  const dateFrom = typeof queryKey[4] === 'string' ? Date.parse(queryKey[4]) : NaN;
  const dateTo = typeof queryKey[5] === 'string' ? Date.parse(queryKey[5]) : NaN;
  if (Number.isFinite(dateFrom) && Number.isFinite(dateTo)) {
    const dateMode = queryKey[14] === 'origin' ? 'origin' : 'operational';
    const isOpenOperational = dateMode === 'operational' && lead.deal_status === 'open';
    const eventAt = dateMode === 'origin'
      ? lead.created_at
      : lead.deal_status === 'won'
        ? lead.won_at
        : lead.deal_status === 'lost'
          ? lead.lost_at
          : lead.created_at;
    const eventTime = eventAt ? Date.parse(eventAt) : NaN;
    if (!isOpenOperational && (!Number.isFinite(eventTime) || eventTime < dateFrom || eventTime > dateTo)) {
      return false;
    }
  }

  const tagIds = typeof queryKey[6] === 'string'
    ? new Set(queryKey[6].split(',').map((tagId) => tagId.trim()).filter(Boolean))
    : undefined;
  if (tagIds?.size && !lead.tags?.some((tag) => tag.id && tagIds.has(tag.id))) return false;

  const search = typeof queryKey[8] === 'string' ? queryKey[8].trim().toLocaleLowerCase('pt-BR') : '';
  if (search) {
    const searchable = [lead.name, lead.email, lead.phone]
      .filter((value): value is string => typeof value === 'string')
      .join(' ')
      .toLocaleLowerCase('pt-BR');
    if (!searchable.includes(search)) return false;
  }

  const metaFilters = [
    { index: 9, values: ['campaign_id', 'campaign_name'] as const },
    { index: 10, values: ['adset_id', 'adset_name'] as const },
    { index: 11, values: ['ad_id', 'ad_name'] as const },
  ];
  for (const metaFilter of metaFilters) {
    const expected = typeof queryKey[metaFilter.index] === 'string'
      ? queryKey[metaFilter.index]
      : undefined;
    if (
      expected &&
      !lead.lead_meta?.some((meta) =>
        metaFilter.values.some((field) => meta[field] === expected),
      )
    ) {
      return false;
    }
  }

  const expectedSource = typeof queryKey[12] === 'string' ? queryKey[12] : undefined;
  if (expectedSource && lead.source !== expectedSource) {
    return false;
  }

  const serializedUserIds = typeof queryKey[13] === 'string' ? queryKey[13] : undefined;
  if (!isUnassignedFilter && serializedUserIds === '__none__') return false;
  if (!isUnassignedFilter && serializedUserIds) {
    const visibleUserIds = new Set(serializedUserIds.split(',').filter(Boolean));
    if (!lead.assigned_user_id || !visibleUserIds.has(lead.assigned_user_id)) return false;
  }

  if (isUnassignedFilter && lead.assigned_user_id !== null) return false;

  const teamId = typeof queryKey[16] === 'string' ? queryKey[16] : undefined;
  if (teamId && lead.team_id !== teamId) return false;

  return true;
}

export interface PipelineBoardStageLike<TLead extends PipelineBoardLeadLike> {
  id: string;
  leads: TLead[];
  total_lead_count: number;
  total_value?: number;
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
  const leadValue = getPipelineLeadValue(currentLocation?.lead ?? snapshotLocation.lead);
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

    const totalLeadCount = Math.max(
      Number(stage.total_lead_count ?? stage.leads.length) + countDelta,
      leads.length,
      0,
    );
    const currentTotalValue = Number(stage.total_value);
    const shouldUpdateTotalValue = Number.isFinite(currentTotalValue) && leadValue > 0;
    const totalValue = shouldUpdateTotalValue
      ? Math.max(currentTotalValue + countDelta * leadValue, 0)
      : stage.total_value;

    if (
      !isTargetStage &&
      countDelta === 0 &&
      totalValue === stage.total_value
    ) {
      return stage;
    }

    return {
      ...stage,
      leads,
      total_lead_count: totalLeadCount,
      total_value: totalValue,
      has_more: totalLeadCount > leads.length,
    };
  });
}

export function patchPipelineLeadInBoard<
  TLead extends PipelineBoardLeadLike,
  TStage extends PipelineBoardStageLike<TLead>,
>(
  board: TStage[] | undefined,
  leadId: string,
  patch: Partial<TLead>,
  options?: { keepInDestination?: boolean; destinationIndex?: number },
) {
  if (!board) return board;

  const currentLocation = findPipelineLeadLocation<TLead, TStage>(board, leadId);
  if (!currentLocation) return board;

  const destinationStageId =
    typeof patch.stage_id === 'string' && patch.stage_id
      ? patch.stage_id
      : currentLocation.stageId;

  if (destinationStageId !== currentLocation.stageId) {
    return applyPendingPipelineMoves(board, [
      {
        leadId,
        sourceStageId: currentLocation.stageId,
        destinationStageId,
        destinationIndex: options?.destinationIndex ?? 0,
        fallbackLead: currentLocation.lead,
        optimisticPatch: patch,
        keepInDestination: options?.keepInDestination ?? true,
        version: 0,
      },
    ]);
  }

  const keepLead = options?.keepInDestination ?? true;
  const patchedLead = { ...currentLocation.lead, ...patch } as TLead;
  const previousValue = getPipelineLeadValue(currentLocation.lead);
  const nextValue = keepLead ? getPipelineLeadValue(patchedLead) : 0;

  return board.map((stage) => {
    if (stage.id !== currentLocation.stageId) return stage;
    const leads = keepLead
      ? stage.leads.map((lead) => lead.id === leadId ? patchedLead : lead)
      : stage.leads.filter((lead) => lead.id !== leadId);
    const totalLeadCount = Math.max(
      Number(stage.total_lead_count ?? stage.leads.length) + (keepLead ? 0 : -1),
      leads.length,
      0,
    );
    const currentTotalValue = Number(stage.total_value);
    const totalValue = Number.isFinite(currentTotalValue)
      ? Math.max(currentTotalValue + nextValue - previousValue, 0)
      : stage.total_value;

    return {
      ...stage,
      leads,
      total_lead_count: totalLeadCount,
      total_value: totalValue,
      has_more: totalLeadCount > leads.length,
    };
  });
}

export function getPipelineLeadValue(lead?: PipelineBoardLeadLike | null) {
  const candidates = [
    lead?.valor_interesse,
    lead?.interest_property?.preco,
    lead?.property?.preco,
  ];

  for (const candidate of candidates) {
    const value = Number(candidate ?? 0);
    if (Number.isFinite(value) && value > 0) return value;
  }

  return 0;
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
  const leadValue = getPipelineLeadValue(optimisticLead);

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
    const currentTotalValue = Number(stage.total_value);
    const shouldUpdateTotalValue = Number.isFinite(currentTotalValue) && leadValue > 0;
    const totalValue = shouldUpdateTotalValue
      ? Math.max(currentTotalValue + countDelta * leadValue, 0)
      : stage.total_value;

    if (
      totalLeadCount === stage.total_lead_count &&
      hasMore === stage.has_more &&
      totalValue === stage.total_value
    ) {
      return stage;
    }

    return {
      ...stage,
      total_lead_count: totalLeadCount,
      total_value: totalValue,
      has_more: hasMore,
    };
  });
}
