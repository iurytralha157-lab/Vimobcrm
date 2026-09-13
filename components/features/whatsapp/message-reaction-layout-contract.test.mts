import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const countMatches = (source: string, pattern: RegExp) => source.match(pattern)?.length ?? 0;

test("conversation surfaces keep the reaction trigger outside the message bubble", () => {
  const conversations = readSource("./conversations/ConversationMessages.tsx");
  const leadThread = readSource("../leads/LeadUnifiedThread.tsx");
  const bubble = readSource("./MessageBubble.tsx");
  const picker = readSource("./message-bubble/MessageReactions.tsx");

  assert.equal(countMatches(conversations, /<MessageBubble\b/g), 1);
  assert.equal(countMatches(leadThread, /<WhatsAppMessageBubble\b/g), 1);
  assert.match(conversations, /<MessageBubble[\s\S]*?reactionPickerPosition="outside"[\s\S]*?\/>/);
  assert.match(leadThread, /<WhatsAppMessageBubble[\s\S]*?reactionPickerPosition="outside"[\s\S]*?\/>/);

  assert.match(bubble, /const showOutsideReactionPicker = reactionPickerPosition === "outside" && Boolean\(onReact\) && !isDeletedMessage/);
  assert.match(bubble, /data-message-reaction-outside[\s\S]*?shrink-0 self-center/);
  assert.match(bubble, /"flex w-full items-center gap-1 mb-1 animate-fade-in"/);
  assert.match(bubble, /\{fromMe && outsideReactionPicker\}\s*<div className=\{cn\(/);
  assert.match(bubble, /<\/div>\s*\{!fromMe && outsideReactionPicker\}/);

  assert.match(picker, /side=\{fromMe \? "left" : "right"\}/);
  assert.match(picker, /collisionPadding=\{12\}/);
  assert.match(picker, /type="button"[\s\S]{0,800}aria-label=\{isReacting \? "Aplicando reação" : "Reagir à mensagem"\}/);
  assert.match(picker, /focus-visible:ring-2 focus-visible:ring-primary\/40/);
  assert.match(picker, /role="group" aria-label="Escolha uma reação"/);
  assert.match(picker, /<SmilePlus[^>]+aria-hidden="true"/);
});
