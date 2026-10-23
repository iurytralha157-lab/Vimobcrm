import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createWhatsAppSoundGate } from "../lib/whatsapp-sound-message.ts";

const source = readFileSync(new URL("./BackendRealtimeBus.tsx", import.meta.url), "utf8");
const parsed = ts.createSourceFile("BackendRealtimeBus.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const handler = parsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "handleWhatsAppEvent");
assert.ok(handler, "production WhatsApp handler must be present");
const compiled = ts.transpileModule(handler.getText(parsed), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

test("global durable SSE reaches the audio gate without an open lead and deduplicates private broadcast", () => {
  const emitted = [];
  const context = vm.createContext({
    WHATSAPP_MESSAGE_EVENTS: new Set(["whatsapp.message.created", "whatsapp.message.received", "whatsapp.message.updated", "whatsapp.message.sent"]),
    getString: (data, key) => typeof data?.[key] === "string" ? data[key] : "",
    notifyLeadRealtimeChange: () => {},
    window: { dispatchEvent: (event) => emitted.push(event) },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
  });
  vm.runInContext(compiled, context);
  const data = { conversationId: "conversation-a", leadId: "lead-a", sessionId: "session-a", messageId: "message-a", fromMe: false, direction: "inbound", captureState: "captured", attendantUserId: "user-a", createdAt: new Date(20_000).toISOString() };
  const queryClient = { invalidateQueries: async () => {} };
  context.handleWhatsAppEvent({ type: "whatsapp.message.created", organizationId: "org-a", data, createdAt: new Date(21_000) }, queryClient);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].type, "vimob:whatsapp-message-insert");
  const gate = createWhatsAppSoundGate("org-a", "user-a", 20_000);
  assert.equal(gate(emitted[0].detail, 21_000), true);
  assert.equal(gate({ ...data, operation: "INSERT", organizationId: "org-a" }, 24_000), false);
  context.handleWhatsAppEvent({ type: "whatsapp.message.updated", organizationId: "org-a", data }, queryClient);
  assert.equal(gate(emitted[1].detail, 24_000), false);
  const otherAttendant = createWhatsAppSoundGate("org-a", "user-b", 20_000);
  assert.equal(otherAttendant(emitted[0].detail, 21_000), false);
  const staleGate = createWhatsAppSoundGate("org-a", "user-a", 0);
  assert.equal(staleGate(emitted[0].detail, 60_000), false);
});
