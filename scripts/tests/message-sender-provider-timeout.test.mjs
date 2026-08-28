import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const senderPath = path.join(
  root,
  "supabase",
  "functions",
  "message-sender",
  "index.ts",
);

async function loadTimeoutContract(fetchImpl, timeoutMs = 10) {
  const source = await readFile(senderPath, "utf8");
  const sourceFile = ts.createSourceFile(
    "message-sender.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const declarations = sourceFile.statements.filter((statement) =>
    (ts.isClassDeclaration(statement) &&
      statement.name?.text === "ProviderOutcomeUnknownError") ||
    (ts.isFunctionDeclaration(statement) &&
      statement.name?.text === "fetchProviderJsonWithTimeout")
  );
  assert.equal(declarations.length, 2, "missing provider timeout contract");

  const compiled = ts.transpileModule(
    `${declarations.map((declaration) => declaration.getText(sourceFile)).join("\n")}
globalThis.__contract = { ProviderOutcomeUnknownError, fetchProviderJsonWithTimeout };`,
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
    fetch: fetchImpl,
    JSON,
    PROVIDER_REQUEST_TIMEOUT_MS: timeoutMs,
    setTimeout,
  });
  vm.runInContext(compiled, context);
  return { source, ...context.__contract };
}

function assertOutcomeUnknown(error) {
  assert.equal(error?.name, "ProviderOutcomeUnknownError");
  assert.match(error?.message || "", /timed out after crossing the provider boundary/);
  return true;
}

test("sender aborts a hanging provider fetch and classifies it as outcome-unknown", async () => {
  let observedSignal;
  const { fetchProviderJsonWithTimeout } = await loadTimeoutContract(
    async (_url, init) => {
      observedSignal = init.signal;
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener(
          "abort",
          () => reject(new Error("request aborted")),
          { once: true },
        );
      });
    },
    5,
  );

  await assert.rejects(
    fetchProviderJsonWithTimeout(
      "https://provider.example.test/send",
      { method: "POST" },
      "Provider",
    ),
    assertOutcomeUnknown,
  );
  assert.equal(observedSignal.aborted, true);
});

test("sender timeout also covers a response body that never completes", async () => {
  let observedSignal;
  const { fetchProviderJsonWithTimeout } = await loadTimeoutContract(
    async (_url, init) => {
      observedSignal = init.signal;
      return {
        async text() {
          return new Promise((_resolve, reject) => {
            observedSignal.addEventListener(
              "abort",
              () => reject(new Error("body read aborted")),
              { once: true },
            );
          });
        },
      };
    },
    5,
  );

  await assert.rejects(
    fetchProviderJsonWithTimeout(
      "https://provider.example.test/send",
      { method: "POST" },
      "Provider",
    ),
    assertOutcomeUnknown,
  );
  assert.equal(observedSignal.aborted, true);
});

test("completed requests clear their timer and preserve parsed JSON", async () => {
  let observedSignal;
  const { fetchProviderJsonWithTimeout } = await loadTimeoutContract(
    async (_url, init) => {
      observedSignal = init.signal;
      return {
        ok: true,
        status: 200,
        async text() {
          return '{"ok":true}';
        },
      };
    },
    5,
  );

  const result = await fetchProviderJsonWithTimeout(
    "https://provider.example.test/send",
    { method: "POST" },
    "Provider",
  );
  await new Promise((resolve) => setTimeout(resolve, 15));

  assert.equal(result.parsed, true);
  assert.equal(result.data.ok, true);
  assert.equal(observedSignal.aborted, false);
});

test("both provider paths validate local configuration before using the timeout boundary", async () => {
  const source = await readFile(senderPath, "utf8");
  const goStart = source.indexOf("async function sendViaEvolutionGo")
  const legacyStart = source.indexOf("async function sendViaEvolutionLegacy", goStart)
  const handlerStart = source.indexOf("Deno.serve(async (req) =>", legacyStart)
  const go = source.slice(goStart, legacyStart)
  const legacy = source.slice(legacyStart, handlerStart)

  assert.ok(goStart >= 0 && legacyStart > goStart && handlerStart > legacyStart)
  assert.ok(
    go.indexOf("Evolution Go proxy configuration missing") <
      go.indexOf("fetchProviderJsonWithTimeout("),
  )
  assert.ok(
    go.indexOf("Evolution Go proxy URL is invalid") <
      go.indexOf("fetchProviderJsonWithTimeout("),
  )
  assert.ok(
    legacy.indexOf("Evolution API not configured") <
      legacy.indexOf("fetchProviderJsonWithTimeout("),
  )
  assert.ok(
    legacy.indexOf("Evolution API URL is invalid") <
      legacy.indexOf("fetchProviderJsonWithTimeout("),
  )
  assert.doesNotMatch(go, /await fetch\(/)
  assert.doesNotMatch(legacy, /await fetch\(/)

  const uncertainStart = source.indexOf(
    "if (providerAccepted || error instanceof ProviderOutcomeUnknownError)",
  )
  const retryStart = source.indexOf("const failedAttemptPlan", uncertainStart)
  const uncertain = source.slice(uncertainStart, retryStart)
  assert.match(uncertain, /status: "failed"/)
  assert.doesNotMatch(uncertain, /status:\s*"pending"/)
});
