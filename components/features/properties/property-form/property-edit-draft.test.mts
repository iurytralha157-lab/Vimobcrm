import assert from 'node:assert/strict';
import test from 'node:test';
import { initialFormData, clearDraft, propertyDraftKey, readDraft, saveDraft } from '@/components/features/properties/property-form/property-form-model';
import { propertyEditDraftKey, propertyEditDraftAccessSignature, savePropertyEditDraft, recoverPropertyEditDraft, clearPropertyEditDraft } from '@/components/features/properties/property-form/property-edit-draft';

const authorization = { permissions: ['property_manage', 'lead_view_team'], moduleEnabled: true, canEdit: true, canManage: true, canAssign: true, canEditOwnerDetails: true, editPolicy: 'everyone', ownerContactVisibility: 'visible' };
const scope = { actorId: 'actor-a', organizationId: 'org-a', propertyId: 'property-a', accessSignature: propertyEditDraftAccessSignature(authorization) };
const key = propertyEditDraftKey(scope.organizationId, scope.actorId, scope.propertyId)!;
const timestamp = '2026-10-12T12:00:00Z';
const form = { ...initialFormData, title: 'Unsaved title', preco: '1000.125', imagem_principal: 'blob:local-photo', fotos: ['blob:another-photo'] };
function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
const server = { canEdit: true, canManage: true, canEditOwnerDetails: true, updatedAt: timestamp, formData: { ...initialFormData, title: 'Server title', imagem_principal: 'https://example.invalid/current.jpg', fotos: ['https://example.invalid/gallery.jpg'] } };

test('saving or canceling an existing property cannot remove another creation draft', () => {
  const local = storage();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: local });
  try {
    const creationKey = propertyDraftKey(scope.organizationId, scope.actorId);
    saveDraft(creationKey, form);
    clearDraft(creationKey, { isEditing: true });
    assert.equal(readDraft(creationKey)?.title, form.title);
    clearDraft(creationKey, { isEditing: false });
    assert.equal(readDraft(creationKey), null);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
test('permitted remount restores fields and original CAS base while refreshing canonical media', () => {
  const local = storage();
  assert.equal(savePropertyEditDraft(local, key, scope, timestamp, form), true);
  assert.equal(local.getItem(key)?.includes('blob:'), false);
  const recovered = recoverPropertyEditDraft(local, key, scope, server)!;
  assert.equal(recovered.formData.title, form.title);
  assert.equal(recovered.formData.preco, form.preco);
  assert.equal(recovered.formData.imagem_principal, server.formData.imagem_principal);
  assert.deepEqual(recovered.formData.fotos, server.formData.fotos);
  assert.equal(recovered.expectedUpdatedAt, timestamp);
  assert.equal(recovered.hasConflict, false);
});
test('lead/team permissions do not discard an edit but property authorization changes do', () => {
  const other = propertyEditDraftAccessSignature({ ...authorization, permissions: ['lead_manage', 'property_manage'] });
  assert.equal(other, scope.accessSignature);
  for (const changed of [{ ...authorization, canEditOwnerDetails: false }, { ...authorization, permissions: [] }, { ...authorization, moduleEnabled: false }, { ...authorization, editPolicy: 'responsible_or_admin' }]) {
    const local = storage(); savePropertyEditDraft(local, key, scope, timestamp, form);
    assert.equal(recoverPropertyEditDraft(local, key, { ...scope, accessSignature: propertyEditDraftAccessSignature(changed) }, server), null);
    assert.equal(local.getItem(key), null);
  }
});
test('fresh server denial discards the draft even if the old local fingerprint is supplied', () => {
  const local = storage(); savePropertyEditDraft(local, key, scope, timestamp, form);
  assert.equal(recoverPropertyEditDraft(local, key, scope, { ...server, canEdit: false }), null);
  assert.equal(local.getItem(key), null);
});
test('fresh workspace capability loss discards contacts/internal fields despite stale AuthContext', () => {
  for (const changed of [{ ...server, canEditOwnerDetails: false }, { ...server, canManage: false }]) {
    const local = storage(); savePropertyEditDraft(local, key, scope, timestamp, { ...form, owner_cellphone: '47999990000' });
    assert.equal(recoverPropertyEditDraft(local, key, scope, changed), null);
    assert.equal(local.getItem(key), null);
  }
});
test('a broker draft never requires management capabilities it did not originally possess', () => {
  const broker = { ...scope, accessSignature: propertyEditDraftAccessSignature({ ...authorization, permissions: ['property_view'], canManage: false, canAssign: false, canEditOwnerDetails: false }) };
  const local = storage(); savePropertyEditDraft(local, key, broker, timestamp, form);
  assert.equal(recoverPropertyEditDraft(local, key, broker, { ...server, canManage: false, canEditOwnerDetails: false })?.formData.title, form.title);
});
test('actor, organization and property keys are isolated without deleting another scope', () => {
  const local = storage(); savePropertyEditDraft(local, key, scope, timestamp, form);
  for (const other of [{ ...scope, actorId: 'actor-b' }, { ...scope, organizationId: 'org-b' }, { ...scope, propertyId: 'property-b' }]) {
    const otherKey = propertyEditDraftKey(other.organizationId, other.actorId, other.propertyId)!;
    assert.notEqual(otherKey, key);
    assert.equal(recoverPropertyEditDraft(local, otherKey, other, server), null);
    assert.equal(recoverPropertyEditDraft(local, key, other, server), null);
    assert.notEqual(local.getItem(key), null);
  }
});
test('server version change restores local fields with a conflict instead of rebasing CAS silently', () => {
  const local = storage(); savePropertyEditDraft(local, key, scope, timestamp, form);
  const recovered = recoverPropertyEditDraft(local, key, scope, { ...server, updatedAt: '2026-10-12T13:00:00Z' })!;
  assert.equal(recovered.hasConflict, true);
  assert.equal(recovered.expectedUpdatedAt, timestamp);
  assert.equal(recovered.formData.title, form.title);
});
test('explicit discard removes only the edit record, and corrupt/unavailable storage fails closed', () => {
  const local = storage(); savePropertyEditDraft(local, key, scope, timestamp, form);
  clearPropertyEditDraft(local, key); assert.equal(local.getItem(key), null);
  local.setItem(key, '{invalid');
  assert.equal(recoverPropertyEditDraft(local, key, scope, server), null);
  assert.equal(local.getItem(key), null);
  const unavailable = { getItem: () => { throw Error('denied'); }, setItem: () => { throw Error('denied'); }, removeItem: () => { throw Error('denied'); } };
  assert.equal(savePropertyEditDraft(unavailable, key, scope, timestamp, form), false);
  assert.equal(recoverPropertyEditDraft(unavailable, key, scope, server), null);
  assert.doesNotThrow(() => clearPropertyEditDraft(unavailable, key));
});
