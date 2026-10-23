import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';
import ts from 'typescript';
import { MutationObserver, QueryClient } from '@tanstack/query-core';
import { apiActivityListResponseSchema, apiActivityResponseSchema, activityListQuerySchema,
  createActivityInputSchema } from '../../lib/validation/crm-support.ts';
import { manualActivityCreateInputSchema } from '../../lib/validation/manual-activities.ts';
import { parseDomainInput, validateDomainResponse } from '../../lib/validation/common.ts';
import { activateQueryClientAccess } from '../../lib/access/query-client-access.ts';
import * as history from '../use-optimistic-lead-history.ts';
import { deferred, evaluateProduction, leadHookRuntime, turn } from './lead-request-runtime-fixture.mjs';

// Actual hook, request scope, Zod parser, API and optimistic-history functions.
// HTTP/auth are synthetic; no environment, network, browser or DB is loaded.
const leadId = '30000000-0000-4000-8000-000000000001';
const variable = () => ({ lead_id: leadId, type: 'call_initiated', content: 'Ligação iniciada', metadata: { phone: '+5511000000000', channel: 'phone' } });
const fixture = JSON.parse(readFileSync('apps/api/internal/leads/testdata/manual_activity_cases.json', 'utf8'));
const moduleSource = path => {
  const ast = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  return ast.statements.filter(node => !ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)).map(node => node.getText(ast)).join('\n');
};
const open = new Set(); afterEach(() => { for (const r of open) r.close(); open.clear(); });
function runtime({ holdCancel = false, respond } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  const scopeRuntime = leadHookRuntime(client), retire = activateQueryClientAccess(client), cancel = deferred();
  const requests = [], cancellations = [], optimistic = [], refreshes = [], observers = [];
  const before = { id: 'existing-server-row', type: 'note', label: 'Existing server event', content: 'Keep me', timestamp: '2026-10-19T12:00:00Z', source: 'activity' };
  client.setQueryData(['lead-history-v2', leadId], [before]);
  const originalCancel = client.cancelQueries.bind(client);
  client.cancelQueries = async filters => { cancellations.push(filters); if (holdCancel) await cancel.promise; return await originalCancel(filters); };
  const deps = { ...history, manualActivityCreateInputSchema, createActivityInputSchema, parseDomainInput, validateDomainResponse,
    apiActivityListResponseSchema, apiActivityResponseSchema, activityListQuerySchema,
    captureCurrentLeadRequestIntent: intent => intent,
    vimobAPIRequest: async (url, options) => {
      requests.push({ url, options });
      if (respond) return await respond(url, options);
      return { data: { id: leadId, organization_id: leadId, user_id: leadId, lead_id: options.body.lead_id,
        type: options.body.type, content: options.body.content, metadata: { ...options.body.metadata, origin: 'manual_activity' }, created_at: '2026-10-19T12:00:00Z' } };
    },
    useQueryClient: () => client, useMutation: options => options,
    useLeadRequestScope: () => scopeRuntime.scope(),
    appendOptimisticLeadHistoryEvent: (...args) => { optimistic.push(args); return history.appendOptimisticLeadHistoryEvent(...args); },
    invalidateLeadHistorySoon: (...args) => refreshes.push(args),
  };
  deps.activitiesAPI = evaluateProduction(moduleSource('lib/api/activities.ts'), deps, 'activitiesAPI');
  const options = evaluateProduction(moduleSource(process.env.MANUAL_ACTIVITY_HOOK_SOURCE || 'hooks/use-activities.ts'), deps, 'useCreateActivity')();
  const r = { client, requests, cancellations, optimistic, refreshes, options, api: deps.activitiesAPI, cancel, retire,
    mutate(input = variable()) { const observer = new MutationObserver(client, options); observers.push(observer); return observer.mutate(input); },
    switchTo: (...args) => { scopeRuntime.switchTo(...args); scopeRuntime.scope(); },
    unmount: () => scopeRuntime.unmount(),
    close() { observers.forEach(observer => observer.reset()); retire(); scopeRuntime.close(); },
  };
  open.add(r); return r;
}

for (const input of [
  { ...variable(), type: 'status_change', metadata: { from_status: 'open', to_status: 'won' } },
  { ...variable(), type: 'note', metadata: { kind: 'feedback' } },
  { ...variable(), type: 'call', metadata: { channel: { toString: null } } },
]) test(`invalid public activity is rejected before cancellation, optimistic history and POST: ${JSON.stringify(input)}`, async () => {
  const r = runtime(); await assert.rejects(r.mutate(input));
  assert.equal(r.optimistic.length, 0); assert.equal(r.cancellations.length, 0); assert.equal(r.requests.length, 0);
  assert.equal(r.client.getQueryData(['lead-history-v2', leadId]).length, 1);
});
test('all shared invalid vectors are denied before hook side effects', async () => {
  const r = runtime();
  for (const vector of fixture.cases.filter(value => !value.valid)) await assert.rejects(r.mutate(vector.input), undefined, vector.name);
  assert.equal(r.cancellations.length, 0); assert.equal(r.optimistic.length, 0); assert.equal(r.requests.length, 0);
});
test('all shared vectors follow the API contract before HTTP, with server origin absent from input', async () => {
  const r = runtime();
  for (const vector of fixture.cases) {
    const prior = r.requests.length;
    if (!vector.valid) { await assert.rejects(r.api.create(vector.input, 'org-a', { expectedUserId: 'actor-a', expectedSessionId: 'sid-a' })); assert.equal(r.requests.length, prior, vector.name); continue; }
    const receipt = await r.api.create(vector.input, 'org-a', { expectedUserId: 'actor-a', expectedSessionId: 'sid-a' });
    assert.equal(r.requests.length, prior + 1, vector.name);
    const { origin, ...metadata } = vector.normalized.metadata;
    assert.equal(origin, 'manual_activity'); assert.deepEqual(r.requests.at(-1).options.body, { ...vector.normalized, metadata }, vector.name);
    assert.equal(receipt.metadata.origin, 'manual_activity');
  }
});
for (const type of ['note', 'call', 'call_initiated', 'email', 'message']) test(`accepted manual ${type} publishes one scoped manual event and one POST`, async () => {
  const r = runtime(); await r.mutate({ lead_id: leadId, type, content: 'Manual text' });
  assert.equal(r.requests.length, 1); assert.equal(r.requests[0].url, '/v1/activities'); assert.equal(r.requests[0].options.method, 'POST');
  assert.equal(r.requests[0].options.organizationId, 'org-a'); assert.equal(r.requests[0].options.expectedUserId, 'actor-a');
  assert.equal(r.requests[0].options.expectedSessionId, 'sid-a'); assert.equal(Object.hasOwn(r.requests[0].options.body.metadata, 'origin'), false);
  assert.equal(r.optimistic.length, 1); assert.equal(r.optimistic[0][2].metadata.origin, 'manual_activity');
  assert.equal(r.optimistic[0][2].type, type);
});
test('real phone handler keeps its call initiation payload and tel behavior', () => {
  const path = 'components/features/leads/LeadDetailDialog.tsx';
  const ast = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); let source;
  function visit(node) { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'handleQuickPhone') source = `const ${node.getText(ast)}`; ts.forEachChild(node, visit); }
  visit(ast); assert.ok(source);
  for (const variant of ['pipeline', 'contacts']) {
    const writes = [], calls = [], lead = { id: leadId, phone: '+55 (11) 00000-0000' };
    const handler = evaluateProduction(source, { variant, canOperateLead: true, localLead: lead, lead,
      normalizePhoneToE164: () => '+5511000000000', createActivityMutation: { mutate: value => writes.push(value) },
      window: { open: (...args) => calls.push(args) }, setQuickActionOutcomeType() {}, setQuickActionOutcomeOpen() {} }, 'handleQuickPhone');
    handler(); assert.equal(writes.length, 1); assert.deepEqual(createActivityInputSchema.parse(writes[0]), writes[0]);
    assert.equal(writes[0].type, 'call_initiated'); assert.equal(calls[0][0], 'tel:+5511000000000');
  }
});
test('input changes during cancellation cannot replace the validated attempt', async () => {
  const r = runtime({ holdCancel: true }), input = variable(), before = structuredClone(input);
  const pending = r.mutate(input); await turn(); assert.equal(r.requests.length, 0);
  input.type = 'status_change'; input.content = 'Forged later value'; input.metadata.phone = 'Changed phone'; input.metadata.kind = 'feedback';
  r.cancel.resolve(); await pending;
  assert.deepEqual(r.requests[0].options.body, before); assert.equal(r.optimistic[0][2].type, 'call_initiated');
  assert.equal(r.optimistic[0][2].content, before.content); assert.equal(r.optimistic[0][2].metadata.phone, before.metadata.phone);
});
test('snapshot remains immutable in the hook before handing off to API parsing', async () => {
  const r = runtime(), input = variable(), create = r.api.create;
  r.api.create = (...args) => { assert.ok(Object.isFrozen(args[0])); assert.ok(Object.isFrozen(args[0].metadata)); return create(...args); };
  await r.options.onMutate(input);
  // API transport sees a second parsed clone; mutating the caller cannot alter it.
  input.metadata.phone = 'Altered after optimistic append'; await r.options.mutationFn(input);
  assert.equal(r.requests[0].options.body.metadata.phone, '+5511000000000'); r.options.onSettled(undefined, undefined, input);
  await assert.rejects(r.options.mutationFn(input));
});
for (const patch of ['sid', 'org', 'unmount', 'lease']) test(`cancellation wait cannot POST or seed history after ${patch} retirement`, async () => {
  const r = runtime({ holdCancel: true }), pending = r.mutate(variable()).then(value => ({ value }), error => ({ error })); await turn();
  if (patch === 'sid') r.switchTo('org-a', 'actor-a', 'sid-b');
  else if (patch === 'org') r.switchTo('org-b', 'actor-a', 'sid-a');
  else if (patch === 'unmount') r.unmount(); else r.retire();
  r.cancel.resolve(); assert.ok((await pending).error); assert.equal(r.requests.length, 0); assert.equal(r.optimistic.length, 0);
});
test('rejected manual write rolls back only its optimistic event and preserves concurrent facts', async () => {
  const response = deferred(), r = runtime({ respond: async () => await response.promise });
  const pending = r.mutate(variable()).then(value => ({ value }), error => ({ error }));
  for (let count = 0; count < 10 && r.requests.length === 0; count++) await turn(); assert.equal(r.requests.length, 1);
  r.client.setQueryData(['lead-history-v2', leadId], rows => [...rows, { id: 'concurrent-server-row', type: 'note' }]);
  response.reject(new Error('Synthetic rejection')); assert.ok((await pending).error);
  assert.deepEqual(r.client.getQueryData(['lead-history-v2', leadId]).map(value => value.id), ['existing-server-row', 'concurrent-server-row']);
});
test('legacy canonical activities remain readable through the API list method', async () => {
  const row = { id: leadId, organization_id: leadId, user_id: null, lead_id: leadId, type: 'status_change', content: 'Historical status',
    metadata: { origin: 'vimob_api', old_status: 'open', to_status: 'won', nested: { historical: true } }, created_at: '2026-10-19T12:00:00Z' };
  const r = runtime({ respond: async () => ({ data: [row] }) });
  assert.deepEqual(await r.api.list({ leadId }), [row]); assert.equal(r.requests[0].options.method, undefined);
});
