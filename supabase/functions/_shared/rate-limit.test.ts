import assert from "node:assert/strict";
import test from "node:test";
import { enforceRateLimit } from "./rate-limit.ts";

type RPCResult = { data: unknown; error: unknown };

function rateLimitClient(results: RPCResult[]) {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    client: {
      async rpc(_name: string, input: Record<string, unknown>) {
        calls.push(input);
        return results.shift() ?? { data: { allowed: true }, error: null };
      },
    },
  };
}

const request = new Request("https://edge.example/public-api/properties", {
  headers: { "x-forwarded-for": "203.0.113.10" },
});
const rules = [
  { name: "minute", limit: 120, windowSeconds: 60 },
  { name: "hour", limit: 1_000, windowSeconds: 3_600 },
];

test("shared rate limiter keeps its historical fail-open default", async () => {
  const failure = new Error("rate limiter unavailable");
  const { client, calls } = rateLimitClient([
    { data: null, error: failure },
    { data: { allowed: true }, error: null },
  ]);

  const result = await enforceRateLimit(
    client as never,
    request,
    "existing_domain",
    rules,
    {},
  );

  assert.equal(result.error, null);
  assert.equal(result.response, null);
  assert.equal(calls.length, 2, "default callers must continue after an unavailable bucket");
});

test("failClosed stops on the first unavailable rate-limit bucket", async () => {
  const failure = new Error("rate limiter unavailable");
  const { client, calls } = rateLimitClient([
    { data: null, error: failure },
    { data: { allowed: true }, error: null },
  ]);

  const result = await enforceRateLimit(
    client as never,
    request,
    "public_api_key",
    rules,
    {},
    { identifier: "org:key", failClosed: true },
  );

  assert.equal(result.error, failure);
  assert.equal(result.response, null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.p_scope, "public_api_key:minute");
  assert.notEqual(calls[0]?.p_identifier_hash, "org:key");
});

test("denied buckets retain retry metadata", async () => {
  const { client } = rateLimitClient([{
    data: { allowed: false, remaining: 0, retry_after_seconds: 37 },
    error: null,
  }]);

  const result = await enforceRateLimit(
    client as never,
    request,
    "public_api_ip",
    [rules[0]],
    {},
    { failClosed: true },
  );

  assert.equal(result.error, null);
  assert.equal(result.response?.status, 429);
  assert.equal(result.response?.headers.get("Retry-After"), "37");
});
