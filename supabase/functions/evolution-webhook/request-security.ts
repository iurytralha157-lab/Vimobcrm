import {
  authorizePrivateWorkerRequest,
  type PrivateWorkerAuthEnvironment,
} from "../_shared/private-worker-auth.ts";

const CALLBACK_GLOBAL_CREDENTIAL_HEADERS = [
  "x-webhook-secret",
  "apikey",
  "x-api-key",
] as const;

export type EvolutionWebhookAuthorization =
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
      | "missing_server_secret"
      | "missing_credential"
      | "missing_session_token"
      | "invalid_credential"
      | "invalid_internal_contract";
  };

export type EvolutionWebhookSecretEnvironment = {
  webhookSecret?: string | null;
  providerApiKey?: string | null;
};

export type EvolutionWebhookIngressEnvironment =
  EvolutionWebhookSecretEnvironment & {
    privateWorker: PrivateWorkerAuthEnvironment;
  };

type EvolutionWebhookSessionIdentity = {
  id?: unknown;
  provider?: unknown;
  instance_id?: unknown;
  instance_name?: unknown;
  provider_instance_id?: unknown;
  name?: unknown;
  advanced_settings?: { webhook_token?: unknown } | null;
};

export type EvolutionInternalSessionBinding =
  | { valid: true }
  | {
    valid: false;
    reason:
      | "missing_session_id"
      | "session_mismatch"
      | "provider_mismatch"
      | "missing_session_token"
      | "invalid_session_token"
      | "instance_mismatch";
  };

export type EvolutionCallbackSessionTokenBinding =
  | { valid: true }
  | {
    valid: false;
    reason: "missing_session_token" | "invalid_session_token";
  };

const INTERNAL_FORBIDDEN_CREDENTIAL_HEADERS = [
  "x-webhook-secret",
  "x-evolution-webhook-token",
  "x-api-key",
] as const;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Distinguishes the durable Go worker from a direct provider callback before
 * reading the request body or creating a privileged client. The legacy
 * evolution-webhook handler rejects the recognized worker contract early; the
 * classification exists so it cannot fall through to direct-callback auth.
 */
export async function authorizeEvolutionWebhookIngressRequest(
  request: Request,
  environment: EvolutionWebhookIngressEnvironment,
): Promise<EvolutionWebhookAuthorization> {
  if (authorizePrivateWorkerRequest(request, environment.privateWorker)) {
    const apiKey = normalizeSecret(request.headers.get("apikey"));
    const sessionToken = normalizeSecret(
      request.headers.get("x-webhook-token"),
    );
    const requestUrl = new URL(request.url);
    const requestedSessionId = normalizeSecret(
      requestUrl.searchParams.get("session_id"),
    );
    const requestedInstanceId = normalizeSecret(
      requestUrl.searchParams.get("instance_id"),
    );
    const authorizationHeader = request.headers.get("authorization");
    const bearer = authorizationHeader?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ||
      "";

    const hasForbiddenCredential = INTERNAL_FORBIDDEN_CREDENTIAL_HEADERS.some(
      (name) => request.headers.has(name),
    );
    const bearerConflicts = authorizationHeader !== null &&
      (!bearer || !apiKey || !(await constantTimeSecretEqual(apiKey, bearer)));

    // `forwardEvolutionWebhook` always sends apikey plus the scoped session
    // token. It adds the same legacy JWT as Bearer when applicable. Reject
    // partial or conflicting variants instead of downgrading to callback auth.
    if (
      !apiKey || !sessionToken || !UUID_PATTERN.test(requestedSessionId) ||
      !requestedInstanceId || hasForbiddenCredential || bearerConflicts
    ) {
      return { authorized: false, reason: "invalid_internal_contract" };
    }

    return { authorized: true, contract: "internal_worker_lease" };
  }

  return authorizeEvolutionWebhookRequest(request.headers, environment);
}

/** Validates the second, session-scoped credential after session resolution. */
export async function validateEvolutionCallbackSessionToken(
  headers: Headers,
  session: EvolutionWebhookSessionIdentity,
): Promise<EvolutionCallbackSessionTokenBinding> {
  const expectedToken = normalizeSecret(
    typeof session.advanced_settings?.webhook_token === "string"
      ? session.advanced_settings.webhook_token
      : "",
  );
  if (!expectedToken) {
    return { valid: false, reason: "missing_session_token" };
  }

  const supplied = readSessionTokens(headers);
  if (!supplied.valid || supplied.values.length === 0) {
    return { valid: false, reason: "invalid_session_token" };
  }
  for (const token of supplied.values) {
    if (!(await constantTimeSecretEqual(expectedToken, token))) {
      return { valid: false, reason: "invalid_session_token" };
    }
  }
  return { valid: true };
}

/**
 * Binds a service-authenticated worker invocation to the session lease encoded
 * by `forwardEvolutionWebhook`. This check intentionally happens only after a
 * session has been resolved by the query UUID.
 */
export async function validateEvolutionInternalSessionBinding(
  request: Request,
  session: EvolutionWebhookSessionIdentity,
  payloadInstance: unknown,
): Promise<EvolutionInternalSessionBinding> {
  const url = new URL(request.url);
  const requestedSessionId = normalizeSecret(url.searchParams.get("session_id"));
  const sessionId = normalizeSecret(
    typeof session.id === "string" ? session.id : "",
  );
  if (!requestedSessionId) {
    return { valid: false, reason: "missing_session_id" };
  }
  if (!sessionId || requestedSessionId !== sessionId) {
    return { valid: false, reason: "session_mismatch" };
  }
  const provider = normalizeSecret(String(session.provider || ""));
  if (provider !== "evolution" && provider !== "evolution_go") {
    return { valid: false, reason: "provider_mismatch" };
  }

  const expectedToken = normalizeSecret(
    typeof session.advanced_settings?.webhook_token === "string"
      ? session.advanced_settings.webhook_token
      : "",
  );
  const incomingToken = normalizeSecret(
    request.headers.get("x-webhook-token"),
  );
  if (!expectedToken) {
    return { valid: false, reason: "missing_session_token" };
  }
  if (!(await constantTimeSecretEqual(expectedToken, incomingToken))) {
    return { valid: false, reason: "invalid_session_token" };
  }

  const expectedInstances = new Set(
    [
      session.instance_id,
      session.instance_name,
      session.provider_instance_id,
      session.name,
    ]
      .map((value) => normalizeSecret(typeof value === "string" ? value : ""))
      .filter(Boolean),
  );
  const suppliedInstances = [
    url.searchParams.get("instance_id"),
    typeof payloadInstance === "string" ? payloadInstance : "",
  ]
    .map(normalizeSecret)
    .filter(Boolean);
  if (
    expectedInstances.size === 0 || suppliedInstances.length === 0 ||
    suppliedInstances.some((value) => !expectedInstances.has(value))
  ) {
    return { valid: false, reason: "instance_mismatch" };
  }

  return { valid: true };
}

/**
 * Authenticate the legacy Evolution callback without touching its body or any
 * privileged client. A dedicated webhook secret wins. The provider API key is
 * only a compatibility fallback for installations created before per-webhook
 * headers were configured.
 */
export async function authorizeEvolutionWebhookRequest(
  headers: Headers,
  environment: EvolutionWebhookSecretEnvironment,
): Promise<EvolutionWebhookAuthorization> {
  const dedicatedSecret = normalizeSecret(environment.webhookSecret);
  const providerApiKey = normalizeSecret(environment.providerApiKey);
  const expectedSecret = dedicatedSecret || providerApiKey;

  if (!expectedSecret) {
    return { authorized: false, reason: "missing_server_secret" };
  }

  const credentials = readSuppliedCredentials(headers);
  if (!credentials.valid || credentials.values.length === 0) {
    return {
      authorized: false,
      reason: credentials.valid ? "missing_credential" : "invalid_credential",
    };
  }

  // Every credential-bearing header must agree. This prevents a valid header
  // from masking a conflicting credential supplied through another header.
  for (const credential of credentials.values) {
    if (!(await constantTimeSecretEqual(expectedSecret, credential))) {
      return { authorized: false, reason: "invalid_credential" };
    }
  }

  const sessionTokens = readSessionTokens(headers);
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
    contract: dedicatedSecret ? "dedicated_secret" : "provider_api_key_fallback",
  };
}

function readSuppliedCredentials(headers: Headers) {
  const values: string[] = [];

  for (const headerName of CALLBACK_GLOBAL_CREDENTIAL_HEADERS) {
    const value = normalizeSecret(headers.get(headerName));
    if (value) values.push(value);
  }

  const authorization = headers.get("authorization")?.trim() || "";
  if (authorization) {
    const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
    if (!bearer) return { valid: false, values: [] as string[] };
    values.push(bearer);
  }

  return { valid: true, values: [...new Set(values)] };
}

function readSessionTokens(headers: Headers) {
  const values: string[] = [];
  for (const headerName of ["x-webhook-token", "x-evolution-webhook-token"] as const) {
    if (!headers.has(headerName)) continue;
    const value = normalizeSecret(headers.get(headerName));
    if (!value) return { valid: false, values: [] as string[] };
    values.push(value);
  }
  return { valid: true, values: [...new Set(values)] };
}

function normalizeSecret(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

async function constantTimeSecretEqual(expected: string, actual: string) {
  const encoder = new TextEncoder();
  const [expectedHash, actualHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
    crypto.subtle.digest("SHA-256", encoder.encode(actual)),
  ]);
  const expectedBytes = new Uint8Array(expectedHash);
  const actualBytes = new Uint8Array(actualHash);
  let difference = expectedBytes.length ^ actualBytes.length;

  for (let index = 0; index < expectedBytes.length; index += 1) {
    difference |= expectedBytes[index] ^ actualBytes[index];
  }

  return difference === 0;
}
