import assert from 'node:assert/strict';
import test from 'node:test';

import { replaceEqualDeep } from '@tanstack/query-core';

import { createPipelineStageSnapshot } from './pipeline-stage-snapshot';

interface TestLead {
  id: string;
  stage_id: string;
  stage?: TestStageSnapshot | null;
}

interface TestStage {
  id: string;
  name: string;
  position: number;
  leads: TestLead[];
  total_lead_count: number;
  has_more: boolean;
}

type TestStageSnapshot = Omit<TestStage, 'leads'>;

function moveLead(
  board: TestStage[],
  leadId: string,
  destinationStageId: string,
): TestStage[] {
  const nextBoard = board.map((stage) => ({
    ...stage,
    leads: [...stage.leads],
  }));
  const sourceStage = nextBoard.find((stage) =>
    stage.leads.some((lead) => lead.id === leadId),
  );
  const destinationStage = nextBoard.find((stage) => stage.id === destinationStageId);

  assert.ok(sourceStage);
  assert.ok(destinationStage);

  const leadIndex = sourceStage.leads.findIndex((lead) => lead.id === leadId);
  const [movedLead] = sourceStage.leads.splice(leadIndex, 1);
  destinationStage.leads.push({
    ...movedLead,
    stage_id: destinationStage.id,
    stage: createPipelineStageSnapshot(destinationStage),
  });

  return replaceEqualDeep(board, nextBoard);
}

test('cria snapshot serializavel do estagio sem carregar a lista de leads', () => {
  const stage: TestStage = {
    id: 'stage-a',
    name: 'Base',
    position: 0,
    leads: [],
    total_lead_count: 1,
    has_more: false,
  };
  const lead: TestLead = {
    id: 'lead-1',
    stage_id: stage.id,
    stage: createPipelineStageSnapshot(stage),
  };
  stage.leads.push(lead);

  assert.equal('leads' in (lead.stage as object), false);
  assert.doesNotThrow(() => JSON.stringify(stage));
});

test('centenas de movimentos otimistas nao criam ciclos nem expandem o cache', () => {
  let board: TestStage[] = [
    {
      id: 'stage-a',
      name: 'Base',
      position: 0,
      leads: [],
      total_lead_count: 1,
      has_more: false,
    },
    {
      id: 'stage-b',
      name: 'Contato',
      position: 1,
      leads: [],
      total_lead_count: 0,
      has_more: false,
    },
  ];
  board[0].leads.push({
    id: 'lead-1',
    stage_id: board[0].id,
    stage: createPipelineStageSnapshot(board[0]),
  });

  const initialSerializedLength = JSON.stringify(board).length;

  for (let movement = 0; movement < 500; movement += 1) {
    const destinationStageId = movement % 2 === 0 ? 'stage-b' : 'stage-a';
    board = moveLead(board, 'lead-1', destinationStageId);

    const serialized = JSON.stringify(board);
    const movedLead = board
      .flatMap((stage) => stage.leads)
      .find((lead) => lead.id === 'lead-1');

    assert.ok(movedLead?.stage);
    assert.equal('leads' in movedLead.stage, false);
    assert.ok(serialized.length <= initialSerializedLength + 32);
  }
});
