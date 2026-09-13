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

test('reorder na mesma etapa preserva status terminal e mudanca para etapa comum reabre', () => {
  assert.equal(getOptimisticPipelineMoveOutcome({
    isSameStage: true,
    currentDealStatus: 'won',
    destinationOutcome: 'open',
  }), null);
  assert.equal(getOptimisticPipelineMoveOutcome({
    isSameStage: false,
    currentDealStatus: 'lost',
  }), 'open');
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
