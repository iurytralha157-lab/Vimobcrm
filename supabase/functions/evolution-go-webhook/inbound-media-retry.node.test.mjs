import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const start = source.indexOf("async function reconcileHandledWhatsAppMessageTransport(");
const end = source.indexOf("function normalizeMessage(", start);
assert.ok(start > 0 && end > start);
const transportSource = stripTypeScriptTypes(source.slice(start, end), { mode: "strip" });

const session = {
  id: "22222222-2222-4222-8222-222222222222",
  organization_id: "11111111-1111-4111-8111-111111111111",
};
const stored = {
  id: "33333333-3333-4333-8333-333333333333",
  conversation_id: "44444444-4444-4444-8444-444444444444",
  lead_id: null,
  from_me: false,
  capture_state: "recorded",
  media_storage_path: null,
  media_status: "pending",
};
const message = {
  messageId: "provider-media-1",
  messageType: "image",
  fromMe: false,
  mediaUrl: null,
  mediaMimeType: "image/jpeg",
  mediaSize: 1200,
};

function buildTransport({ existing = stored, media = { path: null, status: "pending", error: "media_provider_timeout" } } = {}) {
  const writes = [];
  let mediaRecoveryCalls = 0;
  const supabase = {
    from(table) {
      assert.equal(table, "whatsapp_messages");
      const conditions = [];
      let fields;
      const query = {
        update(value) { fields = value; return query; },
        eq(column, value) { conditions.push([column, value]); return query; },
        is(column, value) { conditions.push([column, value]); return query; },
        select() { return query; },
        async maybeSingle() {
          writes.push({ fields, conditions });
          return { data: { id: existing.id }, error: null };
        },
      };
      return query;
    },
  };
  const dependencies = {
    findMessageByProviderIdentity: async () => existing,
    optionalUuid: (value) => value || null,
    persistedWhatsAppMessageCaptureState: (row) => row?.capture_state || null,
    normalizeText: (value) => typeof value === "string" ? value : "",
    redactSuppressedStoredMessage: async () => { throw new Error("unexpected redaction"); },
    storeInboundMedia: async () => { mediaRecoveryCalls += 1; return media; },
    supabase,
  };
  const transport = new Function(
    ...Object.keys(dependencies),
    `${transportSource}\nreturn reconcileHandledWhatsAppMessageTransport;`,
  )(...Object.values(dependencies));
  return { transport, writes, get mediaRecoveryCalls() { return mediaRecoveryCalls; } };
}

test("pending media remains retryable and updates only the original message", async () => {
  const run = buildTransport();
  assert.equal(await run.transport(session, message, stored), false);
  assert.equal(run.mediaRecoveryCalls, 1);
  assert.equal(run.writes.length, 1);
  assert.equal(run.writes[0].fields.media_status, "pending");
  assert.deepEqual(run.writes[0].conditions, [
    ["organization_id", session.organization_id],
    ["session_id", session.id],
    ["id", stored.id],
    ["conversation_id", stored.conversation_id],
    ["from_me", false],
    ["lead_id", null],
    ["capture_state", "recorded"],
  ]);
});

test("successful recovery marks the original message ready", async () => {
  const path = `orgs/${session.organization_id}/sessions/${session.id}/incoming/provider-media-1.jpg`;
  const run = buildTransport({ media: { path, status: "ready", error: null, contentType: "image/jpeg", size: 1200 } });
  assert.equal(await run.transport(session, message, stored), true);
  assert.equal(run.writes[0].fields.media_status, "ready");
  assert.equal(run.writes[0].fields.media_storage_path, path);
});

test("media recovery rejects a row reattributed to another lead", async () => {
  const run = buildTransport({ existing: { ...stored, lead_id: "55555555-5555-4555-8555-555555555555" } });
  await assert.rejects(() => run.transport(session, message, stored), /whatsapp_recorded_replay_media_identity_conflict/);
  assert.equal(run.mediaRecoveryCalls, 0);
  assert.equal(run.writes.length, 0);
});
