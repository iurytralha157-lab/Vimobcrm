import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const messageMediaModulePath = "./message-media.ts";
const {
  buildMessageMediaFilename,
  getSafeAvatarUrl,
  getSafeMessageMediaUrl,
  MAX_OUTBOUND_MESSAGE_MEDIA_BYTES,
  sanitizeMediaFilename,
} = await import(messageMediaModulePath);

test("mantém o mesmo limite de mídia nos dois compositores ativos", () => {
  assert.equal(MAX_OUTBOUND_MESSAGE_MEDIA_BYTES, 5 * 1024 * 1024);

  for (const sourcePath of [
    "components/features/whatsapp/ConversationsScreen.tsx",
    "components/features/chat/FloatingChat.tsx",
  ]) {
    const source = readFileSync(sourcePath, "utf8");
    assert.match(source, /file\.size\s*>\s*MAX_OUTBOUND_MESSAGE_MEDIA_BYTES/);
    assert.match(source, /processedFile\.size\s*>\s*MAX_OUTBOUND_MESSAGE_MEDIA_BYTES/);
  }
});

test("aceita apenas URLs remotas renderizáveis e sem credenciais", () => {
  assert.equal(
    getSafeMessageMediaUrl("https://storage.example.com/media/file.jpg?token=a%2Bb", "image"),
    "https://storage.example.com/media/file.jpg?token=a%2Bb",
  );
  assert.equal(getSafeMessageMediaUrl("javascript:alert(1)", "image"), null);
  assert.equal(getSafeMessageMediaUrl("data:image/png;base64,aGVsbG8=", "image"), "data:image/png;base64,aGVsbG8=");
  assert.equal(getSafeMessageMediaUrl("data:image/svg+xml;base64,PHN2Zy8+", "image"), null);
  assert.equal(getSafeMessageMediaUrl("data:image/png;base64,aGVsbG8=", "audio"), null);
  assert.equal(getSafeMessageMediaUrl("https://user:secret@example.com/file.jpg", "image"), null);
  assert.equal(getSafeMessageMediaUrl("https://example.com/file.enc", "audio"), null);
  assert.equal(getSafeMessageMediaUrl("https://example.com/file%2Eenc", "audio"), null);
});

test("bloqueia endpoints criptografados do provedor sem quebrar avatar remoto", () => {
  assert.equal(getSafeMessageMediaUrl("https://mmg.whatsapp.net/media/file.jpg", "image"), null);
  assert.equal(getSafeMessageMediaUrl("https://pps.whatsapp.net/avatar.jpg", "image"), null);
  assert.equal(getSafeMessageMediaUrl("https://a.whatsapp.net/sticker.webp", "sticker"), null);
  assert.equal(getSafeAvatarUrl("https://pps.whatsapp.net/avatar.jpg"), "https://pps.whatsapp.net/avatar.jpg");
});

test("higieniza nomes de download e remove controles de direcao", () => {
  assert.equal(sanitizeMediaFilename("../../relatorio\u202Efdp.exe"), "relatoriofdp.exe");
  assert.equal(sanitizeMediaFilename("  contrato:<final>?.pdf  "), "contrato__final__.pdf");
  assert.equal(sanitizeMediaFilename("...", "Documento.pdf"), "Documento.pdf");
});

test("nome de midia usa conteudo apenas quando ele representa arquivo", () => {
  assert.equal(
    buildMessageMediaFilename({
      content: "foto do apartamento",
      kind: "image",
      mimeType: "image/jpeg",
      sentAt: "2026-08-16T12:34:00",
    }),
    "Imagem-20260816-1234.jpg",
  );
  assert.equal(
    buildMessageMediaFilename({
      content: "proposta-final.pdf",
      kind: "document",
      mimeType: "application/pdf",
      sentAt: null,
    }),
    "proposta-final.pdf",
  );
});
