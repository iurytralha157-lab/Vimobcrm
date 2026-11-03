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
