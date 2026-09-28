import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("read-only lead history keeps incoming messages in a visible bubble", () => {
  const thread = readSource("../leads/LeadUnifiedThread.tsx");
  const bubble = readSource("./MessageBubble.tsx");

  assert.match(thread, /<WhatsAppMessageBubble[\s\S]*?plainHistory=\{readOnly\}[\s\S]*?\/>/);
  assert.match(bubble, /plainHistory \? "bg-\[var\(--lead-history-message-bg\)\]" : "bg-\[var\(--app-surface-soft\)\]"/);
  assert.doesNotMatch(bubble, /plainHistory \? "bg-transparent"/);
});

test("read-only history identifies a text record with no body without creating message text", () => {
  const bubble = readSource("./MessageBubble.tsx");

  assert.match(bubble, /const isContentUnavailable = plainHistory && mediaKind === "text" && !safeContent\.trim\(\)/);
  assert.match(bubble, /\{isContentUnavailable && \(\s*<span[^>]*>Conteúdo indisponível<\/span>/);
  assert.match(bubble, /\{!isContentUnavailable && safeContent && mediaKind === "text" && \(\s*<MessageText/);
  assert.match(bubble, /data-message-metadata[\s\S]*?formatMessageTime\(sentAt\)/);
});

test("a Meta creative record without usable media shows its recorded label", () => {
  const thread = readSource("../leads/LeadUnifiedThread.tsx");

  assert.match(thread, /const creativeTitle =[\s\S]*?metadataText\(metadata\.creative_name\)[\s\S]*?normalizeEventLabel\(event\)/);
  assert.match(thread, /\{!videoUrl && !imageUrl && \(\s*<div[^>]*>\s*\{creativeTitle\}/);
});
