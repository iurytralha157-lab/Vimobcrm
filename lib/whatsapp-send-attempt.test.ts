import assert from 'node:assert/strict';
import test from 'node:test';

import { runWhatsAppSendAttempt } from './whatsapp-send-attempt';

test('two rapid send actions cannot pass the same attendance confirmation', async () => {
  const lock = { current: false };
  let finishAttendance: (() => void) | undefined;
  const attendance = new Promise<void>((resolve) => { finishAttendance = resolve; });
  let sends = 0;

  const first = runWhatsAppSendAttempt(lock, async () => {
    await attendance;
    sends += 1;
  });
  const second = runWhatsAppSendAttempt(lock, async () => { sends += 1; });

  assert.equal(await second, false);
  assert.equal(sends, 0);
  finishAttendance?.();
  assert.equal(await first, true);
  assert.equal(sends, 1);
  assert.equal(lock.current, false);
});

test('a failed or cancelled attempt releases the composer for retry', async () => {
  const lock = { current: false };
  await assert.rejects(runWhatsAppSendAttempt(lock, async () => {
    throw new Error('attendance failed');
  }), /attendance failed/);
  assert.equal(lock.current, false);
  assert.equal(await runWhatsAppSendAttempt(lock, async () => {}), true);
});
