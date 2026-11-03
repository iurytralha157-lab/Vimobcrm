import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyLoginFailure as classify } from './login-failure';

test('account answers stay neutral', () => {
  for (const error of [
    { status: 400, code: 'invalid_credentials' },
    { status: 400, code: 'email_not_confirmed' },
    { status: 403, code: 'user_banned' },
    new Error('anything else'),
    null,
  ]) assert.equal(classify(error), 'credentials');
});

test('rate limits and unavailable services are explained', () => {
  assert.equal(classify({ status: 429 }), 'rate_limited');
  assert.equal(classify({ code: 'over_request_rate_limit' }), 'rate_limited');
  assert.equal(classify({ status: 503 }), 'unavailable');
  assert.equal(classify({ status: 0 }), 'unavailable');
  assert.equal(classify({ name: 'AuthRetryableFetchError' }), 'unavailable');
});
