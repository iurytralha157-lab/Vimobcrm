import assert from 'node:assert/strict';
import test from 'node:test';

import { signOutWithGlobalRevocation } from './global-sign-out';

function authError(status: number) {
  return Object.assign(new Error(`Auth ${status}`), { status });
}

test('confirms global revocation before clearing the browser session', async () => {
  const calls: string[] = [];
  const outcome = await signOutWithGlobalRevocation({
    getSession: async () => {
      calls.push('get-session');
      return { data: { session: { access_token: 'synthetic-token' } }, error: null };
    },
    revokeGlobal: async (token) => {
      calls.push(`revoke:${token}`);
      return { error: null };
    },
    clearLocal: async () => {
      calls.push('clear-local');
      return { error: null };
    },
  });

  assert.equal(outcome, 'verified-global');
  assert.deepEqual(calls, ['get-session', 'revoke:synthetic-token', 'clear-local']);
});

for (const status of [401, 403, 404]) {
  test(`revoked or invalid current session (${status}) exits locally without claiming global revocation`, async () => {
    let clearedLocal = false;
    const outcome = await signOutWithGlobalRevocation({
      getSession: async () => ({ data: { session: { access_token: 'synthetic-token' } }, error: null }),
      revokeGlobal: async () => ({ error: authError(status) }),
      clearLocal: async () => {
        clearedLocal = true;
        return { error: null };
      },
    });

    assert.equal(outcome, 'local-unverified');
    assert.equal(clearedLocal, true);
  });
}

test('missing current session exits locally without claiming global revocation', async () => {
  let revoked = false;
  const outcome = await signOutWithGlobalRevocation({
    getSession: async () => ({ data: { session: null }, error: null }),
    revokeGlobal: async () => {
      revoked = true;
      return { error: null };
    },
    clearLocal: async () => ({ error: null }),
  });

  assert.equal(outcome, 'local-unverified');
  assert.equal(revoked, false);
});

test('an already invalid session returned by getSession can still leave this device', async () => {
  let clearedLocal = false;
  const outcome = await signOutWithGlobalRevocation({
    getSession: async () => ({ data: { session: null }, error: authError(401) }),
    revokeGlobal: async () => ({ error: null }),
    clearLocal: async () => {
      clearedLocal = true;
      return { error: null };
    },
  });

  assert.equal(outcome, 'local-unverified');
  assert.equal(clearedLocal, true);
});

for (const code of ['refresh_token_not_found', 'refresh_token_already_used']) {
  test(`a revoked refresh token (${code}) exits locally without claiming global revocation`, async () => {
    let clearedLocal = false;
    const outcome = await signOutWithGlobalRevocation({
      getSession: async () => ({
        data: { session: null },
        error: Object.assign(authError(400), { code }),
      }),
      revokeGlobal: async () => ({ error: null }),
      clearLocal: async () => {
        clearedLocal = true;
        return { error: null };
      },
    });

    assert.equal(outcome, 'local-unverified');
    assert.equal(clearedLocal, true);
  });
}

test('transient global logout failure preserves the current browser session for retry', async () => {
  let clearedLocal = false;
  await assert.rejects(
    signOutWithGlobalRevocation({
      getSession: async () => ({ data: { session: { access_token: 'synthetic-token' } }, error: null }),
      revokeGlobal: async () => ({ error: authError(503) }),
      clearLocal: async () => {
        clearedLocal = true;
        return { error: null };
      },
    }),
    /Auth 503/,
  );
  assert.equal(clearedLocal, false);
});

test('session lookup failure preserves local credentials for retry', async () => {
  let clearedLocal = false;
  await assert.rejects(
    signOutWithGlobalRevocation({
      getSession: async () => ({ data: { session: null }, error: authError(503) }),
      revokeGlobal: async () => ({ error: null }),
      clearLocal: async () => {
        clearedLocal = true;
        return { error: null };
      },
    }),
    /Auth 503/,
  );
  assert.equal(clearedLocal, false);
});

test('local SDK cleanup failure remains recoverable instead of redirecting with an old cookie', async () => {
  await assert.rejects(
    signOutWithGlobalRevocation({
      getSession: async () => ({ data: { session: { access_token: 'synthetic-token' } }, error: null }),
      revokeGlobal: async () => ({ error: null }),
      clearLocal: async () => { throw new Error('local storage unavailable'); },
    }),
    /local storage unavailable/,
  );
});
