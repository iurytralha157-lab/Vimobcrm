import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { getGlobalSignOutSessionId } from '../lib/auth/global-sign-out.ts';
import { shouldRetryPipelineQuery } from '../lib/pipeline-reliability.ts';
import { legacyTeamResponse, teamCatalogApiFixture, teamCatalogOrganization } from '../lib/api/team-catalog-runtime-fixture.mjs';

const token = (uid, sid) => `synthetic.${Buffer.from(JSON.stringify({ sub: uid, session_id: sid })).toString('base64url')}.synthetic`;
function fixture(api) {
  let auth = { activeOrganization: { organizationId: teamCatalogOrganization }, user: { id: 'actor-a' }, session: { access_token: token('actor-a', 'sid-a') } };
  const source = ts.createSourceFile('hooks/use-teams.ts', readFileSync('hooks/use-teams.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  const fn = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'useTeams' && node.body);
  const compiled = ts.transpileModule(fn.getText(source).replace(/^export /, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  // Capture query options here; shared-catalog React fixtures run the real trust wrapper.
  const queryOptions = options => options;
  const hook = Function('useAuth', 'useQuery', 'useQueryWithDataTrust', 'teamsAPI', 'getGlobalSignOutSessionId', 'shouldRetryPipelineQuery', compiled + ';return useTeams')(
    () => auth, queryOptions, queryOptions, api, getGlobalSignOutSessionId, shouldRetryPipelineQuery);
  return { options: value => hook(value), replace(patch) { auth = { ...auth, ...patch }; } };
}

for (const [label, patch] of [
  ['UID', { user: { id: 'actor-b' }, session: { access_token: token('actor-b', 'sid-b') } }],
  ['SID', { session: { access_token: token('actor-a', 'sid-b') } }],
  ['organization', { activeOrganization: { organizationId: '50000000-0000-4000-8000-000000000002' } }],
]) test(`actual team QueryObserver does not reuse a previous ${label} catalog`, () => {
  const f = fixture({}), client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const original = f.options({ catalog: true }); client.setQueryData(original.queryKey, [legacyTeamResponse]);
  f.replace(patch); const observer = new QueryObserver(client, f.options({ catalog: true }));
  try { assert.equal(observer.getCurrentResult().data, undefined); } finally { observer.destroy(); client.clear(); }
});

test('team catalogs require complete identity and never share management cache policy', async () => {
  const calls = [], f = fixture({ listTeams: options => calls.push(options) });
  const catalog = f.options({ catalog: true }); assert.equal(catalog.enabled, true);
  assert.notDeepEqual(catalog.queryKey, f.options().queryKey);
  f.replace({ session: null }); assert.equal(f.options({ catalog: true }).enabled, false);
  f.replace({ user: null }); assert.equal(f.options({ catalog: true }).enabled, false);
  f.replace({ user: { id: 'actor-a' }, session: { access_token: token('actor-a', 'sid-a') } });
  assert.equal(f.options({ catalog: true, enabled: false }).enabled, false);
  await f.options().queryFn({ signal: new AbortController().signal }); assert.equal(calls.length, 1);
});

async function observe(api, options = { catalog: true }) {
  const f = fixture(api), client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const observer = new QueryObserver(client, { ...f.options(options), retryDelay: 0 });
  let unsubscribe;
  try { return await new Promise(resolve => { unsubscribe = observer.subscribe(result => { if (result.isSuccess || result.isError) resolve(result); }); }); }
  finally { unsubscribe?.(); observer.destroy(); client.clear(); }
}

test('actual team hook, QueryObserver and API accept the legacy response and pin transport identity', async () => {
  const f = teamCatalogApiFixture(), result = await observe(f.api);
  assert.equal(result.status, 'success'); assert.equal(result.data[0].id, legacyTeamResponse.id);
  assert.equal('revision' in result.data[0], false);
  assert.equal(f.requests[0].options.expectedUserId, 'actor-a'); assert.equal(f.requests[0].options.expectedSessionId, 'sid-a');
  assert.ok(f.requests[0].options.signal); assert.equal(f.management.length, 0);
});

test('team catalog preserves access denials and malformed contracts without fallback, with one transient retry', async () => {
  for (const [failure, expected] of [[Object.assign(new Error('denied'), { status: 403 }), 1], [Object.assign(new Error('timeout'), { status: 0, code: 'api_timeout' }), 2]]) {
    const f = teamCatalogApiFixture(); f.setFailure(failure); const result = await observe(f.api);
    assert.equal(result.status, 'error'); assert.equal(result.error, failure); assert.equal(f.requests.length, expected);
    assert.equal(f.management.length, 0);
  }
  const malformed = teamCatalogApiFixture({ data: [{ ...legacyTeamResponse, members: [{ user_id: 'invalid' }] }] });
  assert.equal((await observe(malformed.api)).status, 'error'); assert.equal(malformed.requests.length, 1);
});

test('unsubscribing a real team observer aborts the old request and late data stays outside the next scope', async () => {
  const f = fixture({}), client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  let signal, finish; const options = f.options({ catalog: true });
  options.queryFn = context => { signal = context.signal; return new Promise(resolve => { finish = resolve; }); };
  const observer = new QueryObserver(client, options), unsubscribe = observer.subscribe(() => {});
  unsubscribe(); assert.equal(signal.aborted, true);
  f.replace({ session: { access_token: token('actor-a', 'sid-b') } }); finish([legacyTeamResponse]);
  await new Promise(resolve => setImmediate(resolve));
  const next = new QueryObserver(client, f.options({ catalog: true }));
  try { assert.equal(next.getCurrentResult().data, undefined); } finally { observer.destroy(); next.destroy(); client.clear(); }
});
