import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const reactionsModulePath = "../../../../lib/whatsapp-reactions.ts";
const { canReactToWhatsAppMessage, groupLatestWhatsAppReactions } = await import(reactionsModulePath);
const reactionPickerSource = readFileSync(
  new URL("./MessageReactions.tsx", import.meta.url),
  "utf8",
);

test("mantém apenas a reação mais recente de cada remetente", () => {
  const grouped = groupLatestWhatsAppReactions([
    {
      id: "reaction-1",
      sent_at: "2026-09-06T12:00:00.000Z",
      reaction_to_message_id: "message-1",
      reaction_emoji: "👍",
      reaction_sender_jid: "contact-1",
      reaction_sender_name: "Ana",
    },
    {
      id: "reaction-2",
      sent_at: "2026-09-06T12:01:00.000Z",
      reaction_to_message_id: "message-1",
      reaction_emoji: "❤️",
      reaction_sender_jid: "contact-1",
      reaction_sender_name: "Ana",
    },
    {
      id: "reaction-3",
      sent_at: "2026-09-06T12:02:00.000Z",
      reaction_to_message_id: "message-1",
      reaction_emoji: "🙏",
      from_me: true,
      reaction_sender_name: "Você",
    },
  ]);

  assert.deepEqual(grouped.get("message-1"), [
    { emoji: "❤️", senderName: "Ana", fromMe: false },
    { emoji: "🙏", senderName: "Você", fromMe: true },
  ]);
});

test("remoção posterior e eventos falhos não deixam badge residual", () => {
  const grouped = groupLatestWhatsAppReactions([
    {
      id: "reaction-1",
      sent_at: "2026-09-06T12:00:00.000Z",
      metadata: { target_message_id: "message-1" },
      content: "😂",
      sender_jid: "contact-1",
    },
    {
      id: "reaction-2",
      sent_at: "2026-09-06T12:01:00.000Z",
      metadata: { target_message_id: "message-1" },
      content: "",
      sender_jid: "contact-1",
    },
    {
      id: "reaction-3",
      sent_at: "2026-09-06T12:02:00.000Z",
      reaction_to_message_id: "message-2",
      reaction_emoji: "😮",
      sender_jid: "contact-2",
      status: "failed",
    },
  ]);

  assert.equal(grouped.has("message-1"), false);
  assert.equal(grouped.has("message-2"), false);
});

test("reação própria otimista substitui e remove a canônica sem duplicar", () => {
  const canonicalMessages = [
    {
      id: "reaction-self-canonical",
      sent_at: "2026-09-06T12:00:00.000Z",
      reaction_to_message_id: "message-1",
      reaction_emoji: "👍",
      reaction_sender_jid: "5511999999999@s.whatsapp.net",
      reaction_sender_name: "Você",
      from_me: true,
    },
    {
      id: "reaction-contact",
      sent_at: "2026-09-06T12:00:30.000Z",
      reaction_to_message_id: "message-1",
      reaction_emoji: "😮",
      reaction_sender_jid: "5511888888888@s.whatsapp.net",
      reaction_sender_name: "Ana",
      from_me: false,
    },
  ];

  const optimisticReplacement = {
    id: "reaction-self-optimistic",
    sent_at: "2026-09-06T12:01:00.000Z",
    reaction_to_message_id: "message-1",
    reaction_emoji: "❤️",
    reaction_sender_jid: null,
    reaction_sender_name: "Você",
    from_me: true,
  };
  const replaced = groupLatestWhatsAppReactions([
    ...canonicalMessages,
    optimisticReplacement,
  ]);

  assert.deepEqual(replaced.get("message-1"), [
    { emoji: "❤️", senderName: "Você", fromMe: true },
    { emoji: "😮", senderName: "Ana", fromMe: false },
  ]);

  const optimisticRemoval = {
    ...optimisticReplacement,
    id: "reaction-self-remove-optimistic",
    sent_at: "2026-09-06T12:02:00.000Z",
    reaction_emoji: null,
    content: null,
  };
  const removed = groupLatestWhatsAppReactions([
    ...canonicalMessages,
    optimisticRemoval,
  ]);

  assert.deepEqual(removed.get("message-1"), [
    { emoji: "😮", senderName: "Ana", fromMe: false },
  ]);
});

test("reação só é liberada depois que a mensagem possui alvo persistido e confirmado", () => {
  const canonical = {
    id: "database-message-id",
    message_id: "provider-message-id",
    client_message_id: "client-message-id",
    status: "sent",
  };

  assert.equal(canReactToWhatsAppMessage(canonical), true);
  assert.equal(canReactToWhatsAppMessage({ ...canonical, status: "delivered" }), true);
  assert.equal(canReactToWhatsAppMessage({ ...canonical, status: "read" }), true);
  assert.equal(canReactToWhatsAppMessage({ ...canonical, status: "received" }), true);
  assert.equal(canReactToWhatsAppMessage({ ...canonical, status: "queued" }), true);

  for (const status of ["pending", "confirming", "failed", "error"]) {
    assert.equal(canReactToWhatsAppMessage({ ...canonical, status }), false, status);
  }

  assert.equal(canReactToWhatsAppMessage({ ...canonical, id: "" }), false);
  assert.equal(canReactToWhatsAppMessage({ ...canonical, message_id: "" }), false);

  const optimisticId = "client-only-id";
  assert.equal(canReactToWhatsAppMessage({
    id: optimisticId,
    message_id: optimisticId,
    client_message_id: optimisticId,
    status: "queued",
  }), false);

  assert.equal(canReactToWhatsAppMessage({
    id: "legacy-message-id",
    message_id: "legacy-message-id",
    status: "sent",
  }), true);
});

test("picker de reações usa portal com colisão e fecha sem vazar Escape", () => {
  assert.match(reactionPickerSource, /PopoverContent/);
  assert.match(reactionPickerSource, /side=\{fromMe \? "left" : "right"\}/);
  assert.match(reactionPickerSource, /collisionPadding=\{12\}/);
  assert.match(reactionPickerSource, /<div className="flex items-center gap-0\.5" role="group" aria-label="Escolha uma reação">/);
  assert.doesNotMatch(reactionPickerSource, /<PopoverContent[\s\S]{0,320}role="group"/);
  assert.match(reactionPickerSource, /onEscapeKeyDown=\{\(event\) => \{/);
  assert.match(reactionPickerSource, /event\.preventDefault\(\);\s*event\.stopPropagation\(\);\s*setReactionPickerOpen\(false\);/);
  assert.match(reactionPickerSource, /onKeyDownCapture=\{handleEscapeBeforeDocument\}/);
  assert.doesNotMatch(reactionPickerSource, /absolute top-\[calc\(100%\+4px\)\]/);
});
