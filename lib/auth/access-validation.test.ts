import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyAccessValidationFailure as classify, confirmSessionFailure as confirm } from './access-validation';

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

test('an API 401 only ends the session after Auth confirms it', async () => {
  assert.equal(await confirm('session', async () => ({ error: null })), 'transient');
  assert.equal(await confirm('session', async () => ({ error: { status: 503 } })), 'transient');
  assert.equal(await confirm('session', async () => ({ error: { status: 401, message: 'Invalid authentication credentials' } })), 'transient');
  assert.equal(await confirm('session', async () => ({ error: { status: 403, code: 'bad_jwt' } })), 'transient');
  assert.equal(await confirm('session', async () => { throw new TypeError('Failed to fetch'); }), 'transient');
  assert.equal(await confirm('session', () => new Promise<{ error: unknown }>(() => {}), 5), 'transient');
  assert.equal(await confirm('session', async () => ({ error: { status: 403, code: 'session_not_found' } })), 'session');
  assert.equal(await confirm('session', async () => ({ error: { name: 'AuthSessionMissingError' } })), 'session');
  assert.equal(await confirm('session', async () => ({ error: { status: 400, code: 'refresh_token_not_found' } })), 'session');
});

test('other failures do not consult Auth', async () => {
  const unexpected = async () => { throw new Error('should not run'); };
  assert.equal(await confirm('denied', unexpected), 'denied');
  assert.equal(await confirm('transient', unexpected), 'transient');
});
