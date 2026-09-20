import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

function readRepoFile(relativePath: string) {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

test("criar lead pela conversa propaga o snapshot observado ate a API", () => {
  const screen = readRepoFile("components/features/whatsapp/ConversationsScreen.tsx");
  const overlays = readRepoFile("components/features/whatsapp/conversations/ConversationOverlays.tsx");
  const dialog = readRepoFile("components/features/leads/CreateLeadDialog.tsx");
  const api = readRepoFile("lib/api/leads.ts");

  assert.match(screen, /getWhatsAppConversationMessageScope\([\s\S]*?\)\.expectedLeadId/);
  assert.match(screen, /expectedPreviousLeadId:\s*expectedPreviousLeadId \|\| undefined/);
  assert.match(overlays, /expectedPreviousLeadId=\{createLeadContact\.expectedPreviousLeadId\}/);
  assert.match(dialog, /expected_previous_lead_id:\s*formData\.conversation_id[\s\S]*?expectedPreviousLeadId \|\| undefined/);
  assert.match(api, /expectedPreviousLeadId:\s*data\.expected_previous_lead_id/);
});
