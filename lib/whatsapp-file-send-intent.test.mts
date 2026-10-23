import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fingerprintWhatsAppFile, getWhatsAppFileIntentStore, getWhatsAppFileIntentOwnerKey, runWhatsAppFileIntent, settleWhatsAppFileIntent } from '@/lib/whatsapp-file-send-intent'

test('an ambiguous file gesture only checks its original ID and never resends bytes', async () => {
  const store = new Map(), sent: string[] = [], checked: string[] = []
  const options = { isCurrent: () => true, isUnconfirmed: () => false,
    send: async (id: string) => { sent.push(id); throw new TypeError('response lost') },
    check: async (id: string) => { checked.push(id); return 'pending' as const } }
  await assert.rejects(runWhatsAppFileIntent(store, 'target/file', options), TypeError)
  for (let i = 0; i < 3; i++) assert.equal((await runWhatsAppFileIntent(store, 'target/file', options)).kind, 'checked')
  assert.equal(sent.length, 1); assert.deepEqual(checked, [sent[0], sent[0], sent[0]])
})

test('exact canonical acceptance or rejection frees a subsequent deliberate intent, not the checking gesture', async () => {
  for (const resolution of ['accepted', 'failed'] as const) {
    const store = new Map(), sent: string[] = []
    const options = { isCurrent: () => true, isUnconfirmed: () => true,
      send: async (id: string) => { sent.push(id); return {} }, check: async () => resolution }
    await runWhatsAppFileIntent(store, 'same', options)
    assert.equal((await runWhatsAppFileIntent(store, 'same', options)).kind, 'checked')
    assert.equal(sent.length, 1)
    await runWhatsAppFileIntent(store, 'same', options)
    assert.equal(sent.length, 2); assert.notEqual(sent[0], sent[1])
  }
})

test('concurrent reselection during POST or GET cannot dispatch another request', async () => {
  const store = new Map(); let sends = 0, checks = 0; let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const options = { isCurrent: () => true, isUnconfirmed: () => true,
    send: async () => { sends++; await gate; return {} }, check: async () => { checks++; await gate; return 'pending' as const } }
  const sending = runWhatsAppFileIntent(store, 'same', options)
  await runWhatsAppFileIntent(store, 'same', options)
  assert.equal(sends, 1); assert.equal(checks, 0); release(); await sending
  const checking = runWhatsAppFileIntent(store, 'same', options)
  await runWhatsAppFileIntent(store, 'same', options); await checking
  assert.equal(sends, 1); assert.equal(checks, 1)
})

test('definitive admission failure permits a new file intent while unknown server errors do not', async () => {
  const store = new Map(); let sends = 0
  const options = { isCurrent: () => true, isUnconfirmed: () => false,
    send: async () => { sends++; throw { status: 400, code: 'invalid_file' } }, check: async () => 'pending' as const }
  await assert.rejects(runWhatsAppFileIntent(store, 'same', options)); await assert.rejects(runWhatsAppFileIntent(store, 'same', options))
  assert.equal(sends, 2)
})

test('scope cancellation cannot send, and canonical resolution arriving after navigation cannot free an uncertain intent', async () => {
  const store = new Map(); let current = true, sends = 0
  const options = { isCurrent: () => current, isUnconfirmed: () => true,
    send: async () => { sends++; return {} }, check: async () => { current = false; return 'accepted' as const } }
  await runWhatsAppFileIntent(store, 'same', options)
  const result = await runWhatsAppFileIntent(store, 'same', options)
  assert.equal(result.kind === 'checked' && result.resolution, 'cancelled'); assert.equal(store.size, 1)
  await runWhatsAppFileIntent(store, 'other', options); assert.equal(sends, 1)
})

test('registry outlives view/query-cache replacement and clears when actor or organization changes', () => {
  const a = getWhatsAppFileIntentStore('user/org')
  a.set('opaque', { clientMessageId: 'original', state: 'unconfirmed' })
  assert.equal(getWhatsAppFileIntentStore('user/org'), a)
  assert.equal(getWhatsAppFileIntentStore('new-user/org').size, 0); assert.equal(a.size, 0)
})

test('a permissions revision preserves the unresolved CID for the same actor and organization', () => {
  const scope = { userId: 'actor', organizationId: 'org', accessScope: 'old-revision' }
  const key = getWhatsAppFileIntentOwnerKey(scope), store = getWhatsAppFileIntentStore(key)
  store.set('opaque', { clientMessageId: 'original', state: 'unconfirmed' })
  assert.equal(getWhatsAppFileIntentStore(getWhatsAppFileIntentOwnerKey({ ...scope, accessScope: 'fresh-revision' })), store)
  assert.equal(store.get('opaque')?.clientMessageId, 'original')
  assert.notEqual(getWhatsAppFileIntentOwnerKey({ ...scope, userId: 'different-actor' }), key)
  assert.notEqual(getWhatsAppFileIntentOwnerKey({ ...scope, organizationId: 'different-org' }), key)
})

test('manual canonical check settles only the exact file client ID', () => {
  const store = new Map([['a', { clientMessageId: 'cid-a', state: 'unconfirmed' as const }], ['b', { clientMessageId: 'cid-b', state: 'unconfirmed' as const }]])
  settleWhatsAppFileIntent(store, 'cid-a')
  assert.deepEqual([...store.keys()], ['a', 'b'])
  assert.equal(store.get('a')?.state, 'settled')
  assert.equal(store.get('b')?.state, 'unconfirmed')
})

test('a Verify gesture rechecks the original ID after another surface settles it', async () => {
  for (const resolution of ['accepted', 'failed'] as const) {
    const store = new Map(), sent: string[] = [], checked: string[] = []
    const options = { isCurrent: () => true, isUnconfirmed: () => true,
      send: async (id: string) => { sent.push(id); return {} },
      check: async (id: string) => { checked.push(id); return resolution } }
    await runWhatsAppFileIntent(store, 'same', options)
    settleWhatsAppFileIntent(store, sent[0])
    const result = await runWhatsAppFileIntent(store, 'same', { ...options, verificationOnly: true })
    assert.deepEqual(result, { kind: 'checked', clientMessageId: sent[0], resolution })
    assert.equal(sent.length, 1); assert.deepEqual(checked, [sent[0]])
    // A stale Verify event is not a new deliberate gesture, even after consume.
    assert.deepEqual(await runWhatsAppFileIntent(store, 'same', { ...options, verificationOnly: true }),
      { kind: 'checked', clientMessageId: '', resolution: 'pending' })
    assert.equal(sent.length, 1)
  }
})

test('a missing file registry never authorizes a Verify gesture to POST', async () => {
  const store = new Map(); let sends = 0, checks = 0
  const options = { verificationOnly: true, isCurrent: () => true, isUnconfirmed: () => true,
    send: async () => { sends++; return {} }, check: async () => { checks++; return 'accepted' as const } }
  for (let index = 0; index < 3; index++) assert.deepEqual(await runWhatsAppFileIntent(store, 'unknown', options),
    { kind: 'checked', clientMessageId: '', resolution: 'pending' })
  assert.equal(sends, 0); assert.equal(checks, 0)
})

test('settled IDs are bounded and eviction preserves unresolved intents and Verify safety', async () => {
  const store = new Map<string, { clientMessageId: string; state: 'unconfirmed' | 'settled' }>()
  store.set('unresolved', { clientMessageId: 'pending-cid', state: 'unconfirmed' })
  for (let index = 0; index < 132; index++) {
    store.set('resolved-' + index, { clientMessageId: 'cid-' + index, state: 'unconfirmed' })
    settleWhatsAppFileIntent(store, 'cid-' + index)
  }
  assert.equal(store.size, 129); assert.equal(store.get('unresolved')?.state, 'unconfirmed')
  assert.equal(store.has('resolved-0'), false); assert.equal(store.get('resolved-131')?.state, 'settled')
  let sends = 0
  await runWhatsAppFileIntent(store, 'resolved-0', { verificationOnly: true, isCurrent: () => true, isUnconfirmed: () => true,
    send: async () => { sends++; return {} }, check: async () => 'accepted' as const })
  assert.equal(sends, 0)
})

test('a new explicit send can replace an ID settled in another surface', async () => {
  const store = new Map(), sent: string[] = []
  const options = { isCurrent: () => true, isUnconfirmed: () => true,
    send: async (id: string) => { sent.push(id); return {} }, check: async () => 'accepted' as const }
  await runWhatsAppFileIntent(store, 'same', options); settleWhatsAppFileIntent(store, sent[0])
  assert.equal((await runWhatsAppFileIntent(store, 'same', options)).kind, 'sent')
  assert.equal(sent.length, 2); assert.notEqual(sent[0], sent[1])
})

test('fingerprint uses original bytes and filename, ignoring lastModified and preparation output', async () => {
  const a = Object.assign(new Blob(['original'], { type: 'image/png' }), { name: 'visita.png', lastModified: 1 })
  const b = Object.assign(new Blob(['original'], { type: 'image/png' }), { name: 'visita.png', lastModified: 2 })
  const c = Object.assign(new Blob(['different'], { type: 'image/png' }), { name: 'visita.png' })
  assert.equal(await fingerprintWhatsAppFile(a), await fingerprintWhatsAppFile(b))
  assert.notEqual(await fingerprintWhatsAppFile(a), await fingerprintWhatsAppFile(c))
})
