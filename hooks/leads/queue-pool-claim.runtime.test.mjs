import assert from 'node:assert/strict';
import test from 'node:test';
import { MutationObserver } from '@tanstack/react-query';
import { deferred, leadHookRuntime, turn } from './lead-request-runtime-fixture.mjs';
import { resetQueuePoolAccessCaches } from '../../lib/queue-pool-cache.ts';

const uuid = '11111111-1111-4111-8111-111111111111';
const poolLead = () => ({ id: 'lead-a', organization_id: 'org-a', assigned_user_id: null,
  can_operate: false,
  queue_pool: { round_robin_id: uuid, episode_id: uuid, revision: 3, state: 'pool_waiting', reason: 'queue_closed', can_claim: true } });
const path = 'hooks/leads/use-claim-queue-pool.ts';

test('actual claim pins CAS and initiating session; uncertain retry reuses idempotency key', async () => {
  const fixture = leadHookRuntime();
  fixture.client().setQueryData(['lead', 'org-a', 'lead-a'], poolLead());
  try {
    fixture.respond(async () => { throw new Error('Uncertain transport'); });
    const observer = new MutationObserver(fixture.client(), fixture.render(path, 'useClaimQueuePool'));
    await assert.rejects(observer.mutate({ lead: poolLead() }), /Uncertain/);
    const first = fixture.requests[0].args;
    assert.deepEqual(first[1], { roundRobinId: uuid, episodeId: uuid, expectedRevision: 3 });
    assert.equal(first[3], 'org-a'); assert.equal(first[4].expectedSessionId, 'sid-a');
    fixture.respond(async () => ({ data: { ...fixture.authorizedLead, queue_pool: null }, error: null }));
    await observer.mutate({ lead: poolLead() });
    assert.equal(fixture.requests[1].args[2], first[2]);
    assert.equal(fixture.notices.at(-1).text, 'Lead assumido por você.');
  } finally { fixture.close(); }
});

test('actual claim rejects generic unassigned or denied capability before transport', async () => {
  const fixture = leadHookRuntime();
  try {
    const observer = new MutationObserver(fixture.client(), fixture.render(path, 'useClaimQueuePool'));
    await assert.rejects(observer.mutate({ lead: { id: 'lead-a', organization_id: 'org-a', assigned_user_id: null } }));
    await assert.rejects(observer.mutate({ lead: { ...poolLead(), queue_pool: { ...poolLead().queue_pool, can_claim: false } } }));
    assert.equal(fixture.requests.length, 0);
  } finally { fixture.close(); }
});

test('late claim after session replacement cannot patch cache, notify or publish', async () => {
  const fixture = leadHookRuntime();
  fixture.client().setQueryData(['lead', 'org-a', 'lead-a'], poolLead());
  try {
    const pending = deferred(); fixture.respond(() => pending.promise);
    const observer = new MutationObserver(fixture.client(), fixture.render(path, 'useClaimQueuePool'));
    const operation = observer.mutate({ lead: poolLead() }); await turn();
    fixture.switchTo('org-a', 'actor-a', 'sid-b'); fixture.render(path, 'useClaimQueuePool');
    assert.equal(fixture.requests[0].args[4].signal.aborted, true);
    pending.resolve({ data: { ...fixture.authorizedLead, queue_pool: null }, error: null });
    await operation;
    assert.deepEqual(fixture.notices, []); assert.deepEqual(fixture.events, []); assert.deepEqual(fixture.cachePatches, []);
  } finally { fixture.close(); }
});

test('membership change discards cached claim capability and fences an already pending response', async () => {
  const fixture = leadHookRuntime();
  fixture.client().setQueryData(['lead', 'org-a', 'lead-a'], poolLead());
  try {
    const pending = deferred(); fixture.respond(() => pending.promise);
    const observer = new MutationObserver(fixture.client(), fixture.render(path, 'useClaimQueuePool'));
    const operation = observer.mutate({ lead: poolLead() }); await turn();
    resetQueuePoolAccessCaches(fixture.client(), 'org-a');
    assert.equal(fixture.client().getQueryData(['lead', 'org-a', 'lead-a']), undefined);
    pending.resolve({ data: { ...fixture.authorizedLead, queue_pool: null }, error: null });
    await operation;
    assert.deepEqual(fixture.notices, []); assert.deepEqual(fixture.events, []); assert.deepEqual(fixture.cachePatches, []);
    await assert.rejects(observer.mutate({ lead: poolLead() }));
    assert.equal(fixture.requests.length, 1);
  } finally { fixture.close(); }
});

test('two claim observers cannot submit the same cached capability concurrently', async () => {
  const fixture = leadHookRuntime();
  fixture.client().setQueryData(['lead', 'org-a', 'lead-a'], poolLead());
  try {
    const pending = deferred(); fixture.respond(() => pending.promise);
    const first = new MutationObserver(fixture.client(), fixture.render(path, 'useClaimQueuePool'));
    const second = new MutationObserver(fixture.client(), fixture.render(path, 'useClaimQueuePool'));
    const operation = first.mutate({ lead: poolLead() }); await turn();
    await assert.rejects(second.mutate({ lead: poolLead() }), /já está sendo assumido/);
    assert.equal(fixture.requests.length, 1);
    pending.resolve({ data: { ...fixture.authorizedLead, queue_pool: null }, error: null });
    await operation;
    assert.equal(fixture.events.length, 1);
    assert.equal(fixture.notices.filter(notice => notice.kind === 'success').length, 1);
  } finally { fixture.close(); }
});

test('organization replacement fences a late claim and never patches the new tenant cache', async () => {
  const fixture = leadHookRuntime();
  fixture.client().setQueryData(['lead', 'org-a', 'lead-a'], poolLead());
  const foreign = { id: 'lead-b', organization_id: 'org-b', assigned_user_id: null };
  fixture.client().setQueryData(['lead', 'org-b', 'lead-b'], foreign);
  try {
    const pending = deferred(); fixture.respond(() => pending.promise);
    const observer = new MutationObserver(fixture.client(), fixture.render(path, 'useClaimQueuePool'));
    const operation = observer.mutate({ lead: poolLead() }); await turn();
    fixture.switchTo('org-b', 'actor-b', 'sid-b'); fixture.render(path, 'useClaimQueuePool');
    assert.equal(fixture.requests[0].args[4].signal.aborted, true);
    pending.resolve({ data: { ...fixture.authorizedLead, queue_pool: null }, error: null });
    await operation;
    assert.deepEqual(fixture.client().getQueryData(['lead', 'org-b', 'lead-b']), foreign);
    assert.deepEqual(fixture.notices, []); assert.deepEqual(fixture.events, []); assert.deepEqual(fixture.cachePatches, []);
    await assert.rejects(observer.mutate({ lead: poolLead() }), /Seu acesso mudou/);
    assert.equal(fixture.requests.length, 1);
  } finally { fixture.close(); }
});

test('a receipt naming another owner cannot grant claim success or publish a client event', async () => {
  const fixture = leadHookRuntime();
  fixture.client().setQueryData(['lead', 'org-a', 'lead-a'], poolLead());
  try {
    fixture.respond(async () => ({ data: { ...fixture.authorizedLead, assigned_user_id: 'another-actor', queue_pool: null }, error: null }));
    const observer = new MutationObserver(fixture.client(), fixture.render(path, 'useClaimQueuePool'));
    await assert.rejects(observer.mutate({ lead: poolLead() }), /confirmar quem assumiu/);
    assert.deepEqual(fixture.events, []); assert.deepEqual(fixture.cachePatches, []);
    assert.equal(fixture.notices.some(notice => notice.kind === 'success'), false);
    assert.deepEqual(fixture.client().getQueryData(['lead', 'org-a', 'lead-a']), poolLead());
  } finally { fixture.close(); }
});
