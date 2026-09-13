import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("legacy media-worker stays retired and fails closed", async () => {
  const manifest = JSON.parse(
    await readFile(
      path.join(root, "supabase", "functions", "production-manifest.json"),
      "utf8",
    ),
  );
  const mediaWorker = manifest.functions.find((entry) => entry.slug === "media-worker");
  assert.equal(mediaWorker?.status, "RETIRED");

  const source = await readFile(
    path.join(root, "supabase", "functions", "media-worker", "index.ts"),
    "utf8",
  );
  assert.match(source, /serveRetiredWhatsAppFunction\(["']media-worker["']\)/);
  assert.doesNotMatch(
    source,
    /createClient|fetch\s*\(|Deno\.env|SUPABASE|EVOLUTION|SERVICE_ROLE|apikey/i,
  );

  const shared = await readFile(
    path.join(root, "supabase", "functions", "_shared", "retired.ts"),
    "utf8",
  );
  assert.match(shared, /status:\s*410/);
  assert.match(shared, /cache-control["']?:\s*["']no-store/);
  assert.doesNotMatch(
    shared,
    /createClient|fetch\s*\(|Deno\.env|SUPABASE_SERVICE_ROLE_KEY|EVOLUTION/i,
  );

  const router = await readFile(
    path.join(root, "deploy", "supabase-self-hosted", "functions-main", "index.ts"),
    "utf8",
  );
  assert.match(router, /item\.status === ["']ACTIVE["']/);
});
