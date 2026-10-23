import assert from 'node:assert/strict';
import test from 'node:test';
import { firstResponseFeedbackRuntime, fixtureTask } from './first-response-feedback-runtime-fixture.mjs';

// Both real popup handlers, task/first-response hooks and scopes. The transport
// injects canonical responses; it does not emulate or claim a database race.
const notes = 'Anotação nova do atendimento';
async function begin(runtime, outcome = 'scheduled', text = notes, task = fixtureTask) {
  const pending = runtime.confirmOutcome(outcome, text, task);
  await runtime.until(() => runtime.byKind('complete').length === 1);
  return { pending, complete: runtime.byKind('complete')[0] };
}
const canonical = (patch = {}) => ({ id: 'task-a', lead_id: 'lead-a', is_done: true,
  outcome: 'scheduled', outcome_notes: notes, ...patch });

for (const [name, patch] of [
  ['old outcome', { outcome: 'not_answered' }],
  ['different notes', { outcome_notes: 'Anotação de outro gestor' }],
  ['different lead', { lead_id: 'lead-b' }],
  ['different task', { id: 'task-b' }],
  ['not completed', { is_done: false }],
  ['missing outcome', { outcome: null }],
  ['missing nonempty notes', { outcome_notes: null }],
]) {
  test(`cadence: canonical ${name} cannot close result, clear task, register first contact or open Agenda`, async t => {
    const runtime = firstResponseFeedbackRuntime('popup'); t.after(() => runtime.close());
    const operation = await begin(runtime);
    assert.equal(operation.complete.args[0].outcome, 'scheduled');
    assert.equal(operation.complete.args[0].outcomeNotes, notes);
    runtime.resolve(operation.complete, canonical(patch));
    let settled = false;
    operation.pending.then(() => { settled = true; });
    await runtime.until(() => settled || runtime.byKind('first-response').length > 0);
    assert.equal(runtime.byKind('first-response').length, 0, 'divergent canonical result must stop before first contact');
    assert.deepEqual(await operation.pending, { value: false });
    assert.equal(runtime.byKind('complete').length, 1);
    assert.equal(runtime.byKind('first-response').length, 0);
    assert.equal(runtime.state().outcomeOpen, true);
    assert.equal(runtime.state().taskForOutcome, fixtureTask);
    assert.deepEqual(runtime.state().draft, { outcome: 'scheduled', notes });
    assert.equal(runtime.state().scheduleOpen, false);
    assert.equal(runtime.state().cadencePending, false);
    assert.equal(runtime.state().pendingRef, false);
    assert.equal(runtime.stateWrites.some(write => write.field === 'outcome' || write.field === 'taskForOutcome' || write.field === 'scheduleOpen'), false);
    assert.equal(runtime.notices.length, 1);
    assert.equal(runtime.notices[0].kind, 'warning');
    assert.match(runtime.notices[0].message, /anotações foram mantidas/);
  });
}

for (const [type, firstContactChannel, scheduledType] of [
  ['call', 'phone', 'call'], ['email', 'email', 'visit'], ['message', null, 'visit'],
]) {
  test(`cadence ${type}: compatible canonical result preserves first-contact and Agenda behavior`, async t => {
    const runtime = firstResponseFeedbackRuntime('popup'); t.after(() => runtime.close());
    const operation = await begin(runtime, 'scheduled', notes, { ...fixtureTask, type });
    runtime.resolve(operation.complete, canonical());
    if (firstContactChannel) {
      await runtime.until(() => runtime.byKind('first-response').length === 1);
      assert.equal(runtime.byKind('first-response')[0].args[1].channel, firstContactChannel);
      assert.equal(runtime.state().outcomeOpen, true, 'the form stays busy until first contact settles');
      runtime.resolve(runtime.byKind('first-response')[0]);
    }
    assert.deepEqual(await operation.pending, { value: true });
    assert.equal(runtime.byKind('first-response').length, firstContactChannel ? 1 : 0);
    assert.equal(runtime.state().outcomeOpen, false);
    assert.equal(runtime.state().taskForOutcome, null);
    assert.deepEqual(runtime.state().draft, { outcome: '', notes: '' });
    assert.equal(runtime.state().scheduleOpen, true);
    assert.equal(runtime.state().scheduleDefaultType, scheduledType);
    assert.equal(runtime.state().cadencePending, false);
    assert.equal(runtime.state().pendingRef, false);
    assert.deepEqual(runtime.notices, []);
  });
}

test('cadence: canonical notes normalized only by trim confirm the original result', async t => {
  const runtime = firstResponseFeedbackRuntime('popup'); t.after(() => runtime.close());
  const original = '  ' + notes + '\n ';
  const operation = await begin(runtime, 'scheduled', original);
  assert.equal(operation.complete.args[0].outcomeNotes, original, 'the callback does not rewrite the entered notes');
  runtime.resolve(operation.complete, canonical());
  await runtime.until(() => runtime.byKind('first-response').length === 1);
  runtime.resolve(runtime.byKind('first-response')[0]);
  assert.equal((await operation.pending).value, true);
  assert.equal(runtime.state().scheduleOpen, true);
  assert.deepEqual(runtime.notices, []);
});

test('cadence: a compatible non-scheduled result closes without opening Agenda', async t => {
  const runtime = firstResponseFeedbackRuntime('popup'); t.after(() => runtime.close());
  const operation = await begin(runtime, 'not_answered');
  runtime.resolve(operation.complete, canonical({ outcome: 'not_answered' }));
  await runtime.until(() => runtime.byKind('first-response').length === 1);
  runtime.resolve(runtime.byKind('first-response')[0]);
  assert.equal((await operation.pending).value, true);
  assert.equal(runtime.state().outcomeOpen, false);
  assert.equal(runtime.state().taskForOutcome, null);
  assert.equal(runtime.state().scheduleOpen, false);
  assert.deepEqual(runtime.notices, []);
});

test('cadence: HTTP 409 preserves the outcome/task and avoids Agenda or first contact until an explicit new attempt', async t => {
  const runtime = firstResponseFeedbackRuntime('popup'); t.after(() => runtime.close());
  const operation = await begin(runtime);
  runtime.reject(operation.complete, 409);
  const result = await operation.pending;
  assert.equal(result.error?.status, 409);
  assert.equal(runtime.state().outcomeOpen, true);
  assert.equal(runtime.state().taskForOutcome, fixtureTask);
  assert.deepEqual(runtime.state().draft, { outcome: 'scheduled', notes });
  assert.equal(runtime.state().scheduleOpen, false);
  assert.equal(runtime.state().cadencePending, false);
  assert.equal(runtime.state().pendingRef, false);
  assert.equal(runtime.byKind('first-response').length, 0);
  assert.equal(runtime.byKind('complete').length, 1, 'a conflict must not retry the write automatically');
  assert.equal(runtime.notices.length, 1);
  assert.equal(runtime.notices[0].kind, 'error');

  const retry = runtime.confirmOutcome('scheduled', notes);
  await runtime.until(() => runtime.byKind('complete').length === 2);
  assert.equal(runtime.byKind('complete')[1].args[0].outcomeNotes, notes);
  runtime.resolve(runtime.byKind('complete')[1], canonical());
  await runtime.until(() => runtime.byKind('first-response').length === 1);
  runtime.resolve(runtime.byKind('first-response')[0]);
  assert.equal((await retry).value, true);
  assert.equal(runtime.state().scheduleOpen, true);
});
