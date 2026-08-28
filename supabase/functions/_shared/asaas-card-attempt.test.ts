import assert from "node:assert/strict";
import test from "node:test";
import {
  billingEdgeClientIpSignature,
  hmacSha256Hex,
  trustedBillingCheckoutClientIp,
} from "./asaas-card-attempt.ts";

test("card-attempt IP accepts only the platform-owned header", async () => {
  assert.equal(
    await trustedBillingCheckoutClientIp(
      new Request("https://example.test", {
        headers: {
          "cf-connecting-ip": "203.0.113.7",
          "x-forwarded-for": "198.51.100.9",
          "x-real-ip": "198.51.100.10",
        },
      }),
    ),
    "203.0.113.7",
  );
  assert.equal(
    await trustedBillingCheckoutClientIp(
      new Request("https://example.test", {
        headers: { "x-forwarded-for": "203.0.113.7" },
      }),
    ),
    null,
  );
});

test("Go proxy client IP requires a fresh request-bound HMAC", async () => {
  const secret = "vimob-edge-client-ip-signing-secret-for-tests";
  const timestamp = "1785852000";
  const body = new TextEncoder().encode('{"billing_type":"CREDIT_CARD"}');
  const path = "/functions/v1/asaas-create-charge";
  const signature = await billingEdgeClientIpSignature({
    secret,
    timestamp,
    method: "POST",
    path,
    clientIp: "203.0.113.8",
    body,
  });
  const previousSecret = Deno.env.get("BILLING_EDGE_CLIENT_IP_SIGNING_SECRET");
  Deno.env.set("BILLING_EDGE_CLIENT_IP_SIGNING_SECRET", secret);
  try {
    const request = new Request(`https://project.test${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-vimob-client-ip": "203.0.113.8",
        "x-vimob-client-ip-timestamp": timestamp,
        "x-vimob-client-ip-signature": signature,
        "cf-connecting-ip": "192.0.2.20",
      },
      body,
    });
    assert.equal(
      await trustedBillingCheckoutClientIp(
        request,
        Number(timestamp) * 1000,
      ),
      "203.0.113.8",
    );
    const tampered = new Request(`https://project.test${path}`, {
      method: "POST",
      headers: {
        "x-vimob-client-ip": "203.0.113.9",
        "x-vimob-client-ip-timestamp": timestamp,
        "x-vimob-client-ip-signature": signature,
        "cf-connecting-ip": "192.0.2.20",
      },
      body,
    });
    assert.equal(
      await trustedBillingCheckoutClientIp(
        tampered,
        Number(timestamp) * 1000,
      ),
      null,
    );
  } finally {
    if (previousSecret === undefined) {
      Deno.env.delete("BILLING_EDGE_CLIENT_IP_SIGNING_SECRET");
    } else {
      Deno.env.set("BILLING_EDGE_CLIENT_IP_SIGNING_SECRET", previousSecret);
    }
  }
});

test("card-attempt fingerprint is stable HMAC-SHA256 without raw IP", async () => {
  const secret = "vimob-test-secret-with-at-least-32-characters";
  const first = await hmacSha256Hex(secret, "203.0.113.7");
  const again = await hmacSha256Hex(secret, "203.0.113.7");
  const different = await hmacSha256Hex(secret, "203.0.113.8");
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(first, again);
  assert.notEqual(first, different);
  assert.equal(first.includes("203.0.113.7"), false);
  await assert.rejects(() => hmacSha256Hex("short", "203.0.113.7"));
});
