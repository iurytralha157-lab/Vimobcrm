import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function functionVerifyJwt(config, functionName) {
  const escaped = functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const section = new RegExp(
    `^\\[functions\\.${escaped}\\]\\r?\\nverify_jwt\\s*=\\s*(true|false)\\s*$`,
    "m",
  ).exec(config);
  assert.ok(section, `missing explicit gateway contract for ${functionName}`);
  return section[1] === "true";
}

test("private message functions explicitly bypass gateway JWT and authenticate in-handler", async () => {
  const [config, sender, proxy, webhook] = await Promise.all([
    readFile(path.join(root, "supabase", "config.toml"), "utf8"),
    readFile(path.join(root, "supabase", "functions", "message-sender", "index.ts"), "utf8"),
    readFile(path.join(root, "supabase", "functions", "evolution-go-proxy", "index.ts"), "utf8"),
    readFile(path.join(root, "supabase", "functions", "evolution-webhook", "index.ts"), "utf8"),
  ]);

  for (const functionName of [
    "message-sender",
    "evolution-go-proxy",
    "evolution-webhook",
  ]) {
    assert.equal(functionVerifyJwt(config, functionName), false);
  }

  assert.match(sender, /authorizePrivateWorkerRequest\(req, secretEnvironment\)/);
  assert.match(proxy, /authenticate\(req, secretEnvironment, supabaseAdmin\)/);
  assert.match(webhook, /authorizeEvolutionWebhookIngressRequest\(req,/);
});
