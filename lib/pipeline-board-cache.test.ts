import assert from 'node:assert/strict';
import test from 'node:test';

import { QueryClient } from '@tanstack/react-query';

import {
  applyPendingPipelineMoves,
  clearPendingPipelineMove,
  clearPendingPipelineMoves,
  getPendingPipelineMoves,
  pipelineBoardMatchesMove,
  reconcilePipelineBoardSnapshot,
  registerPendingPipelineMove,
  restorePipelineLeadSnapshot,
  type PendingPipelineMove,
} from './pipeline-board-cache';

type TestLead = {
  id: string;
  stage_id: string;
  name: string;
  board_order_at?: string;
};

type TestStage = {
  id: string;
  name: string;
  leads: TestLead[];
  total_lead_count: number;
  has_more: boolean;
};

const queryKey = ['stages-with-leads', 'org-1', 'pipeline-1'] as const;

function createBoard(): TestStage[] {
  return [
    {
      id: 'base',
      name: 'Base',
      leads: [
        { id: 'lead-1', stage_id: 'base', name: 'Lead 1' },
        { id: 'lead-2', stage_id: 'base', name: 'Lead 2' },
      ],
      total_lead_count: 2,
      has_more: false,
    },
    {
      id: 'contacted',
      name: 'Contatados',
      leads: [],
      total_lead_count: 0,
      has_more: false,
    },
    {
      id: 'qualified',
      name: 'Qualificados',
      leads: [],
      total_lead_count: 0,
      has_more: false,
    },
  ];
}

function createMove(
  destinationStageId = 'contacted',
  version = 1,
): PendingPipelineMove<TestLead> {
  return {
    leadId: 'lead-1',
    sourceStageId: version === 1 ? 'base' : 'contacted',
    destinationStageId,
    destinationIndex: 0,
    fallbackLead: {
      id: 'lead-1',
      stage_id: destinationStageId,
      name: 'Lead 1',
    },
    optimisticPatch: {
      stage_id: destinationStageId,
      board_order_at: `2026-07-29T00:00:0${version}.000Z`,
    },
    keepInDestination: true,
    version,
  };
}

function leadLocations(board: TestStage[], leadId: string) {
  return board.flatMap((stage) =>
    stage.leads
      .filter((lead) => lead.id === leadId)
      .map(() => stage.id),
  );
}

test('snapshot antigo nunca recoloca o lead na coluna de origem durante o movimento', () => {
  const initialBoard = createBoard();
  const move = createMove();
  const optimisticBoard = applyPendingPipelineMoves(initialBoard, [move]);

  assert.ok(optimisticBoard);
  assert.deepEqual(leadLocations(optimisticBoard, 'lead-1'), ['contacted']);
  assert.deepEqual(optimisticBoard[0].leads.map((lead) => lead.id), ['lead-2']);
  assert.equal(optimisticBoard[0].total_lead_count, 1);
  assert.equal(optimisticBoard[1].total_lead_count, 1);

  const rebasedBoard = reconcilePipelineBoardSnapshot(
    optimisticBoard,
    createBoard(),
    [move],
  );

  assert.deepEqual(leadLocations(rebasedBoard, 'lead-1'), ['contacted']);
  assert.deepEqual(rebasedBoard[0].leads.map((lead) => lead.id), ['lead-2']);
  assert.equal(pipelineBoardMatchesMove(rebasedBoard, move), true);
});

test('structural sharing protege todas as emissoes quando um refetch antigo termina depois do drop', async () => {
  clearPendingPipelineMoves(queryKey);
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  const initialBoard = createBoard();
  let resolveRefetch: ((board: TestStage[]) => void) | undefined;
  const staleRefetch = new Promise<TestStage[]>((resolve) => {
    resolveRefetch = resolve;
  });
  const emissions: TestStage[][] = [];
  let shouldRecord = false;
  const unsubscribe = client.getQueryCache().subscribe(() => {
    if (!shouldRecord) return;
    const board = client.getQueryData<TestStage[]>(queryKey);
    if (board) emissions.push(board);
  });

  client.setQueryData(queryKey, initialBoard);
  const fetchPromise = client.fetchQuery({
    queryKey,
    queryFn: () => staleRefetch,
    structuralSharing: (oldData, newData) =>
      reconcilePipelineBoardSnapshot(
        oldData as TestStage[] | undefined,
        newData as TestStage[],
        getPendingPipelineMoves<TestLead>(queryKey),
      ),
  });

  const move = createMove();
  registerPendingPipelineMove(queryKey, move);
  client.setQueryData<TestStage[]>(queryKey, (old) =>
    applyPendingPipelineMoves(old, [move]),
  );
  shouldRecord = true;
  const optimisticBoard = client.getQueryData<TestStage[]>(queryKey);
  if (optimisticBoard) emissions.push(optimisticBoard);

  resolveRefetch?.(createBoard());
  await fetchPromise;

  assert.ok(emissions.length > 0);
  emissions.forEach((board) => {
    assert.deepEqual(leadLocations(board, 'lead-1'), ['contacted']);
    assert.deepEqual(board[0].leads.map((lead) => lead.id), ['lead-2']);
  });

  unsubscribe();
  clearPendingPipelineMoves(queryKey);
  client.clear();
});

test('segundo movimento do mesmo lead vence respostas e limpezas da versao anterior', () => {
  clearPendingPipelineMoves(queryKey);
  const firstMove = createMove('contacted', 1);
  const secondMove = createMove('qualified', 2);

  registerPendingPipelineMove(queryKey, firstMove);
  registerPendingPipelineMove(queryKey, secondMove);

  assert.equal(clearPendingPipelineMove(queryKey, 'lead-1', 1), false);

  const rebasedBoard = reconcilePipelineBoardSnapshot(
    undefined,
    createBoard(),
    getPendingPipelineMoves<TestLead>(queryKey),
  );

  assert.deepEqual(leadLocations(rebasedBoard, 'lead-1'), ['qualified']);
  assert.equal(rebasedBoard[2].leads[0].stage_id, 'qualified');
  assert.equal(clearPendingPipelineMove(queryKey, 'lead-1', 2), true);
});

test('rollback restaura uma unica copia na posicao original', () => {
  const initialBoard = createBoard();
  const move = createMove();
  const optimisticBoard = applyPendingPipelineMoves(initialBoard, [move]);
  const restoredBoard = restorePipelineLeadSnapshot(
    optimisticBoard,
    initialBoard,
    'lead-1',
  );

  assert.ok(restoredBoard);
  assert.deepEqual(leadLocations(restoredBoard, 'lead-1'), ['base']);
  assert.deepEqual(
    restoredBoard[0].leads.map((lead) => lead.id),
    ['lead-1', 'lead-2'],
  );
  assert.equal(restoredBoard[0].total_lead_count, 2);
  assert.equal(restoredBoard[1].total_lead_count, 0);
});
