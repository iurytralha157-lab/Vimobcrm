import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const retiredMetaFunctions = [
  "instagram-oauth",
  "meta-campaign-insights",
  "meta-messenger-proxy",
  "meta-oauth",
  "meta-token-healthcheck",
  "meta-webhook",
  "meta-webhook-replay",
];

test("legacy Meta Edge Functions stay outside the executable manifest", async () => {
  const manifest = JSON.parse(
    await readFile(
      path.join(root, "supabase", "functions", "production-manifest.json"),
      "utf8",
    ),
  );
  const functions = new Map(
    manifest.functions.map((entry) => [entry.slug, entry]),
  );

  for (const functionName of retiredMetaFunctions) {
    assert.equal(
      functions.get(functionName)?.status,
      "RETIRED",
      `${functionName} must not be executable`,
    );
  }

  const router = await readFile(
    path.join(
      root,
      "deploy",
      "supabase-self-hosted",
      "functions-main",
      "index.ts",
    ),
    "utf8",
  );
  assert.match(router, /item\.status === ['"]ACTIVE['"]/);
});
