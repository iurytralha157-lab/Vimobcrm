import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const retirementRoot = path.join(root, "deploy", "edge-retirement");
const retiredFunctions = [
  "evolution-go-webhook",
  "evolution-go-proxy",
  "whatsapp-notifier",
  "whatsapp-history-access",
];

test("WhatsApp Edge tombstones fail closed without external I/O", async () => {
  const shared = await readFile(path.join(retirementRoot, "_shared", "retired.ts"), "utf8");
  assert.match(shared, /status:\s*410/);
  assert.match(shared, /cache-control["']?:\s*["']no-store/);
  assert.doesNotMatch(shared, /createClient|fetch\s*\(|SUPABASE_SERVICE_ROLE_KEY|EVOLUTION/i);

  for (const functionName of retiredFunctions) {
    const source = await readFile(path.join(retirementRoot, functionName, "index.ts"), "utf8");
    assert.match(source, new RegExp(`serveRetiredWhatsAppFunction\\(["']${functionName}["']\\)`));
    assert.doesNotMatch(source, /createClient|fetch\s*\(|Deno\.env|get\s*\(/);
  }
});
