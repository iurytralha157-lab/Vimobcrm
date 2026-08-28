import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { authorizePrivateWorkerRequest } from "../../supabase/functions/_shared/private-worker-auth.ts";
import { selectSupabaseAdminSecretKey } from "../../supabase/functions/_shared/supabase-secret-keys.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const edgePath = path.join(root, "supabase", "functions", "evolution-go-proxy", "index.ts");
const opaqueSecret = "sb_secret_evolution_proxy_0123456789abcdef";
const legacyServiceRole =
  "legacyHeader0123456789.legacyPayload0123456789.legacySignature0123456789";
const userJwt = "user-header.user-payload.user-signature";
const userId = "00000000-0000-4000-8000-000000000001";

function request(headers = {}) {
  return new Request("https://functions.example.test/evolution-go-proxy", {
    method: "POST",
    headers,
  });
}

function authClient() {
  return {
    auth: {
      async getUser(token) {
        if (token === userJwt) return { data: { user: { id: userId } }, error: null };
        return { data: { user: null }, error: new Error("invalid user token") };
      },
    },
  };
}

async function loadAuthenticate() {
  const source = await readFile(edgePath, "utf8");
  const sourceFile = ts.createSourceFile(
    "evolution-go-proxy.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const names = new Set(["createSupabaseAdminClient", "authenticate"]);
  const declarations = sourceFile.statements.filter(
    (statement) => ts.isFunctionDeclaration(statement) && names.has(statement.name?.text || ""),
  );
  assert.equal(declarations.length, names.size, "missing auth source declaration");

  const compiled = ts.transpileModule(
    `${declarations.map((declaration) => declaration.getText(sourceFile)).join("\n")}
globalThis.__contract = { createSupabaseAdminClient, authenticate };`,
    {
      compilerOptions: {
        module: ts.ModuleKind.None,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const context = vm.createContext({
    authorizePrivateWorkerRequest,
    selectSupabaseAdminSecretKey,
    SUPABASE_URL: "https://project.supabase.test",
    createClient: (url, key) => ({ url, key }),
  });
  vm.runInContext(compiled, context);
  return { source, ...context.__contract };
}

test("opaque apikey and legacy service-role Bearer authenticate as private workers", async () => {
  const { authenticate } = await loadAuthenticate();

  const opaqueResult = await authenticate(
    request({ apikey: opaqueSecret, authorization: `Bearer ${opaqueSecret}` }),
    { SUPABASE_SECRET_KEY: opaqueSecret },
    authClient(),
  );
  assert.equal(opaqueResult.serviceRole, true);
  assert.equal(opaqueResult.userId, "service_role");

  const legacyResult = await authenticate(
    request({ authorization: `Bearer ${legacyServiceRole}` }),
    { SUPABASE_SERVICE_ROLE_KEY: legacyServiceRole },
    authClient(),
  );
  assert.equal(legacyResult.serviceRole, true);
  assert.equal(legacyResult.userId, "service_role");
});

test("browser anon apikey plus a user Bearer remains user-scoped", async () => {
  const { authenticate } = await loadAuthenticate();
  const result = await authenticate(
    request({ apikey: "anon-public-key", authorization: `Bearer ${userJwt}` }),
    { SUPABASE_SECRET_KEY: opaqueSecret },
    authClient(),
  );

  assert.equal(result.serviceRole, false);
  assert.equal(result.userId, userId);
});

test("anon, invalid, and conflicting credentials never become service-role", async () => {
  const { authenticate } = await loadAuthenticate();
  const environment = {
    SUPABASE_SECRET_KEY: opaqueSecret,
    SUPABASE_SERVICE_ROLE_KEY: legacyServiceRole,
  };
  const cases = [
    request({ apikey: "anon-public-key" }),
    request({ apikey: `${opaqueSecret}-wrong` }),
    request({ authorization: "Bearer invalid-user-jwt" }),
    request({ apikey: `${opaqueSecret}-wrong`, authorization: `Bearer ${legacyServiceRole}` }),
  ];

  for (const incoming of cases) {
    const result = await authenticate(incoming, environment, authClient());
    assert.notEqual(result.serviceRole, true);
    assert.equal(result.error, "Unauthorized");
  }
});

test("the selected rotating admin secret is the only key passed to createClient", async () => {
  const { source, createSupabaseAdminClient } = await loadAuthenticate();
  const handlerStart = source.indexOf("Deno.serve(async (req) =>");
  const handler = source.slice(handlerStart);
  const rotatedSecret = "sb_secret_evolution_rotation_abcdef0123456789";
  const admin = createSupabaseAdminClient({
    SUPABASE_SECRET_KEYS: JSON.stringify({
      rotation: rotatedSecret,
      default: opaqueSecret,
    }),
    SUPABASE_SERVICE_ROLE_KEY: legacyServiceRole,
  });

  assert.equal(admin.url, "https://project.supabase.test");
  assert.equal(admin.key, opaqueSecret);
  assert.ok(handlerStart >= 0);
  assert.match(handler, /const secretEnvironment = readSupabaseSecretKeyEnvironment\(\)/);
  assert.match(handler, /const supabaseAdmin = createSupabaseAdminClient\(secretEnvironment\)/);
  assert.match(handler, /authenticate\(req, secretEnvironment, supabaseAdmin\)/);
  assert.match(source, /const supabaseAdminKey = selectSupabaseAdminSecretKey\(secretEnvironment\)/);
  assert.match(source, /createClient\(SUPABASE_URL, supabaseAdminKey\)/);
  assert.doesNotMatch(source, /Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)/);
  assert.doesNotMatch(source, /bearer === SERVICE_KEY/);
});
