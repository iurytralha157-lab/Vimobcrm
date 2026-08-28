import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizeEvolutionWebhookIngressRequest,
  authorizeEvolutionWebhookRequest,
  validateEvolutionCallbackSessionToken,
  validateEvolutionInternalSessionBinding,
} from "./request-security.ts";

const internalApiKey = "sb_secret_internal_worker_0123456789abcdef";
const legacyServiceRole =
  "legacyHeader0123456789.legacyPayload0123456789.legacySignature0123456789";
const sessionId = "13eea7e8-a74f-4bfb-bb36-024e3d26ccc9";

function internalRequest(
  headers: Record<string, string>,
  query = `session_id=${sessionId}&instance_id=instance-1`,
) {
  return new Request(`https://example.test/evolution-webhook?${query}`, {
    method: "POST",
    headers,
  });
}

test("authorizes the dedicated secret through every supported legacy provider header", async () => {
  for (const [name, value] of [
    ["x-webhook-secret", "dedicated-secret"],
    ["apikey", "dedicated-secret"],
    ["x-api-key", "dedicated-secret"],
    ["authorization", "Bearer dedicated-secret"],
  ]) {
    const authorization = await authorizeEvolutionWebhookRequest(
      new Headers({ [name]: value, "x-webhook-token": "session-secret" }),
      { webhookSecret: "dedicated-secret", providerApiKey: "provider-key" },
    );
    assert.deepEqual(authorization, {
      authorized: true,
      contract: "dedicated_secret",
    });
  }
});

test("uses the private provider API key only when no dedicated secret exists", async () => {
  assert.deepEqual(
    await authorizeEvolutionWebhookRequest(
      new Headers({ apikey: "provider-key", "x-webhook-token": "session-secret" }),
      { providerApiKey: "provider-key" },
    ),
    { authorized: true, contract: "provider_api_key_fallback" },
  );

  assert.deepEqual(
    await authorizeEvolutionWebhookRequest(
      new Headers({ apikey: "provider-key", "x-webhook-token": "session-secret" }),
      { webhookSecret: "dedicated-secret", providerApiKey: "provider-key" },
    ),
    { authorized: false, reason: "invalid_credential" },
  );
});

test("fails closed when the server secret, request credential or bearer value is absent", async () => {
  assert.deepEqual(
    await authorizeEvolutionWebhookRequest(new Headers(), {}),
    { authorized: false, reason: "missing_server_secret" },
  );
  assert.deepEqual(
    await authorizeEvolutionWebhookRequest(
      new Headers({ "x-webhook-token": "session-secret" }),
      { webhookSecret: "dedicated-secret" },
    ),
    { authorized: false, reason: "missing_credential" },
  );
  assert.deepEqual(
    await authorizeEvolutionWebhookRequest(
      new Headers({ authorization: "Basic abc", "x-webhook-token": "session-secret" }),
      { webhookSecret: "dedicated-secret" },
    ),
    { authorized: false, reason: "invalid_credential" },
  );
  assert.deepEqual(
    await authorizeEvolutionWebhookRequest(
      new Headers({ "x-webhook-secret": "dedicated-secret" }),
      { webhookSecret: "dedicated-secret" },
    ),
    { authorized: false, reason: "missing_session_token" },
  );
});

test("rejects wrong or conflicting credentials instead of accepting the first match", async () => {
  assert.deepEqual(
    await authorizeEvolutionWebhookRequest(
      new Headers({
        "x-webhook-secret": "wrong",
        "x-webhook-token": "session-secret",
      }),
      { webhookSecret: "dedicated-secret" },
    ),
    { authorized: false, reason: "invalid_credential" },
  );
  assert.deepEqual(
    await authorizeEvolutionWebhookRequest(
      new Headers({
        "x-webhook-secret": "dedicated-secret",
        "x-webhook-token": "session-secret",
        apikey: "conflicting-secret",
      }),
      { webhookSecret: "dedicated-secret" },
    ),
    { authorized: false, reason: "invalid_credential" },
  );
});

test("recognizes the exact Go worker service-auth contract before callback auth", async () => {
  assert.deepEqual(
    await authorizeEvolutionWebhookIngressRequest(
      internalRequest({
        apikey: internalApiKey,
        "x-webhook-token": "session-secret",
      }),
      {
        privateWorker: { SUPABASE_SECRET_KEY: internalApiKey },
        webhookSecret: "provider-webhook-secret",
      },
    ),
    { authorized: true, contract: "internal_worker_lease" },
  );

  assert.deepEqual(
    await authorizeEvolutionWebhookIngressRequest(
      internalRequest({
        apikey: legacyServiceRole,
        authorization: `Bearer ${legacyServiceRole}`,
        "x-webhook-token": "session-secret",
      }),
      {
        privateWorker: { SUPABASE_SERVICE_ROLE_KEY: legacyServiceRole },
        webhookSecret: "provider-webhook-secret",
      },
    ),
    { authorized: true, contract: "internal_worker_lease" },
  );
});

test("keeps a provider callback distinct from configured private worker keys", async () => {
  assert.deepEqual(
    await authorizeEvolutionWebhookIngressRequest(
      new Request("https://example.test/evolution-webhook", {
        method: "POST",
        headers: { apikey: "provider-key", "x-webhook-token": "session-secret" },
      }),
      {
        privateWorker: { SUPABASE_SECRET_KEY: internalApiKey },
        providerApiKey: "provider-key",
      },
    ),
    { authorized: true, contract: "provider_api_key_fallback" },
  );
});

test("binds a direct callback's second credential to the resolved session", async () => {
  const session = {
    id: sessionId,
    provider: "evolution",
    advanced_settings: { webhook_token: "session-secret" },
  };

  assert.deepEqual(
    await validateEvolutionCallbackSessionToken(
      new Headers({ "x-webhook-token": "session-secret" }),
      session,
    ),
    { valid: true },
  );
  assert.deepEqual(
    await validateEvolutionCallbackSessionToken(
      new Headers({ "x-evolution-webhook-token": "wrong" }),
      session,
    ),
    { valid: false, reason: "invalid_session_token" },
  );
  assert.deepEqual(
    await validateEvolutionCallbackSessionToken(new Headers(), session),
    { valid: false, reason: "invalid_session_token" },
  );
});

test("does not let conflicting internal credentials mask one another or downgrade", async () => {
  for (const headers of [
    {
      apikey: legacyServiceRole,
      authorization: "Bearer conflicting-service-key",
      "x-webhook-token": "session-secret",
    },
    {
      apikey: internalApiKey,
      "x-webhook-token": "session-secret",
      "x-webhook-secret": "provider-webhook-secret",
    },
    { apikey: internalApiKey },
  ]) {
    assert.deepEqual(
      await authorizeEvolutionWebhookIngressRequest(
        internalRequest(headers),
        {
          privateWorker: {
            SUPABASE_SECRET_KEY: internalApiKey,
            SUPABASE_SERVICE_ROLE_KEY: legacyServiceRole,
          },
          webhookSecret: "provider-webhook-secret",
        },
      ),
      { authorized: false, reason: "invalid_internal_contract" },
    );
  }

  assert.deepEqual(
    await authorizeEvolutionWebhookIngressRequest(
      internalRequest(
        {
          apikey: internalApiKey,
          "x-webhook-token": "session-secret",
        },
        "session_id=not-a-uuid&instance_id=instance-1",
      ),
      {
        privateWorker: { SUPABASE_SECRET_KEY: internalApiKey },
        webhookSecret: "provider-webhook-secret",
      },
    ),
    { authorized: false, reason: "invalid_internal_contract" },
  );
});

test("binds an internal worker request to its session token and instance signals", async () => {
  const session = {
    id: sessionId,
    provider: "evolution_go",
    instance_id: "instance-1",
    instance_name: "office-whatsapp",
    advanced_settings: { webhook_token: "session-secret" },
  };
  const request = internalRequest({
    apikey: internalApiKey,
    "x-webhook-token": "session-secret",
  });

  assert.deepEqual(
    await validateEvolutionInternalSessionBinding(
      request,
      session,
      "office-whatsapp",
    ),
    { valid: true },
  );
  assert.deepEqual(
    await validateEvolutionInternalSessionBinding(
      internalRequest({
        apikey: internalApiKey,
        "x-webhook-token": "wrong-session-secret",
      }),
      session,
      "office-whatsapp",
    ),
    { valid: false, reason: "invalid_session_token" },
  );
  assert.deepEqual(
    await validateEvolutionInternalSessionBinding(
      internalRequest({
        apikey: internalApiKey,
        "x-webhook-token": "session-secret",
      }),
      session,
      "foreign-instance",
    ),
    { valid: false, reason: "instance_mismatch" },
  );
  assert.deepEqual(
    await validateEvolutionInternalSessionBinding(
      internalRequest(
        {
          apikey: internalApiKey,
          "x-webhook-token": "session-secret",
        },
        "session_id=c15fe784-741b-4764-a60c-c60ffc50d606&instance_id=instance-1",
      ),
      session,
      "office-whatsapp",
    ),
    { valid: false, reason: "session_mismatch" },
  );
});
