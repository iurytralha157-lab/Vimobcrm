import assert from 'node:assert/strict';
import test from 'node:test';

// The Node type-stripping runner requires the explicit TypeScript extension.
// @ts-expect-error -- production imports remain extensionless for Next.js.
import { runLeadImportBatch } from './lead-import-batch.ts';

test('imports batches larger than the regular ten-action limit with bounded concurrency', async () => {
  const rows = Array.from({ length: 25 }, (_, index) => index);
  let active = 0;
  let maximumActive = 0;

  const result = await runLeadImportBatch(
    rows,
    async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
    },
    3,
  );

  assert.equal(result.successIndexes.length, 25);
  assert.equal(result.failures.length, 0);
  assert.ok(maximumActive <= 3);
});

test('keeps processing rows after an individual import failure', async () => {
  const result = await runLeadImportBatch([0, 1, 2, 3], async (row) => {
    if (row === 1) throw new Error('invalid row');
  });

  assert.deepEqual(result.successIndexes, [0, 2, 3]);
  assert.deepEqual(result.failures.map(({ index }) => index), [1]);
});
