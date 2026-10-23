import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import { MutationObserver, QueryClient, QueryObserver } from '@tanstack/query-core';
import { createUUID } from '../../lib/client-id.ts';
import { getGlobalSignOutSessionId } from '../../lib/auth/global-sign-out.ts';
import { captureLeadRequestIntent } from '../../lib/lead-request-intent.ts';
import { captureQueryClientAccess } from '../../lib/access/query-client-access.ts';
import { leadFeedbackCommandSchema, leadFeedbackResponseSchema } from '../../lib/validation/lead-feedback.ts';
import { parseDomainInput, uuidSchema, validateDomainResponse } from '../../lib/validation/common.ts';
import { deferred, evaluateProduction, productionDeclaration, turn } from './lead-request-runtime-fixture.mjs';

// Production API, detail/request scopes, mutation, draft hook and popup save handler.
// Query/MutationObservers execute actual Query scheduling; React lifecycle and
// transport are deterministic adapters. There is no network or real CRM write.
const ids = {
  org: '11111111-1111-4111-8111-111111111111', otherOrg: '22222222-2222-4222-8222-222222222222',
  lead: '33333333-3333-4333-8333-333333333333', actor: '44444444-4444-4444-8444-444444444444',
  otherActor: '55555555-5555-4555-8555-555555555555', activity: '66666666-6666-4666-8666-666666666666',
};
const token = (actor, sid) => `header.${Buffer.from(JSON.stringify({ sub: actor, session_id: sid })).toString('base64url')}.synthetic`;
const moduleSource = path => {
  const ast = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return ast.statements.filter(node => !ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)).map(node => node.getText(ast)).join('\n');
};
const saveHandler = () => 'const ' + productionDeclaration(process.env.LEAD_FEEDBACK_DETAIL_SOURCE || 'components/features/leads/LeadDetailDialog.tsx',
  node => ts.isVariableDeclaration(node) && node.name.getText() === 'handleSaveFeedback');

function runtime(initialVariant = 'pipeline') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  const auth = { activeOrganization: { organizationId: ids.org }, user: { id: ids.actor },
    session: { access_token: token(ids.actor, 'sid-a') } };
  const requests = [], notices = [], events = [], histories = [], invalidations = [], mutations = [], observers = [];
  const invalidate = client.invalidateQueries.bind(client);
  client.invalidateQueries = options => { invalidations.push(options); return invalidate(options); };
  let slots = [], cursor = 0, opened = true, canOperate = true, variant = initialVariant, leadId = ids.lead;
  let draftHook, mutationHook, captureOperation, feedbackSubmittingRef;
  const changed = (previous, next) => !previous || next.some((value, index) => !Object.is(value, previous[index]));
  const react = {
    useRef: value => { const index = cursor++; return slots[index] ??= { current: value }; },
    useMemo: (build, deps) => { const index = cursor++; if (changed(slots[index]?.deps, deps)) slots[index] = { deps, value: build() }; return slots[index].value; },
    useLayoutEffect: (setup, deps) => { const index = cursor++; if (changed(slots[index]?.deps, deps)) { slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: setup() }; } },
    useCallback: callback => callback,
  };
  const deps = { ...react, createUUID, captureLeadRequestIntent, getGlobalSignOutSessionId, captureQueryClientAccess,
    leadFeedbackCommandSchema, leadFeedbackResponseSchema, parseDomainInput, uuidSchema, validateDomainResponse,
    useAuth: () => auth, useQueryClient: () => client,
    getVimobAPIAccessTokenUserId: () => auth.user?.id ?? null,
    getVimobAPIAccessTokenSessionId: () => getGlobalSignOutSessionId(auth.session),
    toast: Object.fromEntries(['error', 'success', 'warning'].map(kind => [kind, message => notices.push({ kind, message })])),
    enforceClientActionRateLimit: () => {}, getClientRateLimitMessage: () => null,
    notifyLeadRealtimeChange: event => events.push(event),
    invalidateLeadHistorySoon: (...args) => histories.push(args),
    useQuery: options => { const observer = new QueryObserver(client, options); observers.push(observer); return observer.getCurrentResult(); },
    useMutation: options => { const observer = new MutationObserver(client, options); mutations.push(observer); return { mutateAsync: input => observer.mutate(input), isPending: observer.getCurrentResult().isPending }; },
    vimobAPIRequest: async (path, options) => { const wait = deferred(); requests.push({ path, options, wait }); return await wait.promise; },
  };
  deps.captureCurrentLeadRequestIntent = evaluateProduction(moduleSource('lib/api/lead-request-intent.ts'), deps, 'captureCurrentLeadRequestIntent');
  deps.leadFeedbackAPI = evaluateProduction(moduleSource('lib/api/lead-feedback.ts'), deps, 'leadFeedbackAPI');
  deps.useLeadRequestScope = evaluateProduction(moduleSource('hooks/leads/use-lead-request-scope.ts'), deps, 'useLeadRequestScope');
  deps.useLeadDetailOperationScope = evaluateProduction(moduleSource('hooks/leads/use-lead-detail-operation-scope.ts'), deps, 'useLeadDetailOperationScope');
  const draftAdapter = evaluateProduction(moduleSource('hooks/leads/use-lead-feedback-draft.ts'), deps, 'useLeadFeedbackDraft');
  const mutationAdapter = evaluateProduction(moduleSource('hooks/leads/use-record-lead-feedback.ts'), deps, 'useRecordLeadFeedback');
  const close = () => { slots.forEach(slot => slot?.cleanup?.()); slots = []; opened = false; };
  const render = (patch = {}) => {
    if ('org' in patch) auth.activeOrganization.organizationId = patch.org;
    if ('actor' in patch) auth.user = patch.actor ? { id: patch.actor } : null;
    if ('sid' in patch || 'actor' in patch) auth.session = { access_token: token(auth.user?.id, patch.sid ?? getGlobalSignOutSessionId(auth.session)) };
    if ('lead' in patch) leadId = patch.lead;
    if ('variant' in patch) variant = patch.variant;
    if ('allowed' in patch) canOperate = patch.allowed;
    opened = true; cursor = 0;
    captureOperation = deps.useLeadDetailOperationScope(leadId, auth.activeOrganization.organizationId,
      auth.user?.id || null, client, canOperate, getGlobalSignOutSessionId(auth.session));
    mutationHook = mutationAdapter();
    draftHook = draftAdapter(auth.activeOrganization.organizationId, leadId, auth.user?.id);
    feedbackSubmittingRef = react.useRef(false);
  };
  const handler = () => evaluateProduction(saveHandler(), { ...deps,
    canOperateLead: canOperate, feedback: draftHook.draft, feedbackSubmittingRef,
    captureDetailOperation: captureOperation, getSubmission: draftHook.getSubmission,
    recordLeadFeedback: mutationHook, acknowledgeSavedDraft: draftHook.acknowledgeSavedDraft,
    lead: { id: leadId }, variant, getErrorMessage: error => error.message,
    updateLead: { mutateAsync: async input => { requests.push({ legacyPatch: input }); } },
  }, 'handleSaveFeedback');
  const type = value => { draftHook.updateDraft(value); render(); };
  const start = async () => { const promise = handler()(); await turn(); return { promise }; };
  const receipt = request => ({ data: { commandId: request.options.body.commandId, leadId,
    activityId: ids.activity, recordedAt: '2026-10-17T10:00:00Z' } });
  const acknowledge = (request = requests.at(-1), patch = {}) => request.wait.resolve({ data: { ...receipt(request).data, ...patch } });
  const reject = (request = requests.at(-1), status = 503) => request.wait.reject(Object.assign(new Error('Synthetic transport failure'), { status }));
  render();
  return { client, auth, requests, notices, events, histories, invalidations, render, type, start, acknowledge, reject,
    draft: () => client.getQueryData(['lead-feedback-draft', auth.activeOrganization.organizationId, leadId]),
    submission: content => draftHook.getSubmission(content), api: deps.leadFeedbackAPI,
    snapshotHandler: handler, close, reopen: () => render(), isOpen: () => opened,
    dispose: () => { close(); observers.forEach(observer => observer.destroy()); mutations.forEach(observer => observer.reset()); client.clear(); },
  };
}

function feedbackServer() {
  const receipts = new Map(), notes = [];
  let feedback = '';
  return {
    notes, currentFeedback: () => feedback,
    commit(request) {
      assert.equal(request.options?.method, 'POST', 'feedback must use the idempotent command endpoint');
      assert.equal(request.path, `/v1/leads/${ids.lead}/feedback`);
      const { commandId, content } = request.options.body;
      const key = JSON.stringify([request.options.organizationId, request.options.expectedUserId, commandId]);
      if (receipts.has(key)) return receipts.get(key);
      const receipt = { data: { commandId, leadId: ids.lead, activityId: createUUID(), recordedAt: '2026-10-21T15:00:00Z' } };
      feedback = content;
      notes.push({ commandId, content });
      receipts.set(key, receipt);
      return receipt;
    },
  };
}

for (const variant of ['pipeline', 'default']) {
const variantTest = (name, run) => test(`${variant}: ${name}`, run);

variantTest('a failed POST retains draft and UUID through retry and popup reopening; ACK permits a new UUID', async t => {
  const h = runtime(variant); t.after(h.dispose); h.type('  Feedback útil  ');
  const first = await h.start(), command = h.requests[0].options.body;
  assert.match(command.commandId, /^[a-f0-9-]{36}$/); assert.equal(command.content, 'Feedback útil');
  assert.equal(h.requests[0].options.method, 'POST'); assert.equal(h.requests[0].path, `/v1/leads/${ids.lead}/feedback`);
  h.reject(); await first.promise; assert.equal(h.draft(), '  Feedback útil  ');
  h.close(); h.reopen(); const retry = await h.start(); assert.equal(h.requests[1].options.body.commandId, command.commandId);
  h.acknowledge(); await retry.promise; assert.equal(h.draft(), '');
  h.type('Feedback útil'); assert.notEqual(h.submission('Feedback útil').commandId, command.commandId);
});

variantTest('typing during an outstanding ACK preserves new text and its different command', async t => {
  const h = runtime(variant); t.after(h.dispose); h.type('Primeiro'); const first = await h.start();
  const old = h.requests[0]; h.type('Novo texto'); const newer = h.submission('Novo texto');
  h.acknowledge(old); await first.promise; assert.equal(h.draft(), 'Novo texto');
  assert.equal(h.submission('Novo texto').commandId, newer.commandId);
});

for (const status of [404, 503]) variantTest(`HTTP ${status} remains visible, preserves the draft and never falls back to PATCH`, async t => {
  const h = runtime(variant); t.after(h.dispose); h.type('Manter rascunho'); const send = await h.start(); h.reject(undefined, status); await send.promise;
  assert.equal(h.draft(), 'Manter rascunho'); assert.equal(h.requests.length, 1); assert.equal(h.requests[0].options.method, 'POST');
  assert.equal(h.notices.filter(notice => notice.kind === 'error').length, 1);
  assert.match(h.notices[0].message, /indisponível.*rascunho foi mantido/); assert.equal(h.events.length, 0);
});

for (const patch of [{ commandId: ids.activity }, { leadId: ids.otherActor }]) variantTest(`mismatched acknowledgement ${Object.keys(patch)[0]} cannot clear draft or emit success`, async t => {
  const h = runtime(variant); t.after(h.dispose); h.type('Confirmar ACK'); const send = await h.start(); const command = h.requests[0].options.body.commandId;
  h.acknowledge(undefined, patch); await send.promise; assert.equal(h.draft(), 'Confirmar ACK'); assert.equal(h.submission('Confirmar ACK').commandId, command);
  assert.equal(h.notices.some(notice => notice.kind === 'success'), false); assert.equal(h.events.length, 0);
});

variantTest('invalid API command/lead/org inputs are rejected before any transport dispatch', async t => {
  const h = runtime(variant); t.after(h.dispose);
  for (const [lead, body, org] of [[ids.lead, { commandId: createUUID(), content: ' ' }, ids.org],
    ['bad', { commandId: createUUID(), content: 'ok' }, ids.org], [ids.lead, { commandId: createUUID(), content: 'ok' }, 'bad'],
    [ids.lead, { commandId: 'bad', content: 'ok' }, ids.org]]) {
    await assert.rejects(h.api.record(lead, body, org));
  }
  assert.equal(h.requests.length, 0);
});

variantTest('a popup with no write capability cannot prepare or dispatch feedback', async t => {
  const h = runtime(variant); t.after(h.dispose); h.type('Sem permissão'); h.render({ allowed: false });
  await (await h.start()).promise; assert.equal(h.requests.length, 0); assert.equal(h.draft(), 'Sem permissão');
});

variantTest('feedback uses the same idempotent POST and confirms the draft only after ACK', async t => {
  const h = runtime(variant); t.after(h.dispose); h.type('Contato');
  const send = await h.start(), request = h.requests[0];
  assert.equal(request.options?.method, 'POST');
  assert.equal(request.path, `/v1/leads/${ids.lead}/feedback`);
  assert.equal(h.draft(), 'Contato');
  h.acknowledge(request); await send.promise;
  assert.equal(h.draft(), '');
});

variantTest('lost ACK followed by B and retry A keeps the original command without restoring A or duplicating its note', async t => {
  const h = runtime(variant), other = runtime(variant), server = feedbackServer();
  t.after(h.dispose); t.after(other.dispose);
  h.type('Feedback A'); const first = await h.start(), original = h.requests[0];
  server.commit(original); h.reject(original); await first.promise;
  assert.equal(h.draft(), 'Feedback A');
  other.render({ actor: ids.otherActor, sid: 'sid-b' }); other.type('Feedback B');
  const newer = await other.start(), otherRequest = other.requests[0];
  otherRequest.wait.resolve(server.commit(otherRequest)); await newer.promise;
  h.close(); h.reopen(); const retry = await h.start(), repeated = h.requests[1];
  assert.equal(repeated.options?.body.commandId, original.options.body.commandId);
  repeated.wait.resolve(server.commit(repeated)); await retry.promise;
  assert.equal(server.currentFeedback(), 'Feedback B');
  assert.deepEqual(server.notes.map(note => note.content), ['Feedback A', 'Feedback B']);
  assert.equal(h.draft(), '');
});

variantTest('a new acknowledged gesture with the same text remains a distinct note', async t => {
  const h = runtime(variant), server = feedbackServer(); t.after(h.dispose);
  const commands = [];
  for (let index = 0; index < 2; index++) {
    h.type('Mesmo conteúdo'); const send = await h.start(), request = h.requests.at(-1);
    const receipt = server.commit(request); commands.push(request.options.body.commandId);
    request.wait.resolve(receipt); await send.promise;
    assert.equal(h.draft(), '');
  }
  assert.notEqual(commands[0], commands[1]);
  assert.deepEqual(server.notes.map(note => note.content), ['Mesmo conteúdo', 'Mesmo conteúdo']);
});

variantTest('an ACK from a closed panel cannot erase a newly opened draft', async t => {
  const h = runtime(variant); t.after(h.dispose); h.type('Texto idêntico');
  const send = await h.start(), old = h.requests[0];
  assert.equal(old.options?.method, 'POST');
  h.close(); h.reopen(); h.type('Texto idêntico');
  h.acknowledge(old); await send.promise;
  assert.equal(h.draft(), 'Texto idêntico');
  assert.equal(h.notices.some(notice => notice.kind === 'success'), false);
});

variantTest('successful feedback invalidates captured organization only and notifies its current actor', async t => {
  const h = runtime(variant); t.after(h.dispose); h.type('Organização A'); const send = await h.start();
  const request = h.requests[0]; assert.equal(request.options.organizationId, ids.org);
  assert.equal(request.options.expectedUserId, ids.actor); assert.equal(request.options.expectedSessionId, 'sid-a');
  h.acknowledge(); await send.promise;
  const scoped = h.invalidations.filter(options => options.queryKey[0] !== 'activities');
  assert.equal(scoped.length, 4); assert.ok(scoped.every(options => options.queryKey[1] === ids.org && options.refetchType === 'active'));
  assert.deepEqual(h.events, [{ organizationId: ids.org, leadId: ids.lead, reason: 'lead.updated' }]);
});

for (const change of [{ org: ids.otherOrg }, { actor: ids.otherActor }, { sid: 'sid-b' }]) variantTest(`late failure after ${JSON.stringify(change)} cannot show a toast in the new visit`, async t => {
  const h = runtime(variant); t.after(h.dispose); h.type('Visita antiga'); const send = await h.start(); const old = h.requests[0];
  h.render(change); assert.equal(old.options.signal.aborted, true); h.reject(old); await send.promise;
  assert.equal(h.notices.length, 0); assert.equal(h.events.length, 0);
});

for (const change of [{ org: ids.otherOrg }, { actor: ids.otherActor }, { sid: 'sid-b' }]) variantTest(`old ACK after ABA ${JSON.stringify(change)} cannot erase a new visit draft`, async t => {
  const h = runtime(variant); t.after(h.dispose); h.type('Texto idêntico'); const send = await h.start(); const old = h.requests[0];
  h.render(change); h.render({ org: ids.org, actor: ids.actor, sid: 'sid-a' }); h.type('Texto idêntico');
  h.acknowledge(old); await send.promise; assert.equal(h.draft(), 'Texto idêntico');
  assert.equal(h.notices.some(notice => notice.kind === 'success'), false); assert.equal(h.events.length, 0);
  assert.ok(h.invalidations.every(options => options.refetchType === 'none'));
});

variantTest('the actual detail scope preserves a new lead draft after the old lead ACK', async t => {
  const h = runtime(variant); t.after(h.dispose); h.type('Lead A draft');
  const oldSend = await h.start(), old = h.requests[0];
  h.render({ lead: ids.otherOrg }); h.type('Lead B draft');
  h.acknowledge(old, { leadId: ids.lead }); await oldSend.promise;
  assert.equal(h.draft(), 'Lead B draft');
  assert.equal(h.notices.some(notice => notice.kind === 'success'), false);
  const current = await h.start(); assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].path, `/v1/leads/${ids.otherOrg}/feedback`);
  h.acknowledge(h.requests[1]); await current.promise; assert.equal(h.draft(), '');
});

variantTest('the actual detail scope permanently retires lead A to B to A acknowledgements', async t => {
  const h = runtime(variant); t.after(h.dispose); h.type('Same draft');
  const oldSend = await h.start(), old = h.requests[0];
  h.render({ lead: ids.otherOrg }); h.render({ lead: ids.lead }); h.type('Same draft');
  h.acknowledge(old, { leadId: ids.lead }); await oldSend.promise;
  assert.equal(h.draft(), 'Same draft');
  assert.equal(h.notices.some(notice => notice.kind === 'success'), false);
});

variantTest('permission loss rejects old draft acknowledgement and a permitted retry keeps its command', async t => {
  const h = runtime(variant); t.after(h.dispose); h.type('Permission changed');
  const oldSend = await h.start(), old = h.requests[0]; h.render({ allowed: false });
  h.acknowledge(old); await oldSend.promise;
  assert.equal(h.draft(), 'Permission changed');
  assert.equal(h.notices.some(notice => notice.kind === 'success'), false);
  h.render({ allowed: true }); const retry = await h.start();
  assert.equal(h.requests[1].options.body.commandId, old.options.body.commandId);
  h.acknowledge(h.requests[1]); await retry.promise; assert.equal(h.draft(), '');
});

variantTest('token renewal with the same SID accepts its matching acknowledgement', async t => {
  const h = runtime(variant); t.after(h.dispose); h.type('Refresh same session');
  const send = await h.start(), request = h.requests[0];
  h.auth.session = { access_token: token(ids.actor, 'sid-a').replace('.synthetic', '.rotated-signature') }; h.render();
  h.acknowledge(request); await send.promise;
  assert.equal(h.draft(), '');
  assert.equal(h.notices.filter(notice => notice.kind === 'success').length, 1);
});

variantTest('repeated clicks before acknowledgement dispatch exactly one command', async t => {
  const h = runtime(variant); t.after(h.dispose); h.type('One gesture');
  const first = await h.start(), repeated = await h.start();
  assert.equal(h.requests.length, 1); h.acknowledge(h.requests[0]);
  await Promise.all([first.promise, repeated.promise]); assert.equal(h.draft(), '');
});

for (const change of [{ lead: ids.otherOrg }, { org: ids.otherOrg }, { actor: ids.otherActor }, { sid: 'sid-b' }]) variantTest(`a retired callback after ${JSON.stringify(change)} cannot hold the next valid save`, async t => {
  const h = runtime(variant); t.after(h.dispose); h.type('Old scoped draft');
  const retired = h.snapshotHandler(); h.render(change); h.type('Current scoped draft');
  let retiredError;
  try { await retired(); } catch (error) { retiredError = error; }
  assert.equal(h.requests.length, 0, 'the retired callback must not dispatch');
  assert.equal(h.draft(), 'Current scoped draft'); assert.equal(h.notices.length, 0);
  assert.equal(h.client.getQueryData(['lead-feedback-command', ids.org, ids.actor, ids.lead]), null,
    'scope rejection must happen before preparing a command');
  const current = await h.start();
  assert.equal(h.requests.length, 1, 'a rejected capture must release the submission latch');
  h.acknowledge(h.requests[0]); await current.promise; assert.equal(h.draft(), '');
  assert.equal(retiredError, undefined, 'an already retired callback must be ignored without an unhandled rejection');
});
}
