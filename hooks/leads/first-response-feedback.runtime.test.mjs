import assert from 'node:assert/strict';
import test from 'node:test';
import { turn } from './lead-request-runtime-fixture.mjs';
import { firstResponseFeedbackRuntime, fixtureTask } from './first-response-feedback-runtime-fixture.mjs';

async function begin(runtime, task = fixtureTask) {
  // Do not await start's returned operation: its transport is intentionally pending.
  const pending = runtime.start(task);
  await runtime.until(() => runtime.requests.length === 1);
  return { pending, first: runtime.requests[0] };
}
async function reachFirstResponse(runtime) {
  const operation = await begin(runtime); runtime.resolve(operation.first);
  await runtime.until(() => runtime.byKind('first-response').length === 1);
  return { ...operation, response: runtime.byKind('first-response')[0] };
}
function assertRetiredUi(runtime, result) {
  // Releasing this operation's busy flag is necessary when access later
  // recovers in the same component. It cannot publish outcome/lead state.
  assert.deepEqual(runtime.stateWrites.filter(write => write.field !== 'cadence' || write.value !== false), []);
  if (runtime.variant === 'popup') {
    assert.equal(runtime.state().cadencePending, false); assert.equal(runtime.state().pendingRef, false);
    assert.equal(result.value, false, 'an expired completion must not tell its caller to open the schedule');
  }
}

for (const variant of ['popup', 'card']) {
  test(`${variant}: successful completion/activity and first response retain the normal flow`, async t => {
    const runtime = firstResponseFeedbackRuntime(variant); t.after(() => runtime.close());
    const operation = await reachFirstResponse(runtime); runtime.resolve(operation.response);
    const result = await operation.pending;
    assert.equal(result.error, undefined); assert.deepEqual(runtime.notices, []);
    assert.equal(runtime.requests.length, 2);
    assert.equal(operation.response.args[0], 'lead-a');
    assert.equal(operation.response.args[1].actorUserId, 'actor-a');
    assert.equal(operation.response.intent.expectedSessionId, 'sid-a');
    assert.equal(runtime.client.getQueryState(['lead-history-v2', 'lead-a'])?.isInvalidated ?? true, true);
    if (variant === 'popup') { assert.equal(result.value, true); assert.equal(runtime.state().cadencePending, false); }
    else assert.equal(runtime.state().outcomeOpen, false);
  });

  test(`${variant}: closing during completion/activity suppresses subsequent first-response work`, async t => {
    const runtime = firstResponseFeedbackRuntime(variant); t.after(() => runtime.close());
    const operation = await begin(runtime); runtime.unmount(); runtime.stateWrites.length = 0;
    runtime.resolve(operation.first); const result = await operation.pending;
    assert.equal(runtime.byKind('first-response').length, 0); assert.deepEqual(runtime.notices, []);
    assertRetiredUi(runtime, result);
  });

  test(`${variant}: closing while first response is pending suppresses its abort warning`, async t => {
    const runtime = firstResponseFeedbackRuntime(variant); t.after(() => runtime.close());
    const operation = await reachFirstResponse(runtime); runtime.unmount(); runtime.stateWrites.length = 0;
    const result = await operation.pending;
    assert.equal(operation.response.intent.signal.aborted, true);
    assert.deepEqual(runtime.notices, []); assertRetiredUi(runtime, result);
  });

  test(`${variant}: a late accepted first response after closing cannot publish UI feedback`, async t => {
    const runtime = firstResponseFeedbackRuntime(variant); t.after(() => runtime.close());
    const operation = await reachFirstResponse(runtime); operation.response.ignoreAbort = true;
    runtime.unmount(); runtime.stateWrites.length = 0; runtime.resolve(operation.response); const result = await operation.pending;
    assert.deepEqual(runtime.notices, []); assertRetiredUi(runtime, result);
  });

  test(`${variant}: current first-response failure offers a working retry without repeating the activity`, async t => {
    const runtime = firstResponseFeedbackRuntime(variant); t.after(() => runtime.close());
    const operation = await reachFirstResponse(runtime); runtime.reject(operation.response); await operation.pending;
    assert.equal(runtime.notices.length, 1); assert.equal(runtime.notices[0].kind, 'warning');
    assert.equal(runtime.notices[0].options.action.label, 'Tentar registro');
    runtime.notices[0].options.action.onClick();
    await runtime.until(() => runtime.byKind('first-response').length === 2);
    runtime.resolve(runtime.byKind('first-response')[1]);
    await runtime.until(() => runtime.notices.length === 2);
    assert.equal(runtime.notices[1].kind, 'success');
    assert.equal(runtime.byKind(variant === 'popup' ? 'complete' : 'activity').length, 1);
  });

  test(`${variant}: the first-response invalidation may refetch lead without retiring normal feedback`, async t => {
    const runtime = firstResponseFeedbackRuntime(variant); t.after(() => runtime.close());
    const read = runtime.watchLeadRefetch();
    const operation = await reachFirstResponse(runtime); runtime.resolve(operation.response);
    const result = await operation.pending;
    assert.equal(result.error, undefined); assert.equal(read.reads(), 1);
    assert.deepEqual(runtime.notices, []);
    if (variant === 'popup') { assert.equal(result.value, true); assert.equal(runtime.state().cadencePending, false); }
    else assert.equal(runtime.state().outcomeOpen, false);
    read.resolve();
  });

  test(`${variant}: retained retry clicked after closing sends nothing and shows no obsolete toast`, async t => {
    const runtime = firstResponseFeedbackRuntime(variant); t.after(() => runtime.close());
    const operation = await reachFirstResponse(runtime); runtime.reject(operation.response); await operation.pending;
    const action = runtime.notices[0].options.action;
    runtime.unmount(); runtime.notices.length = 0; action.onClick(); await turn(); await turn();
    assert.equal(runtime.requests.length, 2); assert.deepEqual(runtime.notices, []);
  });

  for (const [name, replacement] of [
    ['lead', { lead: 'lead-b' }], ['tenant', { org: 'org-b' }], ['session', { sid: 'sid-b' }],
    ['actor', { actor: 'actor-b' }], ['permission', { allowed: false }],
    ['capability', { capability: false }], ['queue pool', { poolReadOnly: true }],
  ]) {
    test(`${variant}: ${name} replacement during first response cannot display old feedback`, async t => {
      const runtime = firstResponseFeedbackRuntime(variant); t.after(() => runtime.close());
      const operation = await reachFirstResponse(runtime); operation.response.ignoreAbort = true;
      runtime.render(replacement); runtime.stateWrites.length = 0; runtime.reject(operation.response); const result = await operation.pending;
      assert.deepEqual(runtime.notices, []); assertRetiredUi(runtime, result);
    });

    test(`${variant}: retained retry cannot run after ${name} replacement`, async t => {
      const runtime = firstResponseFeedbackRuntime(variant); t.after(() => runtime.close());
      const operation = await reachFirstResponse(runtime); runtime.reject(operation.response); await operation.pending;
      const action = runtime.notices[0].options.action;
      runtime.render(replacement); runtime.notices.length = 0; action.onClick(); await turn(); await turn();
      assert.equal(runtime.requests.length, 2); assert.deepEqual(runtime.notices, []);
    });
  }

  for (const [name, replacement, original] of [
    ['lead', { lead: 'lead-b' }, { lead: 'lead-a' }], ['tenant', { org: 'org-b' }, { org: 'org-a' }],
    ['session', { sid: 'sid-b' }, { sid: 'sid-a' }], ['permission', { allowed: false }, { allowed: true }],
  ]) test(`${variant}: ${name} ABA cannot revive a retained retry`, async t => {
    const runtime = firstResponseFeedbackRuntime(variant); t.after(() => runtime.close());
    const operation = await reachFirstResponse(runtime); runtime.reject(operation.response); await operation.pending;
    const action = runtime.notices[0].options.action;
    runtime.render(replacement); runtime.render(original); runtime.notices.length = 0;
    action.onClick(); await turn(); await turn();
    assert.equal(runtime.requests.length, 2); assert.deepEqual(runtime.notices, []);
  });

  test(`${variant}: denied capability starts no activity, task completion, or first response`, async t => {
    const runtime = firstResponseFeedbackRuntime(variant); t.after(() => runtime.close());
    runtime.render({ allowed: false }); await runtime.start();
    assert.deepEqual(runtime.requests, []); assert.deepEqual(runtime.notices, []);
  });

  test(`${variant}: an existing human first response does not send another registration`, async t => {
    const runtime = firstResponseFeedbackRuntime(variant); t.after(() => runtime.close());
    runtime.render({ firstResponseAt: '2026-10-16T10:00:00Z' }); const operation = await begin(runtime);
    runtime.resolve(operation.first); await operation.pending;
    assert.equal(runtime.requests.length, 1); assert.deepEqual(runtime.notices, []);
  });
}

test('popup: definitive read blocking retires first-response feedback', async t => {
  const runtime = firstResponseFeedbackRuntime('popup'); t.after(() => runtime.close());
  const operation = await reachFirstResponse(runtime); runtime.render({ blocked: true });
  runtime.notices.length = 0; runtime.stateWrites.length = 0; runtime.reject(operation.response); const result = await operation.pending;
  assert.deepEqual(runtime.notices, []); assertRetiredUi(runtime, result);
});

test('popup: temporary blocked access releases pending state and permits a fresh operation after recovery', async t => {
  const runtime = firstResponseFeedbackRuntime('popup'); t.after(() => runtime.close());
  const first = await reachFirstResponse(runtime); runtime.render({ blocked: true }); runtime.stateWrites.length = 0;
  runtime.reject(first.response); const retired = await first.pending;
  assertRetiredUi(runtime, retired); assert.deepEqual(runtime.notices, []);
  runtime.render({ blocked: false });
  const second = runtime.start(); await runtime.until(() => runtime.byKind('complete').length === 2);
  runtime.resolve(runtime.byKind('complete')[1]); await runtime.until(() => runtime.byKind('first-response').length === 2);
  runtime.resolve(runtime.byKind('first-response')[1]);
  assert.equal((await second).value, true); assert.equal(runtime.state().cadencePending, false);
  assert.equal(runtime.state().pendingRef, false); assert.deepEqual(runtime.notices, []);
});

test('popup: a note cadence completes without inventing a first-contact channel', async t => {
  const runtime = firstResponseFeedbackRuntime('popup'); t.after(() => runtime.close());
  const operation = await begin(runtime, { ...fixtureTask, type: 'note' }); runtime.resolve(operation.first);
  assert.equal((await operation.pending).value, true); assert.equal(runtime.requests.length, 1);
  assert.deepEqual(runtime.notices, []);
});
