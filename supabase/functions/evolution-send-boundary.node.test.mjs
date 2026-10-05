import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const sessionId = "11111111-1111-4111-8111-111111111111";

function bootProxy(slug) {
  const source = readFileSync(new URL(`./${slug}/index.ts`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const providerRequests = [];
  const databaseReads = [];
  let handler;
  const session = {
    id: sessionId,
    owner_user_id: "owner",
    instance_name: "test-instance",
    advanced_settings: {},
  };
  const supabase = {
    auth: {
      getUser: async () => ({ data: { user: { id: "owner" } }, error: null }),
      getClaims: async () => ({ data: { claims: { role: "service_role" } } }),
    },
    from(table) {
      databaseReads.push(table);
      return {
        select() {
          return {
            eq() {
              return { maybeSingle: async () => ({ data: session, error: null }) };
            },
          };
        },
      };
    },
  };
  const imports = {
    "npm:@supabase/supabase-js@2": { createClient: () => supabase },
    "../_shared/private-worker-auth.ts": { authorizePrivateWorkerRequest: () => true },
    "../_shared/supabase-secret-keys.ts": {
      readSupabaseSecretKeyEnvironment: () => ({}),
      selectSupabaseAdminSecretKey: () => "service-role-test-key",
    },
    "../_shared/rate-limit.ts": { enforceRateLimit: async () => ({ response: null }) },
  };
  const environment = {
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test-key",
    EVOLUTION_GO_API_URL: "https://evolution-go.test",
    EVOLUTION_GO_API_KEY: "evolution-go-test-key",
    EVOLUTION_API_URL: "https://evolution.test",
    EVOLUTION_API_KEY: "evolution-test-key",
  };
  vm.runInNewContext(compiled, {
    exports: {},
    require(specifier) {
      assert.ok(specifier in imports, `unexpected import: ${specifier}`);
      return imports[specifier];
    },
    Deno: {
      env: { get: (name) => environment[name] },
      serve(callback) { handler = callback; },
    },
    fetch: async (url, options) => {
      providerRequests.push({ url: String(url), options });
      return new Response(JSON.stringify({ state: "open", labels: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
    Request,
    Response,
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    console: { log() {}, error() {} },
  }, { filename: `${slug}/index.ts` });
  assert.equal(typeof handler, "function");
  return { handler, providerRequests, databaseReads };
}

function invoke(proxy, slug, action, body = {}) {
  const request = new Request(`https://supabase.test/functions/v1/${slug}`, {
    method: "POST",
    headers: {
      Authorization: "Bearer service-role-test-key",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action, session_id: sessionId, instanceName: "test-instance", body }),
  });
  return proxy.handler(request);
}

test("Evolution Go proxy rejects every direct message mutation before session or provider access", async () => {
  const proxy = bootProxy("evolution-go-proxy");
  for (const action of [
    "send.text", "send.media", "send.audio", "send.sticker", "send.location",
    "send.contact", "send.link", "send.poll", "send.futureAction",
    "message.react", "message.edit", "message.delete",
  ]) {
    const response = await invoke(proxy, "evolution-go-proxy", action, { number: "5511999999999", text: "test" });
    assert.equal(response.status, 410, action);
    const result = await response.json();
    assert.equal(result.ok, false, action);
    assert.equal(result.effect_not_attempted, true, action);
  }
  assert.equal(proxy.databaseReads.length, 0);
  assert.equal(proxy.providerRequests.length, 0);
});

test("Evolution Go proxy still allows a non-send provider read", async () => {
  const proxy = bootProxy("evolution-go-proxy");
  const response = await invoke(proxy, "evolution-go-proxy", "label.list");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
  assert.deepEqual(proxy.databaseReads, ["whatsapp_sessions"]);
  assert.equal(proxy.providerRequests.length, 1);
  assert.equal(new URL(proxy.providerRequests[0].url).pathname, "/label");
});

test("Evolution Go proxy keeps mark-read and session operations available", async () => {
  const proxy = bootProxy("evolution-go-proxy");
  const markRead = await invoke(proxy, "evolution-go-proxy", "message.markread", {
    allowWhatsAppReadReceipt: true,
    jid: "5511999999999@s.whatsapp.net",
    messageIds: ["provider-message-id"],
  });
  assert.equal(markRead.status, 200);
  assert.equal((await markRead.json()).ok, true);
  const connect = await invoke(proxy, "evolution-go-proxy", "instance.connect");
  assert.equal(connect.status, 200);
  assert.equal((await connect.json()).ok, true);
  assert.deepEqual(
    proxy.providerRequests.map((request) => new URL(request.url).pathname),
    ["/message/markread", "/instance/connect"],
  );
});

test("frontend Evolution Go wrapper refuses direct message mutations without calling the API", async () => {
  const source = readFileSync(new URL("../../hooks/use-evolution-go.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const requests = [];
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require(specifier) {
      if (specifier === "@tanstack/react-query") return { useMutation() {} };
      if (specifier === "@/lib/api/whatsapp") {
        return { whatsappAPI: { providerAction: async (payload) => {
          requests.push(payload);
          return { ok: true };
        } } };
      }
      assert.fail(`unexpected import: ${specifier}`);
    },
  });
  for (const action of ["send.text", "message.react", "message.edit", "message.delete"]) {
    const result = await exports.callEvolutionGo(action, { session_id: sessionId });
    assert.equal(result.ok, false, action);
  }
  assert.equal(requests.length, 0);
  const markRead = await exports.callEvolutionGo("message.markread", { session_id: sessionId });
  assert.equal(markRead.ok, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].action, "message.markread");
});

test("legacy Evolution proxy rejects text and media sends before provider access", async () => {
  const proxy = bootProxy("evolution-proxy");
  for (const action of ["sendMessage", "sendFile"]) {
    const response = await invoke(proxy, "evolution-proxy", action);
    assert.equal(response.status, 403, action);
    const result = await response.json();
    assert.equal(result.success, false, action);
    assert.equal(result.effect_not_attempted, true, action);
  }
  assert.equal(proxy.databaseReads.length, 0);
  assert.equal(proxy.providerRequests.length, 0);
});

test("legacy Evolution proxy still allows a non-send status read", async () => {
  const proxy = bootProxy("evolution-proxy");
  const response = await invoke(proxy, "evolution-proxy", "getConnectionStatus");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).success, true);
  assert.equal(proxy.providerRequests.length, 1);
  assert.equal(new URL(proxy.providerRequests[0].url).pathname, "/instance/connectionState/test-instance");
});
