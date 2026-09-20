import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const retiredAuxiliaryFunctions = [
  "ai-agent-responder",
  "calculate-first-response",
  "evolution-webhook",
  "message-sender",
  "sync-whatsapp-contacts",
  "threecplus-webhook",
  "whatsapp-notifier",
];

async function source(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

test("legacy auxiliary WhatsApp functions stay retired and unroutable", async () => {
  const [manifestSource, config] = await Promise.all([
    source("supabase/functions/production-manifest.json"),
    source("supabase/config.toml"),
  ]);
  const manifest = JSON.parse(manifestSource);
  const functions = new Map(
    manifest.functions.map((entry) => [entry.slug, entry]),
  );

  for (const functionName of retiredAuxiliaryFunctions) {
    const entry = functions.get(functionName);
    assert.ok(entry, `${functionName} must remain in the deployment inventory`);
    assert.equal(entry.status, "RETIRED", `${functionName} must not be executable`);
    assert.equal(entry.lifecycle, "RETIRED", `${functionName} must stay retired`);
    assert.equal(
      entry.auth_boundary,
      "NOT_ROUTABLE",
      `${functionName} must have no callable auth boundary`,
    );
    assert.doesNotMatch(
      config,
      new RegExp(`^\\[functions\\.${functionName}\\]\\s*$`, "m"),
      `${functionName} must stay absent from supabase/config.toml`,
    );
  }
});

test("legacy whatsapp-notifier is a provider-free 410 tombstone", async () => {
  const notifier = await source("supabase/functions/whatsapp-notifier/index.ts");

  assert.match(notifier, /status:\s*410/);
  assert.match(notifier, /whatsapp_notifier_retired/);
  assert.match(notifier, /Cache-Control["']?:\s*["']no-store/);
  assert.doesNotMatch(
    notifier,
    /createClient|SUPABASE_SERVICE_ROLE_KEY|EVOLUTION|\.from\s*\(|\bfetch\s*\(/,
  );
});

test("message-sender pins history and effects to the immutable outbox card", async () => {
  const sender = await source("supabase/functions/message-sender/index.ts");
  const loopStart = sender.indexOf("for (const owned of ownedMessages)");
  const providerBoundary = sender.indexOf("const data = provider ===", loopStart);
  const preProvider = sender.slice(loopStart, providerBoundary);

  assert.ok(loopStart >= 0 && providerBoundary > loopStart);
  assert.match(sender, /const messageLeadId = message\.lead_id \|\| null/);
  assert.doesNotMatch(sender, /message\.lead_id \|\| message\.conversation\?\.lead_id/);
  assert.match(preProvider, /loadOutboundBindingSnapshot\(supabase, message\)/);
  assert.match(sender, /\.from\("whatsapp_conversation_lead_bindings"\)/);
  assert.match(sender, /\.eq\("updated_at", snapshot\.conversationUpdatedAt\)/);
  assert.match(sender, /const deliveredLeadId = bindingSnapshot\.leadId/);
  assert.doesNotMatch(sender, /const \{ data: convData \}/);
});

test("contact sync uses a conversation CAS and never copies a stale avatar to a lead", async () => {
  const sync = await source("supabase/functions/sync-whatsapp-contacts/index.ts");

  assert.match(sync, /whatsapp_conversation_lead_bindings/);
  assert.match(sync, /assertWhatsAppConversationBindingSnapshot/);
  assert.match(sync, /\.eq\("updated_at", snapshot\.conversationUpdatedAt\)/);
  assert.match(sync, /Skipped WhatsApp contact update after binding CAS loss/);
  assert.doesNotMatch(sync, /\.from\("leads"\)/);
  assert.doesNotMatch(sync, /whatsapp_avatar_url\s*:/);
});
