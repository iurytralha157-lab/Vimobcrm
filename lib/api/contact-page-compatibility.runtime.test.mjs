import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { DomainValidationError, validateDomainResponse } from '../validation/common.ts';
import { apiContactPageResponseSchema } from '../validation/crm-support.ts';
import { getErrorMessageOrFallback } from './vimob-error.ts';

const state = { request: null };
globalThis.__contactPageCompatibility = state;
const commonURL = new URL('../validation/common.ts', import.meta.url).href;
const schemasURL = new URL('../validation/crm-support.ts', import.meta.url).href;
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    let source;
    if (specifier === './vimob-client' && context.parentURL?.endsWith('/api/contacts.ts')) {
      source = 'export const vimobAPIRequest = (...args) => globalThis.__contactPageCompatibility.request(...args);';
    } else if (specifier === '@/lib/validation' && context.parentURL?.endsWith('/api/contacts.ts')) {
      source = `export * from ${JSON.stringify(commonURL)}; export * from ${JSON.stringify(schemasURL)};`;
    }
    return source ? { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` } : nextResolve(specifier, context);
  },
});
after(() => { hook.deregister(); delete globalThis.__contactPageCompatibility; });
const { contactsAPI } = await import('./contacts.ts');

const organization = '10000000-0000-4000-8000-000000000001';
const row = (total = 37) => ({
  id: '20000000-0000-4000-8000-000000000001', name: 'Contato sintético',
  created_at: '2026-10-13T10:00:00Z', updated_at: '2026-10-13T10:00:00Z',
  tags: [], total_count: total, phone: '+5511999990000',
});
const serve = responses => {
  const requests = [];
  state.request = async (path, options) => {
    assert.equal(path, '/v1/contacts'); requests.push(options);
    const response = responses[requests.length - 1];
    assert.notEqual(response, undefined, 'no unexpected extra request');
    return typeof response === 'function' ? response(options) : response;
  };
  return requests;
};

test('actual compact list displays valid legacy contacts with their exact total and requested pagination', async () => {
  const response = { data: [row()] };
  const requests = serve([response]);
  const page = await contactsAPI.listPage({ page: 2, limit: 10 }, organization);
  assert.deepEqual(page, { data: response.data, total: 37, page: 2, limit: 10 });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].query.responseMode, 'page');
  assert.equal(requests[0].organizationId, organization);
});

test('actual compact list treats a validated empty first legacy page as empty', async () => {
  const requests = serve([{ data: [] }]);
  assert.deepEqual(await contactsAPI.listPage({}, organization), { data: [], total: 0, page: 1, limit: 25 });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].query.page, 1); assert.equal(requests[0].query.limit, 25);
});

test('canonical page envelope, including an empty later page with a nonzero total, stays intact', async () => {
  const response = { data: [], total: 37, page: 5, limit: 10 };
  const requests = serve([response]);
  assert.deepEqual(await contactsAPI.listPage({ page: 5, limit: 10 }, organization), response);
  assert.equal(requests.length, 1);
});

test('empty later legacy page reads one first-page row for the count instead of inventing zero', async () => {
  const requests = serve([{ data: [] }, { data: [row()] }]);
  assert.deepEqual(await contactsAPI.listPage({ search: 'sintético', page: 5, limit: 10 }, organization), { data: [], total: 37, page: 5, limit: 10 });
  assert.equal(requests.length, 2);
  assert.equal(requests[1].query.page, 1); assert.equal(requests[1].query.limit, 1);
  assert.equal(requests[1].query.search, 'sintético'); assert.equal(requests[1].organizationId, organization);
});

test('count probe accepts a canonical response and confirms an entirely empty legacy set', async () => {
  serve([{ data: [] }, { data: [], total: 37, page: 1, limit: 1 }]);
  assert.equal((await contactsAPI.listPage({ page: 5, limit: 10 }, organization)).total, 37);
  serve([{ data: [] }, { data: [] }]);
  assert.deepEqual(await contactsAPI.listPage({ page: 5, limit: 10 }, organization), { data: [], total: 0, page: 5, limit: 10 });
});

for (const response of [
  { data: [row()], page: 2, limit: 10 },
  { data: [row()], total: null },
  { data: [row()], exportVersion: 'a'.repeat(64) },
  { data: [{ ...row(), total_count: undefined }] },
  { data: [{ ...row(), id: 'invalid' }] },
  { data: [row(37), row(38)] },
  { data: [row(0)] },
  { data: [row(2)] },
]) test(`partial or invalid envelopes remain rejected: ${JSON.stringify(response)}`, async () => {
  const requests = serve([response]);
  await assert.rejects(contactsAPI.listPage({ page: 2, limit: 10 }, organization), { name: 'DomainValidationError' });
  assert.equal(requests.length, 1);
});

for (const mode of ['full', 'export']) test(`legacy ${mode} is not promoted into a complete export`, async () => {
  serve([{ data: [row()] }]);
  await assert.rejects(contactsAPI.listPage({ mode, page: 1, limit: 10 }, organization), { name: 'DomainValidationError' });
});

test('canonical export metadata remains intact and no version is fabricated', async () => {
  const response = { data: [row()], total: 37, page: 1, limit: 10, exportVersion: 'a'.repeat(64) };
  serve([response]);
  assert.deepEqual(await contactsAPI.listPage({ mode: 'export', page: 1, limit: 10 }, organization), response);
});

test('the count probe preserves all validated filters and the initiating intent/signal', async () => {
  const controller = new AbortController();
  const intent = { expectedUserId: 'actor-a', expectedSessionId: 'sid-a', signal: controller.signal };
  const filters = { page: 5, limit: 10, pipelineId: organization, teamId: organization, unassigned: true,
    tagIds: [organization], campaignIds: ['campaign-b', 'campaign-a'], sortBy: 'name', sortDir: 'asc' };
  const requests = serve([() => { intent.expectedSessionId = 'sid-b'; return { data: [] }; }, { data: [row()] }]);
  await contactsAPI.listPage(filters, organization, intent);
  assert.deepEqual(requests[1].query, { ...requests[0].query, page: 1, limit: 1 });
  assert.equal(requests[1].expectedUserId, 'actor-a'); assert.equal(requests[1].expectedSessionId, 'sid-a');
  assert.equal(requests[1].signal, controller.signal);
});

test('cancellation after the original legacy read prevents the count probe', async () => {
  const controller = new AbortController();
  const requests = serve([() => { controller.abort(); return { data: [] }; }]);
  await assert.rejects(contactsAPI.listPage({ page: 5, limit: 10 }, organization, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(requests.length, 1);
});

test('authorization or network rejection of the count probe is not converted into an empty list', async () => {
  const denied = Object.assign(new Error('Synthetic denied'), { status: 403 });
  serve([{ data: [] }, () => { throw denied; }]);
  await assert.rejects(contactsAPI.listPage({ page: 5, limit: 10 }, organization), error => error === denied);
});

test('actual screen error message hides response internals and preserves actionable permission errors', () => {
  const source = readFileSync(new URL('../../components/features/contacts/ContactsScreen.tsx', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('ContactsScreen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'contactsErrorMessage') initializer = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(ast); assert.ok(initializer);
  const code = ts.transpileModule(`return ${initializer.getText(ast)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const message = new Function('contactsQueryError', 'DomainValidationError', 'getErrorMessage', code);
  let invalidResponse;
  try { validateDomainResponse(apiContactPageResponseSchema, { data: [] }, 'contacts.list-page'); } catch (error) { invalidResponse = error; }
  const publicMessage = message(invalidResponse, DomainValidationError, getErrorMessageOrFallback);
  assert.match(publicMessage, /Tente novamente/);
  assert.doesNotMatch(publicMessage, /contacts\.list-page|Required|Contrato|total|limit/);
  assert.equal(message(new Error('Você não tem permissão para visualizar contatos.'), DomainValidationError, getErrorMessageOrFallback), 'Você não tem permissão para visualizar contatos.');
});
