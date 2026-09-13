import assert from "node:assert/strict";
import test from "node:test";

const modelModulePath = "./model.ts";
const {
  cleanMessageMimeType,
  formatMessageAudioDuration,
  formatMessageFileSize,
  formatMessageTime,
  generateMessageWaveform,
  getEffectiveMessageMediaKind,
  getNextReactionEmoji,
  normalizeMessageMediaMimeType,
  toCanonicalMessageMediaKind,
  toSafeMessageText,
} = await import(modelModulePath);

test("resolve o tipo visual sem perder as precedências do payload", () => {
  assert.equal(getEffectiveMessageMediaKind("deleted", "image/jpeg", "https://example.com/a.jpg"), "deleted");
  assert.equal(getEffectiveMessageMediaKind("reaction", "image/jpeg", "https://example.com/a.jpg"), "reaction");
  assert.equal(getEffectiveMessageMediaKind("audio", "video/mp4", "https://example.com/a"), "audio");
  assert.equal(getEffectiveMessageMediaKind("unknown", "audio/ogg; codecs=opus", null), "audio");
  assert.equal(getEffectiveMessageMediaKind("unknown", "image/webp", null), "sticker");
  assert.equal(getEffectiveMessageMediaKind("unknown", "image/jpeg", null), "image");
  assert.equal(getEffectiveMessageMediaKind("unknown", null, "https://example.com/file"), "document");
  assert.equal(getEffectiveMessageMediaKind("text", "application/pdf", "https://example.com/file"), "text");
});

test("normaliza MIME somente quando o provedor não entrega um tipo útil", () => {
  assert.equal(cleanMessageMimeType(" Audio/OGG; codecs=opus "), "audio/ogg");
  assert.equal(normalizeMessageMediaMimeType("application/octet-stream", "audio"), "audio/ogg");
  assert.equal(normalizeMessageMediaMimeType(null, "video"), "video/mp4");
  assert.equal(normalizeMessageMediaMimeType(null, "sticker"), "image/webp");
  assert.equal(normalizeMessageMediaMimeType("application/pdf", "document"), "application/pdf");
  assert.equal(normalizeMessageMediaMimeType(null, "text"), undefined);
  assert.equal(toCanonicalMessageMediaKind("reaction"), "document");
});

test("mantém waveform determinístico e limitado ao intervalo visual", () => {
  const first = generateMessageWaveform("message-42", 28);
  const second = generateMessageWaveform("message-42", 28);

  assert.deepEqual(first, second);
  assert.equal(first.length, 28);
  assert.ok(first.every((bar: number) => bar >= 0.2 && bar <= 1));
  assert.notDeepEqual(first, generateMessageWaveform("message-43", 28));
});

test("preserva texto defensivo, horários, duração e tamanho exibidos", () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;

  assert.equal(toSafeMessageText(null), "");
  assert.equal(toSafeMessageText(false), "false");
  assert.equal(toSafeMessageText({ name: "Ana" }), '{"name":"Ana"}');
  assert.equal(toSafeMessageText(circular), "[conteúdo indisponível]");
  assert.equal(formatMessageTime("data inválida"), "");
  assert.equal(formatMessageTime("2026-09-06T12:34:00"), "12:34");
  assert.equal(formatMessageAudioDuration(Number.NaN), "0:00");
  assert.equal(formatMessageAudioDuration(65.9), "1:05");
  assert.equal(formatMessageFileSize(512), "512 B");
  assert.equal(formatMessageFileSize(1536), "1.5 KB");
  assert.equal(formatMessageFileSize(2 * 1024 * 1024), "2.0 MB");
});

test("selecionar a própria reação alterna para remoção", () => {
  assert.equal(getNextReactionEmoji("👍", "👍"), "");
  assert.equal(getNextReactionEmoji("👍", "❤️"), "❤️");
  assert.equal(getNextReactionEmoji(null, "🙏"), "🙏");
});
