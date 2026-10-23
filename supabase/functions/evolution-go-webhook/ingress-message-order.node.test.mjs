import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { whatsappCTWAConfirmationMethod } from "../_shared/whatsapp-ctwa.ts";
import { isEncryptedWhatsAppMediaURL } from "./media-security.ts";
import * as structuredContent from "./structured-content.ts";

// Execute the production parser, routing validator and ordering function without
// loading the Deno server or its privileged client.
const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const parsed = ts.createSourceFile("index.ts", source, ts.ScriptTarget.Latest, true);
const declarations = parsed.statements.filter(ts.isFunctionDeclaration).map((node) => node.getText(parsed));
const compiled = ts.transpileModule(declarations.join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const context = vm.createContext({ ...structuredContent, whatsappCTWAConfirmationMethod, isEncryptedWhatsAppMediaURL });
vm.runInContext(compiled, context);

const session = {
  organization_id: "af200000-0000-4000-8000-000000000001",
  id: "af400000-0000-4000-8000-000000000001",
};
const authorization = { contract: "internal_worker_lease" };
const raw = (id) => ({
  rawMessage: { Info: { ID: id, Chat: "5511999991234@s.whatsapp.net", Timestamp: "2026-10-11T12:00:00Z" }, Message: { conversation: id } },
  envelope: null,
});
const snapshot = (id, sequence) => ({
  version: 1, organization_id: session.organization_id, session_id: session.id,
  provider_message_id: id, state: "unlinked", context_kind: "organic", inbox_event_key: "batch-order-fixture",
  processing_lane: "live", routing_key: "direct-contact", binding_eligible: false, target_mode: "snapshot",
  ingress_sequence: sequence, managed_message_distribution: false, managed_event_pending: false, managed_event_handled: false,
});
const payload = (rows) => ({ __vimob_ingress: { routing_snapshot: { version: 1, messages: rows } } });

test("batch ordering validates normalized provider identity before sorting wrappers", () => {
  const messages = [raw("third"), raw("first"), raw("second")];
  const result = context.orderMessagesByIngressRoutingSnapshot(payload([
    snapshot("first", 10), snapshot("second", 11), snapshot("third", 12),
  ]), session, messages, authorization);
  assert.deepEqual(Array.from(result, (message) => message.rawMessage.Info.ID), ["first", "second", "third"]);
  assert.equal(result[0], messages[1]);
  assert.equal(result[1], messages[2]);
});

test("batch ordering rejects missing, ambiguous and cross-tenant provenance", () => {
  const messages = [raw("first"), raw("second")];
  assert.throws(() => context.orderMessagesByIngressRoutingSnapshot(payload([snapshot("first", 10)]), session, messages, authorization), /snapshot_message_missing/);
  assert.throws(() => context.orderMessagesByIngressRoutingSnapshot(payload([snapshot("first", 10), snapshot("second", 10)]), session, messages, authorization), /snapshot_sequence_ambiguous/);
  const wrongTenant = { ...snapshot("second", 11), organization_id: "af200000-0000-4000-8000-000000000002" };
  assert.throws(() => context.orderMessagesByIngressRoutingSnapshot(payload([snapshot("first", 10), wrongTenant]), session, messages, authorization), /snapshot_scope_invalid/);
});
