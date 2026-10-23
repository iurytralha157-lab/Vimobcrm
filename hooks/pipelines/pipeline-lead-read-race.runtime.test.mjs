import assert from 'node:assert/strict';
import test from 'node:test';
import { compareServerRevisions } from '../../lib/compare-server-revisions.ts';
import { turn } from '../leads/lead-request-runtime-fixture.mjs';
import { leadSnapshot, pipelineLeadReadRaceRuntime, revisions } from './pipeline-lead-read-race-runtime-fixture.mjs';

test('first-response detail refetch cannot be downgraded by an older access GET', async t => {
  const runtime = pipelineLeadReadRaceRuntime(); t.after(() => runtime.close());
  const original = leadSnapshot(), saved = leadSnapshot({ updated_at: revisions[1], first_response_at: '2026-10-16T10:00:00Z' });
  runtime.seed(original); runtime.server(original); runtime.openDetail(runtime.verifiedRead(original));
  const mutation = await runtime.recordFirstResponse(saved);
  runtime.render(); assert.equal(runtime.requests.length, 1);
  mutation.release(); await mutation.pending;
  for (let count = 0; count < 12 && runtime.read()?.updated_at !== saved.updated_at; count++) await turn();
  assert.equal(runtime.read().updated_at, revisions[1], 'real first-response onSuccess must refetch the mounted detail');
  assert.equal(runtime.firstEvents.length, 0, 'this writer emits no local realtime event to cancel access');
  runtime.writes.length = 0;
  await runtime.drainAccess(request => request.index === 0 ? original : saved);
  assert.equal(runtime.read().updated_at, revisions[1]);
  assert.equal(runtime.read().first_response_at, saved.first_response_at);
  assert(runtime.writes.every(write => compareServerRevisions(write.data?.updated_at, saved.updated_at) !== -1));
  assert.equal(runtime.canOperate(), true, 'a bounded fresh GET may confirm the new canonical revision');
  assert(runtime.requests.length <= 2, 'reconciliation must not loop or retry without a bound');
});

test('a response one microsecond older cannot overwrite or freshly certify a newer cached lead', async t => {
  const runtime = pipelineLeadReadRaceRuntime(); t.after(() => runtime.close());
  runtime.render(); const newer = leadSnapshot({ updated_at: revisions[1] }); runtime.seed(newer); runtime.writes.length = 0;
  await runtime.drainAccess(leadSnapshot());
  assert.deepEqual(runtime.read(), newer);
  assert.equal(runtime.canOperate(), false, 'retaining cache is not proof that its authorization was read');
  assert.equal(runtime.requests.length, 2, 'one bounded reread is allowed');
  assert(runtime.writes.every(write => write.data?.updated_at === revisions[1]));
});

for (const [name, patch] of [
  ['responsible attendant', { assigned_user_id: 'actor-b' }],
  ['team', { team_id: 'team-b' }],
  ['revoked capability', { can_operate: false }],
  ['unknown capability after transfer', { assigned_user_id: 'actor-b', can_operate: undefined }],
]) test(`stale access cannot restore ${name} or certify the preserved cache`, async t => {
  const runtime = pipelineLeadReadRaceRuntime(); t.after(() => runtime.close());
  runtime.render(); const newer = leadSnapshot({ updated_at: revisions[1], ...patch }); runtime.seed(newer);
  await runtime.drainAccess(leadSnapshot());
  assert.deepEqual(runtime.read(), newer);
  assert.equal(runtime.canOperate(), false);
});

test('preserving a newer permissive cache must not transform an old denied GET into authorization', async t => {
  const runtime = pipelineLeadReadRaceRuntime(); t.after(() => runtime.close());
  runtime.render(); runtime.seed(leadSnapshot({ updated_at: revisions[1], can_operate: true }));
  await runtime.drainAccess(leadSnapshot({ can_operate: false }));
  assert.equal(runtime.read().can_operate, true);
  assert.equal(runtime.canOperate(), false);
  const access = runtime.result();
  assert(!(access.isSuccess && access.data?.data.can_operate === true), 'cache must not masquerade as the GET response');
});

test('a newer actual GET may install and certify its own snapshot', async t => {
  const runtime = pipelineLeadReadRaceRuntime(); t.after(() => runtime.close());
  runtime.seed(leadSnapshot()); runtime.render();
  const newer = leadSnapshot({ updated_at: revisions[1], team_id: 'team-b' });
  await runtime.drainAccess(newer);
  assert.deepEqual(runtime.read(), newer); assert.equal(runtime.canOperate(), true);
  assert.equal(runtime.requests.length, 1);
});

test('a canonical same-revision denied capability replaces an old permission', async t => {
  const runtime = pipelineLeadReadRaceRuntime(); t.after(() => runtime.close());
  runtime.seed(leadSnapshot()); runtime.render();
  const denied = leadSnapshot({ can_operate: false }); await runtime.drainAccess(denied);
  assert.deepEqual(runtime.read(), denied); assert.equal(runtime.canOperate(), false);
});

test('if cache advances during the bounded reread, the second response still cannot downgrade it', async t => {
  const runtime = pipelineLeadReadRaceRuntime(); t.after(() => runtime.close());
  runtime.render(); runtime.seed(leadSnapshot({ updated_at: revisions[1] }));
  runtime.resolve(runtime.requests[0], leadSnapshot()); await turn();
  assert.equal(runtime.requests.length, 2);
  const latest = leadSnapshot({ updated_at: revisions[2], can_operate: false }); runtime.seed(latest);
  await runtime.drainAccess(leadSnapshot({ updated_at: revisions[1] }));
  assert.deepEqual(runtime.read(), latest); assert.equal(runtime.canOperate(), false);
  assert.equal(runtime.requests.length, 2);
});

test('a cache write between helper resolution and access publication cannot be downgraded', async t => {
  const runtime = pipelineLeadReadRaceRuntime(); t.after(() => runtime.close());
  const original = leadSnapshot(), newer = leadSnapshot({ updated_at: revisions[1], assigned_user_id: 'actor-b', can_operate: false });
  runtime.seed(original); runtime.render(); runtime.writes.length = 0;
  const getData = runtime.client.getQueryData.bind(runtime.client); let armed = true;
  runtime.client.getQueryData = key => {
    const value = getData(key);
    if (armed && key[0] === 'lead' && value?.updated_at === revisions[0]) {
      armed = false;
      // An independent canonical writer runs in the microtask after the read
      // helper's final comparison, before the awaiting access caller resumes.
      queueMicrotask(() => runtime.seed(newer));
    }
    return value;
  };
  await runtime.drainAccess(original);
  runtime.client.getQueryData = getData;
  assert.equal(armed, false, 'the comparison boundary was exercised');
  assert.deepEqual(runtime.read(), newer); assert.equal(runtime.canOperate(), false);
  const firstNewer = runtime.writes.findIndex(write => write.data?.updated_at === revisions[1]);
  assert(firstNewer >= 0);
  assert(runtime.writes.slice(firstNewer).every(write => write.data?.updated_at === revisions[1]));
});

test('an older detail GET cannot overwrite the newer snapshot installed by access', async t => {
  const runtime = pipelineLeadReadRaceRuntime(); t.after(() => runtime.close());
  const original = leadSnapshot(), newer = leadSnapshot({ updated_at: revisions[1], first_response_at: '2026-10-16T10:00:00Z' });
  runtime.seed(original); runtime.openDetail(runtime.verifiedRead(original)); runtime.deferDetails();
  const detail = runtime.detailRefetch(); assert.equal(runtime.detailRequests.length, 1);
  runtime.render(); await runtime.drainAccess(newer); runtime.writes.length = 0;
  assert.equal(runtime.read().updated_at, revisions[1]);
  await runtime.drainDetail(original); await detail;
  assert.deepEqual(runtime.read(), newer);
  assert.equal(runtime.detailResult().isError, true, 'stale detail must not claim to be a successful current GET');
  assert.equal(runtime.detailRequests.length, 2, 'consistency failure must not enter the normal network retry policy');
  assert(runtime.writes.every(write => write.data?.updated_at === revisions[1]));
});

test('the detail query commit checks again after its read helper has resolved', async t => {
  const runtime = pipelineLeadReadRaceRuntime(); t.after(() => runtime.close());
  const original = leadSnapshot(), newer = leadSnapshot({ updated_at: revisions[1], can_operate: false });
  runtime.seed(original); runtime.openDetail(runtime.verifiedRead(original)); runtime.deferDetails();
  const pending = runtime.detailRefetch(); runtime.writes.length = 0;
  const getData = runtime.client.getQueryData.bind(runtime.client); let armed = true;
  runtime.client.getQueryData = key => {
    const value = getData(key);
    if (armed && key[0] === 'lead' && value?.updated_at === revisions[0]) {
      armed = false; queueMicrotask(() => runtime.seed(newer));
    }
    return value;
  };
  await runtime.drainDetail(original); await pending; runtime.client.getQueryData = getData;
  assert.equal(armed, false); assert.deepEqual(runtime.read(), newer);
  assert.equal(runtime.detailResult().isError, true);
  assert.equal(runtime.detailRequests.length, 1, 'a rejected synchronous commit must not restart the HTTP request');
});

test('detail structural sharing preserves deliberate optimistic writes and rollbacks', async t => {
  const runtime = pipelineLeadReadRaceRuntime(); t.after(() => runtime.close());
  const canonical = leadSnapshot({ updated_at: revisions[1] });
  runtime.seed(canonical); runtime.openDetail(runtime.verifiedRead(canonical));
  const optimistic = { ...canonical, deal_status: 'won' };
  assert.doesNotThrow(() => runtime.seed(optimistic)); assert.equal(runtime.read().deal_status, 'won');
  assert.doesNotThrow(() => runtime.seed({ ...canonical })); assert.deepEqual(runtime.read(), canonical);
  const olderManual = leadSnapshot({ deal_status: 'lost' });
  assert.doesNotThrow(() => runtime.seed(olderManual)); assert.deepEqual(runtime.read(), olderManual);
});

test('cancelling an access read prevents its late transport response from writing or certifying', async t => {
  const runtime = pipelineLeadReadRaceRuntime(); t.after(() => runtime.close());
  const newer = leadSnapshot({ updated_at: revisions[1] }); runtime.seed(newer); runtime.render();
  await runtime.client.cancelQueries({ queryKey: ['pipeline-selected-lead-access'] });
  assert.equal(runtime.requests[0].signal.aborted, true);
  runtime.resolve(runtime.requests[0], leadSnapshot()); await turn();
  assert.deepEqual(runtime.read(), newer); assert.equal(runtime.canOperate(), false);
  assert.equal(runtime.requests.length, 1, 'cancelled read must not start a reconciliation GET');
});

test('organization A to B to A cannot revive the first visit response', async t => {
  const runtime = pipelineLeadReadRaceRuntime(); t.after(() => runtime.close());
  runtime.render(); const first = runtime.requests[0];
  runtime.render({ org: 'org-b', selectionVersion: 2 });
  runtime.render({ org: 'org-a', selectionVersion: 3 });
  runtime.resolve(first, leadSnapshot()); await turn();
  assert.equal(first.signal.aborted, true); assert.equal(runtime.read(), undefined);
  assert.equal(runtime.read('org-b'), undefined);
  await runtime.drainAccess(request => leadSnapshot({ organization_id: request.organizationId, updated_at: revisions[1] }));
  assert.equal(runtime.read().updated_at, revisions[1]); assert.equal(runtime.canOperate(), true);
});

test('the actual screen SID signature prevents session ABA from publishing the first visit response', async t => {
  const runtime = pipelineLeadReadRaceRuntime(); t.after(() => runtime.close());
  runtime.render(); const first = runtime.requests[0];
  runtime.render({ sid: 'sid-b' }); runtime.render({ sid: 'sid-a' });
  runtime.resolve(first, leadSnapshot()); await turn();
  assert.equal(first.signal.aborted, true, 'the production screen signature must retire the SID A request');
  assert.equal(runtime.read(), undefined); assert.equal(runtime.canOperate(), false);
});

test('visibility permission ABA cannot revive the retired response', async t => {
  const runtime = pipelineLeadReadRaceRuntime(); t.after(() => runtime.close());
  runtime.render(); const first = runtime.requests[0];
  runtime.render({ allowed: false, visibilityScopeKey: 'actor-a:none' });
  runtime.render({ allowed: true, visibilityScopeKey: 'actor-a:own' });
  runtime.resolve(first, leadSnapshot()); await turn();
  assert.equal(first.signal.aborted, true); assert.equal(runtime.read(), undefined);
  assert.equal(runtime.canOperate(), false);
});

for (const status of [401, 403, 404]) test(`HTTP ${status} cannot promote a cached lead into successful access`, async t => {
  const runtime = pipelineLeadReadRaceRuntime(); t.after(() => runtime.close());
  runtime.render(); await runtime.drainAccess(leadSnapshot()); assert.equal(runtime.canOperate(), true);
  const pending = runtime.refetch(); await turn(); runtime.reject(runtime.requests.at(-1), status); await pending;
  assert.equal(runtime.result().isError, true); assert.equal(runtime.canOperate(), false);
  assert.equal(runtime.denyConsumer(status), true); assert.equal(runtime.read(), undefined);
});

for (const patch of [{ id: 'lead-b' }, { organization_id: 'org-b' }]) test(`wrong identity ${JSON.stringify(patch)} is never cached`, async t => {
  const runtime = pipelineLeadReadRaceRuntime(); t.after(() => runtime.close());
  runtime.render(); await runtime.drainAccess(leadSnapshot(patch));
  assert.equal(runtime.read(), undefined); assert.equal(runtime.canOperate(), false);
  assert.equal(runtime.read('org-b', 'lead-b'), undefined);
});
