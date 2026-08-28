import assert from "node:assert/strict";
import test from "node:test";

import {
  PROXY_KIND,
  browserOriginIsAllowed,
  buildRuntimeConfig,
  createBlockedRequestAuditEvent,
  evaluateProxyRequest,
  normalizeAllowedOrigins,
  parseCommandLine,
  serializeAuditEvent,
} from "./read-only-proxy.mjs";

const API = PROXY_KIND.API;
const SUPABASE = PROXY_KIND.SUPABASE;

function decision(proxy, method, requestUrl, isUpgrade = false) {
  return evaluateProxyRequest({ proxy, method, requestUrl, isUpgrade });
}

test("API proxy permits only GET, HEAD, and OPTIONS", () => {
  for (const method of ["GET", "HEAD", "OPTIONS"]) {
    assert.equal(decision(API, method, "/v1/leads?limit=10").allowed, true, method);
  }

  for (const method of ["POST", "PUT", "PATCH", "DELETE", "CONNECT", "TRACE"]) {
    const result = decision(API, method, "/v1/leads");
    assert.equal(result.allowed, false, method);
    assert.equal(result.reason, "method_not_allowed", method);
  }
});

test("Supabase proxy permits read methods without broadening mutation access", () => {
  for (const method of ["GET", "HEAD", "OPTIONS"]) {
    assert.equal(decision(SUPABASE, method, "/rest/v1/leads?select=id").allowed, true, method);
  }

  for (const method of ["PUT", "PATCH", "DELETE"]) {
    assert.equal(decision(SUPABASE, method, "/rest/v1/leads?id=eq.1").allowed, false, method);
  }

  assert.equal(decision(SUPABASE, "POST", "/rest/v1/rpc/some_function").allowed, false);
  assert.equal(decision(SUPABASE, "POST", "/functions/v1/some-function").allowed, false);
  assert.equal(decision(SUPABASE, "POST", "/auth/v1/signup").allowed, false);
});

test("Supabase POST exception is exact for password login and refresh", () => {
  for (const grantType of ["password", "refresh_token"]) {
    const result = decision(SUPABASE, "POST", `/auth/v1/token?grant_type=${grantType}`);
    assert.equal(result.allowed, true, grantType);
    assert.equal(result.reason, "auth_token_exchange_allowed", grantType);
  }

  const rejectedUrls = [
    "/auth/v1/token",
    "/auth/v1/token/",
    "/auth/v1/Token?grant_type=password",
    "/auth/v1/%74oken?grant_type=password",
    "/auth/v1/token?grant_type=otp",
    "/auth/v1/token?grant_type=password&grant_type=refresh_token",
    "/auth/v1/token?grant_type=password&redirect_to=https%3A%2F%2Fexample.invalid",
    "/auth/v1/token?access_token=secret",
  ];

  for (const requestUrl of rejectedUrls) {
    assert.equal(decision(SUPABASE, "POST", requestUrl).allowed, false, requestUrl);
  }

  assert.equal(decision(API, "POST", "/auth/v1/token?grant_type=password").allowed, false);
});

test("WebSocket upgrades are always blocked", () => {
  for (const proxy of [API, SUPABASE]) {
    const result = decision(proxy, "GET", "/realtime/v1/websocket", true);
    assert.equal(result.allowed, false, proxy);
    assert.equal(result.reason, "websocket_upgrade_blocked", proxy);
  }
});

test("browser origin allowlist accepts only configured loopback origins", () => {
  const origins = normalizeAllowedOrigins([
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3000",
  ]);

  assert.deepEqual(origins, ["http://localhost:3000", "http://127.0.0.1:3000"]);
  assert.equal(browserOriginIsAllowed(undefined, origins), true, "SSR requests have no Origin header");
  assert.equal(browserOriginIsAllowed("http://localhost:3000", origins), true);
  assert.equal(browserOriginIsAllowed("http://localhost:3001", origins), false);
  assert.equal(browserOriginIsAllowed("https://localhost:3000", origins), false);
  assert.equal(browserOriginIsAllowed("https://attacker.invalid", origins), false);

  assert.throws(() => normalizeAllowedOrigins(["https://localhost:3000"]), /HTTP loopback/);
  assert.throws(() => normalizeAllowedOrigins(["http://example.invalid:3000"]), /HTTP loopback/);
  assert.throws(() => normalizeAllowedOrigins([]), /At least one/);
});

test("blocked-request audit schema cannot serialize request secrets", () => {
  const sensitiveRequest = {
    requestUrl:
      "/auth/v1/private-path-value?grant_type=otp&access_token=query-secret-value",
    headers: {
      authorization: "Bearer header-secret-value",
      apikey: "apikey-secret-value",
      cookie: "session=token-secret-value",
    },
    body: JSON.stringify({
      email: "person@example.invalid",
      password: "body-secret-value",
      refresh_token: "refresh-secret-value",
    }),
  };
  const blockedDecision = decision(SUPABASE, "POST", sensitiveRequest.requestUrl);

  const event = createBlockedRequestAuditEvent({
    proxy: SUPABASE,
    method: "POST",
    decision: blockedDecision,
    request: sensitiveRequest,
    headers: sensitiveRequest.headers,
    body: sensitiveRequest.body,
  });
  const line = serializeAuditEvent(event);
  const parsed = JSON.parse(line);

  assert.deepEqual(Object.keys(parsed), [
    "timestamp",
    "event",
    "proxy",
    "method",
    "route",
    "reason",
  ]);
  assert.equal(parsed.route, "redacted");
  assert.match(parsed.timestamp, /^\d{4}-\d{2}-\d{2}T/);

  for (const forbiddenText of [
    "private-path-value",
    "grant_type=otp",
    "access_token",
    "query-secret-value",
    "authorization",
    "header-secret-value",
    "apikey-secret-value",
    "cookie",
    "token-secret-value",
    "person@example.invalid",
    "password",
    "body-secret-value",
    "refresh-secret-value",
  ]) {
    assert.equal(line.includes(forbiddenText), false, forbiddenText);
  }
});

test("known auth route logging still omits its query and credential value", () => {
  const requestUrl = "/auth/v1/token?grant_type=otp&access_token=query-secret-value";
  const blockedDecision = decision(SUPABASE, "POST", requestUrl);
  const line = serializeAuditEvent(
    createBlockedRequestAuditEvent({
      proxy: SUPABASE,
      method: "POST",
      decision: blockedDecision,
    }),
  );

  assert.match(line, /"route":"supabase_auth_token"/);
  assert.equal(line.includes("grant_type"), false);
  assert.equal(line.includes("query-secret-value"), false);
});

test("audit serializer drops unexpected fields even when called directly", () => {
  const line = serializeAuditEvent({
    timestamp: "timestamp-secret-value",
    event: "event-secret-value",
    proxy: "proxy-secret-value",
    method: "method-secret-value",
    route: "/private/path-secret-value",
    reason: "reason-secret-value",
    query: "access_token=query-secret-value",
    headers: { authorization: "Bearer header-secret-value" },
    body: "password=body-secret-value",
  });
  const parsed = JSON.parse(line);

  assert.deepEqual(Object.keys(parsed), ["timestamp", "event", "proxy", "reason"]);
  assert.equal(parsed.event, "internal_event");
  assert.equal(parsed.proxy, "unknown");
  assert.equal(parsed.reason, "internal_failure");

  for (const forbiddenText of [
    "timestamp-secret-value",
    "event-secret-value",
    "proxy-secret-value",
    "method-secret-value",
    "path-secret-value",
    "reason-secret-value",
    "query-secret-value",
    "header-secret-value",
    "body-secret-value",
  ]) {
    assert.equal(line.includes(forbiddenText), false, forbiddenText);
  }
});

test("unknown method text is redacted before audit logging", () => {
  const blockedDecision = {
    ...decision(API, "secret-method-value", "/"),
    reason: "secret-reason-value",
  };
  const line = serializeAuditEvent(
    createBlockedRequestAuditEvent({
      proxy: "secret-proxy-value",
      method: "secret-method-value",
      decision: blockedDecision,
    }),
  );

  assert.match(line, /"method":"OTHER"/);
  assert.match(line, /"proxy":"unknown"/);
  assert.match(line, /"reason":"policy_blocked"/);
  assert.equal(line.includes("secret-method-value"), false);
  assert.equal(line.includes("secret-proxy-value"), false);
  assert.equal(line.includes("secret-reason-value"), false);
});

test("runtime config is explicit, loopback-oriented, and secret-free", () => {
  const parsed = parseCommandLine([
    "--api-target",
    "https://api.example.invalid",
    "--supabase-target",
    "https://project-ref.supabase.co",
    "--web-origin",
    "http://localhost:3000",
    "--api-port",
    "18081",
    "--supabase-port",
    "18082",
    "--acknowledge-upstream-read-risk",
  ]);
  const config = buildRuntimeConfig(parsed);

  assert.equal(config.apiTarget.origin, "https://api.example.invalid");
  assert.equal(config.supabaseTarget.origin, "https://project-ref.supabase.co");
  assert.equal(config.apiPort, 18081);
  assert.equal(config.supabasePort, 18082);
  assert.deepEqual(config.allowedOrigins, ["http://localhost:3000"]);

  assert.throws(
    () => buildRuntimeConfig({ ...parsed, acknowledgeUpstreamReadRisk: false }),
    /Refusing to start/,
  );
  assert.throws(
    () => buildRuntimeConfig({ ...parsed, apiTarget: "http://api.example.invalid" }),
    /must use HTTPS/,
  );
  assert.throws(
    () => buildRuntimeConfig({ ...parsed, apiTarget: "https://user:secret@api.example.invalid" }),
    /must not contain credentials/,
  );
  assert.throws(
    () => buildRuntimeConfig({ ...parsed, supabaseTarget: "https://project-ref.supabase.co/auth/v1" }),
    /must be an origin/,
  );
  assert.throws(
    () => buildRuntimeConfig({ ...parsed, supabasePort: parsed.apiPort }),
    /ports must differ/,
  );
});
