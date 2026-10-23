import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { VimobAPIError } from '../../lib/api/vimob-error.ts';
import { turn } from '../leads/lead-request-runtime-fixture.mjs';
import { pipelineRoundRobinRuntime, ids, revision, nextRevision } from './pipeline-round-robin-runtime-fixture.mjs';

test('round-robin captures revision, fields, actor and SID before global onMutate waits', async () => {
  const f = pipelineRoundRobinRuntime();
  try {
    const hook = f.render(), input = f.input(); f.waitGlobal(); const pending = hook.mutateAsync(input);
    Object.assign(input, { expectedRevision: nextRevision, roundRobinId: null, pipelineId: ids.queue });
    await turn(); assert.equal(f.requests.length, 0); f.releaseGlobal(); const result = await pending;
    assert.equal(result.id, ids.pipeline); assert.equal(f.requests.length, 1);
    const { url, input: request } = f.requests[0]; assert.equal(url, `/v1/pipelines/${ids.pipeline}/round-robin`);
    assert.deepEqual(request.body, { roundRobinId: ids.queue, expectedRevision: revision });
    assert.equal(request.organizationId, ids.org); assert.equal(request.expectedUserId, ids.actor);
    assert.equal(request.expectedSessionId, 'sid-a'); assert.equal(request.retry, false); assert.equal(f.options[0].retry, false);
    assert.equal(f.notices.filter(item => item.kind === 'success').length, 1);
  } finally { f.close(); }
});

test('removing a fallback sends explicit null with the displayed original revision', async () => {
  const f = pipelineRoundRobinRuntime();
  try {
    await f.render().mutateAsync({ ...f.input(), roundRobinId: null });
    assert.deepEqual(f.requests[0].input.body, { roundRobinId: null, expectedRevision: revision });
  } finally { f.close(); }
});

for (const code of ['pipeline_changed', 'round_robin_busy']) test(`${code} is reported once without retry or revision rebase`, async () => {
  const f = pipelineRoundRobinRuntime();
  try {
    f.fail(new VimobAPIError('Review selection', { status: 409, code }));
    await assert.rejects(f.render().mutateAsync(f.input()), error => error.code === code);
    await turn(); assert.equal(f.requests.length, 1); assert.equal(f.requests[0].input.body.expectedRevision, revision);
    assert.equal(f.notices.filter(item => item.kind === 'error').length, 1);
    assert(f.invalidations.every(value => value.keys.every(key => key[1] === ids.org)));
  } finally { f.close(); }
});

for (const replacement of [{ org: ids.otherOrg }, { actor: ids.queue }, { sid: 'sid-b' }, { allowed: false }]) test('global wait cannot dispatch under replacement access ' + JSON.stringify(replacement), async () => {
  const f = pipelineRoundRobinRuntime();
  try {
    const old = f.render(); f.waitGlobal(); const pending = old.mutateAsync(f.input());
    const rejected = assert.rejects(pending, error => error.code === 'pipeline_scope_changed');
    await turn(); f.render(replacement); f.releaseGlobal(); await rejected;
    assert.equal(f.requests.length, 0); assert.deepEqual(f.notices, []);
    assert.deepEqual(f.invalidations, [], 'retired access cannot invalidate its former cache');
  } finally { f.close(); }
});

test('SID A to B to A never revives an old pending gesture or old initiating hook', async () => {
  const f = pipelineRoundRobinRuntime();
  try {
    const old = f.render(); f.waitGlobal(); const pending = old.mutateAsync(f.input());
    const rejected = assert.rejects(pending, error => error.code === 'pipeline_scope_changed');
    await turn(); f.render({ sid: 'sid-b' }); f.render({ sid: 'sid-a' }); f.releaseGlobal(); await rejected;
    await assert.rejects(old.mutateAsync(f.input()), error => error.code === 'pipeline_scope_changed');
    assert.throws(() => old.mutate(f.input()), error => error.code === 'pipeline_scope_changed');
    assert.equal(f.requests.length, 0); assert.deepEqual(f.notices, []);
  } finally { f.close(); }
});

test('ordinary token refresh in the same SID preserves the original gesture', async () => {
  const f = pipelineRoundRobinRuntime();
  try {
    const hook = f.render(); f.waitGlobal(); const pending = hook.mutateAsync(f.input()); await turn(); f.render({ nonce: 2 }); f.releaseGlobal();
    await pending; assert.equal(f.requests.length, 1); assert.equal(f.requests[0].input.expectedSessionId, 'sid-a');
  } finally { f.close(); }
});

for (const mode of ['unmount', 'org', 'SID']) test(`late accepted response after ${mode} cannot show success or reconcile replacement scope`, async () => {
  const f = pipelineRoundRobinRuntime();
  try {
    const reply = f.deferReply(), pending = f.render().mutateAsync(f.input());
    const rejected = assert.rejects(pending, error => error.code === 'pipeline_scope_changed');
    await turn(); assert.equal(f.requests.length, 1);
    if (mode === 'unmount') f.unmount(); else f.render(mode === 'org' ? { org: ids.otherOrg } : { sid: 'sid-b' });
    reply.resolve(); await rejected; assert.deepEqual(f.notices, []);
    assert.equal(f.requests[0].input.signal.aborted, true);
    assert(f.invalidations.every(value => value.refetchType === 'none' && value.keys.every(key => key[1] === ids.org)));
  } finally { f.close(); }
});

for (const patch of [{ id: ids.queue }, { organizationId: ids.otherOrg }]) test('mismatched server response is rejected without a success notification ' + JSON.stringify(patch), async () => {
  const f = pipelineRoundRobinRuntime();
  try {
    f.patchResponse(patch); await assert.rejects(f.render().mutateAsync(f.input()));
    assert.equal(f.notices.filter(item => item.kind === 'success').length, 0);
  } finally { f.close(); }
});

for (const token of [undefined, null, '', 'malformed']) test('legacy or malformed revision never reaches transport: ' + token, async () => {
  const f = pipelineRoundRobinRuntime();
  try { await assert.rejects(f.render().mutateAsync({ ...f.input(), expectedRevision: token })); assert.equal(f.requests.length, 0); }
  finally { f.close(); }
});

test('invalid pipeline path is rejected by the real API adapter before HTTP', async () => {
  const f = pipelineRoundRobinRuntime();
  try { await assert.rejects(f.api.setPipelineRoundRobin('invalid-path', ids.queue, revision, ids.org)); assert.equal(f.requests.length, 0); }
  finally { f.close(); }
});

test('manager requires the displayed row revision and preserves legacy read-only behavior', async () => {
  const f = pipelineRoundRobinRuntime(); let refetches = 0;
  try {
    const refetch = () => { refetches++; return Promise.resolve(); };
    const change = f.manager({ refetch, pipelines: [] });
    await change({ id: ids.pipeline }, ids.queue); assert.equal(f.requests.length, 0); assert.equal(refetches, 1);
    await change({ id: ids.pipeline, revision }, 'none');
    assert.deepEqual(f.requests[0].input.body, { roundRobinId: null, expectedRevision: revision });
  } finally { f.close(); }
});

test('manager JSX passes the displayed row instead of looking up a newer token in the query cache', () => {
  const source = readFileSync('components/features/round-robin/PipelineRoundRobinManager.tsx', 'utf8');
  assert.match(source, /handleChange\(pipeline,\s*value\)/);
  assert.match(source, /disabled=\{[^}]*isPending[^}]*revision/s);
});

for (const mode of ['unmount', 'client']) test(`global wait cannot dispatch after ${mode}`, async () => {
  const f = pipelineRoundRobinRuntime();
  try {
    const old = f.render(); f.waitGlobal(); const pending = old.mutateAsync(f.input());
    const rejected = assert.rejects(pending, error => error.code === 'pipeline_scope_changed'); await turn();
    if (mode === 'unmount') f.unmount(); else { f.replaceClient(); f.render(); }
    f.releaseGlobal(); await rejected; assert.equal(f.requests.length, 0); assert.deepEqual(f.notices, []);
    if (mode === 'unmount') {
      assert.equal(f.invalidations.length, 1); assert.equal(f.invalidations[0].keys.length, 4);
      assert(f.invalidations.every(value => value.refetchType === 'none' && value.keys.every(key => key[1] === ids.org)));
    } else {
      assert.deepEqual(f.invalidations, [], 'a replaced client must remain untouched');
    }
  } finally { f.close(); }
});

for (const error of [new TypeError('Synthetic response loss'), new VimobAPIError('Unavailable', { status: 503, code: 'service_unavailable' })]) test('uncertain transport failure is never automatically retried: ' + error.name, async () => {
  const f = pipelineRoundRobinRuntime();
  try {
    f.fail(error); await assert.rejects(f.render().mutateAsync(f.input())); await turn();
    assert.equal(f.requests.length, 1); assert.equal(f.notices.filter(item => item.kind === 'error').length, 1);
  } finally { f.close(); }
});

test('manager callback retired before a legacy selection neither requests nor refreshes nor notifies', async () => {
  const f = pipelineRoundRobinRuntime(); let refetches = 0;
  try {
    const old = f.manager({ refetch: () => { refetches++; } }); f.render({ sid: 'sid-b' });
    await old({ id: ids.pipeline }, ids.queue);
    assert.equal(f.requests.length, 0); assert.equal(refetches, 0); assert.deepEqual(f.notices, []);
  } finally { f.close(); }
});
