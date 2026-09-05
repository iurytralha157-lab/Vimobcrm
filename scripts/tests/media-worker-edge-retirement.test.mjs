import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("legacy media-worker is a fail-closed tombstone", async () => {
  const source = await readFile(
    path.join(root, "supabase", "functions", "media-worker", "index.ts"),
    "utf8",
  );

  assert.match(source, /status:\s*410/);
  assert.match(source, /cache-control["']?:\s*["']no-store/);
  assert.match(source, /whatsapp_edge_function_retired/);
  assert.match(source, /canonical_service:\s*["']vimob_go_backend["']/);
  assert.doesNotMatch(
    source,
    /createClient|fetch\s*\(|Deno\.env|SUPABASE|EVOLUTION|SERVICE_ROLE|apikey/i,
  );
});
