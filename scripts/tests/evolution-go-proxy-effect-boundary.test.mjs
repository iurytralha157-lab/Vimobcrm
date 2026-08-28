import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const proxyPath = path.join(
  root,
  "supabase",
  "functions",
  "evolution-go-proxy",
  "index.ts",
);

async function loadEvolutionFetch({
  apiUrl = "https://evolution.example.test",
  apiKey = "provider-secret",
  timeoutMs = 50,
  fetchImpl,
} = {}) {
  const source = await readFile(proxyPath, "utf8");
  const sourceFile = ts.createSourceFile(
    "evolution-go-proxy.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const declaration = sourceFile.statements.find(
    (statement) =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === "evolutionFetch",
  );
  assert.ok(declaration, "missing evolutionFetch declaration");

  const compiled = ts.transpileModule(
    `${declaration.getText(sourceFile)}\nglobalThis.__contract = evolutionFetch;`,
    {
      compilerOptions: {
        module: ts.ModuleKind.None,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const context = vm.createContext({
    AbortController,
    clearTimeout,
    EVOLUTION_GO_API_KEY: apiKey,
    EVOLUTION_GO_API_URL: apiUrl,
    EVOLUTION_GO_REQUEST_TIMEOUT_MS: timeoutMs,
    fetch: fetchImpl,
    JSON,
    setTimeout,
    URL,
  });
  vm.runInContext(compiled, context);
  return { source, evolutionFetch: context.__contract };
}

test("configuration failure is provably before the provider boundary", async () => {
  let boundaryCalls = 0;
  let fetchCalls = 0;
  const { evolutionFetch } = await loadEvolutionFetch({
    apiUrl: "",
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response();
    },
  });

  await assert.rejects(
    evolutionFetch("POST", "/message/send", {
      markBackendFetchAttempted: () => {
        boundaryCalls += 1;
      },
    }),
    /configuration missing/,
  );
  assert.equal(boundaryCalls, 0);
  assert.equal(fetchCalls, 0);
});

test("provider 5xx crosses the boundary and remains an explicit provider result", async () => {
  let boundaryCalls = 0;
  let observedSignal;
  const { evolutionFetch } = await loadEvolutionFetch({
    fetchImpl: async (_url, init) => {
      observedSignal = init.signal;
      return new Response('{"error":"unavailable"}', {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    },
  });

  const result = await evolutionFetch("POST", "/message/send", {
    body: { text: "hello" },
    markBackendFetchAttempted: () => {
      boundaryCalls += 1;
    },
  });

  assert.equal(boundaryCalls, 1);
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
  assert.ok(observedSignal instanceof AbortSignal);
});

test("timeout aborts the backend fetch after the effect boundary", async () => {
  let boundaryCalls = 0;
  const { evolutionFetch } = await loadEvolutionFetch({
    timeoutMs: 5,
    fetchImpl: async (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener(
          "abort",
          () => reject(new Error("backend request aborted")),
          { once: true },
        );
      }),
  });

  await assert.rejects(
    evolutionFetch("POST", "/message/send", {
      body: { text: "hello" },
      markBackendFetchAttempted: () => {
        boundaryCalls += 1;
      },
    }),
    /backend request aborted/,
  );
  assert.equal(boundaryCalls, 1);
});

test("proxy exposes effect_not_attempted only while the backend boundary is un-crossed", async () => {
  const [proxySource, senderSource] = await Promise.all([
    readFile(proxyPath, "utf8"),
    readFile(
      path.join(root, "supabase", "functions", "message-sender", "index.ts"),
      "utf8",
    ),
  ]);

  assert.equal(proxySource.match(/effect_not_attempted: true/g)?.length, 2);
  assert.match(
    proxySource,
    /status >= 500 && !backendFetchAttempted[\s\S]*effect_not_attempted: true/,
  );
  assert.match(proxySource, /signal: abortController\.signal/);
  assert.match(proxySource, /clearTimeout\(timeout\)/);

  const failureStart = senderSource.indexOf("if (!response.ok || !data?.ok)");
  const ambiguityStart = senderSource.indexOf(
    "if (isAmbiguousProviderFailure(providerStatus))",
    failureStart,
  );
  const failureBranch = senderSource.slice(failureStart, ambiguityStart);
  assert.match(failureBranch, /data\?\.effect_not_attempted === true/);
  assert.match(failureBranch, /throw new Error\(/);
});
