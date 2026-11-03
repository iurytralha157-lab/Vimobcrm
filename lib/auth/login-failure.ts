export type LoginFailure = 'credentials' | 'rate_limited' | 'unavailable';

/**
 * Credentials and unconfirmed accounts stay indistinguishable. Rate limits and
 * unavailable services say nothing about the account, so they can be explained.
 */
export function classifyLoginFailure(error: unknown): LoginFailure {
  const { status, code, name } = (error && typeof error === 'object' ? error : {}) as {
    status?: unknown;
    code?: unknown;
    name?: unknown;
  };

  if (status === 429 || code === 'over_request_rate_limit') return 'rate_limited';
  if (name === 'AuthRetryableFetchError' || status === 0 || (typeof status === 'number' && status >= 500)) {
    return 'unavailable';
  }
  return 'credentials';
}
