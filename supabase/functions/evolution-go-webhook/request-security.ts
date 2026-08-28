import { constantTimeTextEqual } from "../_shared/asaas-webhook.ts";
import {
  authorizePrivateWorkerRequest,
  type PrivateWorkerAuthEnvironment,
} from "../_shared/private-worker-auth.ts";

export const EVOLUTION_WEBHOOK_MAX_BODY_BYTES = 32 * 1024 * 1024;

const RECOGNIZED_CREDENTIAL_HEADERS = [
  "x-webhook-secret",
  "x-webhook-token",
  "x-evolution-webhook-token",
  "apikey",
  "x-api-key",
  "authorization",
] as const;

const CALLBACK_GLOBAL_CREDENTIAL_HEADERS = [
  "x-webhook-secret",
  "apikey",
  "x-api-key",
] as const;
const INTERNAL_FORBIDDEN_CREDENTIAL_HEADERS = [
  "x-webhook-secret",
  "x-api-key",
  "x-evolution-webhook-token",
] as const;
const FORBIDDEN_QUERY_CREDENTIALS = new Set([
  "apikey",
  "authorization",
  "bearer",
  "clientsecret",
  "signature",
  "token",
  "accesstoken",
  "instancetoken",
  "providerapikey",
  "webhooksecret",
  "webhooktoken",
  "xapikey",
  "xevolutionwebhooktoken",
  "xwebhooksecret",
  "xwebhooktoken",
]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type EvolutionGoWebhookIngressEnvironment = {
  privateWorker: PrivateWorkerAuthEnvironment;
  webhookSecret?: string | null;
  providerApiKey?: string | null;
};

export type EvolutionGoWebhookAuthorization =
  | {
    authorized: true;
    contract:
      | "internal_worker_lease"
      | "dedicated_secret"
      | "provider_api_key_fallback";
  }
  | {
    authorized: false;
    reason:
      | "query_credential_forbidden"
      | "invalid_internal_contract"
      | "missing_server_secret"
      | "missing_credential"
      | "invalid_credential"
      | "missing_session_token";
  };

export type EvolutionGoSessionIdentity = {
  id?: unknown;
  provider?: unknown;
  instance_id?: unknown;
  instance_name?: unknown;
  provider_instance_id?: unknown;
  name?: unknown;
  advanced_settings?: { webhook_token?: unknown } | null;
};

export type EvolutionGoSessionSignals = {
  sessionIds?: unknown[];
  instanceIds?: unknown[];
  instanceNames?: unknown[];
};

export type EvolutionGoSessionBinding =
  | { valid: true }
  | {
    valid: false;
    reason:
      | "session_mismatch"
      | "provider_mismatch"
      | "missing_session_token"
      | "invalid_session_token"
      | "missing_instance_signal"
      | "instance_mismatch";
  };

/**
 * Authenticates the ingress before the request body or a privileged client is
 * touched. The durable Go worker has a deliberately exact service contract;
 * direct callbacks need a global secret as well as a session-scoped token.
 */
export function authorizeEvolutionGoWebhookIngress(
  request: Request,
  environment: EvolutionGoWebhookIngressEnvironment,
): EvolutionGoWebhookAuthorization {
  const requestUrl = new URL(request.url);
  if (hasCredentialInQuery(requestUrl)) {
    return { authorized: false, reason: "query_credential_forbidden" };
  }

  if (authorizePrivateWorkerRequest(request, environment.privateWorker)) {
    const apiKey = normalizedSecret(request.headers.get("apikey"));
    const sessionToken = normalizedSecret(
      request.headers.get("x-webhook-token"),
    );
    const sessionId = normalizedSecret(
      requestUrl.searchParams.get("session_id"),
    );
    const instanceId = normalizedSecret(
      requestUrl.searchParams.get("instance_id"),
    );
    const authorization = request.headers.get("authorization");
    const bearer = readBearer(authorization);
    const forbiddenHeader = INTERNAL_FORBIDDEN_CREDENTIAL_HEADERS.some((name) =>
      request.headers.has(name)
    );
    const bearerConflict = authorization !== null &&
      (!bearer || !apiKey || !constantTimeTextEqual(bearer, apiKey));

    // This is the exact contract emitted by forwardEvolutionWebhook: apikey,
    // optional same-value legacy Bearer, scoped token, and UUID session route.
    if (
      !apiKey || !sessionToken || !UUID_PATTERN.test(sessionId) ||
      !instanceId || forbiddenHeader || bearerConflict
    ) {
      return { authorized: false, reason: "invalid_internal_contract" };
    }

    return { authorized: true, contract: "internal_worker_lease" };
  }

  const expectedSecret = normalizedSecret(environment.webhookSecret) ||
    normalizedSecret(environment.providerApiKey);
  if (!expectedSecret) {
    return { authorized: false, reason: "missing_server_secret" };
  }

  const credentials = readCallbackGlobalCredentials(request.headers);
  if (!credentials.valid || credentials.values.length === 0) {
    return {
      authorized: false,
      reason: credentials.valid ? "missing_credential" : "invalid_credential",
    };
  }
  if (!allConstantTimeEqual(expectedSecret, credentials.values)) {
    return { authorized: false, reason: "invalid_credential" };
  }

  const sessionTokens = readSessionTokens(request.headers);
  if (!sessionTokens.valid || sessionTokens.values.length === 0) {
    return {
      authorized: false,
      reason: sessionTokens.valid
        ? "missing_session_token"
        : "invalid_credential",
    };
  }

  return {
    authorized: true,
    contract: normalizedSecret(environment.webhookSecret)
      ? "dedicated_secret"
      : "provider_api_key_fallback",
  };
}

/** Binds an authenticated request to exactly one Evolution Go session. */
export function validateEvolutionGoSessionBinding(
  request: Request,
  session: EvolutionGoSessionIdentity,
  signals: EvolutionGoSessionSignals,
): EvolutionGoSessionBinding {
  const sessionId = normalizedSecret(
    typeof session.id === "string" ? session.id : "",
  );
  const suppliedSessionIds = normalizedValues(signals.sessionIds);
  if (
    !sessionId || suppliedSessionIds.some((value) => value !== sessionId)
  ) {
    return { valid: false, reason: "session_mismatch" };
  }
  if (normalizedSecret(String(session.provider || "")) !== "evolution_go") {
    return { valid: false, reason: "provider_mismatch" };
  }

  const expectedSessionToken = normalizedSecret(
    typeof session.advanced_settings?.webhook_token === "string"
      ? session.advanced_settings.webhook_token
      : "",
  );
  if (!expectedSessionToken) {
    return { valid: false, reason: "missing_session_token" };
  }
  const suppliedTokens = readSessionTokens(request.headers);
  if (
    !suppliedTokens.valid || suppliedTokens.values.length === 0 ||
    !allConstantTimeEqual(expectedSessionToken, suppliedTokens.values)
  ) {
    return { valid: false, reason: "invalid_session_token" };
  }

  const expectedInstances = new Set(normalizedValues([
    session.instance_id,
    session.instance_name,
    session.provider_instance_id,
    session.name,
  ]));
  const suppliedInstances = normalizedValues([
    ...(signals.instanceIds || []),
    ...(signals.instanceNames || []),
  ]);
  if (suppliedInstances.length === 0) {
    return { valid: false, reason: "missing_instance_signal" };
  }
  if (
    expectedInstances.size === 0 ||
    suppliedInstances.some((value) => !expectedInstances.has(value))
  ) {
    return { valid: false, reason: "instance_mismatch" };
  }

  return { valid: true };
}

export type WebhookRequestBodyErrorCode =
  | "webhook_body_too_large"
  | "invalid_webhook_body";

export class WebhookRequestBodyError extends Error {
  readonly code: WebhookRequestBodyErrorCode;
  readonly status: 400 | 413;

  constructor(
    code: WebhookRequestBodyErrorCode,
    status: 400 | 413,
    message: string,
  ) {
    super(message);
    this.name = "WebhookRequestBodyError";
    this.code = code;
    this.status = status;
  }
}

export function hasRecognizedWebhookCredential(headers: Headers) {
  for (const name of RECOGNIZED_CREDENTIAL_HEADERS) {
    const value = headers.get(name)?.trim() || "";
    if (!value) continue;

    if (name === "authorization") {
      if (/^Bearer\s*$/i.test(value)) continue;
    }

    return true;
  }
  return false;
}

function hasCredentialInQuery(url: URL) {
  for (const key of url.searchParams.keys()) {
    const normalized = key.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    if (FORBIDDEN_QUERY_CREDENTIALS.has(normalized)) return true;
  }
  return false;
}

function readCallbackGlobalCredentials(headers: Headers) {
  const values: string[] = [];
  for (const name of CALLBACK_GLOBAL_CREDENTIAL_HEADERS) {
    if (!headers.has(name)) continue;
    const value = normalizedSecret(headers.get(name));
    if (!value) return { valid: false, values: [] as string[] };
    values.push(value);
  }

  if (headers.has("authorization")) {
    const bearer = readBearer(headers.get("authorization"));
    if (!bearer) return { valid: false, values: [] as string[] };
    values.push(bearer);
  }
  return { valid: true, values: [...new Set(values)] };
}

function readSessionTokens(headers: Headers) {
  const values: string[] = [];
  for (const name of ["x-webhook-token", "x-evolution-webhook-token"] as const) {
    if (!headers.has(name)) continue;
    const value = normalizedSecret(headers.get(name));
    if (!value) return { valid: false, values: [] as string[] };
    values.push(value);
  }
  return { valid: true, values: [...new Set(values)] };
}

function readBearer(value: string | null) {
  if (value === null) return "";
  return value.match(/^Bearer\s+([^\s]+)$/i)?.[1]?.trim() || "";
}

function normalizedValues(values: unknown[] | undefined) {
  return [...new Set((values || []).map((value) =>
    normalizedSecret(typeof value === "string" ? value : "")
  ).filter(Boolean))];
}

function normalizedSecret(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function allConstantTimeEqual(expected: string, candidates: string[]) {
  let matched = 1;
  for (const candidate of candidates) {
    matched &= constantTimeTextEqual(expected, candidate) ? 1 : 0;
  }
  return matched === 1;
}

export async function readBoundedJsonBody<T = unknown>(
  request: Request,
  maxBytes = EVOLUTION_WEBHOOK_MAX_BODY_BYTES,
): Promise<T> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new RangeError("maxBytes must be a positive safe integer");
  }

  const declaredLength = parseDeclaredContentLength(
    request.headers.get("content-length"),
  );
  if (declaredLength !== null && declaredLength > maxBytes) {
    throw bodyTooLargeError();
  }

  if (!request.body) {
    throw invalidBodyError();
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;

      if (receivedBytes + value.byteLength > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // The size violation is authoritative even if stream cancellation fails.
        }
        throw bodyTooLargeError();
      }

      chunks.push(value);
      receivedBytes += value.byteLength;
    }
  } catch (error) {
    if (error instanceof WebhookRequestBodyError) throw error;
    throw invalidBodyError();
  } finally {
    reader.releaseLock();
  }

  const raw = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    raw.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
    return JSON.parse(text) as T;
  } catch {
    throw invalidBodyError();
  }
}

function parseDeclaredContentLength(value: string | null) {
  if (!value || !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function bodyTooLargeError() {
  return new WebhookRequestBodyError(
    "webhook_body_too_large",
    413,
    "Webhook body is too large",
  );
}

function invalidBodyError() {
  return new WebhookRequestBodyError(
    "invalid_webhook_body",
    400,
    "Webhook body must be valid JSON",
  );
}
