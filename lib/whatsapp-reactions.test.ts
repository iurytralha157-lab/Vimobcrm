import assert from "node:assert/strict";
import test from "node:test";
import { groupLatestWhatsAppReactions } from "./whatsapp-reactions";

const reaction = (id: string, emoji: string | null, sentAt = "2026-10-11T18:00:00Z") => ({
  id, sent_at: sentAt, from_me: false, reaction_to_message_id: "target-a",
  reaction_sender_jid: "5511998880001@s.whatsapp.net", reaction_emoji: emoji,
  // Go's public message DTO deliberately redacts private ingress metadata.
  metadata: {},
});

const earlierId = "00000000-0000-4000-8000-000000000003";
const laterId = "00000000-0000-4000-8000-000000000001";

test("same-second removal preserves the canonical API feed with redacted metadata and inverse UUIDs", () => {
  assert.equal(groupLatestWhatsAppReactions([
    reaction(earlierId, "👍"), reaction(laterId, null),
  ]).size, 0);
});

test("same-second addition after removal preserves the canonical API feed with redacted metadata", () => {
  assert.deepEqual(groupLatestWhatsAppReactions([
    reaction(earlierId, null), reaction(laterId, "❤️"),
  ]).get("target-a"), [{ emoji: "❤️", senderName: null, fromMe: false }]);
});

test("provider fractions below one millisecond keep a later removal effective", () => {
  assert.equal(groupLatestWhatsAppReactions([
    reaction(laterId, null, "2026-10-11T18:00:00.000002Z"),
    reaction(earlierId, "👍", "2026-10-11T18:00:00.000001Z"),
  ]).size, 0);
});

test("provider fractions below one millisecond keep a later addition effective", () => {
  assert.deepEqual(groupLatestWhatsAppReactions([
    reaction(earlierId, null, "2026-10-11T18:00:00.000002Z"),
    reaction(laterId, "❤️", "2026-10-11T18:00:00.000003Z"),
  ]).get("target-a"), [{ emoji: "❤️", senderName: null, fromMe: false }]);
});

test("late older provider reaction cannot revive a removed reaction", () => {
  assert.equal(groupLatestWhatsAppReactions([
    reaction(laterId, null), reaction(earlierId, "👍", "2026-10-11T17:59:59Z"),
  ]).size, 0);
});
