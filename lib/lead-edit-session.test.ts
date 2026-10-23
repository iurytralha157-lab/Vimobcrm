import assert from 'node:assert/strict';
import test from 'node:test';
import { changedLeadFields, getLeadDraftKey, normalizeLeadInterestPropertyIds, shouldInitializeLeadForm, uploadLeadFiles } from '@/lib/lead-edit-session';

test('a new server snapshot cannot reinitialize the same open edit session', () => {
  assert.equal(shouldInitializeLeadForm(null, 'org:user:lead', false), false);
  assert.equal(shouldInitializeLeadForm(null, 'org:user:lead', true), true);
  assert.equal(shouldInitializeLeadForm('org:user:lead', 'org:user:lead', true), false);
  assert.equal(shouldInitializeLeadForm('org:user:lead', 'org:user:other', true), true);
});
test('a cadastral edit does not clear an unseen property or resend an unchanged profile', () => {
  const base = { name: 'Ana', property_id: null, interest_property_ids: [] as string[], profile: { cpf: '123', personType: 'individual' } };
  assert.deepEqual(changedLeadFields(base, { ...base, name: 'Ana Silva' }), { name: 'Ana Silva' });
  assert.deepEqual(changedLeadFields(base, { ...base, property_id: null, interest_property_ids: [] }), {});
  assert.deepEqual(changedLeadFields(base, { ...base, interest_property_ids: ['new'] }), { interest_property_ids: ['new'] });
});

test('editing a legacy list preserves the selected primary without losing the old interests', () => {
  assert.deepEqual(normalizeLeadInterestPropertyIds('C', ['A', 'B']), ['C', 'A', 'B']);
  assert.deepEqual(normalizeLeadInterestPropertyIds('C', ['A', 'C', 'B', 'C']), ['C', 'A', 'B']);
  assert.deepEqual(normalizeLeadInterestPropertyIds('C', []), ['C']);
  assert.deepEqual(normalizeLeadInterestPropertyIds(null, ['A', 'B']), ['A', 'B']);
});

test('normalizing an edit snapshot never sends a property patch for an unrelated contact change', () => {
  const original = { name: 'Ana', property_id: 'C', interest_property_ids: normalizeLeadInterestPropertyIds('C', ['A', 'B']) };
  assert.deepEqual(changedLeadFields(original, { ...original, name: 'Ana Silva' }), { name: 'Ana Silva' });
  assert.deepEqual(changedLeadFields(original, { ...original, interest_property_ids: ['C', 'B'] }), { interest_property_ids: ['C', 'B'] });
});
test('drafts require user and organization and separate two users in the same organization', () => {
  assert.equal(getLeadDraftKey(undefined, 'org'), null);
  assert.equal(getLeadDraftKey('u', null), null);
  assert.notEqual(getLeadDraftKey('u1', 'org'), getLeadDraftKey('u2', 'org'));
  assert.notEqual(getLeadDraftKey('u', 'a'), getLeadDraftKey('u', 'b'));
});
test('document recovery retains only failures and never resends successful documents', async () => {
  const attempts: string[] = [];
  const failed = await uploadLeadFiles(['a', 'b', 'c'], async (file) => { attempts.push(file); if (file === 'b') throw new Error('rejected'); });
  assert.deepEqual(failed, ['b']);
  assert.deepEqual(await uploadLeadFiles(failed, async (file) => { attempts.push(file); }), []);
  assert.deepEqual(attempts, ['a', 'b', 'c', 'b']);
});

test('document upload stops scheduling after the initiating form scope ends', async () => {
  let active = true;
  const attempts: string[] = [];
  const remaining = await uploadLeadFiles(['a', 'b', 'c'], async file => { attempts.push(file); active = false; }, () => active);
  assert.deepEqual(attempts, ['a']);
  assert.deepEqual(remaining, ['b', 'c']);
});
