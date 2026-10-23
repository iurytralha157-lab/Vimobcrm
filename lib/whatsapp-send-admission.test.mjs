import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function fixture() {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('./whatsapp-send-admission.ts', import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(code, { exports });
  return exports.reserveWhatsAppSendAdmission;
}
const actor = { organizationId: 'org-a', userId: 'user-a', accessScope: 'revision-a' };

test('reservations retain FIFO before asynchronous preparation or mutation work begins', async () => {
  const reserve = fixture(), events = [];
  const first = reserve(actor, 'session-a', 'conversation-a');
  const second = reserve(actor, 'session-a', 'conversation-a');
  const third = reserve(actor, 'session-a', 'conversation-a');
  assert.equal(first.queued, false); assert.equal(second.queued, true);
  const later = second.wait().then(() => events.push('second'));
  const last = third.wait().then(() => events.push('third'));
  await Promise.resolve(); assert.deepEqual(events, []);
  first.release(); await later; assert.deepEqual(events, ['second']);
  second.release(); await last; assert.deepEqual(events, ['second', 'third']);
  third.release();
});
test('an early canceled reservation cannot let a successor overtake its predecessor', async () => {
  const reserve = fixture(); let entered = false;
  const first = reserve(actor, 'session-a', 'conversation-a');
  const canceled = reserve(actor, 'session-a', 'conversation-a');
  const third = reserve(actor, 'session-a', 'conversation-a');
  canceled.release();
  const pending = third.wait().then(() => { entered = true; });
  await Promise.resolve(); assert.equal(entered, false);
  first.release(); await pending; assert.equal(entered, true); third.release();
});
for (const [name, scope, sessionId, conversationId] of [
  ['organization', { ...actor, organizationId: 'org-b' }, 'session-a', 'conversation-a'],
  ['actor', { ...actor, userId: 'user-b' }, 'session-a', 'conversation-a'],
  ['permission revision', { ...actor, accessScope: 'revision-b' }, 'session-a', 'conversation-a'],
  ['session', actor, 'session-b', 'conversation-a'],
  ['conversation', actor, 'session-a', 'conversation-b'],
]) test(`${name} has independent admission and no fixed pacing`, async () => {
  const reserve = fixture(), held = reserve(actor, 'session-a', 'conversation-a');
  const independent = reserve(scope, sessionId, conversationId);
  assert.equal(independent.queued, false); await independent.wait();
  independent.release(); held.release();
});
test('released lanes are removed and a failed task does not poison later admissions', async () => {
  const reserve = fixture(), first = reserve(actor, 'session-a', 'conversation-a');
  try { await first.wait(); throw Error('synthetic rejection'); } catch { /* owner releases in finally */ }
  finally { first.release(); }
  await Promise.resolve();
  const next = reserve(actor, 'session-a', 'conversation-a');
  assert.equal(next.queued, false); await next.wait(); next.release();
});
test('opaque file receipts coalesce only reservations overlapping the original send', async () => {
  const reserve = fixture(), first = reserve(actor, 'session-a', 'conversation-a');
  const duplicate = reserve(actor, 'session-a', 'conversation-a');
  first.rememberFileIntent('fingerprint', 'original-id');
  first.release(); await duplicate.wait();
  assert.equal(duplicate.fileIntent('fingerprint'), 'original-id');
  assert.equal(duplicate.fileIntent('another-file'), undefined);
  const deliberate = reserve(actor, 'session-a', 'conversation-a');
  duplicate.release(); await deliberate.wait();
  assert.equal(deliberate.fileIntent('fingerprint'), undefined);
  deliberate.release();
});
test('a repeated release cannot widen the overlap boundary of a file receipt', async () => {
  const reserve = fixture(), first = reserve(actor, 'session-a', 'conversation-a');
  const duplicate = reserve(actor, 'session-a', 'conversation-a');
  first.rememberFileIntent('fingerprint', 'original-id'); first.release();
  const later = reserve(actor, 'session-a', 'conversation-a'); first.release();
  await duplicate.wait(); duplicate.release(); await later.wait();
  assert.equal(later.fileIntent('fingerprint'), undefined); later.release();
});
