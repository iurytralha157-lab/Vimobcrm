import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { timeoutAttemptPath, writeExclusiveTimeoutIntent } from './queue-browser-timeout-attempt.mjs';

test('timer attempt IDs cannot escape the exact evidence directory', () => {
  assert.ok(timeoutAttemptPath('worker-v2').endsWith('browser-timeout-attempt-worker-v2.json'));
  for (const id of ['', '../other', 'other/file', 'A', 'x'.repeat(49)]) assert.throws(() => timeoutAttemptPath(id));
});

test('concurrent same-attempt reservations allow one intent and retain the unresolved barrier', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vimob-queue-intent-'));
  const filename = path.join(directory, 'intent.json');
  try {
    const results = await Promise.allSettled(Array.from({ length: 5 }, (_, index) => writeExclusiveTimeoutIntent(filename, { status: 'PENDING', index })));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    for (const result of results.filter(result => result.status === 'rejected')) assert.equal(result.reason.code, 'EEXIST');
    const before = await fs.readFile(filename, 'utf8');
    await assert.rejects(() => writeExclusiveTimeoutIntent(filename, { status: 'PENDING' }), { code: 'EEXIST' });
    assert.equal(await fs.readFile(filename, 'utf8'), before);
  } finally { await fs.unlink(filename).catch(() => undefined); await fs.rmdir(directory); }
});
