import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import { QueryClient } from '@tanstack/react-query'

// Exercise the real shared ownership callbacks without an API or auth session.
const source = readFileSync(new URL('./use-whatsapp-messages-paginated.ts', import.meta.url), 'utf8')
const ast = ts.createSourceFile('hook.ts', source, ts.ScriptTarget.Latest, true)
const names = new Set(['headReadStates', 'headReadState', 'startHeadRead', 'snapshotHeadOwners',
  'isCurrentHeadRead', 'pendingHeadRequest', 'retireHeadReads', 'releaseHeadOwner', 'refreshLatestPage'])
const declarations = []
function visit(node) {
  if (ts.isFunctionDeclaration(node) && names.has(node.name?.text)) declarations.push(node.getText(ast))
  if (ts.isVariableDeclaration(node) && names.has(node.name.getText(ast))) declarations.push(`const ${node.getText(ast)};`)
  ts.forEachChild(node, visit)
}
visit(ast)
assert.equal(declarations.length, names.size)
const compile = text => ts.transpileModule(text, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText
const registryDeclaration = declarations.find(text => text.startsWith('const headReadStates ='))
assert.ok(registryDeclaration)
// All fixtures use the same production registry, as two mounted consumers do.
const headReadStates = Function(`${compile(registryDeclaration)}; return headReadStates;`)()
const compiled = compile(declarations.filter(text => text !== registryDeclaration).join('\n'))

function fixture(t, client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } })) {
  t.after(() => client.clear())
  const queryKey = ['synthetic-head-cancellation']
  client.setQueryData(queryKey, { pages: [{ messages: [{ id: 'seed' }], nextCursor: null }], pageParams: [null] })
  const query = client.getQueryCache().find({ queryKey, exact: true })
  const requests = []
  const owner = () => ({ generation: () => 0, available: () => true, onPage() {}, onHistory() {}, onError() {}, onRefreshState() {} })
  const first = owner(), peer = owner(), ownerRef = { current: null }
  const bindings = {
    exports: {}, headReadStates, useCallback: fn => fn, queryClient: client, queryKey, conversationId: 'synthetic-chat', queryEnabled: true,
    queryFingerprint: 'synthetic-access', refreshStateRef: { current: { key: 'synthetic-access', lastStartedAt: 0 } },
    currentQuery: () => client.getQueryCache().find({ queryKey, exact: true }),
    canonicalPreviewOwner: first, headOwnerRef: ownerRef, pageSize: 2, WHATSAPP_HEAD_REFRESH_MIN_GAP_MS: 1000,
    fetchPage: (cursor, signal) => new Promise(resolve => requests.push({ cursor, signal, resolve })),
    shouldRebaseWhatsAppMessagePages: () => false,
    mergeWhatsAppLatestMessagePage: (_pages, page) => [page],
    flattenWhatsAppMessagePages: pages => pages.flatMap(page => page.messages),
  }
  const implementation = Function(...Object.keys(bindings), `${compiled}; return {
    headReadState, startHeadRead, refreshLatestPage, retireHeadReads, releaseHeadOwner,
    selectOwner(owner) { canonicalPreviewOwner = owner; headOwnerRef.current = { query, state }; },
    initialize(q) { query = q; state = headReadState(queryClient, query); },
  }; var query, state;`)(...Object.values(bindings))
  implementation.initialize(query)
  const state = implementation.headReadState(client, query)
  state.owners.set(first, first)
  implementation.selectOwner(first)
  return { client, query, queryKey, requests, state, first, peer, ...implementation }
}

test('closing the final owner aborts the custom HEAD and ignores a transport that resolves late', async t => {
  const h = fixture(t)
  const pending = h.refreshLatestPage(0)
  assert.ok(h.requests[0].signal instanceof AbortSignal)
  h.releaseHeadOwner()
  assert.equal(h.requests[0].signal.aborted, true)
  h.requests[0].resolve({ messages: [{ id: 'late' }], nextCursor: null })
  await pending
  assert.equal(h.client.getQueryData(h.queryKey).pages[0].messages[0].id, 'seed')
})

test('closing one peer preserves the shared HEAD until the final owner leaves', async t => {
  const h = fixture(t)
  h.state.owners.set(h.peer, h.peer)
  const pending = h.refreshLatestPage(0)
  h.releaseHeadOwner()
  assert.equal(h.requests[0].signal?.aborted, false)
  h.selectOwner(h.peer)
  h.releaseHeadOwner()
  assert.equal(h.requests[0].signal.aborted, true)
  h.requests[0].resolve({ messages: [], nextCursor: null })
  await pending
})

test('retiring access aborts the old HEAD but allows a new authorized read', async t => {
  const h = fixture(t)
  const old = h.refreshLatestPage(0)
  h.retireHeadReads()
  assert.equal(h.requests[0].signal?.aborted, true)
  const current = h.refreshLatestPage(0)
  assert.equal(h.requests.length, 2)
  assert.equal(h.requests[1].signal.aborted, false)
  h.requests[1].resolve({ messages: [{ id: 'current' }], nextCursor: null })
  await current
  h.requests[0].resolve({ messages: [{ id: 'stale' }], nextCursor: null })
  await old
  assert.equal(h.client.getQueryData(h.queryKey).pages[0].messages[0].id, 'current')
})

test('a tracked canonical HEAD supersedes and aborts a custom request', async t => {
  const h = fixture(t)
  const old = h.refreshLatestPage(0)
  const current = h.startHeadRead(h.client, h.query, true)
  assert.equal(h.requests[0].signal?.aborted, true)
  assert.equal(current.queryFetch, h.query.promise)
  h.requests[0].resolve({ messages: [{ id: 'stale' }], nextCursor: null })
  await old
  assert.equal(h.client.getQueryData(h.queryKey).pages[0].messages[0].id, 'seed')
})

test('closing one QueryClient never aborts the same-key HEAD of another tenant client', async t => {
  const a = fixture(t), b = fixture(t)
  const pendingA = a.refreshLatestPage(0), pendingB = b.refreshLatestPage(0)
  a.releaseHeadOwner()
  assert.equal(a.requests[0].signal?.aborted, true)
  assert.equal(b.requests[0].signal?.aborted, false)
  b.requests[0].resolve({ messages: [{ id: 'tenant-b' }], nextCursor: null })
  a.requests[0].resolve({ messages: [{ id: 'tenant-a-late' }], nextCursor: null })
  await Promise.all([pendingA, pendingB])
  assert.equal(b.client.getQueryData(b.queryKey).pages[0].messages[0].id, 'tenant-b')
})
