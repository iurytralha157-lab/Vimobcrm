import assert from 'node:assert/strict';
import test from 'node:test';

import {
  countImportDistributionOutcome,
  countPendingDistribution,
  createEmptyImportDistributionSummary,
  resolveImportDistributionOutcome,
} from './lead-distribution-outcome';

test('preserva os resultados de distribuicao retornados pelo backend', () => {
  for (const outcome of [
    'assigned',
    'already_assigned',
    'no_matching_queue',
    'no_available_members',
    'skipped',
    'reentry_preserved',
  ] as const) {
    assert.equal(resolveImportDistributionOutcome({
      serverOutcome: outcome,
      reentry: outcome === 'reentry_preserved',
      autoDistribute: outcome !== 'skipped',
    }), outcome);
  }
});

test('faz fallback explicito sem confundir reentrada com falha', () => {
  assert.equal(resolveImportDistributionOutcome({ reentry: true, autoDistribute: true }), 'reentry_preserved');
  assert.equal(resolveImportDistributionOutcome({ reentry: false, autoDistribute: false }), 'skipped');
  assert.equal(resolveImportDistributionOutcome({ reentry: false, autoDistribute: true }), 'unknown');
});

test('agrupa contatos criados que ainda precisam de atribuicao', () => {
  const summary = createEmptyImportDistributionSummary();
  countImportDistributionOutcome(summary, 'assigned');
  countImportDistributionOutcome(summary, 'no_matching_queue');
  countImportDistributionOutcome(summary, 'no_available_members');
  countImportDistributionOutcome(summary, 'unknown');

  assert.equal(summary.assigned, 1);
  assert.equal(countPendingDistribution(summary), 3);
});
