import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryClient } from '@tanstack/react-query';

import {
  applyPendingPipelineMoves,
  patchPipelineLeadInBoard,
  reconcilePipelineBoardSnapshot,
  restorePipelineLeadSnapshot,
  type PendingPipelineMove,
  type PipelineBoardStageLike,
} from '@/lib/pipeline-board-cache';
import {
  applyScopedLeadStatusPatch,
  rollbackScopedLeadStatusPatch,
} from '@/lib/pipeline-status-cache';
import {
  buildPipelineStageRestorePlans,
  getPipelineStagePaginationAfterPage,
} from '@/lib/pipeline-pagination-state';

type TestLead = {
  id: string;
  stage_id: string;
  organization_id: string;
  deal_status: 'open' | 'won' | 'lost';
  name: string;
  updated_at: string;
  created_at: string;
};
type TestStage = PipelineBoardStageLike<TestLead> & { pagination_count_is_estimate?: boolean };

function lead(id: string, stageId = 'base'): TestLead {
  return {
    id,
    stage_id: stageId,
    organization_id: 'org-synthetic',
    deal_status: 'open',
    name: id,
    updated_at: '2026-10-20T12:00:00Z',
    created_at: '2026-10-01T12:00:00Z',
  };
}

function boardAfterPage(options: { terminal?: boolean; legacy?: boolean } = {}): TestStage[] {
  const count = options.terminal ? 18 : 24;
  const pagination = getPipelineStagePaginationAfterPage({
    totalCount: options.terminal ? 100 : 13,
    loadedCount: count,
    receivedCount: options.terminal ? 6 : 12,
    addedCount: options.terminal ? 6 : 12,
    requestedCount: 12,
    hasMore: options.legacy ? undefined : !options.terminal,
  });
  return [
    { id: 'base', leads: Array.from({ length: count }, (_, i) => lead(`lead-${i}`)), ...pagination },
    { id: 'other', leads: [lead('other-lead', 'other')], total_lead_count: 1, has_more: false },
  ];
}

function move(board: TestStage[], incoming = false): PendingPipelineMove<TestLead> {
  const item = incoming ? board[1].leads[0] : board[0].leads[0];
  const destinationStageId = incoming ? 'base' : 'other';
  return {
    leadId: item.id,
    sourceStageId: item.stage_id,
    destinationStageId,
    destinationIndex: 0,
    fallbackLead: item,
    optimisticPatch: { stage_id: destinationStageId },
    keepInDestination: true,
    version: 1,
  };
}

test('expanded page continuation survives outgoing movement and exact local rollback', () => {
  const initial = boardAfterPage();
  assert.equal(initial[0].total_lead_count, 25);
  assert.equal(initial[0].has_more, true);
  assert.equal(initial[0].pagination_count_is_estimate, true);
  const projected = applyPendingPipelineMoves(initial, [move(initial)]);
  assert.ok(projected);
  assert.equal(projected[0].leads.length, 23);
  assert.equal(projected[0].total_lead_count, 24);
  assert.equal(projected[0].has_more, true);
  assert.equal(projected[0].pagination_count_is_estimate, true);
  const restored = restorePipelineLeadSnapshot(projected, initial, 'lead-0');
  assert.ok(restored);
  assert.equal(restored[0].leads.length, 24);
  assert.equal(restored[0].total_lead_count, 25);
  assert.equal(restored[0].has_more, true);
  assert.equal(restored[0].pagination_count_is_estimate, true);
  assert.deepEqual(restored.flatMap(stage => stage.leads.map(row => row.id)).sort(),
    initial.flatMap(stage => stage.leads.map(row => row.id)).sort());
});

test('expanded page continuation survives incoming movement and status-preserving patches', () => {
  const initial = boardAfterPage();
  const projected = applyPendingPipelineMoves(initial, [move(initial, true)]);
  assert.ok(projected);
  assert.equal(projected[0].leads.length, 25);
  assert.equal(projected[0].total_lead_count, 26);
  assert.equal(projected[0].has_more, true);
  assert.equal(projected[0].pagination_count_is_estimate, true);
  const patched = patchPipelineLeadInBoard(projected, 'lead-0', { deal_status: 'won' });
  assert.ok(patched);
  assert.equal(patched[0].total_lead_count, 26);
  assert.equal(patched[0].has_more, true);
  assert.equal(patched[0].pagination_count_is_estimate, true);
  assert.equal(patched[0].leads.find(row => row.id === 'lead-0')?.deal_status, 'won');
});

for (const legacy of [false, true]) test(`expanded ${legacy ? 'legacy' : 'new API'} page keeps continuation through filtered status removal and rollback`, () => {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  try {
    const initial = boardAfterPage({ legacy });
    const key = ['stages-with-leads', 'org-synthetic', 'pipeline-synthetic',
      undefined, undefined, undefined, undefined, 'open'];
    client.setQueryData(key, initial);
    const rollback = applyScopedLeadStatusPatch(client, 'org-synthetic', 'lead-0', { deal_status: 'lost' });
    const changed = client.getQueryData<TestStage[]>(key);
    assert.ok(changed);
    assert.equal(changed[0].leads.length, 23);
    assert.equal(changed[0].total_lead_count, 24);
    assert.equal(changed[0].has_more, true);
    assert.equal(changed[0].pagination_count_is_estimate, true);
    assert.equal(changed[0].leads.some(row => row.id === 'lead-0'), false);
    rollbackScopedLeadStatusPatch(client, rollback);
    const restored = client.getQueryData<TestStage[]>(key);
    assert.ok(restored);
    assert.equal(restored[0].leads.length, 24);
    assert.equal(restored[0].total_lead_count, 25);
    assert.equal(restored[0].has_more, true);
    assert.equal(restored[0].pagination_count_is_estimate, true);
    assert.equal(restored[0].leads[0].deal_status, 'open');
  } finally { client.clear(); }
});

test('terminal page replaces stale total locally and movement never invents continuation', () => {
  const initial = boardAfterPage({ terminal: true });
  assert.equal(initial[0].total_lead_count, 18);
  assert.equal(initial[0].has_more, false);
  assert.equal(initial[0].pagination_count_is_estimate, false);
  const projected = applyPendingPipelineMoves(initial, [move(initial)]);
  assert.ok(projected);
  assert.equal(projected[0].total_lead_count, 17);
  assert.equal(projected[0].leads.length, 17);
  assert.equal(projected[0].has_more, false);
  assert.equal(projected[0].pagination_count_is_estimate, false);
  const restored = restorePipelineLeadSnapshot(projected, initial, 'lead-0');
  assert.ok(restored);
  assert.equal(restored[0].total_lead_count, 18);
  assert.equal(restored[0].leads.length, 18);
  assert.equal(restored[0].has_more, false);
  assert.equal(restored[0].pagination_count_is_estimate, false);
});

test('terminal filtered status rollback keeps the column exhausted', () => {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  try {
    const initial = boardAfterPage({ terminal: true });
    const key = ['stages-with-leads', 'org-synthetic', 'pipeline-synthetic',
      undefined, undefined, undefined, undefined, 'open'];
    client.setQueryData(key, initial);
    const rollback = applyScopedLeadStatusPatch(client, 'org-synthetic', 'lead-0', { deal_status: 'lost' });
    rollbackScopedLeadStatusPatch(client, rollback);
    const restored = client.getQueryData<TestStage[]>(key);
    assert.ok(restored);
    assert.equal(restored[0].total_lead_count, 18);
    assert.equal(restored[0].has_more, false);
    assert.equal(restored[0].pagination_count_is_estimate, false);
  } finally { client.clear(); }
});

test('restoration continues to its approved cap despite an old total below the desired prefix', () => {
  const stages: TestStage[] = [{ id: 'base', leads: Array.from({ length: 24 }, (_, i) => lead(`lead-${i}`)), total_lead_count: 25, has_more: true }];
  const plans = buildPipelineStageRestorePlans(stages, { base: 1000 });
  assert.deepEqual(plans, [{ stageId: 'base', offset: 24, limit: 36,
    cursorBefore: '2026-10-01T12:00:00Z', cursorBeforeId: 'lead-23' }]);
});

test('a fresh board snapshot replaces the pagination floor after expansion or shrink', () => {
  const previous = boardAfterPage();
  assert.equal(previous[0].pagination_count_is_estimate, true);
  for (const total of [49, 8]) {
    const incoming = previous.map(stage => stage.id === 'base' ? {
      id: stage.id,
      leads: stage.leads.slice(0, Math.min(total, 12)),
      total_lead_count: total,
      has_more: total > 12,
    } : stage);
    const reconciled = reconcilePipelineBoardSnapshot(previous, incoming, []);
    assert.equal(reconciled[0].total_lead_count, total);
    assert.equal(reconciled[0].leads.length, Math.min(total, 12));
    assert.equal(reconciled[0].has_more, total > 12);
    assert.equal(Object.hasOwn(reconciled[0], 'pagination_count_is_estimate'), false);
    assert.equal(reconciled[0].pagination_count_is_estimate, undefined);
  }
});
