import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { getGlobalSignOutSessionId } from '../lib/auth/global-sign-out.ts';
import { shouldRetryPipelineQuery } from '../lib/pipeline-reliability.ts';
import { legacyTagResponse, tagCatalogApiFixture, tagCatalogTestOrganization } from '../lib/api/tag-catalog-runtime-fixture.mjs';

const token = (uid, sid) => `synthetic.${Buffer.from(JSON.stringify({ sub: uid, session_id: sid })).toString('base64url')}.synthetic`;
function fixture(api) {
  let auth = { activeOrganization: { organizationId: 'org-a' }, user: { id: 'actor-a' }, session: { access_token: token('actor-a', 'sid-a') } };
  const sourcePath = process.env.WHATSAPP_TAG_HOOK_BASELINE || 'hooks/use-tags.ts';
  const source = ts.createSourceFile(sourcePath, readFileSync(sourcePath, 'utf8'), ts.ScriptTarget.Latest, true);
  const functions = source.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === 'useTags' && node.body);
  assert.equal(functions.length, 1);
  const code = ts.transpileModule(functions[0].getText(source).replace(/^export /, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const requests = [];
  const get = (method, ...args) => { requests.push({ method, args }); return Promise.resolve([{ id: 'tag-' + auth.user.id, organization_id: auth.activeOrganization.organizationId }]); };
  // Capture query options here; shared-catalog React fixtures run the real trust wrapper.
  const queryOptions = options => options;
  const hook = Function('useAuth', 'useQuery', 'useQueryWithDataTrust', 'tagsAPI', 'shouldRetryPipelineQuery', 'getGlobalSignOutSessionId', `${code};return useTags`)(
    () => auth, queryOptions, queryOptions, api ?? { catalog: (...args) => get('catalog', ...args), list: (...args) => get('list', ...args) }, shouldRetryPipelineQuery, getGlobalSignOutSessionId);
  return { options: value => hook(value), requests, replace(changes) { auth = { ...auth, ...changes }; }, auth: () => auth };
}

test('actual picker hook pins UID and SID and calls the narrow read API', async () => {
  const f = fixture(), options = f.options({ catalog: true });
  const controller = new AbortController(); await options.queryFn({ signal: controller.signal });
  assert.equal(f.requests[0].method, 'catalog');
  assert.equal(f.requests[0].args[1].signal, controller.signal);
  assert.equal(f.requests[0].args[1].expectedUserId, 'actor-a'); assert.equal(f.requests[0].args[1].expectedSessionId, 'sid-a');
});

for (const [label, changes] of [
  ['UID replacement', { user: { id: 'actor-b' }, session: { access_token: token('actor-b', 'sid-b') } }],
  ['SID replacement under same UID', { session: { access_token: token('actor-a', 'sid-b') } }],
  ['organization replacement', { activeOrganization: { organizationId: 'org-b' } }],
]) test(`actual QueryObserver never displays old catalog after ${label}`, () => {
  const f = fixture(), client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const original = f.options({ catalog: true }); client.setQueryData(original.queryKey, [{ id: 'private-old-tag' }]);
  f.replace(changes);
  const observer = new QueryObserver(client, f.options({ catalog: true }));
  try { assert.equal(observer.getCurrentResult().data, undefined); } finally { observer.destroy(); client.clear(); }
});

test('catalog disabled without complete authentication; management mode retains its full DTO API', async () => {
  const f = fixture(); f.replace({ session: null }); assert.equal(f.options({ catalog: true }).enabled, false);
  f.replace({ user: null }); assert.equal(f.options({ catalog: true }).enabled, false);
  f.replace({ user: { id: 'actor-a' }, session: { access_token: token('actor-a', 'sid-a') } });
  assert.equal(f.options({ catalog: true, enabled: false }).enabled, false);
  await f.options().queryFn({ signal: new AbortController().signal }); assert.equal(f.requests[0].method, 'list');
});

test('unsubscribing the old real QueryObserver aborts its GET and late data stays off the new scope', async () => {
  const f = fixture(), client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  let signal, finish;
  const original = f.options({ catalog: true });
  original.queryFn = context => { signal = context.signal; return new Promise(resolve => { finish = resolve; }); };
  const observer = new QueryObserver(client, original), unsubscribe = observer.subscribe(() => {});
  assert.ok(signal); unsubscribe(); f.replace({ user: { id: 'actor-b' }, session: { access_token: token('actor-b', 'sid-b') } });
  assert.equal(signal.aborted, true); finish([{ id: 'private-old-tag' }]);
  await new Promise(resolve => setImmediate(resolve));
  const next = new QueryObserver(client, f.options({ catalog: true }));
  try { assert.equal(next.getCurrentResult().data, undefined); } finally { observer.destroy(); next.destroy(); client.clear(); }
});

async function observeCatalog(api, options = { catalog: true }) {
  const f = fixture(api), client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  f.replace({ activeOrganization: { organizationId: tagCatalogTestOrganization } });
  const observer = new QueryObserver(client, { ...f.options(options), retryDelay: 0 });
  let unsubscribe;
  try {
    return await new Promise(resolve => {
      unsubscribe = observer.subscribe(result => { if (result.isSuccess || result.isError) resolve(result); });
    });
  } finally { unsubscribe?.(); observer.destroy(); client.clear(); }
}

test('actual picker hook, QueryObserver and API read old and new DTOs without updated_at', async () => {
  const narrow = { id: legacyTagResponse.id, name: legacyTagResponse.name, color: legacyTagResponse.color, organization_id: tagCatalogTestOrganization };
  for (const record of [legacyTagResponse, narrow, { ...legacyTagResponse, updated_at: '2026-10-01T10:00:00.123456Z' }]) {
    const f = tagCatalogApiFixture({ data: [record] });
    const result = await observeCatalog(f.api);
    assert.equal(result.status, 'success');
    assert.deepEqual(JSON.parse(JSON.stringify(result.data)), [narrow]);
    assert.equal('updated_at' in result.data[0], false, 'a picker cannot invent or expose a write revision');
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].options.query.view, 'catalog');
    assert.equal(f.requests[0].options.expectedUserId, 'actor-a');
    assert.equal(f.requests[0].options.expectedSessionId, 'sid-a');
    assert.equal(f.management.length, 0);
  }
});

test('actual management hook keeps rejecting the legacy list instead of fabricating a revision', async () => {
  const f = tagCatalogApiFixture();
  const result = await observeCatalog(f.api, {});
  assert.equal(result.status, 'error');
  assert.equal(result.error.code, 'domain_validation_error');
  assert.ok(result.error.issues.includes('data.0.updated_at: Required'));
  assert.equal(result.data, undefined);
  assert.equal(f.requests.length, 1, 'a deterministic contract error is not retried');
  assert.equal(f.requests[0].options.query, undefined);
});

test('picker transport and tenant errors remain errors without falling back to full tag management', async () => {
  const forbidden = tagCatalogApiFixture();
  const denial = Object.assign(new Error('Synthetic access denial'), { status: 403, code: 'forbidden' });
  forbidden.setFailure(denial);
  const denied = await observeCatalog(forbidden.api);
  assert.equal(denied.status, 'error'); assert.equal(denied.error, denial);
  assert.equal(forbidden.requests.length, 1); assert.equal(forbidden.management.length, 0);

  const foreign = tagCatalogApiFixture({ data: [{ ...legacyTagResponse, organization_id: '50000000-0000-4000-8000-000000000002' }] });
  const rejected = await observeCatalog(foreign.api);
  assert.equal(rejected.status, 'error'); assert.equal(rejected.data, undefined);
  assert.match(rejected.error.message, /outra organização/);
  assert.equal(foreign.requests.length, 1);
});

test('picker keeps one retry for transient failures and rejects malformed responses as errors', async () => {
  const transient = tagCatalogApiFixture();
  transient.setFailure(Object.assign(new Error('Synthetic timeout'), { status: 0, code: 'api_timeout' }));
  const failed = await observeCatalog(transient.api);
  assert.equal(failed.status, 'error'); assert.equal(transient.requests.length, 2);
  assert.equal(transient.management.length, 0);
  const malformed = tagCatalogApiFixture({ data: [{ ...legacyTagResponse, id: 'invalid-id' }] });
  const invalid = await observeCatalog(malformed.api);
  assert.equal(invalid.status, 'error'); assert.equal(invalid.data, undefined);
  assert.equal(invalid.error.code, 'domain_validation_error'); assert.equal(malformed.requests.length, 1);
});
