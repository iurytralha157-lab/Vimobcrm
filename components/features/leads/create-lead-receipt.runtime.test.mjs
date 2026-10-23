import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test, { afterEach } from 'node:test';
import { MutationObserver } from '@tanstack/react-query';
import { apiCreateLeadResponseSchema, leadCreateInputSchema } from '../../../lib/validation/leads.ts';
import { parseDomainInput, validateDomainResponse } from '../../../lib/validation/common.ts';
import { buildLeadEditFields, changedLeadFields, uploadLeadFiles } from '../../../lib/lead-edit-session.ts';
import { toQueuePool } from '../../../lib/queue-pool.ts';
import { getGlobalSignOutSessionId } from '../../../lib/auth/global-sign-out.ts';
import { captureLeadRequestIntent } from '../../../lib/lead-request-intent.ts';
import { contactImportScopeKey, createLeadImportScope } from '../../../lib/lead-import-scope.ts';
import { requiresWonLeadFinancialReview, WON_LEAD_FINANCIAL_REVIEW_MESSAGE } from './lead-detail/financial-review.ts';
import { deferred, leadHookRuntime, turn } from '../../../hooks/leads/lead-request-runtime-fixture.mjs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const ID = '11111111-1111-4111-8111-111111111111';
const ORG_ID = '22222222-2222-4222-8222-222222222222';
const receipt = { data: null, leadId: ID, leadVisible: false, reentry: false, distributionOutcome: 'assigned' };

// Execute the actual production API method, hooks and submit handler with only
// their external boundaries stubbed. No browser, backend or database is opened.
function findDeclaration(relative, predicate) {
  const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
  const file = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true);
  let found;
  function visit(node) {
    if (predicate(node)) found = node.getText(file);
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(found, `Production declaration not found: ${relative}`);
  return found;
}

const apiMethod = findDeclaration('../../../lib/api/leads.ts', node => ts.isMethodDeclaration(node) && node.name.getText() === 'createLead');
const legacyMapper = findDeclaration('../../../lib/api/leads.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === 'toLegacyLead').replace(/^export /, '');
const submitDeclaration = findDeclaration('./CreateLeadDialog.tsx', node => ts.isVariableDeclaration(node) && node.name.getText() === 'handleSubmit');
const leadEventConsumer = findDeclaration('../../../contexts/BackendRealtimeBus.tsx', node => ts.isFunctionDeclaration(node) && node.name?.text === 'handleLeadEvent');
const eventGetString = findDeclaration('../../../contexts/BackendRealtimeBus.tsx', node => ts.isFunctionDeclaration(node) && node.name?.text === 'getString');

function execute(source, dependencies, result) {
  const body = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText;
  return Function(...Object.keys(dependencies), `${body}\nreturn ${result};`)(...Object.values(dependencies));
}

function apiFixture(payload = receipt) {
  const requests = [];
  const api = execute(`${legacyMapper}\nconst api = { ${apiMethod} };`, {
    apiCreateLeadResponseSchema, leadCreateInputSchema, parseDomainInput, validateDomainResponse, toQueuePool,
    vimobAPIRequest: async (path, options) => { requests.push({ path, ...options }); return payload; },
  }, 'api');
  return { api, requests };
}

const cleanup = [];
afterEach(() => { for (const close of cleanup.splice(0)) close(); });
function hookFixture(api) {
  const invalidations = [], runtimes = [];
  const mutation = name => {
    const runtime = leadHookRuntime(); runtimes.push(runtime); cleanup.push(runtime.close);
    runtime.switchTo(ORG_ID, 'synthetic-actor', 'synthetic-sid');
    runtime.respond((method, args) => api[method](...args));
    const client = runtime.client(), invalidate = client.invalidateQueries.bind(client);
    client.invalidateQueries = (...args) => { invalidations.push(args[0]); return invalidate(...args); };
    const observer = new MutationObserver(client, runtime.render('hooks/use-leads.ts', name));
    return { mutationFn: input => observer.mutate(input) };
  };
  return {
    create: mutation('useCreateLead'), import: mutation('useImportLeads'), invalidations,
    get notices() { return runtimes.flatMap(runtime => runtime.notices.map(notice => notice.text)); },
    get events() { return runtimes.flatMap(runtime => runtime.events); },
  };
}

test('actual create client returns a limited receipt without converting null into a fake Lead', async () => {
  const f = apiFixture();
  const result = await f.api.createLead(ORG_ID, { name: 'Contato sintético', phone: '+5511999990000', import_mode: true });
  assert.equal(result.data, null);
  assert.equal(result.leadId, ID);
  assert.equal(result.leadVisible, false);
  assert.equal(result.error, null);
  assert.equal(result.assignedUserName, undefined);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].body.importMode, true);
  assert.equal(f.requests[0].organizationId, ORG_ID);
});

test('committed queue lifecycle receipts preserve every canonical outcome without a client parse failure', async () => {
  for (const outcome of ['pooled', 'queue_closed', 'queue_waiting', 'queue_limit_reached', 'queue_protected']) {
    const fixture = apiFixture({ ...receipt, distributionOutcome: outcome });
    const result = await fixture.api.createLead(ORG_ID, { name: 'Contato sintético', phone: '+5511999990000' });
    assert.equal(result.leadId, ID);
    assert.equal(result.distributionOutcome, outcome);
    assert.equal(result.data, null);
  }
});

test('actual create client preserves visible legacy server responses during a staged release', async () => {
  const data = {
    id: ID, organizationId: ORG_ID, name: 'Contato sintético', email: 'synthetic@example.com',
    source: 'manual', status: 'new', dealStatus: 'open', priority: 'normal', reentryCount: 0,
    createdAt: '2026-10-12T18:00:00Z', updatedAt: '2026-10-12T18:00:00Z',
  };
  const f = apiFixture({ data, reentry: false, distributionOutcome: 'skipped' });
  const result = await f.api.createLead(ORG_ID, { name: data.name, email: data.email });
  assert.equal(result.leadId, ID);
  assert.equal(result.leadVisible, true);
  assert.equal(result.data.email, data.email);
  assert.equal(result.data.created_at, data.createdAt);
});

test('actual create hook accepts persisted out-of-scope result and invalidates without claiming failure', async () => {
  const f = hookFixture(apiFixture().api);
  const result = await f.create.mutationFn({ name: 'Contato sintético', phone: '+5511999990000' });
  assert.equal(result.id, ID);
  assert.equal(result.lead, null);
  assert.ok(f.notices.some(message => message.includes('sucesso')));
  assert.equal(f.events[0].leadId, ID);
  assert.ok(f.invalidations.some(input => input.queryKey[0] === 'leads'));
});

test('actual import hook counts a receipt as successful creation and preserves distribution outcome', async () => {
  const f = hookFixture(apiFixture().api);
  const result = await f.import.mutationFn([{ name: 'Contato sintético', phone: '+5511999990000', auto_distribute: true }]);
  assert.equal(result.success, 1);
  assert.equal(result.created, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.distribution.assigned, 1);
});

test('actual import hook counts a redistributed reentry receipt once rather than reporting failed import', async () => {
  const f = hookFixture(apiFixture({ ...receipt, reentry: true }).api);
  const result = await f.import.mutationFn([{ name: 'Contato sintético', phone: '+5511999990000', auto_distribute: true }]);
  assert.equal(result.success, 1);
  assert.equal(result.created, 0);
  assert.equal(result.reentered, 1);
  assert.equal(result.failed, 0);
});

test('actual import still reports malformed receipts as failures without counting unverified creations', async () => {
  const f = hookFixture(apiFixture({ ...receipt, leadId: undefined }).api);
  const result = await f.import.mutationFn([{ name: 'Contato sintético', phone: '+5511999990000' }]);
  assert.equal(result.success, 0);
  assert.equal(result.created, 0);
  assert.equal(result.failed, 1);
  assert.equal(result.failures[0].code, 'domain_validation_error');
});

function dialogFixture(saveResult, edit = false, changed = true, access = {}) {
  const uploads = [], saved = [], created = [], notices = [], states = [], closed = [], recoveries = [], updates = [], submissions = [];
  const session = { access_token: `header.${Buffer.from(JSON.stringify({ sub: 'synthetic-actor', session_id: 'synthetic-sid' })).toString('base64url')}.synthetic` };
  const submissionScope = createLeadImportScope();
  const submissionScopeKey = JSON.stringify([contactImportScopeKey(ORG_ID, 'synthetic-actor', getGlobalSignOutSessionId(session)), edit ? ID : null]);
  submissionScope.activate(submissionScopeKey);
  const formData = { ...Object.fromEntries(['email','cargo','empresa','profissao','renda_familiar','valor_interesse','property_id','gender','social_name','birth_date','cpf','rg','cnpj','corporate_name','trade_name','state_registration'].map(key => [key, ''])), name: 'Contato sintético', phone: '+5511999990000', feedback: '', message: '', tag_ids: [], interest_property_ids: [], source: 'manual', person_type: 'individual' };
  const dependencies = {
    accessBlocked: false, accessPending: false, submissionAttemptRef: { current: null }, submissionMountedRef: { current: true },
    activeTab: 'management', isEditMode: edit, editableLead: edit ? { id: ID, feedback: '' } : null,
    sensitiveProfileError: false, formData,
    isSubmitting: false, attachmentRecovery: null, editReadDenied: access.editReadDenied ?? false,
    canUploadAttachments: access.canUploadAttachments ?? true,
    buildLeadEditFields, changedLeadFields, uploadLeadFiles,
    session, captureLeadRequestIntent, getGlobalSignOutSessionId, submissionScope, submissionScopeKey,
    requiresWonLeadFinancialReview, WON_LEAD_FINANCIAL_REVIEW_MESSAGE,
    editBaseFormRef: { current: { ...formData, name: changed ? 'Nome anterior' : formData.name } },
    editBaseLeadRef: { current: { id: ID, updated_at: '2026-10-12T18:00:00Z', can_operate: true } },
    setAttachmentRecovery: value => recoveries.push(value),
    validateBasicStep: () => true, validateProfileStep: () => true, validateManagementStep: () => true,
    setActiveTab: () => {}, setIsSubmitting: value => states.push(value),
    parseCurrencyInput: () => undefined,
    createLead: { mutateAsync: async input => { submissions.push(input); return saveResult; } }, updateLead: { mutateAsync: async (input) => { updates.push(input); return saveResult; } },
    expectedPreviousLeadId: 'unlinked', confirmHistoryLink: true,
    pendingAttachments: [{ name: 'synthetic.pdf' }], activeOrganization: { organizationId: ORG_ID },
    user: { id: 'synthetic-actor' },
    leadAttachmentsAPI: { upload: async (...args) => uploads.push(args) },
    toast: { warning: value => notices.push(value), success: value => notices.push(value), error: value => notices.push(value) },
    draftKey: null, removeLeadDraft: () => {}, setPendingAttachments: () => {}, setDraftRestored: () => {}, setErrors: () => {},
    onSaved: lead => saved.push(lead), onCreated: leadId => created.push(leadId), onOpenChange: value => closed.push(value),
  };
  const submit = execute(`const ${submitDeclaration};`, dependencies, 'handleSubmit');
  return { submit, uploads, saved, created, notices, states, closed, recoveries, updates, submissions, replaceSubmissionSession: () => {
    session.access_token = `header.${Buffer.from(JSON.stringify({ sub: 'synthetic-actor', session_id: 'replacement-sid' })).toString('base64url')}.synthetic`;
    submissionScope.activate(JSON.stringify([contactImportScopeKey(ORG_ID, 'synthetic-actor', getGlobalSignOutSessionId(session)), edit ? ID : null]));
  } };
}

test('actual dialog retains inaccessible documents after limited creation and finishes without fabricating a Lead', async () => {
  const f = dialogFixture({ id: ID, lead: null, leadVisible: false });
  await f.submit({ preventDefault() {} });
  assert.equal(f.uploads.length, 0);
  assert.deepEqual(f.saved, []);
  assert.deepEqual(f.created, []);
  assert.deepEqual(f.closed, []);
  assert.equal(f.recoveries[0].leadId, ID);
  assert.equal(f.recoveries[0].canUpload, false);
  assert.equal(f.recoveries[0].files.length, 1);
  f.recoveries[0].onFinish();
  f.recoveries[0].onFinish();
  assert.deepEqual(f.created, [ID]);
  assert.deepEqual(f.closed, [false]);
  assert.ok(f.notices.some(message => message.includes('não foram enviados')));
  assert.ok(f.states.includes(false));
});

test('actual dialog preserves full visible creation callback and attachment upload', async () => {
  const lead = { id: ID, name: 'Contato sintético', can_operate: true };
  const f = dialogFixture({ id: ID, lead, leadVisible: true });
  await f.submit({ preventDefault() {} });
  assert.equal(f.uploads[0][0], ID);
  assert.deepEqual(f.saved, [lead]);
  assert.deepEqual(f.created, [ID]);
});

test('actual dialog edit preserves existing Lead callback without emitting creation event', async () => {
  const lead = { id: ID, name: 'Contato sintético', can_operate: true };
  const f = dialogFixture(lead, true);
  await f.submit({ preventDefault() {} });
  assert.equal(f.uploads[0][0], ID);
  assert.deepEqual(f.saved, [lead]);
  assert.deepEqual(f.created, []);
  assert.deepEqual(f.updates[0], { id: ID, name: 'Contato sintético', expectedUpdatedAt: '2026-10-12T18:00:00Z' });
});

test('actual dialog uploads documents without issuing an empty PATCH or recreating the unchanged contact', async () => {
  const f = dialogFixture({ id: ID, name: 'Contato sintético', can_operate: true }, true, false);
  await f.submit({ preventDefault() {} });
  assert.deepEqual(f.updates, []);
  assert.equal(f.uploads.length, 1);
  assert.equal(f.saved[0].id, ID);
  assert.deepEqual(f.closed, [false]);
});

test('dialog denied edit does not patch, upload or close; visible read-only creation retains files', async () => {
  const denied = dialogFixture({ id: ID, can_operate: false }, true, true, { editReadDenied: true });
  await denied.submit({ preventDefault() {} });
  assert.deepEqual(denied.updates, []); assert.deepEqual(denied.uploads, []); assert.deepEqual(denied.closed, []);
  const readOnly = dialogFixture({ id: ID, lead: { id: ID, can_operate: false }, leadVisible: true });
  await readOnly.submit({ preventDefault() {} });
  assert.equal(readOnly.uploads.length, 0); assert.equal(readOnly.recoveries[0].canUpload, false);
  const noModulePermission = dialogFixture({ id: ID, lead: { id: ID, can_operate: true }, leadVisible: true }, false, true, { canUploadAttachments: false });
  await noModulePermission.submit({ preventDefault() {} });
  assert.equal(noModulePermission.uploads.length, 0); assert.equal(noModulePermission.recoveries[0].canUpload, false);
});

test('dialog late creation after replacing submission SID cannot upload, publish or close', async () => {
  const pending = deferred(); const fixture = dialogFixture(pending.promise);
  const operation = fixture.submit({ preventDefault() {} }); await turn();
  assert.equal(fixture.submissions.length, 1);
  fixture.replaceSubmissionSession();
  pending.resolve({ id: ID, lead: { id: ID, can_operate: true }, leadVisible: true });
  await operation;
  assert.deepEqual(fixture.uploads, []); assert.deepEqual(fixture.created, []); assert.deepEqual(fixture.saved, []); assert.deepEqual(fixture.closed, []); assert.deepEqual(fixture.notices, []);
});

test('actual backend event consumer preserves lead invalidation using only the limited receipt ID', () => {
  const changes = [];
  const consume = execute(`${eventGetString}\n${leadEventConsumer}`, {
    notifyLeadRealtimeChange: change => changes.push(change),
  }, 'handleLeadEvent');
  consume({ type: 'lead.created', organizationId: ORG_ID, data: { leadId: ID } });
  assert.deepEqual(changes, [{ organizationId: ORG_ID, leadId: ID, reason: 'lead.created' }]);
});
