import assert from 'node:assert/strict';
import test from 'node:test';
import { createContactImportRecoveryStore, type ContactImportRecovery } from './contact-import-recovery';
import { createEmptyImportDistributionSummary } from '@/lib/lead-distribution-outcome';
import { contactImportScopeKey } from '@/lib/lead-import-scope';
import { CONTACT_IMPORT_RECOVERY_TTL_MS, MAX_COMPLETED_CONTACT_IMPORT_RECOVERIES, MAX_CONTACT_IMPORT_RECOVERY_FILE_BYTES } from '@/config/contact-import';

const snapshot = (): ContactImportRecovery => ({ rows: [{ rowNumber: 2, nome: 'Ana', importRequestKey: 'original-key' }], file: null,
  destination: { pipeline: 'pipeline', assignee: 'none', source: 'import', customSource: '', autoDistribute: false, roundRobin: 'automatic' },
  pending: true, phase: 'importing', progress: null, result: null, unknownPreparationRows: [], preparedRows: 1, createdTags: 0 });

test('scope recovery keeps row keys and actual partial outcomes after the original UI unsubscribes', () => {
  const store = createContactImportRecoveryStore();
  const run = store.start('org-a/actor/session', snapshot());
  assert.ok(run);
  let originalNotifications = 0;
  const unsubscribe = store.subscribe('org-a/actor/session', () => { originalNotifications += 1; });
  unsubscribe();
  store.update('org-a/actor/session', run, { pending: false, phase: null, result: { total: 2, processed: 1, remaining: 1, created: 1, reentered: 0, success: 1, failed: 0, failures: [], unstarted: [{ index: 1, rowNumber: 3, name: 'Bruna' }], stopped: true, reasons: [], distribution: createEmptyImportDistributionSummary() } });
  assert.equal(originalNotifications, 0);
  assert.equal(store.get('org-a/actor/session')?.rows[0].importRequestKey, 'original-key');
  assert.equal(store.get('org-a/actor/session')?.result?.remaining, 1);
  assert.equal(store.get('org-b/actor/session'), undefined);
  assert.equal(store.get('org-a/other-actor/session'), undefined);
  assert.equal(store.get('org-a/actor/new-session'), undefined);
});

test('an old callback cannot overwrite a later attempt and pending requests cannot be dismissed as unstarted', () => {
  const store = createContactImportRecoveryStore();
  const first = store.start('scope', snapshot())!;
  assert.equal(store.start('scope', snapshot()), null);
  store.clear('scope');
  assert.ok(store.get('scope'));
  store.update('scope', first, { pending: false });
  const second = store.start('scope', snapshot())!;
  store.update('scope', first, { createdTags: 99, pending: false });
  assert.equal(store.get('scope')?.createdTags, 0);
  store.update('scope', second, { pending: false });
  store.clear('scope');
  assert.equal(store.get('scope'), undefined);
});

test('ending a session purges files including pending runs; late completions cannot restore them', () => {
  const store = createContactImportRecoveryStore();
  const key = contactImportScopeKey('org-a', 'actor-a', 'session-a')!;
  const run = store.start(key, { ...snapshot(), file: new File(['Nome;Telefone\nAna;123'], 'contacts.csv') })!;
  store.retainSession('actor-a', 'session-b');
  assert.equal(store.get(key), undefined);
  store.update(key, run, { pending: false });
  assert.equal(store.get(key), undefined);
  const newKey = contactImportScopeKey('org-a', 'actor-a', 'session-b')!;
  store.start(newKey, snapshot());
  store.retainSession(null, null);
  assert.equal(store.get(newKey), undefined);
});

test('switching organizations and refreshing the same SID preserve recovery only for that actor/session', () => {
  const store = createContactImportRecoveryStore();
  const keyA = contactImportScopeKey('org-a', 'actor-a', 'same-session')!;
  const keyB = contactImportScopeKey('org-b', 'actor-a', 'same-session')!;
  const otherActor = contactImportScopeKey('org-a', 'actor-b', 'same-session')!;
  store.start(keyA, snapshot()); store.start(keyB, snapshot()); store.start(otherActor, snapshot());
  store.retainSession('actor-a', 'same-session');
  store.retainSession('actor-a', 'same-session');
  assert.ok(store.get(keyA)); assert.ok(store.get(keyB));
  assert.equal(store.get(otherActor), undefined);
});

test('completed recovery expires while idle and notifies consumers without expiring a pending run', () => {
  let now = 0;
  const scheduled: Array<{ fn: () => void; delay: number; cancelled: boolean }> = [];
  const store = createContactImportRecoveryStore({ now: () => now, scheduleExpiry: (fn, delay) => {
    const timer = { fn, delay, cancelled: false }; scheduled.push(timer);
    return () => { timer.cancelled = true; };
  } });
  const pending = store.start('pending', snapshot())!;
  assert.equal(scheduled.length, 0);
  let notifications = 0;
  store.subscribe('pending', () => { notifications += 1; });
  store.update('pending', pending, { pending: false });
  assert.equal(scheduled[0].delay, CONTACT_IMPORT_RECOVERY_TTL_MS);
  const other = store.start('still-pending', snapshot())!;
  now = CONTACT_IMPORT_RECOVERY_TTL_MS;
  scheduled[0].fn();
  assert.equal(store.get('pending'), undefined);
  assert.ok(store.get('still-pending'));
  assert.equal(notifications, 2);
  store.update('still-pending', other, { pending: false });
});

test('completed recovery has bounded count and file bytes while pending outcomes remain recoverable', () => {
  const store = createContactImportRecoveryStore({ scheduleExpiry: () => () => {} });
  store.start('pending', snapshot());
  for (let index = 0; index <= MAX_COMPLETED_CONTACT_IMPORT_RECOVERIES; index += 1) {
    store.start(`complete-${index}`, { ...snapshot(), pending: false });
  }
  assert.equal(store.get('complete-0'), undefined);
  assert.ok(store.get(`complete-${MAX_COMPLETED_CONTACT_IMPORT_RECOVERIES}`));
  assert.ok(store.get('pending'));
  const large = new File([new Uint8Array(MAX_CONTACT_IMPORT_RECOVERY_FILE_BYTES / 2 + 1)], 'synthetic.csv');
  store.start('large-1', { ...snapshot(), pending: false, file: large });
  store.start('large-2', { ...snapshot(), pending: false, file: large });
  assert.equal(store.get('large-1'), undefined);
  assert.equal(store.get('large-2')?.file, large);
  assert.ok(store.get('pending'));
});
