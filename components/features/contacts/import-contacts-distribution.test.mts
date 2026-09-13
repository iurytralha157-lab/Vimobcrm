import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('./ImportContactsDialog.tsx', import.meta.url),
  'utf8',
);

test('import dialog controls automatic distribution and supports an explicit queue', () => {
  assert.match(source, /auto_distribute:\s*isAutoDistribute/);
  assert.match(source, /round_robin_id:/);
  assert.match(source, /selectedRoundRobin !== 'automatic'/);
  assert.match(source, /useRoundRobins/);
  assert.match(source, /Pelas regras automáticas/);
  assert.doesNotMatch(source, /team_id:/);
  assert.doesNotMatch(source, /Equipe de destino/);
});
