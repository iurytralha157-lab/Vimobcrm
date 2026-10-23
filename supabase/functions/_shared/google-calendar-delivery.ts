export const GOOGLE_CALENDAR_REQUEST_TIMEOUT_MS = 20_000;

export class GoogleCalendarRetryableError extends Error {
  constructor(message: string, public status = 0, public retryAfterSeconds: number | null = null) {
    super(message);
    this.name = "GoogleCalendarRetryableError";
  }
}

export class GoogleCalendarLeaseLostError extends Error {
  constructor() {
    super("Google Agenda worker lease is no longer owned.");
    this.name = "GoogleCalendarLeaseLostError";
  }
}

export class GoogleCalendarVersionChangedError extends Error {
  constructor() {
    super("Compromisso atualizado durante o envio; a versao atual sera reenviada.");
    this.name = "GoogleCalendarVersionChangedError";
  }
}

export class GoogleCalendarConnectionChangedError extends Error {
  constructor() {
    super("A conexao Google mudou durante a autorizacao. Inicie a conexao novamente.");
    this.name = "GoogleCalendarConnectionChangedError";
  }
}

export function assertGoogleCalendarOAuthReady(token: Record<string, unknown>) {
  const scopes = new Set(String(token.scope || "").split(/\s+/).filter(Boolean));
  if (!scopes.has("https://www.googleapis.com/auth/calendar.events.owned") &&
    !scopes.has("https://www.googleapis.com/auth/calendar.events") &&
    !scopes.has("https://www.googleapis.com/auth/calendar")) {
    throw new Error("Permissao do Google Agenda nao concedida. Reconecte e autorize a Agenda.");
  }
  if (typeof token.access_token !== "string" || !token.access_token.trim() ||
    typeof token.refresh_token !== "string" || !token.refresh_token.trim()) {
    throw new Error("Autorizacao offline do Google ausente. Reconecte a conta com consentimento.");
  }
}

export function googleCalendarRetryAfter(value: string | null, now = Date.now()) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(86_400, Math.ceil(seconds));
  const deadline = Date.parse(value);
  return Number.isNaN(deadline) ? null : Math.min(86_400, Math.max(0, Math.ceil((deadline - now) / 1000)));
}

export function googleCalendarErrorStatus(status: number, body: unknown) {
  if (status !== 403 || !body || typeof body !== "object") return status;
  const detail = (body as Record<string, unknown>).error;
  if (!detail || typeof detail !== "object") return status;
  const errors = (detail as Record<string, unknown>).errors;
  return Array.isArray(errors) && errors.some((item: unknown) => item && typeof item === "object" &&
    ["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded"].includes(
      String((item as Record<string, unknown>).reason))) ? 429 : status;
}

export function googleCalendarRetryPolicy(error: unknown, attempts: number, random = Math.random) {
  const status = error instanceof GoogleCalendarRetryableError ? error.status : 0;
  // 412 means another writer advanced the remote version. Read both versions
  // again on the next attempt; never repeat the stale payload in this request.
  const retryable = status === 0 || status === 408 || status === 412 || status === 429 || status >= 500;
  const jittered = Math.ceil(Math.min(3600, 30 * 2 ** Math.min(Math.max(0, attempts - 1), 7)) * (0.5 + random()));
  const retryAfter = error instanceof GoogleCalendarRetryableError ? error.retryAfterSeconds : null;
  return { retryable, delaySeconds: Math.max(10, jittered, retryAfter || 0) };
}

export function googleCalendarFetchWithDeadline(input: string | URL | Request, init: RequestInit = {}) {
  const deadline = AbortSignal.timeout(GOOGLE_CALENDAR_REQUEST_TIMEOUT_MS);
  return fetch(input, {
    ...init,
    signal: init.signal ? AbortSignal.any([init.signal, deadline]) : deadline,
  });
}
