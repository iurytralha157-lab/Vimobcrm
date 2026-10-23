import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const organizations = [
  "10000000-0000-4000-8000-000000000001",
  "20000000-0000-4000-8000-000000000002",
];

export function userJWT(organizationId, userId = organizationId) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    sub: userId, organization_id: organizationId, role: "authenticated", aud: "authenticated",
    exp: 4_000_000_000,
  })}`;
  return `${unsigned}.${createHmac("sha256", "local-proxy-fixture-only").update(unsigned).digest("base64url")}`;
}

export async function loadProxy() {
  const source = await readFile(path.join(root, "supabase/functions/evolution-go-proxy/index.ts"), "utf8");
  const retired = await readFile(path.join(root, "supabase/functions/_shared/retired.ts"), "utf8");
  const effects = { environment: 0, database: 0, auth: 0, provider: 0 };
  let handler;
  const environment = {
    SUPABASE_URL: "https://fixture.supabase.test",
    SUPABASE_SECRET_KEY: "local-fixture-secret-key",
    EVOLUTION_GO_API_URL: "https://provider.example.test",
    EVOLUTION_GO_API_KEY: "local-fixture-provider-key",
  };
  const admin = {
    auth: { getUser: async jwt => {
      effects.auth += 1;
      const claims = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
      return { data: { user: { id: claims.sub } }, error: null };
    } },
    from: () => {
      effects.database += 1;
      let id;
      const query = {
        select: () => query,
        eq: (key, value) => { if (key === "id") id = value; return query; },
        maybeSingle: async () => ({ data: {
          id, owner_user_id: id, organization_id: id, instance_name: `fixture-${id}`,
          provider: "evolution_go", advanced_settings: { token: "local-fixture-instance-token" },
        }, error: null }),
        update: () => query,
      };
      return query;
    },
  };
  const context = vm.createContext({
    Response, Request, URL, AbortController, setTimeout, clearTimeout,
    console: { error: () => {}, warn: () => {}, log: () => {} },
    Deno: {
      serve: callback => { handler = callback; },
      env: { get: name => { effects.environment += 1; return environment[name] || ""; } },
    },
    fetch: async () => { effects.provider += 1; return Response.json({ id: "fixture-provider-id" }); },
  });
  const compile = text => ts.transpileModule(text, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const execute = text => {
    const vmModule = { exports: {} };
    const run = new vm.Script(`(function(require,module,exports){${compile(text)}\n})`).runInContext(context);
    run(specifier => {
      if (specifier.endsWith("/retired.ts")) return execute(retired);
      if (specifier.startsWith("npm:")) return { createClient: () => admin };
      if (specifier.endsWith("/private-worker-auth.ts")) return {
        authorizePrivateWorkerRequest: request => request.headers.get("apikey") === environment.SUPABASE_SECRET_KEY,
      };
      if (specifier.endsWith("/supabase-secret-keys.ts")) return {
        readSupabaseSecretKeyEnvironment: () => { effects.environment += 1; return environment; },
        selectSupabaseAdminSecretKey: values => values.SUPABASE_SECRET_KEY,
      };
      throw new Error(`Unexpected entrypoint dependency: ${specifier}`);
    }, vmModule, vmModule.exports);
    return vmModule.exports;
  };
  execute(source);
  assert.equal(typeof handler, "function", "actual entrypoint must register its handler");
  return { source, effects, handler };
}

export function proxyRequest(action, organizationId = organizations[0], overrides = {}) {
  return new Request("https://functions.example.test/evolution-go-proxy", {
    method: "POST",
    headers: { authorization: `Bearer ${userJWT(organizationId)}`, apikey: "local-public-anon-key", "content-type": "application/json" },
    body: JSON.stringify({ action, session_id: organizationId, organization_id: organizationId,
      body: { number: "5511999990000", text: "Synthetic fixture" }, ...overrides }),
  });
}

export function assertNoEffects(effects) {
  assert.deepEqual(effects, { environment: 0, database: 0, auth: 0, provider: 0 });
}
