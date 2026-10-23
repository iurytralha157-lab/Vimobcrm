import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';
import ts from 'typescript';
import { MutationObserver, QueryClient } from '@tanstack/query-core';
import { getGlobalSignOutSessionId } from '../../lib/auth/global-sign-out.ts';
import { captureLeadRequestIntent } from '../../lib/lead-request-intent.ts';
import { activateQueryClientAccess, captureQueryClientAccess } from '../../lib/access/query-client-access.ts';
import { parseDomainInput, uuidSchema, validateDomainResponse } from '../../lib/validation/common.ts';
import { leadContactOutcomeCommandSchema, leadContactOutcomeResponseSchema } from '../../lib/validation/lead-contact-outcomes.ts';
import { deferred, evaluateProduction, turn } from './lead-request-runtime-fixture.mjs';

// Hook, scope, API parser and MutationObserver are production code. Transport,
// token wait and React lifecycle are controlled; no API, DB or browser writes.
const ids = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000004'];
const command = { commandId: ids[0], leadId: ids[1], channel: 'call', outcome: 'answered', notes: 'Synthetic result' };
const token = (actor, sid, version = 1) => `header.${Buffer.from(JSON.stringify({ sub: actor, session_id: sid, version })).toString('base64url')}.synthetic`;
const moduleSource = path => {
  const ast = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  return ast.statements.filter(node => !ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)).map(node => node.getText(ast)).join('\n');
};
const open = new Set(); afterEach(() => { for (const r of open) r.close(); open.clear(); });
function runtime({ deferStart = false } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  const retire = activateQueryClientAccess(client), slots = [], observers = [], requests = [], invalidations = [], events = [];
  const auth = { user: { id: 'actor-a' }, activeOrganization: { organizationId: ids[2] }, session: { access_token: token('actor-a', 'sid-a') } };
  let cursor = 0, mounted = true, hook;
  const changed = (before, after) => !before || after.some((value, index) => !Object.is(value, before[index]));
  const invalidate = client.invalidateQueries.bind(client);
  client.invalidateQueries = filters => { invalidations.push(filters); return invalidate(filters); };
  const deps = {
    parseDomainInput, uuidSchema, validateDomainResponse, leadContactOutcomeCommandSchema, leadContactOutcomeResponseSchema,
    captureLeadRequestIntent, getGlobalSignOutSessionId, captureQueryClientAccess,
    captureCurrentLeadRequestIntent: intent => intent,
    useAuth: () => auth, useQueryClient: () => client,
    getVimobAPIAccessTokenUserId: () => auth.user?.id ?? null,
    getVimobAPIAccessTokenSessionId: () => getGlobalSignOutSessionId(auth.session),
    useRef: value => { const index = cursor++; return slots[index] ??= { current: value }; },
    useMemo: (build, keys) => { const index = cursor++; if (changed(slots[index]?.keys, keys)) slots[index] = { keys, value: build() }; return slots[index].value; },
    useLayoutEffect: (setup, keys) => { const index = cursor++; if (changed(slots[index]?.keys, keys)) { slots[index]?.cleanup?.(); slots[index] = { keys, cleanup: setup() }; } },
    useMutation: options => { const observer = new MutationObserver(client, options); observers.push(observer); return { mutateAsync: input => observer.mutate(input) }; },
    notifyLeadRealtimeChange: value => events.push(value),
    vimobAPIRequest: async (url, options) => {
      const request = { url, options, response: deferred(), token: deferred(), started: false }; requests.push(request);
      if (deferStart) await request.token.promise;
      options.onRequestStart?.(); request.started = true;
      return await request.response.promise;
    },
  };
  deps.leadContactOutcomesAPI = evaluateProduction(moduleSource('lib/api/lead-contact-outcomes.ts'), deps, 'leadContactOutcomesAPI');
  deps.useLeadRequestScope = evaluateProduction(moduleSource('hooks/leads/use-lead-request-scope.ts'), deps, 'useLeadRequestScope');
  const invokeHook = evaluateProduction(moduleSource('hooks/leads/use-record-lead-contact-outcome.ts'), deps, 'useRecordLeadContactOutcome');
  const frame = (patch = {}) => {
    if ('org' in patch) auth.activeOrganization = { organizationId: patch.org };
    if ('actor' in patch) auth.user = patch.actor ? { id: patch.actor } : null;
    if ('sid' in patch || 'actor' in patch || 'version' in patch) auth.session = auth.user
      ? { access_token: token(auth.user.id, patch.sid ?? getGlobalSignOutSessionId(auth.session), patch.version ?? 1) } : null;
    cursor = 0; hook = invokeHook(); return hook;
  };
  const start = async (input = command) => { const pending = hook.mutateAsync({ ...input }).then(value => ({ value }), error => ({ error })); await turn(); return { pending, request: requests.at(-1) }; };
  const resolve = (request, patch = {}) => request.response.resolve({ data: { commandId: request.options.body.commandId,
    leadId: ids[1], channel: request.options.body.channel, activityId: ids[3], recordedAt: '2026-10-20T01:02:03.123456789Z', ...patch } });
  const unmount = () => { mounted = false; slots.forEach(slot => slot?.cleanup?.()); };
  const r = { client, requests, invalidations, events, frame, start, resolve, retire, unmount,
    close() { if (mounted) unmount(); retire(); observers.forEach(observer => observer.reset()); client.clear(); } };
  frame(); open.add(r); return r;
}

test('confirmed receipt invalidates only activity/history and preserves separate first-response sequencing', async () => {
  const r = runtime(), { pending, request } = await r.start();
  assert.equal(request.started, true); assert.equal(request.options.retry, false); assert.equal(request.options.signal, undefined);
  assert.equal(request.options.expectedUserId, 'actor-a'); assert.equal(request.options.expectedSessionId, 'sid-a');
  r.resolve(request); assert.equal((await pending).value.commandId, command.commandId);
  assert.deepEqual(r.invalidations.map(value => value.queryKey), [['activities'], ['recent-activities'], ['lead-history-v2', ids[1]]]);
  assert.ok(r.invalidations.every(value => value.refetchType === 'active'));
  assert.deepEqual(r.events, [{ organizationId: ids[2], leadId: ids[1], reason: 'lead.updated' }]);
});

for (const patch of [{ org: ids[3] }, { actor: 'actor-b' }, { actor: null }, { sid: 'sid-b' }]) {
  test(`late receipt after access replacement ${JSON.stringify(patch)} cannot invalidate or publish`, async () => {
    const r = runtime(), { pending, request } = await r.start(); r.frame(patch); r.resolve(request);
    assert.ok((await pending).value); assert.deepEqual(r.invalidations, []); assert.deepEqual(r.events, []);
  });
  test(`token wait rejects retired intent before POST starts ${JSON.stringify(patch)}`, async () => {
    const r = runtime({ deferStart: true }), { pending, request } = await r.start(); r.frame(patch);
    request.token.resolve(); const result = await pending;
    assert.equal(result.error?.name, 'AbortError'); assert.equal(request.started, false);
    assert.deepEqual(r.invalidations, []); assert.deepEqual(r.events, []);
  });
}

test('normal close after POST start reconciles same-access receipt with passive invalidation', async () => {
  const r = runtime(), { pending, request } = await r.start(); r.unmount(); r.resolve(request);
  assert.ok((await pending).value); assert.equal(r.invalidations.length, 3);
  assert.ok(r.invalidations.every(value => value.refetchType === 'none')); assert.deepEqual(r.events, []);
});
test('close during token wait prevents the POST from starting', async () => {
  const r = runtime({ deferStart: true }), { pending, request } = await r.start(); r.unmount(); request.token.resolve();
  assert.equal((await pending).error?.name, 'AbortError'); assert.equal(request.started, false); assert.deepEqual(r.invalidations, []);
});
test('token refresh preserves the same SID without discarding a valid command', async () => {
  const r = runtime(), { pending, request } = await r.start(); r.frame({ version: 2 }); r.resolve(request);
  assert.ok((await pending).value); assert.equal(r.invalidations.length, 3); assert.equal(r.events.length, 1);
});
test('provider lease retirement and same-identity reactivation cannot revive the receipt', async () => {
  const r = runtime(), { pending, request } = await r.start(); r.unmount(); r.retire(); r.client.clear();
  const retireNext = activateQueryClientAccess(r.client); r.resolve(request); assert.ok((await pending).value);
  assert.deepEqual(r.invalidations, []); assert.deepEqual(r.events, []); assert.equal(r.client.getQueryCache().getAll().length, 0); retireNext();
});

for (const patch of [{ commandId: ids[3] }, { leadId: ids[3] }, { channel: 'email' }, { recordedAt: 'invalid' }]) {
  test(`invalid receipt ${JSON.stringify(patch)} never invalidates or announces success`, async () => {
    const r = runtime(), { pending, request } = await r.start(); r.resolve(request, patch);
    assert.ok((await pending).error); assert.deepEqual(r.invalidations, []); assert.deepEqual(r.events, []); assert.equal(r.requests.length, 1);
  });
}
for (const status of [404, 409, 503]) test(`HTTP ${status} keeps exactly one explicit request and no success side effects`, async () => {
  const r = runtime(), { pending, request } = await r.start(); request.response.reject(Object.assign(new Error('Synthetic failure'), { status }));
  assert.equal((await pending).error.status, status); assert.equal(r.requests.length, 1); assert.deepEqual(r.invalidations, []); assert.deepEqual(r.events, []);
});
test('a confirmed receipt schedules no unguarded delayed history invalidation', async () => {
  const r = runtime(), { pending, request } = await r.start(); r.resolve(request); assert.ok((await pending).value);
  const count = r.invalidations.length; r.retire(); r.client.clear();
  await new Promise(resolve => setTimeout(resolve, 760)); assert.equal(r.invalidations.length, count);
});
