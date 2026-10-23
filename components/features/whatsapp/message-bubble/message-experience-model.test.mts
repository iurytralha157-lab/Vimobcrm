import assert from "node:assert/strict";
import test from "node:test";
import { collectNumericMentions, parseMessageInline, parseMessageTextBlocks } from "@/components/features/whatsapp/message-bubble/message-text-model";
import { claimMessageAudio, releaseMessageAudio } from "@/components/features/whatsapp/message-bubble/audio-playback-coordinator";
import { getMessageMediaGallery, getMessageMediaGalleryNeighbor } from "@/components/features/whatsapp/message-bubble/media-gallery-model";
import { isSingleReactionEmoji, summarizeMessageReactions } from "@/components/features/whatsapp/message-bubble/reaction-model";

test("URL handles stay inside the original link, never become mentions", () => {
  const url = "https://example.test/@corretor/visita?a=@cliente";
  assert.deepEqual(parseMessageInline(url), [{ kind: "link", text: url }]);
});
test("email addresses are preserved and numeric mentions still resolve", () => {
  const nodes = parseMessageInline("andre@example.test @5511999991111 @Ana");
  assert.deepEqual(nodes.filter((node) => node.kind === "email"), [{ kind: "email", text: "andre@example.test" }]);
  assert.deepEqual(collectNumericMentions(nodes), ["5511999991111"]);
});
test("closing punctuation is excluded from a URL and balanced URL parentheses stay", () => {
  assert.deepEqual(parseMessageInline("(https://example.test/casa(a))."), [{ kind: "text", text: "(" }, { kind: "link", text: "https://example.test/casa(a)" }, { kind: "text", text: ")." }]);
});
test("inline formatting supports nested styles without interpreting HTML", () => {
  assert.deepEqual(parseMessageInline("*Olá _Ana_* ~antigo~"), [{ kind: "strong", children: [{ kind: "text", text: "Olá " }, { kind: "emphasis", children: [{ kind: "text", text: "Ana" }] }] }, { kind: "text", text: " " }, { kind: "strike", children: [{ kind: "text", text: "antigo" }] }]);
  assert.deepEqual(parseMessageInline("<img src=x onerror=alert(1)>"), [{ kind: "text", text: "<img src=x onerror=alert(1)>" }]);
});
test("code stays literal and does not resolve mentions or links", () => {
  const nodes = parseMessageInline("`@5511999991111 *texto* https://example.test` ");
  assert.deepEqual(collectNumericMentions(nodes), []);
  assert.equal(nodes[0].kind, "code");
});
test("unmatched markers, underscores in words and arithmetic remain literal", () => {
  for (const text of ["nome_completo", "2 * 3 * 4", "*incompleto", "http://", "@", ""]) {
    const nodes = parseMessageInline(text);
    assert.equal(nodes.map((node) => "text" in node ? node.text : "").join(""), text);
  }
});
test("block formatting keeps list markers, quotations, blank lines and fenced literal text", () => {
  const blocks = parseMessageTextBlocks("> retorno\n- Casa\n2. Visita\n\n```\n*literal*\n@5511999991111\n```");
  assert.deepEqual(blocks.slice(0, 4).map((block) => block.kind), ["quote", "bullet", "numbered", "paragraph"]);
  assert.deepEqual(blocks.at(-1), { kind: "code", text: "*literal*\n@5511999991111" });
});
test("claiming audio B pauses A while an old pause callback cannot release B", () => {
  let aPauses = 0; let bPauses = 0;
  const a = { pause() { aPauses++; releaseMessageAudio(a); } };
  const b = { pause() { bPauses++; releaseMessageAudio(b); } };
  claimMessageAudio(a); claimMessageAudio(b); releaseMessageAudio(a);
  claimMessageAudio({ pause() {} });
  assert.equal(aPauses, 1); assert.equal(bPauses, 1);
});
test("claiming the same media twice does not pause itself and release is idempotent", () => {
  let pauses = 0; const audio = { pause() { pauses++; } };
  claimMessageAudio(audio); claimMessageAudio(audio); releaseMessageAudio(audio); releaseMessageAudio(audio);
  assert.equal(pauses, 0);
});
test("reaction counts aggregate by emoji without dropping participant order", () => {
  assert.deepEqual(summarizeMessageReactions([{ emoji: "👍", senderName: "Ana", fromMe: false }, { emoji: "❤️", senderName: "Você", fromMe: true }, { emoji: "👍", senderName: "Bruno", fromMe: false }]), [{ emoji: "👍", count: 2 }, { emoji: "❤️", count: 1 }]);
});
test("one custom emoji accepts modifiers, ZWJ, flags and keycaps", () => {
  for (const emoji of ["👍", "👍🏽", "👨‍👩‍👧‍👦", "🏳️‍🌈", "🇧🇷", "1️⃣", "❤️"]) assert.equal(isSingleReactionEmoji(emoji), true, emoji);
});
test("custom reaction rejects prose, multiple emojis and markup", () => {
  for (const value of ["", "sim", "👍👍", "👍 texto", "1", "<img>", "🏽"]) assert.equal(isSingleReactionEmoji(value), false, value);
});
test("gallery navigation keeps feed order, deduplicates rows and never wraps at its ends", () => {
  const a = { id: "a", url: "https://example.test/a.png", type: "image" as const };
  const b = { id: "b", url: "https://example.test/b.mp4", type: "video" as const };
  const items = getMessageMediaGallery([a, b, a], { ...a, url: "https://example.test/a-fresh.png" });
  assert.deepEqual(items.map((item) => item.id), ["a", "b"]);
  assert.equal(items[0].url, "https://example.test/a-fresh.png");
  assert.equal(getMessageMediaGalleryNeighbor(items, "a", -1), null);
  assert.equal(getMessageMediaGalleryNeighbor(items, "b", 1), null);
  assert.equal(getMessageMediaGalleryNeighbor(items, "a", 1), b);
});
test("gallery preserves the recorded filename when an initial preview supplies only a fresh URL", () => {
  const item = { id: "a", url: "https://example.test/a.png", type: "image" as const, filename: "Casa.png" };
  assert.equal(getMessageMediaGallery([item], { id: "a", url: "https://example.test/fresh.png", type: "image" })[0].filename, "Casa.png");
});
test("a gallery missing the active message falls back to its own item", () => {
  const current = { id: "current", url: "https://example.test/c.png", type: "image" as const };
  assert.deepEqual(getMessageMediaGallery([{ id: "other", url: "https://example.test/x.png", type: "image" }], current), [current]);
});
test("gallery admits a stored item with only an authorized refresh, never an empty unsupported item", () => {
  const current = { id: "current", url: "https://example.test/c.png", type: "image" as const };
  const stored = { id: "stored", url: "", type: "image" as const, refresh: async () => "https://example.test/fresh.png" };
  assert.deepEqual(getMessageMediaGallery([current, stored, { id: "invalid", url: "", type: "image" }], current).map((item) => item.id), ["current", "stored"]);
});
