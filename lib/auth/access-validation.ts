import { runAuthOperationWithTimeout } from './frontend-auth-reliability';

export type AccessValidationFailure = 'session' | 'transient' | 'denied';

const SESSION_ERROR_CODES = new Set(['unauthorized', 'missing_session', 'session_missing', 'session_revoked']);
const SESSION_ERROR_MESSAGE = /invalid or expired bearer token|sess[aã]o expirada|missing bearer token/i;
const TRANSIENT_STATUS_CODES = new Set([0, 408, 425, 429]);

type ErrorFields = { status?: unknown; code?: unknown; message?: unknown };

function readErrorFields(error: unknown): ErrorFields {
  return error && typeof error === 'object' ? error as ErrorFields : {};
}

/** Separates "the check failed" from "the check answered that access is gone". */
export function classifyAccessValidationFailure(error: unknown): AccessValidationFailure {
  const { status, code, message } = readErrorFields(error);

  if (status === 401 || (typeof code === 'string' && SESSION_ERROR_CODES.has(code))) return 'session';
  if (typeof status === 'number') {
    return TRANSIENT_STATUS_CODES.has(status) || status >= 500 ? 'transient' : 'denied';
  }
  return SESSION_ERROR_MESSAGE.test(typeof message === 'string' ? message : String(error ?? ''))
    ? 'session'
    : 'transient';
}

const ENDED_SESSION_CODES = new Set([
  'session_not_found',
  'refresh_token_not_found',
  'refresh_token_already_used',
  'user_not_found',
]);
const AUTH_SESSION_CHECK_WAIT_MS = 5_000;

/** Only the Auth service can say that a session ended; other outcomes stay undecided. */
export function isEndedAuthSessionError(error: unknown) {
  // A bare 401/403 can come from the gateway or a bad key, not from this session.
  const { code } = readErrorFields(error);
  const name = error && typeof error === 'object' ? (error as { name?: unknown }).name : undefined;
  return name === 'AuthSessionMissingError'
    || (typeof code === 'string' && ENDED_SESSION_CODES.has(code));
}

/**
 * The API answers 401 for any token verification failure, including JWKS or
 * configuration problems. Ask Auth before treating that answer as a dead session.
 */
export async function confirmSessionFailure(
  failure: AccessValidationFailure,
  checkAuthSession: () => PromiseLike<{ error: unknown }>,
  waitMs = AUTH_SESSION_CHECK_WAIT_MS,
): Promise<AccessValidationFailure> {
  if (failure !== 'session') return failure;
  const check = await runAuthOperationWithTimeout(checkAuthSession, waitMs);
  if (check.status !== 'completed') return 'transient';
  return isEndedAuthSessionError(check.value.error) ? 'session' : 'transient';
}
