import assert from 'node:assert/strict'
import test from 'node:test'

import {
  capturePasswordRecoveryIntent,
  clearPasswordRecoveryEvidence,
  grantPasswordRecoveryProof,
  hasPasswordRecoveryAuthenticationMethod,
  hasPasswordRecoveryProof,
  isPasswordRecoveryAccessToken,
  isPasswordRecoveryIdentityMatch,
  readPasswordRecoveryUrlEvidence,
  type PasswordRecoveryStorage,
} from './password-recovery'

function unsignedToken(payload: Record<string, unknown>) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `header.${encoded}.signature`
}

function memoryStorage(): PasswordRecoveryStorage {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
    removeItem: (key) => { values.delete(key) },
  }
}

test('recognizes only explicit recovery URL formats on /reset-password', () => {
  assert.deepEqual(
    readPasswordRecoveryUrlEvidence(new URL('https://app.test/reset-password?code=pkce-code')),
    { kind: 'pkce', code: 'pkce-code' },
  )
  assert.deepEqual(
    readPasswordRecoveryUrlEvidence(new URL('https://app.test/reset-password?token_hash=hash&type=recovery')),
    { kind: 'token_hash', tokenHash: 'hash' },
  )
  assert.deepEqual(
    readPasswordRecoveryUrlEvidence(new URL('https://app.test/reset-password#access_token=access&refresh_token=refresh&type=recovery')),
    { kind: 'implicit', accessToken: 'access', refreshToken: 'refresh' },
  )

  assert.deepEqual(
    readPasswordRecoveryUrlEvidence(new URL('https://app.test/reset-password?token_hash=hash&type=email')),
    { kind: 'none' },
  )
  assert.deepEqual(
    readPasswordRecoveryUrlEvidence(new URL('https://app.test/reset-password#access_token=access&refresh_token=refresh&type=signup')),
    { kind: 'none' },
  )
  assert.deepEqual(
    readPasswordRecoveryUrlEvidence(new URL('https://app.test/login?code=pkce-code')),
    { kind: 'none' },
  )
})

test('rejects duplicate, conflicting or oversized recovery credentials', () => {
  const invalidURLs = [
    'https://app.test/reset-password?code=first&code=second',
    'https://app.test/reset-password?token_hash=hash&type=recovery&type=signup',
    'https://app.test/reset-password?code=pkce&token_hash=hash&type=recovery',
    'https://app.test/reset-password?code=pkce#access_token=access&refresh_token=refresh&type=recovery',
    'https://app.test/reset-password#access_token=first&access_token=second&refresh_token=refresh&type=recovery',
    `https://app.test/reset-password?code=${'x'.repeat((4 * 1024) + 1)}`,
    `https://app.test/reset-password#access_token=${'x'.repeat((16 * 1024) + 1)}&refresh_token=refresh&type=recovery`,
  ]

  for (const value of invalidURLs) {
    assert.deepEqual(
      readPasswordRecoveryUrlEvidence(new URL(value)),
      { kind: 'none' },
      value,
    )
  }
})

test('an existing session is never enough without a recovery proof', () => {
  const storage = memoryStorage()
  assert.equal(hasPasswordRecoveryProof(storage, 'existing-user', 1_000), false)
  assert.equal(isPasswordRecoveryIdentityMatch(null, 'existing-user', 'existing-user'), false)
})

test('PASSWORD_RECOVERY proof is granted only after a fresh recovery intent', () => {
  const storage = memoryStorage()
  const now = 10_000

  assert.equal(grantPasswordRecoveryProof(storage, 'user-1', now), false)
  assert.equal(
    capturePasswordRecoveryIntent(
      storage,
      new URL('https://app.test/reset-password?code=recovery-code'),
      now,
    ),
    true,
  )
  assert.equal(grantPasswordRecoveryProof(storage, 'user-1', now + 1), true)
  assert.equal(hasPasswordRecoveryProof(storage, 'user-1', now + 2), true)
  assert.equal(hasPasswordRecoveryProof(storage, 'other-user', now + 2), false)
})

test('recovery proof expires and can be explicitly cleared', () => {
  const storage = memoryStorage()
  const now = 20_000
  capturePasswordRecoveryIntent(
    storage,
    new URL('https://app.test/reset-password?token_hash=hash&type=recovery'),
    now,
  )
  grantPasswordRecoveryProof(storage, 'user-1', now)

  assert.equal(hasPasswordRecoveryProof(storage, 'user-1', now + (15 * 60 * 1000) + 1), false)

  capturePasswordRecoveryIntent(
    storage,
    new URL('https://app.test/reset-password?code=another-code'),
    now,
  )
  grantPasswordRecoveryProof(storage, 'user-1', now)
  clearPasswordRecoveryEvidence(storage)
  assert.equal(hasPasswordRecoveryProof(storage, 'user-1', now), false)
})

test('identity check binds submit to the user authenticated by recovery', () => {
  assert.equal(isPasswordRecoveryIdentityMatch('user-1', 'user-1', 'user-1'), true)
  assert.equal(isPasswordRecoveryIdentityMatch('user-1', 'user-2', 'user-1'), false)
  assert.equal(isPasswordRecoveryIdentityMatch('user-1', 'user-1', 'user-2'), false)
  assert.equal(isPasswordRecoveryIdentityMatch('user-1', null, 'user-1'), false)
})
test('recognizes recovery only from the signed authentication-method claim', () => {
  const recoveryClaims = {
    amr: [
      { method: 'otp', timestamp: 1 },
      { method: 'recovery', timestamp: 2 },
    ],
  }

  assert.equal(hasPasswordRecoveryAuthenticationMethod(recoveryClaims), true)
  assert.equal(isPasswordRecoveryAccessToken(unsignedToken(recoveryClaims)), true)
  assert.equal(isPasswordRecoveryAccessToken(unsignedToken({ amr: [{ method: 'password' }] })), false)
  assert.equal(isPasswordRecoveryAccessToken('not-a-jwt'), false)
  assert.equal(isPasswordRecoveryAccessToken('x'.repeat((16 * 1024) + 1)), false)
})
