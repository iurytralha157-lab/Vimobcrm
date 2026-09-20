import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

function readRepoFile(relativePath: string) {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

test("deep link por conversa resolve o vínculo fora da lista paginada", () => {
  const screen = readRepoFile("components/features/whatsapp/ConversationsScreen.tsx");
  const hooks = readRepoFile("hooks/use-whatsapp-conversations.ts");
  const api = readRepoFile("lib/api/whatsapp.ts");

  assert.match(screen, /useWhatsAppConversationSnapshot\(/);
  assert.match(screen, /legacyDeepLinkSnapshotQuery\.isFetched/);
  assert.match(screen, /legacyDeepLinkSnapshotQuery\.isFetching/);
  assert.match(screen, /legacyDeepLinkSnapshotQuery\.data/);
  assert.doesNotMatch(screen, /legacyDeepLinkListConversation/);
  assert.match(hooks, /whatsappQueryKeys\.conversationSnapshot\(scope, conversationId\)/);
  assert.match(hooks, /whatsappAPI\.getConversationSnapshot\(/);
  assert.match(api, /\/v1\/whatsapp\/conversations\/\$\{conversationId\}\/snapshot/);
});

test("deep link faz a segunda leitura presa ao mesmo card", () => {
  const screen = readRepoFile("components/features/whatsapp/ConversationsScreen.tsx");

  assert.match(
    screen,
    /getWhatsAppConversationMessageScope\(\s*legacyDeepLinkSnapshotQuery\.data,?\s*\)\.expectedLeadId/,
  );
  assert.match(
    screen,
    /useWhatsAppConversation\(\s*initialConversationId && !initialLeadId \? initialConversationId : null,\s*legacyDeepLinkExpectedLeadId,?\s*\)/,
  );
});
