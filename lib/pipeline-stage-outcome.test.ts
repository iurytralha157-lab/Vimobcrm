import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getOptimisticPipelineMoveOutcome,
  getPipelineStageOutcome,
} from './pipeline-stage-outcome';

test('identifica etapa terminal perdida antes de mover', () => {
  assert.equal(getPipelineStageOutcome({ id: 'lost', is_lost: true }), 'lost');
});

test('identifica automacao perdida em action_config direto ou aninhado', () => {
  const stage = { id: 'stage-1' };

  assert.equal(getPipelineStageOutcome(stage, [{
    stage_id: 'stage-1',
    automation_type: 'change_deal_status_on_enter',
    action_config: { deal_status: 'lost' },
  }]), 'lost');
  assert.equal(getPipelineStageOutcome(stage, [{
    stage_id: 'stage-1',
    automation_type: 'change_deal_status_on_enter',
    config: { action_config: { deal_status: 'lost' } },
  }]), 'lost');
});

test('reordenar dentro da mesma etapa preserva o resultado', () => {
  assert.equal(getOptimisticPipelineMoveOutcome({
    isSameStage: true,
    currentDealStatus: 'won',
    sourceStage: { id: 'won', is_won: true },
    destinationOutcome: 'open',
  }), null);
});

test('arraste entre etapas comuns preserva ganho e perda', () => {
  for (const currentDealStatus of ['won', 'lost']) {
    assert.equal(getOptimisticPipelineMoveOutcome({
      isSameStage: false,
      currentDealStatus,
      sourceStage: { id: 'neutral' },
    }), null);
  }
});

test('saida de etapa terminal reabre quando a regra corresponde ao resultado', () => {
  assert.equal(getOptimisticPipelineMoveOutcome({
    isSameStage: false,
    currentDealStatus: 'lost',
    sourceStage: { id: 'lost', is_lost: true },
  }), 'open');
  assert.equal(getOptimisticPipelineMoveOutcome({
    isSameStage: false,
    currentDealStatus: 'won',
    sourceStage: { id: 'sales' },
    stageAutomations: [{
      stage_id: 'sales', is_active: true, automation_type: 'change_deal_status_on_enter',
      action_config: { deal_status: 'won' },
    }],
  }), 'open');
});

test('origem ambigua preserva o resultado e regra explicita do destino continua valendo', () => {
  const move = {
    isSameStage: false,
    currentDealStatus: 'won',
    sourceStage: { id: 'stage-1', is_won: true, is_lost: true },
  };
  assert.equal(getOptimisticPipelineMoveOutcome(move), null);
  assert.equal(getOptimisticPipelineMoveOutcome({ ...move, destinationOutcome: 'lost' }), 'lost');
});

test('ignora automacao inativa e preserva ganho explicito', () => {
  const stage = { id: 'stage-1', is_won: true };
  assert.equal(getPipelineStageOutcome(stage, [{
    stage_id: 'stage-1',
    is_active: false,
    automation_type: 'change_deal_status_on_enter',
    action_config: { deal_status: 'lost' },
  }]), 'won');
});
