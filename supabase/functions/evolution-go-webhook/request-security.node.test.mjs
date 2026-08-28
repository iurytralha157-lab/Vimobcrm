import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizeEvolutionGoWebhookIngress,
  readBoundedJsonBody,
  validateEvolutionGoSessionBinding,
  WebhookRequestBodyError,
} from "./request-security.ts";

const sessionId = "c15fe784-741b-4764-a60c-c60ffc50d606";
const serviceKey = "sb_secret_service_key_for_webhook_tests_123456789";
const baseEnvironment = {
  privateWorker: { SUPABASE_SECRET_KEY: serviceKey },
  webhookSecret: "dedicated-callback-secret",
  providerApiKey: "provider-api-key",
};

function request(headers = {}, query = `session_id=${sessionId}&instance_id=instance-1`) {
  return new Request(`https://project.test/functions/v1/evolution-go-webhook?${query}`, {
    method: "POST",
    headers,
    body: "{}",
  });
}

test("accepts the exact Go forwarder contract before body or database access", () => {
  const result = authorizeEvolutionGoWebhookIngress(
    request({
      apikey: serviceKey,
      "x-webhook-token": "session-secret",
    }),
    baseEnvironment,
  );
  assert.deepEqual(result, {
    authorized: true,
    contract: "internal_worker_lease",
  });
});

test("accepts the Go forwarder's same-value legacy JWT Bearer", () => {
  const legacyKey = "header.payload.signature-value-long-enough-for-tests";
  const result = authorizeEvolutionGoWebhookIngress(
    request({
      apikey: legacyKey,
      authorization: `Bearer ${legacyKey}`,
      "x-webhook-token": "session-secret",
    }),
    {
      ...baseEnvironment,
      privateWorker: { SUPABASE_SERVICE_ROLE_KEY: legacyKey },
    },
  );
  assert.deepEqual(result, {
    authorized: true,
    contract: "internal_worker_lease",
  });
});

test("rejects partial, conflicting, and query-carried internal credentials", () => {
  for (const incoming of [
    request({ apikey: serviceKey }),
    request({
      apikey: serviceKey,
      authorization: "Bearer conflicting-service-key",
      "x-webhook-token": "session-secret",
    }),
    request(
      { apikey: serviceKey, "x-webhook-token": "session-secret" },
      `session_id=${sessionId}&instance_id=instance-1&Webhook_Token=leaked`,
    ),
  ]) {
    assert.equal(
      authorizeEvolutionGoWebhookIngress(incoming, baseEnvironment).authorized,
      false,
    );
  }
});

test("direct callback needs both global and session-scoped credentials", () => {
  const accepted = authorizeEvolutionGoWebhookIngress(
    request({
      "x-webhook-secret": "dedicated-callback-secret",
      "x-webhook-token": "session-secret",
    }),
    baseEnvironment,
  );
  assert.deepEqual(accepted, {
    authorized: true,
    contract: "dedicated_secret",
  });

  assert.equal(
    authorizeEvolutionGoWebhookIngress(
      request({ "x-webhook-token": "session-secret" }),
      baseEnvironment,
    ).authorized,
    false,
  );
  assert.equal(
    authorizeEvolutionGoWebhookIngress(
      request({
        "x-webhook-secret": "dedicated-callback-secret",
        "x-api-key": "conflicting-provider-key",
        "x-webhook-token": "session-secret",
      }),
      baseEnvironment,
    ).authorized,
    false,
  );
});

test("provider API key is only the explicit fallback when no dedicated secret exists", () => {
  const result = authorizeEvolutionGoWebhookIngress(
    request({
      apikey: "provider-api-key",
      "x-webhook-token": "session-secret",
    }),
    { ...baseEnvironment, webhookSecret: "" },
  );
  assert.deepEqual(result, {
    authorized: true,
    contract: "provider_api_key_fallback",
  });
});

test("session binding requires every supplied tenant signal and token to agree", () => {
  const incoming = request({
    "x-webhook-secret": "dedicated-callback-secret",
    "x-webhook-token": "session-secret",
  });
  const session = {
    id: sessionId,
    provider: "evolution_go",
    instance_id: "instance-1",
    instance_name: "primary-instance",
    advanced_settings: { webhook_token: "session-secret" },
  };
  assert.deepEqual(
    validateEvolutionGoSessionBinding(incoming, session, {
      sessionIds: [sessionId],
      instanceIds: ["instance-1"],
      instanceNames: ["primary-instance"],
    }),
    { valid: true },
  );
  assert.deepEqual(
    validateEvolutionGoSessionBinding(incoming, session, {
      sessionIds: [sessionId],
      instanceIds: ["other-instance"],
    }),
    { valid: false, reason: "instance_mismatch" },
  );
  assert.deepEqual(
    validateEvolutionGoSessionBinding(
      request({
        "x-webhook-secret": "dedicated-callback-secret",
        "x-webhook-token": "wrong-session-secret",
      }),
      session,
      { sessionIds: [sessionId], instanceIds: ["instance-1"] },
    ),
    { valid: false, reason: "invalid_session_token" },
  );
});

test("body is bounded by declared and streamed bytes", async () => {
  const declared = {
    headers: new Headers({ "content-length": "1000" }),
    body: new ReadableStream({
      pull() {
        throw new Error("oversized declared body must not be consumed");
      },
    }),
  };
  await assert.rejects(
    readBoundedJsonBody(declared, 16),
    (error) => error instanceof WebhookRequestBodyError && error.status === 413,
  );

  await assert.rejects(
    readBoundedJsonBody(
      new Request("https://project.test/hook", {
        method: "POST",
        body: JSON.stringify({ payload: "too large" }),
      }),
      8,
    ),
    (error) => error instanceof WebhookRequestBodyError && error.status === 413,
  );
});
