import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VimobAPIError } from '../../lib/api/vimob-error.ts';
import { deferred, turn } from './lead-request-runtime-fixture.mjs';
import { contractAPIRuntime, contractHookRuntime, contractUIRuntime, ids, moveBody, revision } from './lead-move-contract-runtime-fixture.mjs';

const incompatible = error => error?.code === 'lead_move_contract_unavailable';

for (const kind of ['board', 'popup']) {
  test(`${kind}: incompatible preflight prevents POST and every optimistic stage change`, async t => {
    const api = contractAPIRuntime();
    const h = contractUIRuntime(kind, { contractError: new api.contract.LeadMoveContractError('synthetic-request') });
    t.after(h.close); await h.start(); await turn();
    assert.equal(h.ui.requests.length, 0);
    assert.equal(h.stage(), 'stage-a');
    assert.deepEqual(h.optimisticWrites, []);
    assert.equal(h.probes.length, 1);
    if (kind === 'board') assert.equal(h.ui.visual().size, 0);
    assert.match(h.ui.notices.join(' '), /Não foi possível mover o lead/);
    assert.doesNotMatch(h.ui.notices.join(' '), /servidor|atualiz|API|revision-v1/i);
  });

  test(`${kind}: awaiting preflight leaves the card at its source without provisional writes`, async t => {
    const h = contractUIRuntime(kind, { pending: true }); t.after(h.close);
    const pending = h.start(); await turn();
    assert.equal(h.ui.requests.length, 0);
    assert.equal(h.stage(), 'stage-a');
    assert.deepEqual(h.optimisticWrites, []);
    if (kind === 'board') assert.equal(h.ui.visual().size, 0);
    h.gate.resolve({ contract: 'revision-v1' }); await pending;
    assert.equal(h.ui.requests.length, 1);
    assert.equal(h.stage(), 'stage-b');
  });

  test(`${kind}: a scope retired while checking compatibility cannot move after A to B to A`, async t => {
    const h = contractUIRuntime(kind, { pending: true }); t.after(h.close);
    const pending = h.start(); await turn();
    if (kind === 'board') {
      h.ui.runtime.switchTo('org-b', 'actor-b', 'sid-b'); h.ui.runtime.scope();
      h.ui.runtime.switchTo('org-a', 'actor-a', 'sid-a'); h.ui.runtime.scope();
    } else {
      h.runtime.detailScope('replacement-lead'); h.runtime.detailScope('lead-a');
    }
    h.gate.resolve({ contract: 'revision-v1' }); await pending;
    assert.equal(h.ui.requests.length, 0);
    assert.equal(h.stage(), 'stage-a');
    assert.deepEqual(h.ui.notices, []);
  });

  test(`${kind}: a warm proof keeps optimistic placement synchronous without a second readiness request`, async t => {
    const h = contractUIRuntime(kind, { warm: true }); t.after(h.close);
    const response = h.ui.deferReply(), pending = h.start();
    assert.equal(h.stage(), 'stage-b');
    assert.equal(h.probes.length, 0); assert.equal(h.optimisticWrites.length, 1);
    await turn();
    response.resolve({ data: { id: 'lead-a', stage_id: 'stage-b', updated_at: revision }, error: null });
    await pending;
  });
}

test('compatible API advertises the exact contract through a noncached, nonretrying, identity-pinned read', async () => {
  const h = contractAPIRuntime(), proof = await h.proof();
  assert.equal(h.requests.length, 1);
  const request = h.requests[0];
  assert.equal(request.path, '/v1/leads/capabilities/move-stage');
  assert.equal(request.options.organizationId, ids.org);
  assert.equal(request.options.cache, 'no-store'); assert.equal(request.options.retry, false);
  assert.equal(request.options.expectedUserId, ids.actor); assert.equal(request.options.expectedSessionId, 'sid-a');
  assert.equal(h.contract.isLeadMoveStageContractCurrent(proof, ids.org, h.intent()), true);
});

test('additive capability response metadata remains readable while the required contract stays exact', async () => {
  const h = contractAPIRuntime();
  h.respond(async () => ({ data: { contract: 'revision-v1', futureReadField: true }, requestId: 'synthetic', meta: { replica: 'new' } }));
  const proof = await h.proof();
  assert.equal(h.contract.isLeadMoveStageContractCurrent(proof, ids.org, h.intent()), true);
  assert.equal(h.requests.length, 1);
});

for (const payload of [undefined, {}, { data: {} }, { data: { contract: 'legacy' } }, { data: { contract: true } }]) {
  test(`unknown capability ${JSON.stringify(payload)} prevents a direct API move without retry or old payload fallback`, async () => {
    const h = contractAPIRuntime(); h.respond(async () => payload);
    await assert.rejects(h.move(), incompatible);
    assert.equal(h.posts().length, 0); assert.equal(h.requests.length, 1);
  });
}

for (const status of [404, 405]) {
  test(`missing capability route HTTP ${status} is actionable and never dispatches the move`, async () => {
    const h = contractAPIRuntime(); h.respond(async () => {
      throw new VimobAPIError('Old API', { status, code: 'api_error', requestId: 'synthetic-request' });
    });
    await assert.rejects(h.move(), error => {
      assert.ok(incompatible(error));
      assert.equal(error.status, 409);
      assert.equal(error.requestId, 'synthetic-request');
      assert.doesNotMatch(error.message, /servidor|atualiz|API|revision-v1/i);
      assert.doesNotMatch(error.technicalMessage, /servidor|atualiz|API|revision-v1/i);
      return true;
    });
    assert.equal(h.posts().length, 0);
  });
}

test('a compatible proof sends exactly one complete CAS request and no extra preflight', async () => {
  const h = contractAPIRuntime(), proof = await h.proof(); await h.move(proof);
  assert.equal(h.requests.length, 2); assert.equal(h.posts().length, 1);
  const request = h.posts()[0];
  assert.equal(request.path, `/v1/leads/${ids.lead}/move-stage`);
  assert.equal(request.options.retry, false);
  assert.deepEqual(request.options.body, moveBody()); assert.equal(request.options.body.expectedUpdatedAt, revision);
});

test('legacy direct callers obtain a contract read before their single CAS write', async () => {
  const h = contractAPIRuntime(); await h.move();
  assert.deepEqual(h.requests.map(request => request.options.method ?? 'GET'), ['GET', 'POST']);
  assert.equal(h.posts()[0].options.body.expectedUpdatedAt, revision);
});

for (const patch of [
  { actor: ids.otherActor }, { sid: 'sid-b' }, { base: 'https://replacement.synthetic.invalid' }, { now: 1_792_238_430_001 },
]) {
  test(`stale proof after changing ${Object.keys(patch)[0]} fails before POST and never silently refreshes`, async () => {
    const h = contractAPIRuntime(), proof = await h.proof(); Object.assign(h.state, patch);
    await assert.rejects(h.move(proof), incompatible);
    assert.equal(h.posts().length, 0); assert.equal(h.requests.length, 1);
  });
}

test('a proof belongs to its organization and cannot be copied or forged', async () => {
  const h = contractAPIRuntime(), proof = await h.proof();
  for (const candidate of [{ ...proof }, { contract: 'revision-v1' }]) {
    await assert.rejects(h.move(candidate), incompatible);
  }
  await assert.rejects(h.move(proof, moveBody(), ids.otherOrg), incompatible);
  assert.equal(h.posts().length, 0);
});

test('an explicitly invalidated proof stays rejected even before its time limit', async () => {
  const h = contractAPIRuntime(), proof = await h.proof(); h.contract.invalidateLeadMoveStageContract(proof);
  await assert.rejects(h.move(proof), incompatible); assert.equal(h.posts().length, 0);
});

for (const [status, code] of [[400, 'invalid_json'], [404, 'api_error']]) {
  test(`mixed replicas ${status}/${code} invalidate readiness and never resend without CAS`, async () => {
    const h = contractAPIRuntime(), proof = await h.proof();
    h.respond(async () => { throw new VimobAPIError('Old replica', { status, code, requestId: 'synthetic-request' }); });
    await assert.rejects(h.move(proof), incompatible);
    assert.equal(h.posts().length, 1); assert.equal(h.requests.length, 2);
    assert.equal(h.posts()[0].options.body.expectedUpdatedAt, revision);
    assert.equal(h.contract.isLeadMoveStageContractCurrent(proof, ids.org, h.intent()), false);
    await assert.rejects(h.move(proof), incompatible); assert.equal(h.posts().length, 1);
  });
}

for (const [status, code] of [[403, 'permission_denied'], [403, 'invalid_json'], [404, 'lead_not_found'], [429, 'lead_move_rate_limited'], [409, 'lead_changed'],
  [409, 'lead_stage_changed'], [400, 'lead_move_destination_unavailable'], [400, 'lead_lost_reason_required'], [503, 'service_unavailable']]) {
  test(`ordinary movement failure ${status}/${code} preserves its original error and never retries`, async () => {
    const h = contractAPIRuntime(), proof = await h.proof(); const original = new VimobAPIError('Domain failure', { status, code });
    h.respond(async () => { throw original; });
    await assert.rejects(h.move(proof), error => error === original);
    assert.equal(h.posts().length, 1); assert.equal(h.requests.length, 2);
  });
}

test('invalid payload is rejected before capability discovery or any transport call', async () => {
  const h = contractAPIRuntime(); await assert.rejects(h.move(undefined, { ...moveBody(), stageId: 'not-a-uuid' }));
  assert.equal(h.requests.length, 0);
});

test('a move without the snapshot revision is rejected before discovering capabilities', async () => {
  const h = contractAPIRuntime(), body = moveBody(); delete body.expectedUpdatedAt;
  await assert.rejects(h.move(undefined, body), error => error.code === 'lead_move_revision_required');
  assert.equal(h.requests.length, 0);
});

test('a proof expiring during token preparation is checked again at actual POST dispatch', async () => {
  const h = contractAPIRuntime(), proof = await h.proof();
  h.beforeDispatch((_path, options) => { if (options.method === 'POST') h.state.now += 30_001; });
  await assert.rejects(h.move(proof), incompatible);
  assert.equal(h.posts().length, 0); assert.equal(h.requests.length, 1);
});

test('identity replacement during a capability read cannot issue readiness for the new session', async () => {
  const h = contractAPIRuntime(), wait = deferred(); h.respond(() => wait.promise);
  const pending = h.proof(); h.state.sid = 'sid-b'; wait.resolve({ data: { contract: 'revision-v1' } });
  const proof = await pending;
  assert.equal(h.contract.isLeadMoveStageContractCurrent(proof, ids.org, h.intent()), false);
  assert.equal(h.posts().length, 0);
});

test('the preloaded React Query contract remains an issued proof and avoids a second GET for a warm gesture', async t => {
  const h = contractHookRuntime(); t.after(h.close); await turn();
  const operation = h.operation(), ready = h.hook().getCurrent(operation);
  assert.ok(ready); assert.equal(h.requests.length, 1);
  assert.equal(await h.hook().ensureCompatible(operation), ready);
  assert.equal(h.requests.length, 1);
  await h.move(ready); assert.equal(h.posts().length, 1);
});

test('an expired preloaded proof requires one new GET and does not revive through Query dataUpdatedAt', async t => {
  const h = contractHookRuntime(); t.after(h.close); await turn();
  const operation = h.operation(), original = h.hook().getCurrent(operation);
  h.state.now += 30_001;
  assert.equal(h.hook().getCurrent(operation), undefined);
  const refreshed = await h.hook().ensureCompatible(operation);
  assert.notEqual(refreshed, original); assert.equal(h.requests.length, 2);
  assert.equal(h.posts().length, 0);
});

for (const patch of [{ org: ids.otherOrg }, { actor: ids.otherActor }, { sid: 'sid-b' }, { base: 'https://replacement.synthetic.invalid' }]) {
  test(`the preloaded query is isolated across ${Object.keys(patch)[0]} and rejects the old visit`, async t => {
    const h = contractHookRuntime(); t.after(h.close); await turn(); const operation = h.operation();
    h.render(patch); await assert.rejects(h.hook().ensureCompatible(operation), incompatible);
    assert.equal(h.posts().length, 0);
  });
}

test('a capability read resolving after A to B to A cannot revive its retired gesture', async t => {
  const h = contractHookRuntime(); t.after(h.close); await turn();
  h.state.now += 30_001; const wait = deferred(); h.respond(() => wait.promise);
  const operation = h.operation(), pending = h.hook().ensureCompatible(operation); await turn();
  h.render({ org: ids.otherOrg }); h.render({ org: ids.org });
  wait.resolve({ data: { contract: 'revision-v1' } });
  await assert.rejects(pending, incompatible); assert.equal(h.posts().length, 0);
});

test('an invalidated proof is not resurrected by a fresh cache timestamp', async t => {
  const h = contractHookRuntime(); t.after(h.close); await turn(); const operation = h.operation();
  const proof = h.hook().getCurrent(operation); h.contract.invalidateLeadMoveStageContract(proof);
  assert.equal(h.hook().getCurrent(operation), undefined);
  const refreshed = await h.hook().ensureCompatible(operation);
  assert.notEqual(refreshed, proof); assert.equal(h.requests.length, 2);
});

for (const failure of ['404', 'malformed']) {
  test(`a ${failure} capability refetch retires the successful proof even inside thirty seconds`, async t => {
    const h = contractHookRuntime(); t.after(h.close); await turn(); const operation = h.operation();
    const previous = h.hook().getCurrent(operation); assert.ok(previous);
    h.respond(async () => {
      if (failure === '404') throw new VimobAPIError('Older replica', { status: 404, code: 'api_error' });
      return { data: { contract: 'legacy' } };
    });
    await h.client.refetchQueries({ queryKey: ['lead-move-contract'], exact: false });
    assert.equal(h.hook().getCurrent(operation), undefined);
    assert.equal(h.contract.isLeadMoveStageContractCurrent(previous, ids.org, h.intent()), false);
    await assert.rejects(h.hook().ensureCompatible(operation), incompatible);
    assert.equal(h.posts().length, 0);
  });
}

test('simultaneous cold gestures share one capability GET and perform no POST', async t => {
  const h = contractHookRuntime(); t.after(h.close); await turn(); h.state.now += 30_001;
  const wait = deferred(); h.respond(() => wait.promise);
  const first = h.hook().ensureCompatible(h.operation()), second = h.hook().ensureCompatible(h.operation());
  await turn(); assert.equal(h.requests.length, 2); assert.equal(h.posts().length, 0);
  wait.resolve({ data: { contract: 'revision-v1' } });
  const [a, b] = await Promise.all([first, second]); assert.equal(a, b);
});

test('popup ignores a repeated stage action while the first compatibility read is pending', async t => {
  const h = contractUIRuntime('popup', { pending: true }); t.after(h.close);
  const first = h.start(); await turn(); await h.start();
  assert.equal(h.probes.length, 1); assert.equal(h.ui.requests.length, 0); assert.deepEqual(h.optimisticWrites, []);
  h.gate.resolve({ contract: 'revision-v1' }); await first;
  assert.equal(h.ui.requests.length, 1);
});

test('popup retired during token preparation aborts before actual POST even when organization and SID return to A', async t => {
  const h = contractUIRuntime('popup', { warm: true, delayDispatch: true }); t.after(h.close);
  const pending = h.start(); await turn();
  assert.equal(h.stage(), 'stage-b'); assert.equal(h.dispatches.length, 0);
  h.runtime.detailScope('replacement-lead'); h.runtime.detailScope('lead-a');
  h.ui.patchLocal({ name: 'Replacement visit', stage_id: 'replacement-stage' });
  h.tokenGate.resolve(); await pending;
  assert.equal(h.dispatches.length, 0); assert.equal(h.ui.requests.length, 0);
  assert.equal(h.stage(), 'replacement-stage'); assert.equal(h.ui.state().localLead.name, 'Replacement visit');
  assert.deepEqual(h.ui.notices, []);
});
