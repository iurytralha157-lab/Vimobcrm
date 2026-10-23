import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { QueryClient } from '@tanstack/react-query';
import { createLeadImportScope, contactImportScopeKey } from './lead-import-scope.ts';
import { captureLeadRequestIntent } from './lead-request-intent.ts';
import { isDefinitiveLeadReadDenial, visibleLeadRead } from './lead-read-access.ts';
import { LeadReadSupersededError, readConsistentLeadSnapshot, reconcileLeadReadCache } from './lead-read-consistency.ts';
import { prepareLeadPDFPreview } from './lead-attachment-preview.ts';

const ts = createRequire(import.meta.url)('typescript');
function extract(path, predicate) {
  const file = ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  let source;
  function visit(node) { if (predicate(node)) source = node.getText(file); ts.forEachChild(node, visit); }
  visit(file);
  assert.ok(source);
  return source;
}
function execute(source, dependencies, result) {
  const code = ts.transpileModule(source.replace(/^export /, ''), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText;
  return Function(...Object.keys(dependencies), `${code}; return ${result};`)(...Object.values(dependencies));
}
const hook = name => extract('../hooks/use-leads.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === name);
const bulkSource = hook('useBulkDeleteLeads');
function bulkFixture() {
  const current = { actor: 'actor-A', session: 'session-A' }, calls = [], cleanup = [];
  const scope = createLeadImportScope();
  const operation = execute(bulkSource, {
    useQueryClient: () => ({ invalidateQueries() {} }),
    useAuth: () => ({ activeOrganization: { organizationId: 'org-A' }, user: { id: 'actor-A' }, session: { id: 'session-A' } }),
    useState: () => [scope], useLayoutEffect: fn => cleanup.push(fn()), useMutation: options => options,
    getGlobalSignOutSessionId: session => session.id, contactImportScopeKey, createLeadImportScope,
    captureLeadRequestIntent, getVimobAPIAccessTokenUserId: () => current.actor,
    getVimobAPIAccessTokenSessionId: () => current.session, getErrorMessage: error => error.message,
    leadsAPI: { deleteLead: async (id, org, intent) => { calls.push({ id, org, intent }); await Promise.resolve(); return { error: null }; } },
  }, 'useBulkDeleteLeads()');
  return { operation, current, calls, scope, unmount: () => cleanup.forEach(fn => fn?.()) };
}
test('actual bulk mutation pins organization, actor and SID and stops pending IDs on actor/session changes', async () => {
  for (const change of ['actor', 'session', 'unmount']) {
    const f = bulkFixture();
    const pending = f.operation.mutationFn(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    if (change === 'unmount') f.unmount(); else f.current[change] = 'changed';
    const result = await pending;
    assert.equal(f.calls.length, 3);
    assert.deepEqual(result.deletedIds, ['a', 'b', 'c']);
    assert.deepEqual(result.unstartedIds, ['d', 'e', 'f', 'g', 'h']);
    for (const call of f.calls) {
      assert.equal(call.org, 'org-A');
      assert.deepEqual(call.intent, { expectedUserId: 'actor-A', expectedSessionId: 'session-A' });
    }
  }
});
test('an old bulk callback cannot initiate organization A requests after switching to B with the same actor/SID', async () => {
  const f = bulkFixture();
  f.scope.activate(contactImportScopeKey('org-B', 'actor-A', 'session-A'));
  await assert.rejects(f.operation.mutationFn(['a', 'b']), /acesso mudou/);
  assert.deepEqual(f.calls, []);
});
test('missing session refuses a mutation rather than resolving a later session implicitly', () => {
  assert.throws(() => captureLeadRequestIntent('actor', null), /confirmar a sessão/);
  assert.throws(() => captureLeadRequestIntent(null, 'sid'), /confirmar a sessão/);
});
test('actual useLead clears a denied cached snapshot but preserves it on transient failures', async () => {
  for (const status of [403, 404, 500]) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const key = ['lead', 'org', 'lead'];
    const snapshot = { id: 'lead', name: 'Previously authorized' };
    const failure = Object.assign(new Error(`Synthetic HTTP ${status}`), { status });
    const calls = [];
    client.setQueryData(key, snapshot);
    const options = execute(hook('useLead'), {
      useAuth: () => ({ activeOrganization: { organizationId: 'org' } }), useQueryClient: () => client,
      useQuery: opts => opts, canReuseLeadReadOnMount: () => false, isDefinitiveLeadReadDenial,
      LeadReadSupersededError, readConsistentLeadSnapshot, reconcileLeadReadCache,
      leadsAPI: { getLead: async (id, organizationId, signal) => { calls.push({ id, organizationId, signal }); throw failure; } },
    }, "useLead('lead')");
    try {
      await assert.rejects(client.fetchQuery({ ...options, retry: false }), error => {
        assert.equal(error, failure, 'the actual HTTP failure must reach the caller');
        assert.equal(error.status, status);
        return true;
      });
      assert.equal(calls.length, 1);
      assert.equal(calls[0].id, 'lead');
      assert.equal(calls[0].organizationId, 'org');
      assert.ok(calls[0].signal instanceof AbortSignal);
      assert.deepEqual(client.getQueryData(key), status === 500 ? snapshot : null);
      assert.equal(visibleLeadRead(snapshot, failure), status === 500 ? snapshot : null);
    } finally {
      client.clear();
    }
  }
});
test('actual PDF fetch rejects HTML and the iframe keeps opaque isolation and a validated source', async () => {
  const reader = extract('../components/features/leads/LeadAttachmentViewer.tsx', node => ts.isFunctionDeclaration(node) && node.name?.text === 'readLeadAttachmentBlob');
  const read = execute(reader, {
    AbortController, setTimeout, clearTimeout, prepareLeadPDFPreview,
    fetch: async () => new Response('%PDF-<p>inert synthetic</p>', { headers: { 'content-type': 'text/html' } }),
  }, 'readLeadAttachmentBlob');
  await assert.rejects(read('https://synthetic.test/file', new AbortController().signal, true), /invalid_pdf/);
  const frame = extract('../components/features/leads/LeadAttachmentViewer.tsx', node => ts.isJsxSelfClosingElement(node) && node.tagName.getText() === 'iframe');
  assert.match(frame, /sandbox=""/);
  assert.match(frame, /src=\{previewObjectUrl \|\| undefined\}/);
  assert.doesNotMatch(frame, /allow-scripts|allow-same-origin/);
});

test('the actual update and delete API methods forward the frozen request identity', async () => {
  const calls = [];
  const current = { actor: 'actor-B', session: 'session-B' };
  const captureCurrentLeadRequestIntent = execute(
    extract('./api/lead-request-intent.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === 'captureCurrentLeadRequestIntent'),
    {
      captureLeadRequestIntent,
      getVimobAPIAccessTokenUserId: () => current.actor,
      getVimobAPIAccessTokenSessionId: () => current.session,
    },
    'captureCurrentLeadRequestIntent',
  );
  for (const name of ['updateLead', 'deleteLead']) {
    const method = extract('./api/leads.ts', node => ts.isMethodDeclaration(node) && node.name.getText() === name);
    const api = execute(`const api = { ${method} };`, {
      parseDomainInput: (_schema, input) => input, toAPILeadUpdateBody: data => data, leadUpdateInputSchema: {},
      captureCurrentLeadRequestIntent,
      vimobAPIRequest: async (path, options) => { calls.push({ path, options }); await Promise.resolve(); return { data: { id: 'lead' } }; },
      validateDomainResponse() {}, apiLeadResponseSchema: {}, toLegacyLead: data => data,
    }, 'api');
    const intent = captureLeadRequestIntent('actor-A', 'session-A');
    assert.ok(Object.isFrozen(intent));
    const captured = captureCurrentLeadRequestIntent(intent);
    assert.ok(Object.isFrozen(captured));
    assert.deepEqual(captured, intent);
    const pending = name === 'updateLead'
      ? api.updateLead('lead', { name: 'Changed' }, 'org-A', intent)
      : api.deleteLead('lead', 'org-A', intent);
    current.actor = 'actor-C'; current.session = 'session-C';
    await pending;
  }
  assert.equal(calls.length, 2);
  for (const { path, options } of calls) {
    assert.equal(path, '/v1/leads/lead');
    assert.equal(options.organizationId, 'org-A');
    assert.equal(options.expectedUserId, 'actor-A');
    assert.equal(options.expectedSessionId, 'session-A');
  }
  assert.deepEqual(calls[0].options.body, { name: 'Changed' });
  assert.equal(calls[1].options.body, undefined);
  assert.deepEqual(calls.map(({ options }) => options.method), ['PATCH', 'DELETE']);
});
