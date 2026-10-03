import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const start = source.indexOf("async function resolveWhatsAppAttendanceCapture(");
const end = source.indexOf("async function findStoredMessage(", start);
assert.ok(start > 0 && end > start);

const resolverSource = stripTypeScriptTypes(source.slice(start, end), { mode: "strip" });
const session = {
  id: "22222222-2222-4222-8222-222222222222",
  organization_id: "11111111-1111-4111-8111-111111111111",
};
const conversation = { id: "33333333-3333-4333-8333-333333333333" };
const ingress = {
  inboxEventKey: "provider-event-1",
  ingressSequence: 1,
  activeBindingId: null,
  contextKind: "organic",
};
const message = {
  messageId: "provider-message-1",
  content: "Oi",
  providerOccurredAt: "2026-10-02T15:00:00.000Z",
  fromMe: false,
  isGroup: false,
  messageType: "text",
};

function buildResolver({ recording = false, owner = null, inboxCreatedAt = "2026-10-02T15:00:01.000Z" } = {}) {
  const queriedTables = [];
  const supabase = {
    from(table) {
      queriedTables.push(table);
      const query = {
        select() { return query; },
        eq() { return query; },
        is() { return query; },
        maybeSingle: async () => {
          if (table === "whatsapp_webhook_inbox") return { data: { created_at: inboxCreatedAt }, error: null };
          if (table === "whatsapp_conversation_lead_bindings") {
            return { data: { id: "44444444-4444-4444-8444-444444444444" }, error: null };
          }
          if (table === "whatsapp_sessions") return { data: { ...session, owner_user_id: owner }, error: null };
          throw new Error(`Unexpected query of ${table}`);
        },
      };
      return query;
    },
  };
  const dependencies = {
    sha256Hex: async () => "a".repeat(64),
    cleanText: (value) => typeof value === "string" ? value.trim() || null : null,
    persistedWhatsAppMessageCaptureState: (stored) => stored?.capture_state || null,
    inboundRecordingEnabledForSession: () => recording,
    optionalUuid: (value) => value || null,
    resolveActiveSessionOwner: async () => owner,
    isConfirmedClickToWhatsAppAd: () => false,
    supabase,
  };
  const names = Object.keys(dependencies);
  const values = Object.values(dependencies);
  const resolver = new Function(...names, `${resolverSource}\nreturn resolveWhatsAppAttendanceCapture;`)(...values);
  return { resolver, queriedTables };
}

function decide(resolver, { leadId = null, current = true, snapshot = ingress, incoming = message, stored = null } = {}) {
  return resolver(session, conversation, leadId, current, snapshot, incoming, null, stored);
}

test("recording off keeps a new contact without a lead suppressed", async () => {
  const { resolver, queriedTables } = buildResolver();
  assert.equal((await decide(resolver)).captureState, "suppressed");
  assert.deepEqual(queriedTables, []);
});

test("recording on retains a new contact without a lead after durable ingress", async () => {
  const { resolver, queriedTables } = buildResolver({ recording: true });
  const result = await decide(resolver);
  assert.equal(result.captureState, "recorded");
  assert.equal(result.reason, "inbound_contact_history");
  assert.deepEqual(queriedTables, ["whatsapp_webhook_inbox"]);
});

test("a previously suppressed message remains suppressed on retry", async () => {
  const { resolver, queriedTables } = buildResolver({ recording: true });
  const result = await decide(resolver, { stored: { capture_state: "suppressed" } });
  assert.equal(result.captureState, "suppressed");
  assert.deepEqual(queriedTables, []);
});

test("recording rejects quarantine, missing ingress and provider time", async () => {
  const { resolver, queriedTables } = buildResolver({ recording: true });
  assert.equal((await decide(resolver, { current: false })).captureState, "suppressed");
  assert.equal((await decide(resolver, { snapshot: null })).captureState, "suppressed");
  assert.equal((await decide(resolver, { incoming: { ...message, providerOccurredAt: null } })).captureState, "suppressed");
  assert.deepEqual(queriedTables, []);
});

test("recording retains a lead message without attendance and leaves outbound alone", async () => {
  const { resolver } = buildResolver({ recording: true });
  const leadId = "55555555-5555-4555-8555-555555555555";
  assert.equal((await decide(resolver, { leadId })).captureState, "recorded");
  assert.equal((await decide(resolver, { incoming: { ...message, fromMe: true } })).captureState, "suppressed");
  assert.equal((await decide(resolver, { incoming: { ...message, isGroup: true } })).captureState, "suppressed");
});
