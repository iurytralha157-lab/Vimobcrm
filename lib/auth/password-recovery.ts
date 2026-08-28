const RECOVERY_INTENT_STORAGE_KEY = 'vimob:password-recovery:intent:v1'
const RECOVERY_PROOF_STORAGE_KEY = 'vimob:password-recovery:proof:v1'
const RECOVERY_EVIDENCE_TTL_MS = 15 * 60 * 1000
const RECOVERY_CODE_MAX_LENGTH = 4 * 1024
const RECOVERY_TOKEN_HASH_MAX_LENGTH = 4 * 1024
const RECOVERY_SESSION_TOKEN_MAX_LENGTH = 16 * 1024
const UNSAFE_RECOVERY_VALUE = /[\u0000-\u001f\u007f]/

export type PasswordRecoveryUrlEvidence =
  | { kind: 'pkce'; code: string }
  | { kind: 'token_hash'; tokenHash: string }
  | { kind: 'implicit'; accessToken: string; refreshToken: string }
  | { kind: 'none' }

type RecoveryIntent = {
  kind: Exclude<PasswordRecoveryUrlEvidence['kind'], 'none'>
  capturedAt: number
}

type RecoveryProof = RecoveryIntent & {
  userId: string
}

export type PasswordRecoveryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

type AuthenticationMethodReference = {
  method?: unknown
}

type AuthenticationMethodClaims = {
  amr?: unknown
}

function normalizeRecoveryPath(pathname: string) {
  const normalized = pathname.replace(/\/+$/, '')
  return normalized || '/'
}

function parseHashParams(hash: string) {
  return new URLSearchParams(hash.replace(/^#/, ''))
}

function readSingleRecoveryValue(
  params: URLSearchParams,
  key: string,
  maxLength: number,
) {
  const values = params.getAll(key)
  if (values.length !== 1) return null

  const value = values[0]?.trim() || ''
  if (!value || value.length > maxLength || UNSAFE_RECOVERY_VALUE.test(value)) {
    return null
  }
  return value
}

function hasRecoveryCredential(params: URLSearchParams) {
  return params.has('code')
    || params.has('token_hash')
    || params.has('access_token')
    || params.has('refresh_token')
}

export function hasPasswordRecoveryAuthenticationMethod(claims: unknown) {
  if (!claims || typeof claims !== 'object') return false

  const { amr } = claims as AuthenticationMethodClaims
  return Array.isArray(amr) && amr.some((entry) => (
    Boolean(entry)
    && typeof entry === 'object'
    && (entry as AuthenticationMethodReference).method === 'recovery'
  ))
}

export function readAccessTokenClaims(accessToken: string) {
  const token = accessToken.trim()
  if (!token || token.length > RECOVERY_SESSION_TOKEN_MAX_LENGTH) return null
  const payload = token.split('.')[1]
  if (!payload) return null

  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
    const binary = globalThis.atob(padded)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    const parsed = JSON.parse(new TextDecoder().decode(bytes))
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

export function isPasswordRecoveryAccessToken(accessToken: string | null | undefined) {
  return Boolean(
    accessToken
    && hasPasswordRecoveryAuthenticationMethod(readAccessTokenClaims(accessToken)),
  )
}
export function readPasswordRecoveryUrlEvidence(url: URL): PasswordRecoveryUrlEvidence {
  if (normalizeRecoveryPath(url.pathname) !== '/reset-password') {
    return { kind: 'none' }
  }

  const hashParams = parseHashParams(url.hash)
  const hasQueryCode = url.searchParams.has('code')
  const hasQueryTokenHash = url.searchParams.has('token_hash')
  const hasImplicitCredential = hasRecoveryCredential(hashParams)

  // Never guess which credential should win when a URL contains conflicting
  // recovery formats. This also rejects duplicate credentials because each
  // accepted field is read through getAll below.
  if (
    (hasQueryCode && hasQueryTokenHash)
    || ((hasQueryCode || hasQueryTokenHash) && hasImplicitCredential)
  ) {
    return { kind: 'none' }
  }

  if (hasQueryCode) {
    const code = readSingleRecoveryValue(
      url.searchParams,
      'code',
      RECOVERY_CODE_MAX_LENGTH,
    )
    if (!code) return { kind: 'none' }
    return { kind: 'pkce', code }
  }

  if (hasQueryTokenHash) {
    const tokenHash = readSingleRecoveryValue(
      url.searchParams,
      'token_hash',
      RECOVERY_TOKEN_HASH_MAX_LENGTH,
    )
    const type = readSingleRecoveryValue(url.searchParams, 'type', 32)
    if (!tokenHash || type !== 'recovery') return { kind: 'none' }
    return { kind: 'token_hash', tokenHash }
  }

  if (hasImplicitCredential) {
    const accessToken = readSingleRecoveryValue(
      hashParams,
      'access_token',
      RECOVERY_SESSION_TOKEN_MAX_LENGTH,
    )
    const refreshToken = readSingleRecoveryValue(
      hashParams,
      'refresh_token',
      RECOVERY_SESSION_TOKEN_MAX_LENGTH,
    )
    const type = readSingleRecoveryValue(hashParams, 'type', 32)
    if (!accessToken || !refreshToken || type !== 'recovery') {
      return { kind: 'none' }
    }
    return { kind: 'implicit', accessToken, refreshToken }
  }

  return { kind: 'none' }
}

function safeRead<T>(storage: PasswordRecoveryStorage, key: string): T | null {
  try {
    const value = storage.getItem(key)
    return value ? JSON.parse(value) as T : null
  } catch {
    return null
  }
}

function safeWrite(storage: PasswordRecoveryStorage, key: string, value: unknown) {
  try {
    storage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

function safeRemove(storage: PasswordRecoveryStorage, key: string) {
  try {
    storage.removeItem(key)
  } catch {
    // Storage can be disabled by browser privacy settings. The active flow can
    // still complete from the URL/event; it just cannot survive a reload.
  }
}

function isFresh(timestamp: unknown, now: number) {
  return typeof timestamp === 'number'
    && timestamp <= now
    && now - timestamp <= RECOVERY_EVIDENCE_TTL_MS
}

export function capturePasswordRecoveryIntent(
  storage: PasswordRecoveryStorage,
  url: URL,
  now = Date.now(),
) {
  const evidence = readPasswordRecoveryUrlEvidence(url)
  if (evidence.kind === 'none') return false

  safeRemove(storage, RECOVERY_PROOF_STORAGE_KEY)
  return safeWrite(storage, RECOVERY_INTENT_STORAGE_KEY, {
    kind: evidence.kind,
    capturedAt: now,
  } satisfies RecoveryIntent)
}

export function grantPasswordRecoveryProof(
  storage: PasswordRecoveryStorage,
  userId: string,
  now = Date.now(),
) {
  const normalizedUserId = userId.trim()
  const intent = safeRead<RecoveryIntent>(storage, RECOVERY_INTENT_STORAGE_KEY)

  if (!normalizedUserId || !intent || !isFresh(intent.capturedAt, now)) {
    if (intent && !isFresh(intent.capturedAt, now)) {
      clearPasswordRecoveryEvidence(storage)
    }
    return false
  }

  const written = safeWrite(storage, RECOVERY_PROOF_STORAGE_KEY, {
    ...intent,
    userId: normalizedUserId,
  } satisfies RecoveryProof)

  if (written) {
    safeRemove(storage, RECOVERY_INTENT_STORAGE_KEY)
  }
  return written
}

export function hasPasswordRecoveryProof(
  storage: PasswordRecoveryStorage,
  userId: string,
  now = Date.now(),
) {
  const proof = safeRead<RecoveryProof>(storage, RECOVERY_PROOF_STORAGE_KEY)
  const normalizedUserId = userId.trim()

  if (!proof || !isFresh(proof.capturedAt, now)) {
    if (proof) clearPasswordRecoveryEvidence(storage)
    return false
  }

  return Boolean(normalizedUserId && proof.userId === normalizedUserId)
}

export function isPasswordRecoveryIdentityMatch(
  expectedUserId: string | null | undefined,
  authenticatedUserId: string | null | undefined,
  sessionUserId: string | null | undefined,
) {
  const expected = expectedUserId?.trim()
  return Boolean(
    expected
    && authenticatedUserId?.trim() === expected
    && sessionUserId?.trim() === expected,
  )
}

export function clearPasswordRecoveryEvidence(storage: PasswordRecoveryStorage) {
  safeRemove(storage, RECOVERY_INTENT_STORAGE_KEY)
  safeRemove(storage, RECOVERY_PROOF_STORAGE_KEY)
}
