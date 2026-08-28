import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const proxyPath = path.join(root, "supabase", "functions", "evolution-proxy", "index.ts");

async function loadWebhookHelpers() {
  const source = await readFile(proxyPath, "utf8");
  const sourceFile = ts.createSourceFile(
    "evolution-proxy.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const names = new Set([
    "resolveWebhookSessionToken",
    "evolutionWebhookHeaders",
    "safeEvolutionWebhookUrl",
  ]);
  const declarations = sourceFile.statements.filter(
    (statement) => ts.isFunctionDeclaration(statement) && names.has(statement.name?.text || ""),
  );
  assert.equal(declarations.length, names.size);

  const compiled = ts.transpileModule(
    `${declarations.map((declaration) => declaration.getText(sourceFile)).join("\n")}
globalThis.__contract = { resolveWebhookSessionToken, evolutionWebhookHeaders, safeEvolutionWebhookUrl };`,
    {
      compilerOptions: {
        module: ts.ModuleKind.None,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const context = vm.createContext({
    URL,
    SESSION_UUID_PATTERN: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  });
  vm.runInContext(compiled, context);
  return { source, ...context.__contract };
}

test("create and setWebhook provision the callback secret only in a header", async () => {
  const { source } = await loadWebhookHelpers();

  assert.match(source, /Deno\.env\.get\("EVOLUTION_WEBHOOK_SECRET"\)/);
  assert.match(
    source,
    /createInstance\([\s\S]*?EVOLUTION_WEBHOOK_SECRET,[\s\S]*?webhookSessionToken,[\s\S]*?params,/,
  );
  assert.match(
    source,
    /setWebhook\([\s\S]*?EVOLUTION_WEBHOOK_SECRET,[\s\S]*?webhookSessionToken,[\s\S]*?params,/,
  );
  assert.equal(
    source.match(/headers: evolutionWebhookHeaders\(webhookSecret, sessionToken\)/g)?.length,
    2,
  );
  assert.match(
    source,
    /if \(action === "createInstance" \|\| action === "setWebhook"\)[\s\S]*?!EVOLUTION_WEBHOOK_SECRET[\s\S]*?status: 503/,
  );
  assert.match(source, /webhookSessionToken = await resolveWebhookSessionToken\(supabase, params\)/);
  assert.match(source, /\.eq\("provider", "evolution"\)/);
  assert.match(source, /\.eq\("is_active", true\)/);
  assert.match(source, /\.neq\("status", "deleted"\)/);
  assert.doesNotMatch(source, /searchParams\.set\([^\n]*EVOLUTION_WEBHOOK_SECRET/);
});

test("session token is loaded from one active legacy session and ambiguity fails closed", async () => {
  const { resolveWebhookSessionToken } = await loadWebhookHelpers();
  const sessionId = "13eea7e8-a74f-4bfb-bb36-024e3d26ccc9";

  const byId = fakeSessionClient([
    { id: sessionId, advanced_settings: { webhook_token: "  scoped-token  " } },
  ]);
  assert.equal(
    await resolveWebhookSessionToken(byId.client, { session_id: sessionId }),
    "scoped-token",
  );
  assert.deepEqual(byId.filters, [
    ["provider", "evolution"],
    ["is_active", true],
    ["status", "deleted"],
    ["id", sessionId],
  ]);

  const ambiguous = fakeSessionClient([
    { id: "one", advanced_settings: { webhook_token: "one" } },
    { id: "two", advanced_settings: { webhook_token: "two" } },
  ]);
  assert.equal(
    await resolveWebhookSessionToken(ambiguous.client, { instanceName: "office" }),
    "",
  );

  const missingToken = fakeSessionClient([
    { id: sessionId, advanced_settings: {} },
  ]);
  assert.equal(
    await resolveWebhookSessionToken(missingToken.client, { sessionId }),
    "",
  );
});

test("webhook helper fails closed without a secret and rejects credential query parameters", async () => {
  const { evolutionWebhookHeaders, safeEvolutionWebhookUrl } = await loadWebhookHelpers();

  assert.deepEqual(
    { ...evolutionWebhookHeaders("  callback-secret  ", "  session-secret  ") },
    {
      "x-webhook-secret": "callback-secret",
      "x-webhook-token": "session-secret",
    },
  );
  assert.throws(() => evolutionWebhookHeaders(" ", "session-secret"), /not configured/);
  assert.throws(() => evolutionWebhookHeaders("callback-secret", " "), /not configured/);
  assert.equal(
    safeEvolutionWebhookUrl("https://functions.example.test/evolution-webhook"),
    "https://functions.example.test/evolution-webhook",
  );
  for (const key of [
    "secret",
    "token",
    "apikey",
    "api_key",
    "webhook_secret",
    "webhook-token",
    "x-webhook-secret",
    "x_webhook_token",
    "x-evolution-webhook-token",
  ]) {
    assert.throws(
      () => safeEvolutionWebhookUrl(`https://functions.example.test/evolution-webhook?${key}=leak`),
      /not allowed/,
    );
  }
});

function fakeSessionClient(rows, error = null) {
  const filters = [];
  const builder = {
    from(table) {
      assert.equal(table, "whatsapp_sessions");
      return this;
    },
    select() {
      return this;
    },
    in(column, value) {
      filters.push([column, value]);
      return this;
    },
    eq(column, value) {
      filters.push([column, value]);
      return this;
    },
    neq(column, value) {
      filters.push([column, value]);
      return this;
    },
    limit() {
      return this;
    },
    maybeSingle() {
      return Promise.resolve({
        data: rows.length === 1 ? rows[0] : null,
        error,
      });
    },
    then(resolve, reject) {
      return Promise.resolve({ data: rows, error }).then(resolve, reject);
    },
  };
  return { client: builder, filters };
}
