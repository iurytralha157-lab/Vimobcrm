import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { getPipelineLeadCardClockKey } from '../../../../lib/pipeline-lead-card-clock.ts';
import { evaluateProduction, productionDeclaration } from '../../../../hooks/leads/lead-request-runtime-fixture.mjs';

test('memo clock key follows the real LeadCard formatter at minute/hour boundaries and invalid dates', () => {
  const source = productionDeclaration('components/features/leads/LeadCard.tsx', node => ts.isVariableDeclaration(node) && node.name.getText() === 'formatShortTime');
  const format = evaluateProduction(`const ${source}`, {}, 'formatShortTime');
  const now = Date.parse('2026-10-16T12:00:00Z');
  for (const age of [-1, 0, 9_999, 10_000, 59_999, 60_000, 60_001, 3_599_999, 3_600_000, 3_600_001, 86_400_000, 1_000_000_000]) {
    const stage_entered_at = new Date(now - age).toISOString();
    const lead = { stage_entered_at, created_at: stage_entered_at };
    assert.equal(getPipelineLeadCardClockKey(lead, now), `${format(new Date(stage_entered_at), now)}:${age < 10_000}`);
  }
  assert.equal(getPipelineLeadCardClockKey({ stage_entered_at: 'bad' }, now).split(':')[0], format(new Date('bad'), now));
});
