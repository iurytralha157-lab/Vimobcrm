import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { InfiniteQueryObserver, QueryClient } from '@tanstack/react-query';
import * as reactQuery from '@tanstack/react-query';

const require = createRequire(import.meta.url);
const repository = resolve(import.meta.dirname, '..');
const modules = new Map();
function production(path) {
  if (modules.has(path)) return modules.get(path).exports;
  const compiledModule = { exports: {} }; modules.set(path, compiledModule);
  const code = ts.transpileModule(readFileSync(resolve(repository, path), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  Function('require', 'module', 'exports', code)(name => name.startsWith('@/')
    ? production(name.slice(2) + '.ts') : name === '@tanstack/react-query' ? reactQuery : require(name), compiledModule, compiledModule.exports);
  return compiledModule.exports;
}
const cache = production('lib/whatsapp-query-cache.ts');
const refresh = production('lib/realtime/whatsapp-refresh-coordinator.ts');
const inboxAccess = production('lib/whatsapp-inbox-access.ts');
const helperPath = resolve(repository, 'lib/realtime/whatsapp-query-refresh.ts');
let refreshHelpers = {};
try { readFileSync(helperPath); refreshHelpers = production('lib/realtime/whatsapp-query-refresh.ts'); } catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const names = new Set(['getWhatsAppRealtimeScopeKey', 'getWhatsAppRealtimeRefreshCoordinator',
  'dispatchWhatsAppMessagesReconcile', 'matchesWhatsAppMessagesQuery',
  'scheduleWhatsAppRealtimeRefresh', 'whatsappRealtimeRefreshCoordinators', 'useWhatsAppConversations',
  'useWhatsAppLeadRealtime', 'WHATSAPP_CONVERSATIONS_REFETCH_MS', 'WHATSAPP_CONVERSATIONS_PAGINATED_REFETCH_MS']);
const hookPath = process.env.WHATSAPP_LIST_REFRESH_BASELINE || resolve(repository, 'hooks/use-whatsapp-conversations.ts');
const source = ts.createSourceFile(hookPath, readFileSync(hookPath, 'utf8'), ts.ScriptTarget.Latest, true);
const statements = source.statements.filter(node => ts.isFunctionDeclaration(node) ? names.has(node.name?.text)
  : ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => names.has(declaration.name.getText(source))));
assert.equal(statements.length, names.size);
const code = ts.transpileModule(statements.map(node => node.getText(source)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const scope = { organizationId: 'org-a', userId: 'actor-a', accessScope: 'sid-a:permissions-a' };
function fixture(t, { pages = 2, currentScope = scope, filters = {}, sharedClient } = {}) {
  const client = sharedClient || new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const requests = [];
  let hookOptions;
  let disposeLead;
  const events = new EventTarget();
  const bindings = { ...cache, ...refresh, ...refreshHelpers, ...inboxAccess, client, scope: currentScope, exports: {},
    window: events, useQueryClient: () => client, useCanSubscribeWhatsAppRealtime: () => true,
    useEffect: run => { disposeLead = run(); }, createClient: () => ({}),
    getPrivateBroadcastRegistry: () => ({ acquire: () => ({ release() {} }) }), reportWhatsAppRealtimeDiagnostic() {},
    useWhatsAppQueryScope: () => currentScope, useInfiniteQuery: value => { hookOptions = value; return {}; },
    useMemo: fn => fn(), whatsappAPI: { getConversationsPage: (params, options) => new Promise((resolveRequest, reject) => {
      const request = { params, options, resolve: resolveRequest, reject, aborted: options.signal.aborted };
      options.signal.addEventListener('abort', () => { request.aborted = true; }, { once: true });
      requests.push(request);
    }) } };
  const implementation = Function(...Object.keys(bindings), `${code};useWhatsAppConversations(undefined,${JSON.stringify(filters)},['session-a'],2);
    return {wake:()=>{scheduleWhatsAppRealtimeRefresh(client,scope,{refreshConversations:true});getWhatsAppRealtimeRefreshCoordinator(client).flush(getWhatsAppRealtimeScopeKey(scope));},
      flush:()=>getWhatsAppRealtimeRefreshCoordinator(client).flush(getWhatsAppRealtimeScopeKey(scope)),
      subscribeLead:()=>useWhatsAppLeadRealtime(true,['lead-a']),clear:()=>getWhatsAppRealtimeRefreshCoordinator(client).clear()};`)(...Object.values(bindings));
  const key = hookOptions.queryKey;
  const seed = { pages: Array.from({ length: pages }, (_, index) => ({ conversations: [{ id: `cached-${index}`, marker: 'cached' }],
    nextCursor: index < pages - 1 ? `cursor-${index + 1}` : null })), pageParams: Array.from({ length: pages }, (_, index) => index ? `cursor-${index}` : null) };
  if (!client.getQueryData(key)) client.setQueryData(key, seed);
  const observers = [];
  const observe = (enabled = true) => {
    const observer = new InfiniteQueryObserver(client, { ...hookOptions, enabled });
    const stop = observer.subscribe(() => {}); const owner = { observer, stop() { stop(); observer.destroy(); } };
    observers.push(owner); return owner;
  };
  const owner = observe();
  t.after(() => { disposeLead?.(); implementation.clear(); observers.forEach(value => value.stop()); if (!sharedClient) client.clear(); });
  return { client, key, requests, wake: implementation.wake, flush: implementation.flush, observe, owner, seed, events, subscribeLead: implementation.subscribeLead,
    data: () => client.getQueryData(key),
    complete(index, marker, nextCursor = null) { requests[index].resolve({ conversations: [{ id: `${marker}-${requests[index].params.cursor || 'head'}`, marker }], nextCursor }); },
    async settle() { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); },
  };
}

test('ten hints faster than a two-page read never abort it and publish a trailing canonical snapshot', async t => {
  const f = fixture(t); f.wake();
  assert.equal(f.requests.length, 1);
  for (let index = 0; index < 10; index++) f.wake();
  assert.equal(f.requests.length, 1, 'hints must coalesce while the head is pending');
  assert.equal(f.requests[0].aborted, false);
  f.complete(0, 'first', 'cursor-1'); await f.settle();
  assert.equal(f.requests.length, 2); assert.equal(f.requests[1].params.cursor, 'cursor-1');
  f.complete(1, 'first'); await f.settle();
  assert.deepEqual(f.data().pages.map(page => page.conversations[0].marker), ['first', 'first']);
  assert.equal(f.requests.length, 3, 'a hint after the read began requires one trailing read');
  f.complete(2, 'fresh', 'fresh-cursor'); await f.settle(); f.complete(3, 'fresh'); await f.settle();
  assert.deepEqual(f.data().pages.map(page => page.conversations[0].marker), ['fresh', 'fresh']);
  assert.deepEqual(f.data().pageParams, [null, 'fresh-cursor']);
  assert.ok(f.requests.every(request => !request.aborted));
});

test('hints during the trailing read coalesce once more, without starving earlier publication', async t => {
  const f = fixture(t, { pages: 1 }); f.wake(); f.wake(); f.complete(0, 'first'); await f.settle();
  assert.equal(f.data().pages[0].conversations[0].marker, 'first');
  assert.equal(f.requests.length, 2);
  for (let index = 0; index < 10; index++) f.wake();
  f.complete(1, 'second'); await f.settle();
  assert.equal(f.data().pages[0].conversations[0].marker, 'second');
  assert.equal(f.requests.length, 3);
  f.complete(2, 'third'); await f.settle(); assert.equal(f.requests.length, 3);
});

test('an existing native next-page read finishes before the queued full reconciliation', async t => {
  const f = fixture(t, { pages: 1 });
  f.client.setQueryData(f.key, { ...f.seed, pages: [{ ...f.seed.pages[0], nextCursor: 'next-native' }] });
  const next = f.owner.observer.fetchNextPage(); assert.equal(f.requests[0].params.cursor, 'next-native');
  f.wake(); f.wake(); assert.equal(f.requests[0].aborted, false);
  f.complete(0, 'append'); await next; await f.settle();
  assert.equal(f.data().pages.length, 2); assert.equal(f.requests.length, 2);
  f.complete(1, 'reconciled', 'next-reconciled'); await f.settle(); f.complete(2, 'reconciled'); await f.settle();
  assert.deepEqual(f.data().pageParams, [null, 'next-reconciled']);
});

test('two owners share reads and one closing does not abort the other', async t => {
  const f = fixture(t, { pages: 1 }); const peer = f.observe(); f.wake(); f.wake();
  f.owner.stop(); assert.equal(f.requests[0].aborted, false);
  f.complete(0, 'first'); await f.settle(); assert.equal(f.requests.length, 2);
  f.complete(1, 'fresh'); await f.settle(); assert.equal(peer.observer.getCurrentResult().data.pages[0].conversations[0].marker, 'fresh');
});

test('closing the last owner cancels immediately and never runs its queued wake', async t => {
  const f = fixture(t, { pages: 1 }); f.wake(); f.wake(); f.owner.stop();
  assert.equal(f.requests[0].aborted, true);
  const count = f.requests.length; f.complete(0, 'retired'); await f.settle();
  assert.equal(f.requests.length, count); assert.strictEqual(f.data(), f.seed);
});

test('inactive lists are stale without an HTTP read; disabled observer cancels a queued active read', async t => {
  const f = fixture(t, { pages: 1 }); f.owner.stop(); f.wake(); await f.settle();
  assert.equal(f.requests.length, 0); assert.equal(f.client.getQueryState(f.key).isInvalidated, true);
  const owner = f.observe(); assert.equal(f.requests.length, 1); f.wake();
  owner.observer.setOptions({ ...owner.observer.options, enabled: false });
  assert.equal(f.requests[0].aborted, true);
  f.complete(0, 'disabled'); await f.settle(); assert.equal(f.requests.length, 1);
});

test('removed/recreated identical key cannot inherit an old trailing wake or result', async t => {
  const f = fixture(t, { pages: 1 }); f.wake(); f.wake();
  f.client.removeQueries({ queryKey: f.key, exact: true }); f.owner.stop();
  f.client.setQueryData(f.key, f.seed); const peer = f.observe();
  const before = f.requests.length; f.complete(0, 'old-query'); await f.settle();
  assert.equal(f.requests.length, before); assert.strictEqual(peer.observer.getCurrentResult().data, f.seed);
  f.wake(); assert.equal(f.requests.length, before + 1);
  f.complete(before, 'new-query'); await f.settle(); assert.equal(f.data().pages[0].conversations[0].marker, 'new-query');
});

for (const [label, otherScope] of [['organization', { ...scope, organizationId: 'org-b' }],
  ['actor', { ...scope, userId: 'actor-b' }], ['SID/access', { ...scope, accessScope: 'sid-b:permissions-b' }]]) {
  test(`${label} scope and filtered list remain independent`, async t => {
    const f = fixture(t, { pages: 1 });
    const foreign = fixture(t, { pages: 1, currentScope: otherScope, sharedClient: f.client });
    const filtered = fixture(t, { pages: 1, filters: { search: 'needle' }, sharedClient: f.client });
    f.wake(); f.wake(); assert.equal(foreign.requests.length, 0); assert.equal(filtered.requests.length, 1);
    f.complete(0, 'main'); filtered.complete(0, 'filtered'); await f.settle();
    assert.equal(f.requests.length, 2); assert.equal(filtered.requests.length, 2);
    assert.strictEqual(foreign.data(), foreign.seed);
    f.complete(1, 'main-fresh'); filtered.complete(1, 'filtered-fresh'); await f.settle();
    assert.equal(filtered.requests[0].params.filters.search, 'needle');
  });
}

for (const status of [401, 403, 404]) test(`${status} retires a pending wake without replay; a later explicit hint can recover`, async t => {
  const f = fixture(t, { pages: 1 }); f.wake(); f.wake();
  const error = Object.assign(new Error('synthetic denied'), { status }); f.requests[0].reject(error); await f.settle();
  assert.equal(f.requests.length, 1);
  if (status === 401 || status === 403) assert.deepEqual(f.data().pages, []);
  else assert.strictEqual(f.data(), f.seed);
  f.wake(); assert.equal(f.requests.length, 2); f.complete(1, 'recovered'); await f.settle();
  assert.equal(f.data().pages[0].conversations[0].marker, 'recovered');
});

test('transient error keeps one pending wake and succeeds without an unbounded retry loop', async t => {
  const f = fixture(t, { pages: 1 }); f.wake(); f.wake();
  f.requests[0].reject(Object.assign(new Error('synthetic temporary'), { status: 503 })); await f.settle();
  assert.equal(f.requests.length, 2); f.complete(1, 'recovered'); await f.settle(); assert.equal(f.requests.length, 2);
});

test('explicit revocation cancellation immediately aborts and drops queued work', async t => {
  const f = fixture(t, { pages: 1 }); f.wake(); f.wake();
  await f.client.cancelQueries({ queryKey: f.key, exact: true }); assert.equal(f.requests[0].aborted, true);
  f.complete(0, 'revoked'); await f.settle();
  assert.equal(f.requests.length, 1, 'a reverted cached cancellation cannot silently consume the wake with a new GET');
  assert.strictEqual(f.data(), f.seed);
});

test('one quiescent hint causes one read, with no background trailing poll', async t => {
  const f = fixture(t, { pages: 1 }); f.wake(); f.complete(0, 'only'); await f.settle();
  assert.equal(f.requests.length, 1); assert.equal(f.client.getQueryState(f.key).fetchStatus, 'idle');
});

test('separate QueryClients with identical keys do not share reads or cancellation', async t => {
  const first = fixture(t, { pages: 1 }), second = fixture(t, { pages: 1 });
  first.wake(); first.wake(); second.wake();
  first.owner.stop(); assert.equal(first.requests[0].aborted, true); assert.equal(second.requests[0].aborted, false);
  second.complete(0, 'second-client'); await second.settle();
  assert.equal(second.requests.length, 1); assert.equal(second.data().pages[0].conversations[0].marker, 'second-client');
});

test('separate surface schedulers on one QueryClient still share the same read and trailing wake', async t => {
  const first = fixture(t, { pages: 1 });
  const second = fixture(t, { pages: 1, sharedClient: first.client });
  first.wake(); second.wake(); assert.equal(first.requests.length + second.requests.length, 1);
  const active = first.requests.length ? first : second;
  active.complete(0, 'first-shared'); await active.settle();
  assert.equal(first.requests.length + second.requests.length, 2);
  const trailing = first.requests.length === 2 ? first : second;
  trailing.complete(trailing.requests.length - 1, 'shared-fresh'); await trailing.settle();
  assert.equal(first.data().pages[0].conversations[0].marker, 'shared-fresh');
});

test('a hint in the success notification is retained before the completion continuation runs', async t => {
  const f = fixture(t, { pages: 1 });
  let hinted = false;
  const stop = f.client.getQueryCache().subscribe(event => {
    if (!hinted && event.query.queryHash === f.client.getQueryCache().find({ queryKey: f.key, exact: true }).queryHash
      && event.type === 'updated' && event.action.type === 'success') { hinted = true; f.wake(); }
  });
  t.after(stop); f.wake(); f.complete(0, 'first'); await f.settle();
  assert.equal(hinted, true); assert.equal(f.requests.length, 2);
  f.complete(1, 'after-success'); await f.settle(); assert.equal(f.requests.length, 2);
});

test('hints arriving during transient recovery are preserved until the final fresh read', async t => {
  const f = fixture(t, { pages: 1 }); f.wake(); f.wake();
  f.requests[0].reject(Object.assign(new Error('synthetic temporary'), { status: 503 })); await f.settle();
  assert.equal(f.requests.length, 2); f.wake(); f.wake();
  f.complete(1, 'recovery'); await f.settle(); assert.equal(f.requests.length, 3);
  assert.equal(f.data().pages[0].conversations[0].marker, 'recovery');
  f.complete(2, 'latest'); await f.settle(); assert.equal(f.requests.length, 3);
  assert.equal(f.data().pages[0].conversations[0].marker, 'latest');
});

test('a transient failure without a pending hint never retries on its own', async t => {
  const f = fixture(t, { pages: 1 }); f.wake();
  f.requests[0].reject(Object.assign(new Error('synthetic temporary'), { status: 503 })); await f.settle();
  assert.equal(f.requests.length, 1); assert.strictEqual(f.data(), f.seed);
});

test('the actual lead authorization-change handler immediately cancels the old list read', async t => {
  const f = fixture(t, { pages: 1 }); f.subscribeLead(); f.wake(); f.wake();
  let authorizationEvents = 0;
  f.events.addEventListener(cache.WHATSAPP_MESSAGES_RECONCILE_EVENT, event => { if (event.detail?.authorizationChanged) authorizationEvents++; });
  f.events.dispatchEvent(new CustomEvent('vimob:lead-realtime-change', { detail: {
    organizationId: scope.organizationId, leadId: 'lead-a', reason: 'lead.assignee_changed',
  } }));
  assert.equal(f.requests[0].aborted, true);
  assert.equal(f.requests.length, 2, 'authorization cannot wait behind an ordinary in-flight read');
  assert.equal(authorizationEvents, 1, 'the existing immediate message authorization fence is retained');
  f.complete(1, 'authorized'); await f.settle();
  f.complete(0, 'stale-access'); await f.settle();
  assert.equal(f.data().pages[0].conversations[0].marker, 'authorized');
});

test('authorization changes also cancel the initial read before any list data has been cached', async t => {
  const f = fixture(t, { pages: 1 }); f.owner.stop(); f.client.removeQueries({ queryKey: f.key, exact: true });
  f.observe(); assert.equal(f.data(), undefined); assert.equal(f.requests.length, 1);
  f.subscribeLead(); f.wake();
  f.events.dispatchEvent(new CustomEvent('vimob:lead-realtime-change', { detail: {
    organizationId: scope.organizationId, leadId: 'lead-a', reason: 'lead.assignee_changed',
  } }));
  assert.equal(f.requests[0].aborted, true); assert.equal(f.requests.length, 2);
  f.complete(0, 'stale-initial'); f.complete(1, 'fresh-initial'); await f.settle();
  assert.equal(f.data().pages[0].conversations[0].marker, 'fresh-initial'); assert.equal(f.requests.length, 2);
});

test('a denied authorization refresh is not replayed by that same lead event queued message batch', async t => {
  const f = fixture(t, { pages: 1 }); f.subscribeLead();
  f.events.dispatchEvent(new CustomEvent('vimob:lead-realtime-change', { detail: {
    organizationId: scope.organizationId, leadId: 'lead-a', reason: 'lead.assignee_changed',
  } }));
  assert.equal(f.requests.length, 1);
  f.requests[0].reject(Object.assign(new Error('synthetic revoked'), { status: 403 })); await f.settle();
  f.flush(); await f.settle(); assert.equal(f.requests.length, 1);
});
