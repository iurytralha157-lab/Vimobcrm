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

test('imports 5,000 rows with bounded concurrency and exact progress totals', async () => {
  const rows = Array.from({ length: 5_000 }, (_, index) => index);
  let active = 0;
  let maximumActive = 0;
  let lastProgress = null as null | {
    total: number;
    processed: number;
    success: number;
    failed: number;
    remaining: number;
  };

  const result = await runLeadImportBatch(
    rows,
    async (row) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      if (row > 0 && row % 1_000 === 0) throw new Error('invalid row');
    },
    {
      concurrency: 50,
      onProgress: (progress) => {
        lastProgress = progress;
      },
    },
  );

  assert.ok(maximumActive <= 8);
  assert.equal(result.successIndexes.length, 4_996);
  assert.deepEqual(result.failures.map(({ index }) => index), [1_000, 2_000, 3_000, 4_000]);
  assert.deepEqual(lastProgress, {
    total: 5_000,
    processed: 5_000,
    success: 4_996,
    failed: 4,
    remaining: 0,
  });
});
