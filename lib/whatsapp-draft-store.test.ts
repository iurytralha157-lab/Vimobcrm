import assert from 'node:assert/strict';
import test from 'node:test';
import { createWhatsAppDraftStore, getWhatsAppDraftOwner } from '@/lib/whatsapp-draft-store';

test('drafts survive reload in the tab and isolate actor, org, permission scope and card', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const a = getWhatsAppDraftOwner({ userId: 'user-a', organizationId: 'org-a', accessScope: 'read-a' })!;
  const b = getWhatsAppDraftOwner({ userId: 'user-b', organizationId: 'org-a', accessScope: 'read-a' })!;
  const key = JSON.stringify([a, 'chat-a', 'lead-a']);
  const store = createWhatsAppDraftStore(storage, () => 100);
  store.set(key, 'Mensagem ainda não enviada');
  const next = createWhatsAppDraftStore(storage, () => 200);
  assert.equal(next.get(key), 'Mensagem ainda não enviada');
  assert.equal(next.get(JSON.stringify([b, 'chat-a', 'lead-a'])), '');
  assert.equal(next.get(JSON.stringify([a, 'chat-a', 'lead-b'])), '');
  next.clearConversation(a, 'chat-a');
  assert.equal(next.get(key), '');
  assert.equal(createWhatsAppDraftStore(storage, () => 300).get(key), '');
});
test('expired, malformed and unavailable storage cannot expose or block a draft', () => {
  let now = 100;
  const owner = 'owner', key = JSON.stringify([owner, 'chat', 'lead']);
  const store = createWhatsAppDraftStore(undefined, () => now);
  store.set(key, 'rascunho');
  now += 24 * 60 * 60_000;
  assert.equal(store.get(key), '');
  const blocked = createWhatsAppDraftStore({ getItem() { throw Error(); }, setItem() { throw Error(); }, removeItem() { throw Error(); } });
  blocked.set(key, 'texto'); assert.equal(blocked.get(key), 'texto');
  blocked.clearOwner(owner); assert.equal(blocked.get(key), '');
});

test('changing actor or role removes old owners, including persisted reload drafts', () => {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) || null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
  const owner = getWhatsAppDraftOwner({ userId: 'user', organizationId: 'org', accessScope: 'role-old' })!;
  const nextOwner = getWhatsAppDraftOwner({ userId: 'user', organizationId: 'org', accessScope: 'role-new' })!;
  const old = JSON.stringify([owner, 'chat', 'lead']), next = JSON.stringify([nextOwner, 'chat', 'lead']);
  const store = createWhatsAppDraftStore(storage);
  store.set(old, 'conteudo anterior'); store.set(next, 'atual'); store.retainOwner(nextOwner);
  assert.equal(store.get(old), ''); assert.equal(store.get(next), 'atual');
  assert.equal(createWhatsAppDraftStore(storage).get(old), '');
  store.clearOwner(nextOwner); assert.equal(createWhatsAppDraftStore(storage).get(next), '');
});

test('one malformed stored key does not discard another valid draft', () => {
  const key = JSON.stringify(['owner', 'chat', 'lead']);
  const content = JSON.stringify({ broken: { text: 'invalid', at: 100 }, [key]: { text: 'valid', at: 100 } });
  const store = createWhatsAppDraftStore({ getItem: () => content, setItem() {}, removeItem() {} }, () => 200);
  assert.equal(store.get(key), 'valid');
});

test('revision subscribers observe other conversation drafts and removals with unchanged empty snapshots', () => {
  const store = createWhatsAppDraftStore(), key = JSON.stringify(['owner', 'chat', 'lead']);
  const revisions: number[] = [];
  const unsubscribe = store.subscribe(() => { revisions.push(store.getRevision()); });
  assert.equal(store.get(null), '');
  store.set(key, 'Visible in inbox');
  assert.equal(store.get(null), '');
  store.set(key, 'Visible in inbox'); // An unchanged text does not notify again.
  store.clearConversation('owner', 'chat');
  assert.deepEqual(revisions, [1, 2]);
  unsubscribe();
  store.set(key, 'After unsubscribe');
  assert.deepEqual(revisions, [1, 2]);
  assert.equal(store.getRevision(), 3);
});
