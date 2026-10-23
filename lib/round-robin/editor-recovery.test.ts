import assert from 'node:assert/strict';
import test from 'node:test';
import { createDistributionEditorVisit } from '@/lib/round-robin/editor-visit';
import { createEmptyDistributionQueueFormData } from '@/lib/round-robin/distribution-queue-form';
import { distributionDraftKey, readDistributionDraftRecovery, saveDistributionDraft, saveDistributionNavigationDraft } from '@/lib/round-robin/pending-draft';
import { requireSuccessfulQueueReload } from '@/lib/round-robin/reload-result';

const attemptId = '11111111-1111-4111-8111-111111111111';
function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

test('navigation cannot replace a pending creation review with editable fields, even if cancelled', () => {
  const storage = memoryStorage(), key = distributionDraftKey('org', 'actor')!;
  const marker = JSON.stringify({ reviewRequired: true, creationAttemptId: attemptId });
  storage.setItem(key, marker);
  const edited = { ...createEmptyDistributionQueueFormData(), name: 'New visual draft' };
  for (const navigationAccepted of [false, true]) {
    assert.equal(saveDistributionNavigationDraft(storage, key, edited, { hasUnreviewedCreation: true, pendingCreationSnapshot: null }), true);
    assert.equal(storage.getItem(key), marker, String(navigationAccepted));
    assert.equal(readDistributionDraftRecovery(storage, key)?.status, 'review_required');
  }
});

test('navigation preserves the exact frozen creation payload while the visible draft has changed', () => {
  const storage = memoryStorage(), key = distributionDraftKey('org', 'actor')!;
  const pending = { ...createEmptyDistributionQueueFormData(), name: 'Sent A', creationAttemptId: attemptId };
  const edited = { ...pending, name: 'Unsent B', creationAttemptId: undefined };
  assert.equal(saveDistributionNavigationDraft(storage, key, edited, { hasUnreviewedCreation: false, pendingCreationSnapshot: pending }), true);
  const recovered = readDistributionDraftRecovery(storage, key);
  assert.equal(recovered?.status, 'ready');
  if (recovered?.status === 'ready') assert.deepEqual(recovered.form, pending);
});

test('ordinary drafts stay principal scoped and storage failures never claim preservation', () => {
  const storage = memoryStorage();
  const form = { ...createEmptyDistributionQueueFormData(), name: 'Ordinary B' };
  const scope = { hasUnreviewedCreation: false, pendingCreationSnapshot: null };
  const key = distributionDraftKey('org-a', 'actor-a', 'queue-a')!;
  assert.equal(saveDistributionNavigationDraft(storage, key, form, scope), true);
  assert.equal(storage.getItem(distributionDraftKey('org-b', 'actor-a', 'queue-a')!), null);
  assert.equal(storage.getItem(distributionDraftKey('org-a', 'actor-b', 'queue-a')!), null);
  assert.equal(saveDistributionNavigationDraft({ ...storage, setItem: () => { throw new Error('Quota'); } }, key, form, scope), false);
  assert.equal(saveDistributionNavigationDraft(storage, distributionDraftKey('org', 'actor')!, form,
    { ...scope, hasUnreviewedCreation: true }), false, 'a missing review record is not reported as saved');
});

test('a late operation cannot remove a newer draft after the editor visit was replaced', async () => {
  const visit = createDistributionEditorVisit(), storage = memoryStorage();
  const key = distributionDraftKey('org', 'actor', 'queue')!;
  const retireA = visit.activate(), operationA = visit.beginOperation()!;
  let resolve!: () => void;
  const pending = new Promise<void>((done) => { resolve = done; });
  const oldSave = pending.then(() => {
    if (operationA.isCurrent()) storage.removeItem(key);
    return operationA.finish();
  });
  retireA();
  const retireB = visit.activate(), operationB = visit.beginOperation()!;
  const draftB = { ...createEmptyDistributionQueueFormData(), name: 'Later B' };
  saveDistributionDraft(storage, key, draftB);
  resolve();
  assert.equal(await oldSave, false);
  assert.equal(operationB.isCurrent(), true);
  assert.equal(visit.isBusy(), true, 'completion of A cannot release B');
  const recovered = readDistributionDraftRecovery(storage, key);
  assert.equal(recovered?.status === 'ready' && recovered.form.name, 'Later B');
  operationB.finish(); retireB();
});

test('visits deduplicate rapid save/reload gestures and never revive an operation after ABA or old cleanup', () => {
  const visit = createDistributionEditorVisit();
  assert.equal(visit.beginOperation(), null, 'closed or unmounted editor');
  const retireA = visit.activate(), operationA = visit.beginOperation()!;
  assert.equal(visit.beginOperation(), null);
  retireA(); const retireB = visit.activate(); retireA();
  assert.equal(operationA.isCurrent(), false);
  assert.equal(operationA.finish(), false);
  const operationB = visit.beginOperation()!;
  assert.equal(operationB.finish(), true);
  assert.equal(operationB.finish(), false);
  assert.equal(visit.isBusy(), false);
  assert.ok(visit.beginOperation()); retireB();
  assert.equal(visit.isBusy(), false);
});

test('explicit reload rejects failed requests with or without cached data, preserving the old snapshot', () => {
  const cached = { revision: 3, name: 'Old cache' };
  const error = new Error('Synthetic disconnected network');
  assert.throws(() => requireSuccessfulQueueReload({ data: cached, isError: true, error }), (actual) => actual === error);
  assert.throws(() => requireSuccessfulQueueReload({ data: undefined, isError: true, error }), (actual) => actual === error);
  assert.throws(() => requireSuccessfulQueueReload({ data: cached, isError: true }), /rascunho foi mantido/);
  assert.throws(() => requireSuccessfulQueueReload({ data: undefined }), /rascunho foi mantido/);
  const fresh = { ...cached, revision: 4 };
  assert.equal(requireSuccessfulQueueReload({ data: fresh, isError: false, error: null }), fresh);
  assert.deepEqual(cached, { revision: 3, name: 'Old cache' });
});
