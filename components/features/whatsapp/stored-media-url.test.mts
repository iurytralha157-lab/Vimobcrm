import assert from "node:assert/strict";
import test from "node:test";

const storedMediaURLModulePath = "./stored-media-url.ts";
const {
  hasStoredWhatsAppMedia,
  shouldLoadStoredMediaURL,
  withStoredMediaURL,
} = await import(storedMediaURLModulePath);

const now = 1_000_000;
const storedMessage = {
  id: "message-1",
  media_status: "ready" as const,
  media_storage_path: "orgs/org-1/whatsapp/message-1.jpg",
  media_url: "https://mmg.whatsapp.net/expired.enc",
  media_error: null,
};

test("stored media ignores a legacy provider URL and loads a signed URL", () => {
  assert.equal(hasStoredWhatsAppMedia(storedMessage), true);
  assert.equal(shouldLoadStoredMediaURL(storedMessage, undefined, now), true);

  const loading = withStoredMediaURL(storedMessage, undefined);
  assert.equal(loading.media_url, null);
  assert.equal(loading.media_status, "ready");

  const signed = withStoredMediaURL(storedMessage, {
    url: "https://storage.example.com/object/sign/orgs/org-1/whatsapp/message-1.jpg?token=redacted",
    refreshAt: now + 60_000,
  });
  assert.match(signed.media_url ?? "", /^https:\/\/storage\.example\.com\//);
  assert.equal(signed.media_status, "ready");
  assert.equal(shouldLoadStoredMediaURL(storedMessage, {
    url: signed.media_url,
    refreshAt: now + 60_000,
  }, now), false);
});

test("expired signed URLs refresh and a failed GET waits for explicit retry", () => {
  const expired = { url: "https://storage.example.com/expired", refreshAt: now - 1 };
  assert.equal(shouldLoadStoredMediaURL(storedMessage, expired, now), true);
  // The screen evicts expired entries before presenting the next URL.
  assert.equal(withStoredMediaURL(storedMessage, undefined).media_url, null);

  const failed = { url: null, refreshAt: null };
  assert.equal(shouldLoadStoredMediaURL(storedMessage, failed, now), false);
  const presentation = withStoredMediaURL(storedMessage, failed);
  assert.equal(presentation.media_status, "failed");
  assert.match(presentation.media_error ?? "", /Tente novamente/);
  assert.doesNotMatch(presentation.media_error ?? "", /mmg|token=/);
});

test("messages without a completed stored file keep their original media state", () => {
  const providerOnly = { ...storedMessage, media_storage_path: null };
  assert.equal(hasStoredWhatsAppMedia(providerOnly), false);
  assert.equal(shouldLoadStoredMediaURL(providerOnly, undefined, now), false);
  assert.equal(withStoredMediaURL(providerOnly, undefined), providerOnly);
});
