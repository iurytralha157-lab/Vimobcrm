import assert from 'node:assert/strict';
import test from 'node:test';
import { runAuthOperationWithTimeout } from './frontend-auth-reliability.ts';
import { createPasswordRecoveryRequestCoordinator } from './password-recovery-request.ts';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('click and Enter share one real request even after the visual timeout and cooldown expire', async () => {
  let now = 0, calls = 0;
  const coordinator = createPasswordRecoveryRequestCoordinator({ now: () => now });
  const response = deferred();
  const first = coordinator.start(() => { calls += 1; return response.promise; });
  assert.ok(first);
  assert.equal(coordinator.start(() => { calls += 1; return Promise.resolve(); }), null);
  assert.deepEqual(await runAuthOperationWithTimeout(() => first.settled, 1), { status: 'timed_out' });
  assert.equal(calls, 1);
  now = 61_000; coordinator.tick();
  assert.deepEqual(coordinator.getSnapshot(), { pending: true, cooldownUntil: 0, remainingSeconds: 0 });
  assert.equal(coordinator.start(() => Promise.resolve()), null);
  response.resolve({ error: { status: 503 } });
  await first.settled;
  assert.equal(coordinator.getSnapshot().pending, false);
  const next = coordinator.start(() => { calls += 1; return Promise.resolve(); });
  assert.ok(next); await next.settled;
  assert.equal(calls, 2);
});

test('success, unknown account, rate limit, SMTP error and rejection have the same public settlement and cooldown', async () => {
  const operations = [
    async () => ({ error: null }),
    async () => ({ error: { status: 400, code: 'user_not_found' } }),
    async () => ({ error: { status: 429, code: 'over_email_send_rate_limit' } }),
    async () => ({ error: { status: 503, message: 'synthetic provider detail' } }),
    async () => { throw new Error('synthetic transport detail'); },
  ];
  const observations = [];
  for (const operation of operations) {
    const coordinator = createPasswordRecoveryRequestCoordinator({ now: () => 1000 });
    const ticket = coordinator.start(operation);
    assert.ok(ticket);
    observations.push({ result: await ticket.settled, snapshot: coordinator.getSnapshot() });
    assert.equal(coordinator.start(operation), null);
  }
  observations.forEach(observation => assert.deepEqual(observation, observations[0]));
  assert.deepEqual(observations[0], { result: undefined, snapshot: { pending: false, cooldownUntil: 61_000, remainingSeconds: 60 } });
  assert.equal(JSON.stringify(observations).includes('synthetic'), false);
});

test('cooldown uses a deadline, survives subscriber remount and stops publishing after expiry', async () => {
  let now = 5000, notices = 0;
  const coordinator = createPasswordRecoveryRequestCoordinator({ now: () => now });
  const unsubscribe = coordinator.subscribe(() => { notices += 1; });
  const ticket = coordinator.start(async () => ({}));
  await ticket.settled;
  unsubscribe();
  now += 59_001; coordinator.tick();
  assert.equal(coordinator.getSnapshot().remainingSeconds, 1);
  assert.equal(coordinator.start(async () => ({})), null);
  const before = notices;
  const unsubscribeAgain = coordinator.subscribe(() => { notices += 1; });
  now += 999; coordinator.tick();
  assert.equal(coordinator.getSnapshot().remainingSeconds, 0);
  assert.equal(coordinator.getSnapshot().cooldownUntil, 0);
  assert.equal(notices, before + 1);
  coordinator.tick(); assert.equal(notices, before + 1);
  assert.equal(coordinator.getServerSnapshot().pending, false);
  assert.equal(coordinator.getServerSnapshot().remainingSeconds, 0);
  unsubscribeAgain();
});
