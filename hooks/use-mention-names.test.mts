import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync("hooks/use-mention-names.ts", "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;
const moduleShim = { exports: {} };
vm.runInNewContext(`${compiled}\nmodule.exports.__test = {cacheKey, selectKnownContactName};`, {
  module: moduleShim, exports: moduleShim.exports,
  require: (specifier: string) => {
    if (specifier === "react" || specifier === "@tanstack/react-query") return {};
    if (specifier === "@/hooks/use-whatsapp-query-scope") return {};
    if (specifier === "@/lib/api/whatsapp") return { whatsappAPI: {} };
    if (specifier === "@/lib/whatsapp-message-input") return { WHATSAPP_UNLINKED_LEAD_SNAPSHOT: "unlinked" };
    if (specifier === "@/lib/whatsapp-query-cache") return { WHATSAPP_MESSAGES_RECONCILE_EVENT: "reconcile" };
    throw new Error(`Import inesperado: ${specifier}`);
  },
});
const registry = (moduleShim.exports as { __test: {
  cacheKey(digits: string, context?: Record<string, string | null | undefined>): string;
  selectKnownContactName(conversations: Array<Record<string, unknown>>, digits: string, leadId?: string | null): string | null;
} }).__test;

test("mention keys isolate organization, actor, permission scope, card and session", () => {
  const base = { organizationId: "org-a", userId: "user-a", accessScope: "own", leadId: "lead-a",
    groupJid: "group-a@g.us", sessionId: "session-a" };
  const original = registry.cacheKey("5511999999999", base);
  for (const field of ["organizationId", "userId", "accessScope", "leadId", "sessionId", "groupJid"]) {
    assert.notEqual(original, registry.cacheKey("5511999999999", { ...base, [field]: "different" }), field);
  }
});

test("lead names only resolve from the exact authorized card sharing that phone", () => {
  const phone = "5511999999999";
  const conversations = [
    { lead_id: "lead-a", contact_phone: phone, lead: { id: "lead-a", name: "Card A" } },
    { lead_id: "lead-b", contact_phone: phone, lead: { id: "lead-b", name: "Card B" } },
  ];
  assert.equal(registry.selectKnownContactName(conversations, phone, "lead-a"), "Card A");
  assert.equal(registry.selectKnownContactName(conversations, phone, "lead-b"), "Card B");
  assert.equal(registry.selectKnownContactName(conversations, phone, null), null);
  assert.equal(registry.selectKnownContactName(conversations, phone, "lead-c"), null);
});
