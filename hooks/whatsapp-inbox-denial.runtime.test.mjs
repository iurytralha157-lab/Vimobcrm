import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const repository = process.cwd();
const require = createRequire(resolve(repository, 'package.json'));
const ts = require('typescript');
const reactQuery = require('@tanstack/react-query');
const { QueryClient, QueryObserver, InfiniteQueryObserver } = reactQuery;
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
const dependencies = { ...production('lib/whatsapp-query-cache.ts'), ...production('lib/whatsapp-inbox-access.ts'),
  ...production('lib/filters/whatsapp-filter-options.ts') };
const sourcePath = resolve(repository, 'hooks/use-whatsapp-conversations.ts');
const source = ts.createSourceFile(sourcePath, readFileSync(sourcePath, 'utf8'), ts.ScriptTarget.Latest, true);
const names = new Set(['useWhatsAppConversations', 'useWhatsAppUnreadCount', 'useWhatsAppConversationFilterOptions',
  'WHATSAPP_CONVERSATIONS_REFETCH_MS', 'WHATSAPP_CONVERSATIONS_PAGINATED_REFETCH_MS']);
const statements = source.statements.filter(node => ts.isFunctionDeclaration(node) ? names.has(node.name?.text)
  : ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => names.has(declaration.name.getText(source))));
assert.equal(statements.length, names.size);
const compiled = ts.transpileModule(statements.map(node => node.getText(source)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const scope = { organizationId: 'org-a', userId: 'actor-a', accessScope: 'permissions:sid-a' };
const catalog = { pipelines: [{ id: 'private-pipeline', name: 'Synthetic private pipeline' }], teams: [], users: [],
  sources: [], tags: [], pages: [], campaigns: [], adSets: [], ads: [], nextOffset: null };

function fixture(t) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });
  const owners = [], requests = [];
  const add = (kind = 'list', currentScope = scope, filters = {}) => {
    let options;
    const request = (params, transport) => new Promise((resolveRequest, reject) => {
      requests.push({ kind, params, transport, resolve: resolveRequest, reject });
    });
    const bindings = { ...dependencies, exports: {}, useQueryClient: () => client, useWhatsAppQueryScope: () => currentScope,
      useMemo: fn => fn(), useQuery: value => { options = value; return {}; },
      useInfiniteQuery: value => { options = value; return {}; },
      whatsappAPI: { getConversationsPage: request, getUnreadCount: request, getConversationFilterOptions: request } };
    const hook = kind === 'count' ? 'useWhatsAppUnreadCount' : kind === 'options' ? 'useWhatsAppConversationFilterOptions' : 'useWhatsAppConversations';
    const invocation = kind === 'options' ? `${hook}(undefined,undefined,{},true);` : `${hook}(undefined,${JSON.stringify(filters)});`;
    Function(...Object.keys(bindings), `${compiled};${invocation}`)(...Object.values(bindings));
    const seed = kind === 'count' ? 6 : { pages: [kind === 'options' ? catalog : {
      conversations: [{ id: 'private-card', contact_name: 'Synthetic private name', last_message: 'Synthetic private preview' }], nextCursor: 'older',
    }], pageParams: [kind === 'options' ? 0 : null] };
    client.setQueryData(options.queryKey, seed);
    const Observer = kind === 'count' ? QueryObserver : InfiniteQueryObserver;
    const observer = new Observer(client, { ...options, enabled: false });
    const stop = observer.subscribe(() => {}); owners.push({ observer, stop });
    return { observer, key: options.queryKey, seed, data: () => client.getQueryData(options.queryKey),
      read: () => observer.refetch(), options };
  };
  t.after(() => { owners.forEach(owner => { owner.stop(); owner.observer.destroy(); }); client.clear(); });
  return { client, requests, add, settle: async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); } };
}
const response = (kind, marker = 'restored') => kind === 'count' ? 2 : kind === 'options' ? { ...catalog, pipelines: [{ id: marker, name: marker }] }
  : { conversations: [{ id: marker, contact_name: marker, last_message: marker }], nextCursor: null };
const assertEmpty = entry => assert.deepEqual(entry.data(), typeof entry.seed === 'number' ? 0 : { pages: [], pageParams: [] });

for (const status of [401, 403]) for (const kind of ['list', 'count', 'options']) {
  test(`${kind} ${status} removes scoped cards, filter catalog and count, cancels peers and restores only after a new GET`, async t => {
    const f = fixture(t), denied = f.add(kind), siblings = [f.add('list', scope, { search: 'other-filter' }), f.add('count'), f.add('options')];
    const foreign = [f.add('list', { ...scope, organizationId: 'org-b' }), f.add('count', { ...scope, userId: 'actor-b' }),
      f.add('options', { ...scope, accessScope: 'permissions:sid-b' })];
    const pendingPeer = siblings[0].read(), pendingDenial = denied.read();
    f.requests[1].reject(Object.assign(Error('synthetic denied'), { status }));
    await pendingDenial; await f.settle();
    [denied, ...siblings].forEach(assertEmpty);
    [denied, ...siblings].forEach(entry => assert.equal(f.client.getQueryState(entry.key).isInvalidated, true));
    assert.equal(f.requests[0].transport.signal.aborted, true);
    await pendingPeer;
    foreign.forEach(entry => assert.strictEqual(entry.data(), entry.seed));
    f.requests[0].resolve(response('list', 'late-private')); await f.settle();
    [denied, ...siblings].forEach(assertEmpty);
    const restored = denied.read(); f.requests[2].resolve(response(kind)); await restored; await f.settle();
    assert.equal(denied.observer.getCurrentResult().isError, false);
    assert.notDeepEqual(denied.data(), typeof denied.seed === 'number' ? 0 : { pages: [], pageParams: [] });
    foreign.forEach(entry => assert.strictEqual(entry.data(), entry.seed));
  });
}

for (const failure of [Object.assign(Error('synthetic unavailable'), { status: 503 }), Error('synthetic offline')]) {
  test(`${failure.message} preserves cached inbox data and does not cancel another read`, async t => {
    const f = fixture(t), list = f.add(), count = f.add('count'), peer = f.add('list', scope, { search: 'peer' });
    const pendingPeer = peer.read(), pendingFailure = list.read();
    f.requests[1].reject(failure); await pendingFailure; await f.settle();
    [list, count, peer].forEach(entry => assert.strictEqual(entry.data(), entry.seed));
    assert.equal(f.requests[0].transport.signal.aborted, false);
    f.requests[0].resolve(response('list')); await pendingPeer;
  });
}

test('a delayed denial cannot erase a new authorized response after the scope was retired', async t => {
  const f = fixture(t), list = f.add(), peer = f.add('list', scope, { search: 'peer' });
  const old = peer.read(), denial = list.read(); f.requests[1].reject({ status: 403 }); await denial; await f.settle();
  assertEmpty(peer); await old;
  const restored = list.read(); f.requests[2].resolve(response('list', 'new-authorized')); await restored;
  f.requests[0].reject({ status: 403 }); await f.settle();
  assert.equal(list.data().pages[0].conversations[0].id, 'new-authorized');
});

for (const kind of ['count', 'options']) test(`an older ${kind} poll cannot restore its private DTO after another inbox query is denied`, async t => {
  const f = fixture(t), older = f.add(kind), denied = f.add();
  const pendingOlder = older.read(), pendingDenial = denied.read();
  f.requests[1].reject({ status: 403 }); await pendingDenial; await f.settle();
  assertEmpty(older); assert.equal(f.requests[0].transport.signal.aborted, true); await pendingOlder;
  f.requests[0].resolve(response(kind, 'late-private')); await f.settle(); assertEmpty(older);
  const restored = older.read(); f.requests[2].resolve(response(kind, 'new-authorized')); await restored;
  assert.notDeepEqual(older.data(), typeof older.seed === 'number' ? 0 : { pages: [], pageParams: [] });
});

test('removed and recreated same-key Query cannot receive its former response or denial', async t => {
  const f = fixture(t), old = f.add(); const pending = old.read();
  f.client.removeQueries({ queryKey: old.key, exact: true });
  const current = f.add();
  f.requests[0].reject({ status: 403 }); await pending; await f.settle();
  assert.strictEqual(current.data(), current.seed);
});
