import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { createPipelineCrudBrowser, ids, revision } from './pipeline-crud-session-runtime-fixture.mjs';

const kinds = ['createPipeline', 'createStage', 'updateStage', 'reorderStages'];
let browser, page, errors;
before(async () => { browser = await createPipelineCrudBrowser(); }, { timeout: 180_000 });
beforeEach(async () => { ({ page, errors } = await browser.open()); });
afterEach(async () => { await page?.close(); assert.deepEqual(errors, []); });
after(async () => { await browser?.close(); });

const state = () => page.evaluate(() => window.h.snapshot());
const start = (kind, mode = 'mutateAsync', old = false) => page.evaluate(({ kind, mode, old }) => window.h.start(kind, mode, old), { kind, mode, old });
const done = async index => {
  await page.waitForFunction(index => ['success', 'error'].includes(window.h.results[index]?.status), index);
  return (await state()).results[index];
};
async function waitGlobal(kind, mode = 'mutateAsync') {
  await page.evaluate(() => { window.h.globalGate = true; window.h.captureAccess(); window.h.saved = window.h.latest; });
  const index = await start(kind, mode);
  await page.waitForFunction(() => window.h.globalEntered === true);
  return index;
}
async function change(patch) {
  await page.evaluate(patch => window.h.change(patch), patch);
  await page.waitForFunction(patch => Object.entries(patch).every(([key, value]) => window.h.scope[key] === value), patch);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve())));
}
async function releaseGlobal() {
  await page.evaluate(() => { window.h.globalGate = false; window.h.releaseGlobal(); });
}
function noReplacementEffects(snapshot) {
  assert.deepEqual(snapshot.callbacks, []);
  assert.deepEqual(snapshot.toasts, []);
  assert.equal(snapshot.ui, 'untouched');
  assert.deepEqual(snapshot.invalidations, [], 'a retired provider access must not be invalidated');
}

for (const kind of kinds) {
  test(`${kind}: normal gesture pins identity, signal and no automatic retry`, async () => {
    const index = await start(kind);
    assert.equal((await done(index)).status, 'success');
    const snapshot = await state();
    assert.equal(snapshot.requests.length, 1);
    const request = snapshot.requests[0];
    assert.equal(request.organizationId, ids.org);
    assert.equal(request.expectedUserId, ids.actor);
    assert.equal(request.expectedSessionId, 'sid-a');
    assert.equal(request.hasSignal, true);
    assert.equal(request.retry, false);
    assert.deepEqual(snapshot.callbacks.map(value => value.event), ['onSuccess', 'onSettled']);
    assert(snapshot.invalidations.every(item => item.keys.every(key => key[1] === ids.org)));
  });

  for (const patch of [{ sid: 'sid-b' }, { actor: ids.otherActor }, { org: ids.otherOrg },
    { actor: null, sid: null, org: null }, { allowed: false }]) {
    test(`${kind}: retired gesture cannot send after global wait ${JSON.stringify(patch)}`, async () => {
      const index = await waitGlobal(kind);
      await change(patch); await releaseGlobal();
      assert.equal((await done(index)).status, 'error');
      const snapshot = await state(); assert.equal(snapshot.requests.length, 0); noReplacementEffects(snapshot);
    });
  }

  test(`${kind}: SID A to B to A cannot revive the gesture or saved callback`, async () => {
    const index = await waitGlobal(kind);
    await change({ sid: 'sid-b' }); await change({ sid: 'sid-a' }); await releaseGlobal();
    assert.equal((await done(index)).status, 'error');
    const old = await start(kind, 'mutateAsync', true);
    assert.equal((await done(old)).status, 'error');
    assert.equal((await state()).requests.length, 0); noReplacementEffects(await state());
  });

  test(`${kind}: ordinary token refresh in the same SID preserves the gesture`, async () => {
    const index = await waitGlobal(kind);
    await change({ nonce: 2 }); await releaseGlobal();
    assert.equal((await done(index)).status, 'success');
    assert.equal((await state()).requests.length, 1);
    assert.equal((await state()).requests[0].expectedSessionId, 'sid-a');
  });

  for (const mode of ['success', 'error']) for (const patch of [{ sid: 'sid-b' }, { org: ids.otherOrg }, { actor: ids.otherActor }]) {
    test(`${kind}: late ${mode} cannot affect replacement access ${JSON.stringify(patch)}`, async () => {
      await page.evaluate(mode => { window.h.replyGate = true; if (mode === 'error') window.h.failure = { status: 503, code: 'synthetic_unavailable' }; window.h.captureAccess(); }, mode);
      const index = await start(kind);
      await page.waitForFunction(() => window.h.requests.length === 1);
      await change(patch);
      await page.evaluate(() => { for (const client of window.h.clients) if (client !== window.h.currentClient) client.clear(); });
      await page.evaluate(() => { window.h.replyGate = false; window.h.releaseReply(); });
      assert.equal((await done(index)).status, 'error');
      const snapshot = await state();
      assert.equal(snapshot.requests.length, 1); assert.equal(snapshot.requests[0].aborted, true);
      noReplacementEffects(snapshot);
      assert(snapshot.cacheCounts.slice(0, -1).every(count => count === 0), 'retired clients must not be repopulated');
    });
  }

  for (const responsePatch of [{ organizationId: ids.otherOrg }, ...(kind === 'createPipeline' || kind === 'createStage'
    ? [] : [{ id: ids.otherPipeline }]), ...(['createStage', 'reorderStages'].includes(kind) ? [{ pipelineId: ids.otherPipeline }] : [])]) {
    test(`${kind}: mismatched response is not accepted ${JSON.stringify(responsePatch)}`, async () => {
      await page.evaluate(patch => window.h.responsePatch = patch, responsePatch);
      const index = await start(kind);
      assert.equal((await done(index)).status, 'error');
      const snapshot = await state(); assert.equal(snapshot.requests.length, 1);
      assert.equal(snapshot.callbacks.filter(value => value.event === 'onSuccess').length, 0);
    });
  }

  test(`${kind}: uncertain failure is not retried despite provider retry default`, async () => {
    await page.evaluate(() => window.h.failure = { status: 503, code: 'synthetic_unavailable' });
    const index = await start(kind);
    assert.equal((await done(index)).status, 'error');
    const snapshot = await state(); assert.equal(snapshot.requests.length, 1);
    assert.deepEqual(snapshot.callbacks.map(value => value.event), ['onError', 'onSettled']);
  });

  test(`${kind}: mutate callback also retires before transport`, async () => {
    await waitGlobal(kind, 'mutate'); await change({ sid: 'sid-b' }); await releaseGlobal();
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 40)));
    const snapshot = await state(); assert.equal(snapshot.requests.length, 0); noReplacementEffects(snapshot);
  });

  test(`${kind}: closing only the editor keeps reconciliation without callbacks`, async () => {
    await page.evaluate(() => { window.h.replyGate = true; window.h.captureAccess(); });
    const index = await start(kind);
    await page.waitForFunction(() => window.h.requests.length === 1);
    await page.evaluate(() => window.h.setMounted(false));
    await page.locator('#ui').waitFor({ state: 'detached' });
    assert.equal((await state()).oldAccessCurrent, true, 'closing the editor does not retire the provider access');
    await page.evaluate(() => { window.h.replyGate = false; window.h.releaseReply(); });
    await done(index);
    const snapshot = await state();
    assert.deepEqual(snapshot.callbacks, []); assert.deepEqual(snapshot.toasts, []);
    assert(snapshot.invalidations.length > 0, 'an accepted write may need reconciliation when reopened');
    assert(snapshot.invalidations.every(item => item.refetchType === 'none' && item.keys.every(key => key[1] === ids.org)));
  });

  test(`${kind}: replacement gesture B remains current after retired ACK A`, async () => {
    await page.evaluate(() => window.h.replyGate = true);
    const first = await start(kind);
    await page.waitForFunction(() => window.h.requests.length === 1);
    await change({ sid: 'sid-b' });
    await page.evaluate(() => window.h.responseAt[1] = { name: 'Reply B' });
    const second = await start(kind);
    await page.waitForFunction(() => window.h.requests.length === 2);
    await page.evaluate(() => { window.h.replyGate = false; window.h.replies[1](); });
    assert.equal((await done(second)).status, 'success');
    await page.waitForFunction(kind => {
      const hook = window.h.latest[kind], data = hook.data;
      return hook.status === 'success' && (Array.isArray(data) ? data[0]?.name : data?.name) === 'Reply B';
    }, kind);
    const before = await state();
    await page.evaluate(() => window.h.replies[0]());
    assert.equal((await done(first)).status, 'error');
    const after = await state();
    assert(after.callbacks.every(item => item.index === second));
    assert.deepEqual(after.invalidations, before.invalidations);
    assert.deepEqual(after.mutations[kind], before.mutations[kind]);
    const data = after.mutations[kind].data;
    assert.equal(Array.isArray(data) ? data[0].name : data.name, 'Reply B');
  });
}

test('reorderStages accepts additional archived rows returned by the canonical ListStages read', async () => {
  await page.evaluate(() => window.h.extraArchived = true);
  const index = await start('reorderStages');
  const result = await done(index);
  assert.equal(result.status, 'success');
  assert.equal(result.value.length, 3);
  assert.equal(result.value.find(row => row.id === ids.otherPipeline)?.is_active, false);
});

for (const divergent of [false, true]) test(`reorderStages preserves the client UUID of a new row: divergent=${divergent}`, async () => {
  await page.evaluate(divergent => {
    const h = window.h, previous = h.input;
    h.input = kind => kind === 'reorderStages' ? {
      pipelineId: h.ids.pipeline,
      stages: [{ id: h.ids.stage, name: 'New stage', color: '#123456', stage_key: 'new_stage', isNew: true }],
    } : previous(kind);
    if (divergent) h.responsePatch = { id: h.ids.otherStage };
  }, divergent);
  const index = await start('reorderStages'), result = await done(index), snapshot = await state();
  assert.equal(result.status, divergent ? 'error' : 'success');
  assert.equal(snapshot.requests.length, 1);
  assert.equal(snapshot.requests[0].body.stages[0].id, ids.stage);
  assert.equal(snapshot.requests[0].body.stages[0].isNew, true);
  if (!divergent) assert.equal(result.value[0].id, ids.stage);
  else assert.equal(snapshot.callbacks.filter(item => item.event === 'onSuccess').length, 0);
});

test('closing the deletion resource retires its callback while preserving captured cache reconciliation', async () => {
  await page.evaluate(() => {
    window.h.captureAccess();
    window.h.deletionInput = window.h.deletion.capture({ id: window.h.ids.stage, expectedUpdatedAt: window.h.version });
    window.h.deletionGuard = window.h.deletion.captureScopeGuard();
  });
  await change({ resource: null });
  const result = await page.evaluate(() => {
    const h = window.h;
    const current = h.deletion.isCurrent(h.deletionInput), callbackCurrent = h.deletionGuard();
    h.deletion.settled(h.deletionInput);
    return { current, callbackCurrent, ...h.snapshot() };
  });
  assert.equal(result.current, false);
  assert.equal(result.callbackCurrent, false);
  assert.equal(result.oldAccessCurrent, true);
  assert.equal(result.requests.length, 0);
  assert.equal(result.invalidations.length, 1);
  assert.equal(result.invalidations[0].refetchType, 'none');
  assert(result.invalidations[0].keys.length > 0);
  assert(result.invalidations[0].keys.every(key => key[1] === ids.org));
});

test('reorderStages captures nested order, fields and microsecond revisions before onMutate awaits', async () => {
  const index = await waitGlobal('reorderStages');
  await page.evaluate(index => {
    const input = window.h.inputs[index];
    input.pipelineId = window.h.ids.otherPipeline;
    Object.assign(input.stages[0], { name: 'Changed after gesture', expectedUpdatedAt: '2026-10-20T11:00:00Z', stage_key: 'changed' });
    input.stages.reverse(); input.stages.push({ ...input.stages[0], id: window.h.ids.otherPipeline });
  }, index);
  await releaseGlobal(); assert.equal((await done(index)).status, 'success');
  const request = (await state()).requests[0];
  assert.equal(request.url, `/v1/pipelines/${ids.pipeline}/stages/reorder`);
  assert.deepEqual(request.body.stages.map(item => ({ id: item.id, name: item.name, stageKey: item.stageKey, revision: item.expectedUpdatedAt })), [
    { id: ids.stage, name: 'First', stageKey: 'first', revision }, { id: ids.otherStage, name: 'Second', stageKey: 'second', revision },
  ]);
});
