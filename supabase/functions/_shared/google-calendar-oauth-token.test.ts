import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import ts from "typescript";
import {
  assertGoogleCalendarOAuthReady,
  googleCalendarFetchWithDeadline,
} from "./google-calendar-delivery.ts";
import { resolveGoogleCalendarOAuthTokenScope } from "./google-calendar-oauth-token.ts";

const clientId = "synthetic-client.apps.googleusercontent.com";
const calendarScope = "https://www.googleapis.com/auth/calendar.events.owned";
const token = { access_token: "synthetic-access", refresh_token: "synthetic-refresh" };
const verificationFailed =
  "Nao foi possivel verificar a autorizacao do Google Agenda. Tente conectar novamente.";

function assertSanitized(error: unknown) {
  assert.ok(error instanceof Error);
  assert.equal(error.message, verificationFailed);
  assert.equal(Object.hasOwn(error, "cause"), false);
  assert.doesNotMatch(String(error.stack), /synthetic-(?:access|refresh|secret)|oauth2\.googleapis/);
  return true;
}

test("omitted scope is verified by fixed Google POST without credentials in its URL", async (t) => {
  const log = t.mock.method(console, "info", () => undefined);
  const request = t.mock.method(globalThis, "fetch", async (
    input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1],
  ) => {
    assert.equal(String(input), "https://oauth2.googleapis.com/tokeninfo");
    assert.equal(new URL(String(input)).search, "");
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "error");
    assert.equal(init?.cache, "no-store");
    assert.ok(init?.signal instanceof AbortSignal);
    assert.equal(new Headers(init?.headers).get("Authorization"), `Bearer ${token.access_token}`);
    assert.equal(new Headers(init?.headers).get("Content-Type"), "application/x-www-form-urlencoded");
    assert.equal(init?.body, undefined);
    return Response.json({ aud: clientId, scope: `openid email ${calendarScope}` });
  });

  const resolved = await resolveGoogleCalendarOAuthTokenScope(token, clientId);
  assert.equal(resolved.scope, `openid email ${calendarScope}`);
  assertGoogleCalendarOAuthReady(resolved);
  assert.equal(Object.hasOwn(token, "scope"), false);
  assert.equal(request.mock.callCount(), 1);
  assert.deepEqual(log.mock.calls.map((call) => call.arguments), [
    ["google-calendar-oauth scopes verified via tokeninfo"],
  ]);
});

test("an explicit Calendar grant needs no lookup and keeps the response unchanged", async (t) => {
  const request = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected lookup"); });
  const response = { ...token, scope: calendarScope };
  assert.equal(await resolveGoogleCalendarOAuthTokenScope(response, clientId), response);
  assertGoogleCalendarOAuthReady(response);
  assert.equal(request.mock.callCount(), 0);
});

test("explicit partial consent is denied without fetching a replacement grant", async (t) => {
  const request = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected lookup"); });
  await assert.rejects(resolveGoogleCalendarOAuthTokenScope({ ...token, scope: "openid email" }, clientId), /Permissao/);
  assert.equal(request.mock.callCount(), 0);
});

test("present malformed scope is never treated as omitted, including explicit undefined", async (t) => {
  const request = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected lookup"); });
  for (const scope of [null, undefined, "", " \t ", [], [calendarScope], 42, { scope: calendarScope }]) {
    await assert.rejects(resolveGoogleCalendarOAuthTokenScope({ ...token, scope }, clientId), assertSanitized);
  }
  assert.equal(request.mock.callCount(), 0);
});

test("missing or malformed access token cannot start tokeninfo lookup", async (t) => {
  const request = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected lookup"); });
  for (const access_token of [null, undefined, "", " \t ", [], 42]) {
    await assert.rejects(resolveGoogleCalendarOAuthTokenScope({ access_token }, clientId), assertSanitized);
  }
  for (const response of [null, [], "synthetic-secret", 42]) {
    await assert.rejects(resolveGoogleCalendarOAuthTokenScope(response, clientId), assertSanitized);
  }
  await assert.rejects(resolveGoogleCalendarOAuthTokenScope(token, ""), assertSanitized);
  assert.equal(request.mock.callCount(), 0);
});

test("tokeninfo requires exact audience and cannot substitute azp", async (t) => {
  const log = t.mock.method(console, "info", () => undefined);
  let audience: unknown;
  t.mock.method(globalThis, "fetch", async () => Response.json({ aud: audience, azp: clientId, scope: calendarScope }));
  for (audience of ["different-client", `${clientId} `, null, undefined, [clientId], 42]) {
    await assert.rejects(resolveGoogleCalendarOAuthTokenScope(token, clientId), assertSanitized);
  }
  assert.equal(log.mock.callCount(), 0);
});

test("tokeninfo must provide a string Calendar scope", async (t) => {
  const log = t.mock.method(console, "info", () => undefined);
  let scope: unknown;
  t.mock.method(globalThis, "fetch", async () => Response.json({ aud: clientId, scope }));
  for (scope of [null, undefined, "", " \t ", [calendarScope], 42, "openid email"]) {
    await assert.rejects(resolveGoogleCalendarOAuthTokenScope(token, clientId), assertSanitized);
  }
  assert.equal(log.mock.callCount(), 0);
});

test("HTTP errors, network failures, timeouts and invalid tokeninfo JSON stay sanitized", async (t) => {
  const log = t.mock.method(console, "info", () => undefined);
  let mode = "http";
  t.mock.method(globalThis, "fetch", async () => {
    if (mode === "network") throw new Error(`synthetic-secret https://oauth2.googleapis.com/?access_token=${token.access_token}`);
    if (mode === "timeout") throw new DOMException("synthetic-secret", "TimeoutError");
    if (mode === "json") return new Response("synthetic-secret", { status: 200 });
    return Response.json({ error_description: "synthetic-secret" }, { status: 503 });
  });
  for (mode of ["http", "network", "timeout", "json"]) {
    await assert.rejects(resolveGoogleCalendarOAuthTokenScope(token, clientId), assertSanitized);
  }
  assert.equal(log.mock.callCount(), 0);
});

test("tokeninfo scalar and array bodies cannot establish a grant", async (t) => {
  let body: unknown;
  t.mock.method(globalThis, "fetch", async () => Response.json(body));
  for (body of [null, "synthetic-secret", 42, [{ aud: clientId, scope: calendarScope }]]) {
    await assert.rejects(resolveGoogleCalendarOAuthTokenScope(token, clientId), assertSanitized);
  }
});

test("a verified scope does not replace the final offline-token requirement", async (t) => {
  t.mock.method(console, "info", () => undefined);
  t.mock.method(globalThis, "fetch", async () => Response.json({ aud: clientId, scope: calendarScope }));
  const response = await resolveGoogleCalendarOAuthTokenScope({ access_token: token.access_token }, clientId);
  assert.throws(() => assertGoogleCalendarOAuthReady(response), /offline/);
  assert.doesNotThrow(() => assertGoogleCalendarOAuthReady({ ...response, refresh_token: token.refresh_token }));
});

test("the real code exchange resolves omitted scope before returning its token response", async (t) => {
  t.mock.method(console, "info", () => undefined);
  const requests: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: Parameters<typeof fetch>[0]) => {
    requests.push(String(input));
    return Response.json(String(input).endsWith("/token")
      ? token
      : { aud: clientId, scope: calendarScope });
  });
  const file = resolve(process.cwd(), "supabase/functions/_shared/google-calendar.ts");
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ESNext, true);
  const declaration = source.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === "exchangeOAuthCode");
  assert.ok(declaration);
  const compiled = ts.transpileModule(`${declaration.getText(source).replace(/^export\s+/, "")}\nreturn exchangeOAuthCode;`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exchange = new Function("getGoogleOAuthConfig", "googleCalendarFetchWithDeadline", "GOOGLE_TOKEN_URL",
    "resolveGoogleCalendarOAuthTokenScope", compiled)(
    () => ({ clientId, clientSecret: "synthetic-secret", redirectUri: "https://staging.example.test/callback" }),
    googleCalendarFetchWithDeadline, "https://oauth2.googleapis.com/token", resolveGoogleCalendarOAuthTokenScope,
  ) as (code: string) => Promise<Record<string, unknown>>;
  const response = await exchange("synthetic-code");
  assertGoogleCalendarOAuthReady(response);
  assert.deepEqual(requests, ["https://oauth2.googleapis.com/token", "https://oauth2.googleapis.com/tokeninfo"]);
});
