import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyAccessValidationFailure as classify } from './access-validation';

test('only an answer from the server can mean that access was lost', () => {
  assert.equal(classify({ status: 403, code: 'permission_denied' }), 'denied');
  assert.equal(classify({ status: 404, code: 'not_found' }), 'denied');
});

test('unavailable services and network failures are transient', () => {
  for (const status of [0, 408, 425, 429, 500, 502, 503, 504]) assert.equal(classify({ status }), 'transient');
  assert.equal(classify(new TypeError('Failed to fetch')), 'transient');
  assert.equal(classify(new DOMException('Aborted', 'AbortError')), 'transient');
  assert.equal(classify(undefined), 'transient');
});

test('session failures stay distinct from other failures', () => {
  assert.equal(classify({ status: 401, code: 'session_revoked' }), 'session');
  assert.equal(classify({ code: 'missing_session' }), 'session');
  assert.equal(classify(new Error('Invalid or expired bearer token.')), 'session');
  assert.equal(classify(new Error('Sessão expirada. Faça login novamente.')), 'session');
});
