import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  decodeBoundedWhatsAppMediaBase64,
  isEncryptedWhatsAppMediaURL,
  validateWhatsAppPlaintextMedia,
  WhatsAppMediaValidationError,
} from "./media-security.ts";

function oggOpusFixture() {
  const bytes = new Uint8Array(64);
  bytes.set(Buffer.from("OggS"), 0);
  bytes.set(Buffer.from("OpusHead"), 28);
  for (let index = 36; index < bytes.length; index += 1) bytes[index] = index;
  return bytes;
}

async function sha256Base64(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Buffer.from(digest).toString("base64");
}

test("accepts decrypted Ogg/Opus only when size and plaintext SHA-256 match", async () => {
  const bytes = oggOpusFixture();
  const result = await validateWhatsAppPlaintextMedia({
    bytes,
    messageType: "audio",
    declaredMimeType: "audio/ogg; codecs=opus",
    declaredSize: bytes.length,
    fileSha256: await sha256Base64(bytes),
    requirePlaintextSha256: true,
  });
  assert.equal(result.contentType, "audio/ogg");
  assert.equal(result.size, bytes.length);
});

test("rejects ciphertext whose bytes match fileEncSha256", async () => {
  const plaintext = oggOpusFixture();
  const ciphertext = Uint8Array.from({ length: plaintext.length }, (_, index) => (index * 17 + 3) & 0xff);
  await assert.rejects(
    validateWhatsAppPlaintextMedia({
      bytes: ciphertext,
      messageType: "audio",
      declaredMimeType: "audio/ogg; codecs=opus",
      declaredSize: plaintext.length,
      fileSha256: await sha256Base64(plaintext),
      fileEncSha256: await sha256Base64(ciphertext),
      requirePlaintextSha256: true,
    }),
    (error) => error instanceof WhatsAppMediaValidationError && error.code === "media_ciphertext_rejected",
  );
});

test("rejects wrong plaintext digest, size, and magic before storage", async () => {
  const bytes = oggOpusFixture();
  const wrongDigest = await sha256Base64(new Uint8Array([1, 2, 3]));
  await assert.rejects(
    validateWhatsAppPlaintextMedia({
      bytes,
      messageType: "audio",
      declaredSize: bytes.length,
      fileSha256: wrongDigest,
    }),
    (error) => error instanceof WhatsAppMediaValidationError && error.code === "media_plaintext_sha256_mismatch",
  );
  await assert.rejects(
    validateWhatsAppPlaintextMedia({ bytes, messageType: "audio", declaredSize: bytes.length + 1 }),
    (error) => error instanceof WhatsAppMediaValidationError && error.code === "media_size_mismatch",
  );
  await assert.rejects(
    validateWhatsAppPlaintextMedia({ bytes: Buffer.from("%PDF-1.7\n"), messageType: "audio" }),
    (error) => error instanceof WhatsAppMediaValidationError && error.code === "media_magic_mismatch",
  );
});

test("keeps arbitrary document formats when plaintext SHA-256 proves integrity", async () => {
  const csv = new TextEncoder().encode("name,email\nAna,ana@example.test\n");
  const textDocument = await validateWhatsAppPlaintextMedia({
    bytes: csv,
    messageType: "document",
    declaredMimeType: "text/csv",
    declaredSize: csv.length,
    fileSha256: await sha256Base64(csv),
    requirePlaintextSha256: true,
  });
  assert.equal(textDocument.contentType, "text/csv");

  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3]);
  const imageDocument = await validateWhatsAppPlaintextMedia({
    bytes: jpeg,
    messageType: "document",
    declaredMimeType: "image/jpeg",
    fileSha256: await sha256Base64(jpeg),
  });
  assert.equal(imageDocument.contentType, "image/jpeg");
});

test("bounds base64 before use and recognizes encrypted WhatsApp transport URLs", () => {
  assert.throws(
    () => decodeBoundedWhatsAppMediaBase64("AAAAAA==", 3),
    (error) => error instanceof WhatsAppMediaValidationError && error.code === "media_too_large",
  );
  assert.equal(isEncryptedWhatsAppMediaURL("https://mmg.whatsapp.net/v/t62/file.enc?x=1"), true);
  assert.equal(isEncryptedWhatsAppMediaURL("https://cdn.example.test/decrypted/audio.ogg"), false);
});

test("active Edge path never GETs a nested media URL and validates before upload", () => {
  const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const normalizeStart = source.indexOf("function normalizeMessage(");
  const normalizeEnd = source.indexOf("function previewForMessage(", normalizeStart);
  const normalization = source.slice(normalizeStart, normalizeEnd);
  assert.doesNotMatch(normalization, /mediaBlock\.(?:url|URL|mediaUrl|media_url)/);
  assert.doesNotMatch(source, /function fetchInboundMedia\(/);
  assert.match(source, /fetch\(`\$\{EVOLUTION_GO_API_URL\}\$\{path\}`/);
  assert.match(source, /request\("\/message\/downloadmedia"\)/);
  assert.match(source, /const EVOLUTION_GO_MEDIA_TIMEOUT_MS = 20_000/);
  assert.match(source, /body: JSON\.stringify\(\{ message: providerMessage \}\)/);
  assert.match(source, /apikey: token[\s\S]{0,80}instanceId: instanceKey/);
  const instanceKeyStart = source.indexOf("function providerMediaInstanceKey(");
  const instanceKeyEnd = source.indexOf("function providerMediaToken(", instanceKeyStart);
  const instanceKeySource = source.slice(instanceKeyStart, instanceKeyEnd);
  assert.ok(
    instanceKeySource.indexOf("evolution_go_resolved_instance_key")
      < instanceKeySource.indexOf("session.instance_id"),
  );
  assert.ok(instanceKeySource.indexOf("session.instance_id") < instanceKeySource.indexOf("session.instance_name"));
  const validation = source.indexOf("await validateWhatsAppPlaintextMedia(");
  const upload = source.indexOf('.from("whatsapp-media")', validation);
  assert.ok(validation > 0 && upload > validation);
  const pendingLog = source.slice(
    source.indexOf('console.warn("Inbound WhatsApp media remains pending"'),
    source.indexOf("return {", source.indexOf('console.warn("Inbound WhatsApp media remains pending"')),
  );
  assert.doesNotMatch(pendingLog, /token|providerMessage|mediaKey|raw:/i);
});
