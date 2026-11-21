import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { assertGoogleCalendarOAuthReady } from "./google-calendar-delivery.ts";
import { assertGoogleTasksScope } from "./google-tasks-api.ts";

type Row = Record<string, unknown>;
function realFunction(name: string, dependencies: Row) {
  const filename = "supabase/functions/_shared/google-calendar.ts";
  const source = ts.createSourceFile(filename, readFileSync(filename, "utf8"), ts.ScriptTarget.ESNext, true);
  const declaration = source.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name);
  assert.ok(declaration);
  const code = ts.transpileModule(`${declaration.getText(source).replace(/^export\s+/, "")}\nreturn ${name};`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(dependencies), code)(...Object.values(dependencies));
}

test("Calendar-only consent cannot replace a connection during a requested Tasks upgrade", async () => {
  let mutations = 0;
  const query = { select: () => query, eq: () => query, order: async () => ({ data: [], error: null }) };
  const upsert = realFunction("upsertConnectionFromOAuth", {
    supabase: { from: () => query, rpc: async () => { mutations++; return { data: {}, error: null }; } },
    addSeconds: () => "future", normalizeGoogleAccountEmail: (email: string) => email,
    selectReusableGoogleCalendarConnection: () => null, assertGoogleCalendarOAuthReady, assertGoogleTasksScope,
  });
  await assert.rejects(upsert({ state: { user_id: "synthetic-owner", organization_id: "synthetic-org", enable_tasks: true },
    userInfo: { email: "synthetic@example.invalid" }, tokenResponse: { access_token: "synthetic-access", refresh_token: "synthetic-refresh",
      scope: "openid email https://www.googleapis.com/auth/calendar.events.owned" } }), /Autorize o Google Tasks/);
  assert.equal(mutations, 0, "Neither Vault activation nor Tasks metadata may change on partial consent");
});

test("Tasks authorization is enabled only after the verified credential revision activates", async () => {
  const calls: Array<{ name: string; args: Row }> = [];
  const query = { select: () => query, eq: () => query, order: async () => ({ data: [], error: null }) };
  const upsert = realFunction("upsertConnectionFromOAuth", {
    supabase: { from: () => query, rpc: async (name: string, args: Row) => {
      calls.push({ name, args }); return { data: { id: "connection", credential_revision: 9 }, error: null };
    } },
    addSeconds: () => "future", normalizeGoogleAccountEmail: (email: string) => email,
    selectReusableGoogleCalendarConnection: () => null, assertGoogleCalendarOAuthReady, assertGoogleTasksScope,
  });
  await upsert({ state: { user_id: "synthetic-owner", organization_id: "synthetic-org", enable_tasks: true },
    userInfo: { email: "synthetic@example.invalid" }, tokenResponse: { access_token: "synthetic-access", refresh_token: "synthetic-refresh",
      scope: "https://www.googleapis.com/auth/calendar.events.owned https://www.googleapis.com/auth/tasks" } });
  assert.deepEqual(calls.map(call => call.name), ["google_calendar_activate_oauth_connection", "google_calendar_enable_tasks"]);
  assert.equal(calls[1].args.p_expected_revision, 9);
});

test("OAuth auth URL asks for Tasks only when the server state requests the capability", () => {
  const build = realFunction("buildGoogleAuthUrl", { getGoogleOAuthConfig: () => ({ clientId: "synthetic", redirectUri: "https://staging.example.invalid/callback" }),
    GOOGLE_SCOPES: ["openid", "email", "https://www.googleapis.com/auth/calendar.events.owned"] });
  const legacy = new URL(build("synthetic-state"));
  const upgraded = new URL(build("synthetic-state", true));
  assert.equal(legacy.searchParams.get("scope")?.includes("/auth/tasks"), false);
  assert.equal(upgraded.searchParams.get("scope")?.includes("/auth/tasks"), true);
  assert.equal(upgraded.searchParams.get("access_type"), "offline");
});
