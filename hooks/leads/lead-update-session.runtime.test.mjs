import assert from 'node:assert/strict';
import test from 'node:test';
import { MutationObserver } from '@tanstack/react-query';
import { deferred, leadHookRuntime, turn } from './lead-request-runtime-fixture.mjs';

function fixture() {
  const runtime = leadHookRuntime(), client = runtime.client(), pending = deferred(); let writes = 0;
  const lead = { ...runtime.authorizedLead, name: 'Synthetic previous', stage_id: 'stage-a' };
  client.setQueryData(['lead', 'org-a', 'lead-a'], lead);
  client.setQueryData(['leads', 'org-a'], [lead]);
  client.setQueryData(['contacts-list', 'org-a'], [lead]);
  client.setQueryData(['stages-with-leads', 'org-a'], [{ id: 'stage-a', leads: [lead] }]);
  for (const method of ['setQueryData', 'setQueriesData']) {
    const original = client[method].bind(client);
    client[method] = (...args) => { writes += 1; return original(...args); };
  }
  runtime.respond(method => { assert.equal(method, 'updateLead'); return pending.promise; });
  const render = () => runtime.render('hooks/use-leads.ts', 'useUpdateLead');
  const original = render(), observer = new MutationObserver(client, original);
  const response = { ...lead, name: 'Synthetic saved', updated_at: '2026-10-13T10:00:01.000001Z' };
  return { runtime, client, original, render, pending, response, writes: () => writes,
    start: () => observer.mutate({ id: 'lead-a', name: response.name, expectedUpdatedAt: lead.updated_at }),
    close: () => runtime.close() };
}

test('actual update hook/cache does not patch or publish a late response under replacement SID of the same actor/client', async () => {
  const f = fixture();
  try {
    const result = f.start(); await turn(); assert.equal(f.runtime.requests.length, 1);
    assert.equal(f.runtime.requests[0].args[3].expectedSessionId, 'sid-a');
    f.runtime.switchTo('org-a', 'actor-a', 'sid-b'); f.render();
    assert.equal(f.runtime.requests[0].args[3].signal.aborted, true);
    f.pending.resolve({ data: f.response, error: null }); await result;
    assert.equal(f.writes(), 0); assert.equal(f.runtime.cachePatches.length, 0);
    assert.deepEqual(f.runtime.events, []); assert.deepEqual(f.runtime.notices, []);
    assert.equal(f.client.getQueryData(['lead', 'org-a', 'lead-a']).name, 'Synthetic previous');
  } finally { f.close(); }
});

test('actual update hook/cache cannot revive a delayed snapshot after SID A -> B -> A', async () => {
  const f = fixture();
  try {
    const result = f.start(); await turn();
    f.runtime.switchTo('org-a', 'actor-a', 'sid-b'); f.render(); f.runtime.switchTo(); f.render();
    f.pending.resolve({ data: f.response, error: null }); await result;
    assert.equal(f.writes(), 0); assert.equal(f.runtime.cachePatches.length, 0); assert.deepEqual(f.runtime.events, []);
  } finally { f.close(); }
});

test('actual update hook/cache cannot revive a delayed snapshot after organization A -> B -> A', async () => {
  const f = fixture();
  try {
    const result = f.start(); await turn();
    f.runtime.switchTo('org-b', 'actor-a', 'sid-a'); f.render(); f.runtime.switchTo(); f.render();
    f.pending.resolve({ data: f.response, error: null }); await result;
    assert.equal(f.writes(), 0); assert.equal(f.runtime.cachePatches.length, 0); assert.deepEqual(f.runtime.events, []);
  } finally { f.close(); }
});

test('actual update hook/cache preserves same-SID refresh and canonical financial/board reconciliation', async () => {
  const f = fixture();
  try {
    const result = f.start(); await turn(); f.runtime.switchTo('org-a', 'actor-a', 'sid-a', 2); f.render();
    assert.equal(f.runtime.requests[0].args[3].signal.aborted, false);
    assert.equal(f.runtime.events.length, 0, 'an optimistic/pending update must not publish a persisted signal');
    f.pending.resolve({ data: { ...f.response, valor_interesse: 125000.5 }, error: null }); await result;
    assert.ok(f.writes() >= 3); assert.equal(f.runtime.cachePatches.length, 1);
    assert.equal(f.client.getQueryData(['lead', 'org-a', 'lead-a']).name, 'Synthetic saved');
    assert.equal(f.client.getQueryData(['leads', 'org-a'])[0].name, 'Synthetic saved');
    assert.equal(f.client.getQueryData(['contacts-list', 'org-a'])[0].name, 'Synthetic saved');
    const board = f.client.getQueryData(['stages-with-leads', 'org-a']);
    assert.equal(board[0].leads[0].valor_interesse, 125000.5); assert.equal(board[0].leads[0].stage_id, 'stage-a');
    assert.equal(f.runtime.events[0].reason, 'lead.updated');
    assert.equal(f.runtime.events.length, 1, 'canonical success publishes exactly one persisted signal');
  } finally { f.close(); }
});

test('actual update hook/cache reconciles the captured client after normal close without publishing global effects', async () => {
  const f = fixture();
  try {
    const result = f.start(); await turn(); f.runtime.unmount();
    f.pending.resolve({ data: f.response, error: null }); await result;
    assert.ok(f.writes() >= 3); assert.equal(f.runtime.cachePatches.length, 1);
    assert.equal(f.client.getQueryData(['lead', 'org-a', 'lead-a']).name, 'Synthetic saved');
    assert.deepEqual(f.runtime.events, []); assert.deepEqual(f.runtime.notices, []);
  } finally { f.close(); }
});

test('actual update failure after SID replacement invalidates captured queries without stale error notices', async () => {
  const f = fixture();
  try {
    const result = f.start(); await turn(); f.runtime.switchTo('org-a', 'actor-a', 'sid-b'); f.render();
    f.pending.reject(new Error('Synthetic update failure')); await assert.rejects(result);
    assert.equal(f.writes(), 0); assert.deepEqual(f.runtime.notices, []); assert.deepEqual(f.runtime.events, []);
    assert.equal(f.client.getQueryState(['lead', 'org-a', 'lead-a']).isInvalidated, true);
  } finally { f.close(); }
});

test('actual old update callback after SID ABA cannot start another mutation', async () => {
  const f = fixture();
  try {
    f.runtime.switchTo('org-a', 'actor-a', 'sid-b'); f.render(); f.runtime.switchTo(); f.render();
    const stale = new MutationObserver(f.client, f.original);
    await assert.rejects(stale.mutate({ id: 'lead-a', name: 'Synthetic stale' }));
    assert.equal(f.runtime.requests.length, 0); assert.equal(f.writes(), 0); assert.deepEqual(f.runtime.notices, []);
  } finally { f.close(); }
});
