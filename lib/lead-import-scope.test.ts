import assert from 'node:assert/strict';
import test from 'node:test';
import { contactImportScopeKey, createLeadImportScope } from './lead-import-scope';

test('organization, actor and session identify separate import scopes, without keeping access tokens', () => {
  const first = contactImportScopeKey('org-a', 'actor-a', 'session-a');
  for (const key of [contactImportScopeKey('org-b', 'actor-a', 'session-a'), contactImportScopeKey('org-a', 'actor-b', 'session-a'), contactImportScopeKey('org-a', 'actor-a', 'session-b')]) assert.notEqual(first, key);
  assert.equal(contactImportScopeKey('org-a', 'actor-a', null), null);
});

test('unmount and A-B-A remount never revive an earlier batch or stale callback', () => {
  const scope = createLeadImportScope();
  const close = scope.activate('a');
  const original = scope.capture('a');
  assert.equal(original(), true);
  close();
  assert.equal(original(), false);
  scope.activate('b');
  assert.equal(scope.capture('a')(), false);
  scope.activate('a');
  assert.equal(original(), false);
  assert.equal(scope.capture('a')(), true);
});
