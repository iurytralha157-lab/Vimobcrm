import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import { QueryClient, QueryObserver } from '@tanstack/react-query'

const exports = {}
Function('exports', ts.transpileModule(readFileSync(new URL('./whatsapp-avatar-cache.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText)(exports)
const { isWhatsAppAvatarQuery, invalidateWhatsAppAvatarCaches } = exports

const userA = '10000000-0000-4000-8000-000000000001'
const userB = '10000000-0000-4000-8000-000000000002'
const sender = (org, ids = userA) => ['whatsapp-sender-avatars', org, 'viewer', 'access-sid', 'conversation', 'lead', 'session', ids]
const conversation = (root, org, ...rest) => [root, 'tenant-scope', org, 'viewer', 'access-sid', ...rest]
const roots = ['whatsapp-conversations', 'whatsapp-conversation', 'whatsapp-conversation-snapshot', 'whatsapp-conversation-history']

test('avatar matching requires the organization in the correct namespace slot', () => {
  for (const root of roots) {
    assert.equal(isWhatsAppAvatarQuery(conversation(root, 'org-a', 'chat'), 'org-a', userA), true)
    assert.equal(isWhatsAppAvatarQuery(conversation(root, 'org-b', 'org-a'), 'org-a', userA), false)
    assert.equal(isWhatsAppAvatarQuery([root, 'wrong-marker', 'org-a'], 'org-a', userA), false)
  }
  assert.equal(isWhatsAppAvatarQuery(sender('org-a'), 'org-a', userA), true)
  assert.equal(isWhatsAppAvatarQuery(sender('org-b', `org-a,${userA}`), 'org-a', userA), false)
  assert.equal(isWhatsAppAvatarQuery(['user-summaries', 'org-a', [userA]], 'org-a', userA), true)
  assert.equal(isWhatsAppAvatarQuery(['user-summaries', 'org-b', ['org-a', userA]], 'org-a', userA), false)
  assert.equal(isWhatsAppAvatarQuery(['organization-users', 'org-a'], 'org-a', userA), true)
  assert.equal(isWhatsAppAvatarQuery(['organization-users', 'org-b', 'org-a'], 'org-a', userA), false)
  for (const org of ['', ' ', 'none']) assert.equal(isWhatsAppAvatarQuery(sender(org), org), false)
})

test('a target avatar refresh only reads sender batches that contain that canonical user ID', () => {
  assert.equal(isWhatsAppAvatarQuery(sender('org-a', `${userB},${userA}`), 'org-a', userA.toUpperCase()), true)
  assert.equal(isWhatsAppAvatarQuery(sender('org-a', userB), 'org-a', userA), false)
  assert.equal(isWhatsAppAvatarQuery(sender('org-a', `${userA}-suffix`), 'org-a', userA), false)
  assert.equal(isWhatsAppAvatarQuery(sender('org-a', userB), 'org-a'), true)
})

test('message, unread, media, session and outbox caches never match photo invalidation', () => {
  for (const root of ['whatsapp-messages', 'whatsapp-message-media-url', 'whatsapp-outbox', 'whatsapp-sessions', 'whatsapp-attendance']) {
    assert.equal(isWhatsAppAvatarQuery(conversation(root, 'org-a'), 'org-a', userA), false)
  }
  assert.equal(isWhatsAppAvatarQuery(conversation('whatsapp-conversations', 'org-a', 'unread-count'), 'org-a', userA), false)
})

test('the real QueryClient invalidates only photo projections in the intended organization', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const included = [sender('org-a'), ['user-summaries', 'org-a'], ['organization-users', 'org-a'], ...roots.map(root => conversation(root, 'org-a', 'chat'))]
  const excluded = [sender('org-b'), sender('org-a', userB), ['user-summaries', 'org-b'], ['organization-users', 'org-b'],
    ...roots.map(root => conversation(root, 'org-b', 'org-a')),
    conversation('whatsapp-messages', 'org-a', 'chat'), conversation('whatsapp-outbox', 'org-a'),
    conversation('whatsapp-conversations', 'org-a', 'unread-count')]
  for (const key of [...included, ...excluded]) client.setQueryData(key, { url: 'accepted-photo' })
  try {
    await invalidateWhatsAppAvatarCaches(client, 'org-a', userA)
    for (const key of included) assert.equal(client.getQueryState(key).isInvalidated, true, JSON.stringify(key))
    for (const key of excluded) assert.equal(client.getQueryState(key).isInvalidated, false, JSON.stringify(key))
    for (const key of [...included, ...excluded]) assert.deepEqual(client.getQueryData(key), { url: 'accepted-photo' })
  } finally { client.clear() }
})

test('an active refresh cancels an older photo read before refetch and rejects its late completion', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const key = sender('org-a')
  let resolveOld, calls = 0, oldSignal
  const observer = new QueryObserver(client, {
    queryKey: key,
    queryFn: ({ signal }) => {
      calls++
      if (calls === 1) { oldSignal = signal; return new Promise(resolve => { resolveOld = resolve }) }
      return Promise.resolve({ url: 'new-photo' })
    },
  })
  const unsubscribe = observer.subscribe(() => {})
  try {
    await invalidateWhatsAppAvatarCaches(client, 'org-a', userA)
    assert.equal(oldSignal.aborted, true)
    assert.equal(calls, 2)
    assert.deepEqual(client.getQueryData(key), { url: 'new-photo' })
    resolveOld({ url: 'old-photo' })
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(client.getQueryData(key), { url: 'new-photo' })
  } finally { unsubscribe(); client.clear() }
})

test('the realtime consumer refreshes photos within the existing verified organization branch', () => {
  const source = readFileSync(new URL('../contexts/BackendRealtimeBus.tsx', import.meta.url), 'utf8')
  const scopeGuard = source.indexOf('event.organizationId !== organizationId')
  const usersBranch = source.indexOf('if (event.type === "organization.users.changed")')
  const refresh = source.indexOf('void invalidateWhatsAppAvatarCaches(', usersBranch)
  const nextBranch = source.indexOf("if (event.type.startsWith('tag.'))", usersBranch)
  assert.ok(scopeGuard >= 0 && scopeGuard < usersBranch && refresh > usersBranch && refresh < nextBranch)
  assert.match(source.slice(usersBranch, nextBranch), /organizationId,\s*getString\(event.data, "targetUserId"\)/)
  assert.doesNotMatch(source.slice(usersBranch, nextBranch), /authorizationChanged|WHATSAPP_MESSAGES_RECONCILE_EVENT/)
})

test('the actual user-change branch refreshes the Auth profile only for the current user photo change', () => {
  const source = readFileSync(new URL('../contexts/BackendRealtimeBus.tsx', import.meta.url), 'utf8')
  const ast = ts.createSourceFile('BackendRealtimeBus.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let body
  function visit(node) {
    if (ts.isIfStatement(node) && node.expression.getText(ast) === 'event.type === "organization.users.changed"') body = node.thenStatement.getText(ast)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(body)
  const invoke = Function('event', 'organizationId', 'userId', 'activeQueryClient',
    'invalidateWhatsAppAvatarCaches', 'getString', 'requestAccessRefresh', body)
  for (const [data, expected] of [
    [{ changeKind: 'avatar_updated', targetUserId: userA }, 1],
    [{ changeKind: 'avatar_updated', targetUserId: userB }, 0],
    [{ changeKind: 'updated', targetUserId: userA }, 0],
    [{ changeKind: 'avatar_updated' }, 0],
  ]) {
    let profileRefreshes = 0
    const photoRefreshes = []
    invoke({ type: 'organization.users.changed', data }, 'org-a', userA,
      { invalidateQueries: () => Promise.resolve() },
      (_client, org, target) => { photoRefreshes.push([org, target]); return Promise.resolve() },
      (value, key) => typeof value?.[key] === 'string' ? value[key] : '',
      () => { profileRefreshes++ })
    assert.equal(profileRefreshes, expected)
    assert.deepEqual(photoRefreshes, [['org-a', data.targetUserId]])
  }
})
