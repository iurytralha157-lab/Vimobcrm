import assert from 'node:assert/strict';
import test from 'node:test';
import { turn } from './lead-request-runtime-fixture.mjs';
import { firstResponseFeedbackRuntime } from './first-response-feedback-runtime-fixture.mjs';

// Real quick-action handler, activity/first-response hooks, MutationObserver and
// request/detail scopes. Deferred synthetic transport; no network or database.
async function begin(runtime) {
  const pending = runtime.start();
  await runtime.until(() => runtime.byKind('activity').length === 1);
  return { pending, activity: runtime.byKind('activity')[0] };
}

async function reachFirstResponse(runtime) {
  const operation = await begin(runtime);
  runtime.resolve(operation.activity);
  await runtime.until(() => runtime.byKind('first-response').length === 1);
  return { ...operation, response: runtime.byKind('first-response')[0] };
}

function assertRetired(runtime) {
  assert.equal(runtime.state().quickPending, false, 'expired access must release the instance busy state');
  assert.equal(runtime.state().quickPendingRef, false, 'expired access must release the attempt ref');
  assert.equal(runtime.state().outcomeOpen, true, 'an old response cannot close the retained outcome form');
  assert.deepEqual(runtime.stateWrites.filter(write => write.field !== 'quick' || write.value !== false), []);
  assert.deepEqual(runtime.notices, [], 'an old response cannot publish a success/error/retry toast');
}

for (const quickType of ['call', 'email']) {
  test(`quick ${quickType}: normal confirmation completes activity and first response, closes form and releases busy`, async t => {
    const runtime = firstResponseFeedbackRuntime('quick'); t.after(() => runtime.close());
    runtime.render({ quickType });
    const operation = await reachFirstResponse(runtime);
    assert.equal(runtime.state().quickPending, true);
    assert.equal(runtime.state().quickPendingRef, true);
    assert.equal(runtime.state().outcomeOpen, true);
    assert.equal(operation.activity.args[0], 'lead-a');
    assert.equal(operation.activity.args[1].channel, quickType);
    assert.equal(operation.activity.args[1].outcome, quickType === 'call' ? 'answered' : 'replied');
    assert.equal(operation.activity.args[1].notes, 'Synthetic outcome');
    assert.match(operation.activity.args[1].commandId, /^[0-9a-f-]{36}$/i);
    assert.equal(operation.response.args[1].channel, quickType === 'call' ? 'phone' : 'email');
    runtime.resolve(operation.response);
    assert.deepEqual(await operation.pending, { value: true });
    assert.equal(runtime.requests.length, 2);
    assert.equal(runtime.state().outcomeOpen, false);
    assert.equal(runtime.state().quickPending, false);
    assert.equal(runtime.state().quickPendingRef, false);
    assert.deepEqual(runtime.state().quickDraft, { outcome: '', notes: '' });
    assert.deepEqual(runtime.notices, []);
  });
}

test('quick: temporary read block/recovery during activity releases busy without posting first contact or closing form', async t => {
  const runtime = firstResponseFeedbackRuntime('quick'); t.after(() => runtime.close());
  const operation = await begin(runtime);
  runtime.render({ blocked: true }); runtime.render({ blocked: false }); runtime.stateWrites.length = 0;
  runtime.resolve(operation.activity);
  const result = await operation.pending;
  assertRetired(runtime);
  assert.equal(result.value, false);
  assert.equal(runtime.byKind('first-response').length, 0);
  assert.equal(runtime.byKind('activity').length, 1);

  // The same recovered component can start and finish a fresh attempt.
  const next = runtime.start();
  await runtime.until(() => runtime.byKind('activity').length === 2);
  runtime.resolve(runtime.byKind('activity')[1]);
  await runtime.until(() => runtime.byKind('first-response').length === 1);
  runtime.resolve(runtime.byKind('first-response')[0]);
  assert.equal((await next).value, true);
  assert.equal(runtime.state().quickPending, false);
  assert.equal(runtime.state().quickPendingRef, false);
  assert.equal(runtime.state().outcomeOpen, false);
  assert.deepEqual(runtime.notices, []);
});

test('quick: rejected old activity after read recovery releases busy and cannot publish an obsolete error', async t => {
  const runtime = firstResponseFeedbackRuntime('quick'); t.after(() => runtime.close());
  const operation = await begin(runtime);
  runtime.render({ blocked: true }); runtime.render({ blocked: false }); runtime.stateWrites.length = 0;
  runtime.reject(operation.activity);
  const result = await operation.pending;
  assert.ok(result.error, 'the owning confirmation receives the rejected operation and keeps its draft');
  assertRetired(runtime);
  assert.equal(runtime.byKind('first-response').length, 0);
});

for (const settled of ['resolve', 'reject']) {
  test(`quick: ${settled} first-response response after read block/recovery cannot close or warn in the recovered form`, async t => {
    const runtime = firstResponseFeedbackRuntime('quick'); t.after(() => runtime.close());
    const operation = await reachFirstResponse(runtime); operation.response.ignoreAbort = true;
    runtime.render({ blocked: true }); runtime.render({ blocked: false }); runtime.stateWrites.length = 0;
    runtime[settled](operation.response);
    assert.equal((await operation.pending).value, false);
    assertRetired(runtime);
    assert.equal(runtime.byKind('first-response').length, 1);
  });
}

test('quick: overlapping confirmation cannot dispatch a second activity while the first attempt owns busy', async t => {
  const runtime = firstResponseFeedbackRuntime('quick'); t.after(() => runtime.close());
  const operation = await begin(runtime);
  assert.equal((await runtime.start()).value, false);
  assert.equal(runtime.byKind('activity').length, 1);
  runtime.resolve(operation.activity);
  await runtime.until(() => runtime.byKind('first-response').length === 1);
  runtime.resolve(runtime.byKind('first-response')[0]);
  assert.equal((await operation.pending).value, true);
  assert.equal(runtime.state().quickPending, false);
});

test('quick: failed current first response keeps its explicit retry, but read ABA retires that retry', async t => {
  const runtime = firstResponseFeedbackRuntime('quick'); t.after(() => runtime.close());
  const operation = await reachFirstResponse(runtime);
  runtime.reject(operation.response);
  assert.equal((await operation.pending).value, true, 'the activity itself was persisted');
  assert.equal(runtime.notices.length, 1);
  assert.equal(runtime.notices[0].kind, 'warning');
  assert.equal(runtime.notices[0].options.action.label, 'Tentar registro');
  const retry = runtime.notices[0].options.action.onClick;
  runtime.render({ blocked: true }); runtime.render({ blocked: false }); runtime.notices.length = 0;
  retry(); await turn(); await turn();
  assert.equal(runtime.requests.length, 2);
  assert.deepEqual(runtime.notices, []);
  assert.equal(runtime.state().quickPending, false);
});

for (const patch of [{ blocked: true }, { fetching: true }, { allowed: false }, { poolReadOnly: true }, { capability: false }]) {
  test(`quick: current denied or inconclusive state ${JSON.stringify(patch)} returns false without mutations`, async t => {
    const runtime = firstResponseFeedbackRuntime('quick'); t.after(() => runtime.close());
    runtime.render(patch);
    assert.equal((await runtime.start()).value, false);
    assert.deepEqual(runtime.requests, []);
    assert.deepEqual(runtime.notices, []);
    assert.equal(runtime.state().quickPending, false);
    assert.equal(runtime.state().quickPendingRef, false);
  });
}

for (const variant of ['quick', 'card']) test(`${variant}: unknown ACK retries the original command while preserving edited notes`, async t => {
  const runtime = firstResponseFeedbackRuntime(variant); t.after(() => runtime.close());
  const pending = runtime.startOutcome('answered', 'Original result');
  await runtime.until(() => runtime.byKind('activity').length === 1);
  const original = runtime.byKind('activity')[0]; runtime.reject(original, 503);
  assert.ok((await pending).error); assert.equal(runtime.byKind('first-response').length, 0);
  const retryPending = runtime.startOutcome('busy', 'New notes after unknown acknowledgement');
  await runtime.until(() => runtime.byKind('activity').length === 2);
  const retry = runtime.byKind('activity')[1];
  const sent = request => request.args[1]?.commandId ? request.args[1] : request.args[0]?.metadata;
  assert.equal(sent(retry).outcome, sent(original).outcome, 'uncertain retry must reconcile the original result');
  assert.equal(sent(retry).notes, sent(original).notes, 'new notes must not mutate the uncertain command');
  assert.deepEqual(retry.args[1], original.args[1]);
  assert.equal(retry.args[1].outcome, 'answered'); assert.equal(retry.args[1].notes, 'Original result');
  runtime.resolve(retry); await runtime.until(() => runtime.byKind('first-response').length === 1);
  runtime.resolve(runtime.byKind('first-response')[0]);
  assert.equal((await retryPending).value, false, 'newer draft remains open after original receipt');
  assert.deepEqual(runtime.state().quickDraft, { outcome: 'busy', notes: 'New notes after unknown acknowledgement' });
  assert.equal(runtime.state().outcomeOpen, true);
  assert.ok(runtime.notices.some(notice => notice.kind === 'info' && /mantidas/.test(notice.message)));
  const nextPending = runtime.startOutcome('busy', 'New notes after unknown acknowledgement');
  await runtime.until(() => runtime.byKind('activity').length === 3);
  const next = runtime.byKind('activity')[2];
  assert.notEqual(next.args[1].commandId, original.args[1].commandId); assert.equal(next.args[1].outcome, 'busy');
  runtime.reject(next); assert.ok((await nextPending).error);
});
