import assert from 'node:assert/strict';
import test from 'node:test';

import { QueryClient } from '@tanstack/react-query';

import {
  applyPendingPipelineMoves,
  clearPendingPipelineMove,
  clearPendingPipelineMoves,
  getPendingPipelineMoves,
  patchPipelineLeadInBoard,
  pipelineLeadMatchesQueryKeyScope,
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
  valor_interesse?: number | null;
  assigned_user_id?: string | null;
  deal_status?: string | null;
};

type TestStage = {
  id: string;
  name: string;
  leads: TestLead[];
  total_lead_count: number;
  total_value?: number;
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

test('movimento otimista e rollback reconciliam os totais monetarios', () => {
  const initialBoard = createBoard();
  initialBoard[0].leads[0].valor_interesse = 250_000;
  initialBoard[0].total_value = 400_000;
  initialBoard[1].total_value = 100_000;

  const optimisticBoard = applyPendingPipelineMoves(initialBoard, [createMove()]);
  assert.ok(optimisticBoard);
  assert.equal(optimisticBoard[0].total_value, 150_000);
  assert.equal(optimisticBoard[1].total_value, 350_000);

  const restoredBoard = restorePipelineLeadSnapshot(
    optimisticBoard,
    initialBoard,
    'lead-1',
  );
  assert.ok(restoredBoard);
  assert.equal(restoredBoard[0].total_value, 400_000);
  assert.equal(restoredBoard[1].total_value, 100_000);
});

test('patch de etapa vindo do detalhe move o card entre colunas imediatamente', () => {
  const initialBoard = createBoard();
  initialBoard[0].leads[0].valor_interesse = 250_000;
  initialBoard[0].total_value = 400_000;
  initialBoard[1].total_value = 100_000;

  const updatedBoard = patchPipelineLeadInBoard(initialBoard, 'lead-1', {
    stage_id: 'contacted',
  });

  assert.ok(updatedBoard);
  assert.deepEqual(leadLocations(updatedBoard, 'lead-1'), ['contacted']);
  assert.equal(updatedBoard[0].total_lead_count, 1);
  assert.equal(updatedBoard[1].total_lead_count, 1);
  assert.equal(updatedBoard[0].total_value, 150_000);
  assert.equal(updatedBoard[1].total_value, 350_000);
});

test('atualizacao do detalhe respeita usuario, equipe e status da chave do board', () => {
  const lead = {
    id: 'lead-1',
    assigned_user_id: 'user-2',
    deal_status: 'open',
  };

  assert.equal(
    pipelineLeadMatchesQueryKeyScope(
      ['stages-with-leads', 'org-1', 'pipeline-1', undefined, null, null, null, 'open', null, null, null, null, null, 'user-1,user-2'],
      lead,
    ),
    true,
  );
  assert.equal(
    pipelineLeadMatchesQueryKeyScope(
      ['stages-with-leads', 'org-1', 'pipeline-1', undefined, null, null, null, 'won', null, null, null, null, null, 'user-1,user-2'],
      lead,
    ),
    false,
  );
  assert.equal(
    pipelineLeadMatchesQueryKeyScope(
      ['stages-with-leads', 'org-1', 'pipeline-1', undefined, null, null, null, undefined, null, null, null, null, null, '__none__'],
      lead,
    ),
    false,
  );
});

test('cache filtrado sem responsavel aceita apenas lead com atribuicao nula', () => {
  const unassignedQueryKey = [
    'stages-with-leads',
    'org-1',
    'pipeline-1',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    true,
  ] as const;

  assert.equal(
    pipelineLeadMatchesQueryKeyScope(unassignedQueryKey, {
      id: 'lead-unassigned',
      assigned_user_id: null,
    }),
    true,
  );
  assert.equal(
    pipelineLeadMatchesQueryKeyScope(unassignedQueryKey, {
      id: 'lead-assigned',
      assigned_user_id: 'user-1',
    }),
    false,
  );
  assert.equal(
    pipelineLeadMatchesQueryKeyScope(unassignedQueryKey, {
      id: 'lead-without-assignment-field',
    }),
    false,
  );

  const unassignedQueryKeyWithLegacyUserFilter: unknown[] = [
    ...unassignedQueryKey,
  ];
  unassignedQueryKeyWithLegacyUserFilter[3] = 'user-1';
  assert.equal(
    pipelineLeadMatchesQueryKeyScope(unassignedQueryKeyWithLegacyUserFilter, {
      id: 'lead-unassigned-with-conflicting-user-filter',
      assigned_user_id: null,
    }),
    true,
  );

  const teamUnassignedQueryKey = [...unassignedQueryKey, 'team-1'] as const;
  assert.equal(
    pipelineLeadMatchesQueryKeyScope(teamUnassignedQueryKey, {
      id: 'lead-unassigned-team-1',
      assigned_user_id: null,
      team_id: 'team-1',
    }),
    true,
  );
  assert.equal(
    pipelineLeadMatchesQueryKeyScope(teamUnassignedQueryKey, {
      id: 'lead-unassigned-team-2',
      assigned_user_id: null,
      team_id: 'team-2',
    }),
    false,
  );
  assert.equal(
    pipelineLeadMatchesQueryKeyScope(teamUnassignedQueryKey, {
      id: 'lead-unassigned-without-team',
      assigned_user_id: null,
    }),
    false,
  );
  assert.equal(
    pipelineLeadMatchesQueryKeyScope(teamUnassignedQueryKey, {
      id: 'lead-unassigned-null-team',
      assigned_user_id: null,
      team_id: null,
    }),
    false,
  );
  assert.equal(
    pipelineLeadMatchesQueryKeyScope(teamUnassignedQueryKey, {
      id: 'lead-now-assigned-team-1',
      assigned_user_id: 'user-1',
      team_id: 'team-1',
    }),
    false,
  );
});

test('cache da pipeline preserva lead que tenha qualquer tag selecionada', () => {
  const queryKeyWithTags = [
    'stages-with-leads',
    'org-1',
    'pipeline-1',
    undefined,
    undefined,
    undefined,
    'tag-1,tag-2',
  ] as const;

  assert.equal(
    pipelineLeadMatchesQueryKeyScope(queryKeyWithTags, {
      id: 'lead-1',
      tags: [{ id: 'tag-2' }],
    }),
    true,
  );
  assert.equal(
    pipelineLeadMatchesQueryKeyScope(queryKeyWithTags, {
      id: 'lead-2',
      tags: [{ id: 'tag-3' }],
    }),
    false,
  );
});

test('patch na mesma etapa ajusta o total de 100 para 250', () => {
  const board = createBoard();
  board[0].leads[0].valor_interesse = 100;
  board[0].total_value = 100;

  const updated = patchPipelineLeadInBoard(board, 'lead-1', {
    valor_interesse: 250,
  });

  assert.ok(updated);
  assert.equal(updated[0].total_value, 250);
  assert.equal(updated[0].leads[0].valor_interesse, 250);
});

test('remove lead, contagem e valor quando ele deixa de pertencer ao escopo', () => {
  const board = createBoard();
  board[0].leads[0].valor_interesse = 250;
  board[0].total_value = 400;

  const updated = patchPipelineLeadInBoard(board, 'lead-1', {
    assigned_user_id: 'user-fora',
  }, { keepInDestination: false });

  assert.ok(updated);
  assert.deepEqual(updated[0].leads.map((lead) => lead.id), ['lead-2']);
  assert.equal(updated[0].total_lead_count, 1);
  assert.equal(updated[0].total_value, 150);
});

test('nao mantem card quando um filtro nao pode ser confirmado pelos dados do cache', () => {
  const filteredKey = [
    'stages-with-leads',
    'org-1',
    'pipeline-1',
    undefined,
    '2026-09-01T00:00:00.000Z',
    '2026-09-30T23:59:59.999Z',
    undefined,
    undefined,
    undefined,
    'campaign-unknown',
    undefined,
    undefined,
    undefined,
    undefined,
    'origin',
  ] as const;

  assert.equal(pipelineLeadMatchesQueryKeyScope(filteredKey, {
    id: 'lead-1',
    deal_status: 'open',
    created_at: '2026-09-08T12:00:00.000Z',
  }), false);
});

test('pagina Meta no cache exige id exato e a mesma linha de atribuicao dos demais filtros', () => {
  const pageAndCampaignKey = [
    'stages-with-leads',
    'org-1',
    'pipeline-1',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    'campaign-1',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    '123456789012345',
  ] as const;

  assert.equal(
    pipelineLeadMatchesQueryKeyScope(pageAndCampaignKey, {
      id: 'lead-same-entry',
      lead_meta: [{ page_id: '123456789012345', campaign_id: 'campaign-1' }],
    }),
    true,
  );
  assert.equal(
    pipelineLeadMatchesQueryKeyScope(pageAndCampaignKey, {
      id: 'lead-cross-entry',
      lead_meta: [
        { page_id: '123456789012345', campaign_id: 'campaign-2' },
        { page_id: '987654321098765', campaign_id: 'campaign-1' },
      ],
    }),
    false,
  );
  assert.equal(
    pipelineLeadMatchesQueryKeyScope(pageAndCampaignKey, {
      id: 'lead-page-name-only',
      lead_meta: [{ page_name: '123456789012345', campaign_id: 'campaign-1' }],
    }),
    false,
  );
  assert.equal(
    pipelineLeadMatchesQueryKeyScope(pageAndCampaignKey, {
      id: 'lead-without-attribution',
    }),
    false,
  );
});

test('filtro de origem do cache segue exatamente a coluna source do backend', () => {
  const filteredKey = [
    'stages-with-leads',
    'org-1',
    'pipeline-1',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    'api',
    undefined,
    'operational',
  ] as const;
  const lead = {
    id: 'lead-1',
    source: 'webhook',
    deal_status: 'open',
    lead_meta: [{ platform: 'api' }],
  };

  assert.equal(pipelineLeadMatchesQueryKeyScope(filteredKey, lead), false);
  assert.equal(
    pipelineLeadMatchesQueryKeyScope(filteredKey, { ...lead, source: 'api' }),
    true,
  );
});
