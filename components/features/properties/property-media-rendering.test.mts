import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("a thumbnail that fails to load shows the placeholder, not an empty box", () => {
  const card = read("./PropertyCard.tsx");
  assert.match(card, /onError=\{\(\) => setFailedImageSource\(imageSrc\)\}/);
  assert.match(card, /imageSrc && failedImageSource !== imageSrc \?/);
});

test("dropping files on the gallery area adds them instead of navigating away from the form", () => {
  const uploader = read("./ImageUploader.tsx");
  assert.match(uploader, /onDragOver=\{handleGalleryDragOver\}/);
  assert.match(uploader, /onDrop=\{handleGalleryDrop\}/);
  assert.match(uploader, /event\.preventDefault\(\)/);
});

test("photo requests get more time than the two Storage checks the API performs", () => {
  const client = read("../../../lib/api/property-workspace.ts");
  for (const fragment of ["/assets/upload-intents`,\n      { method: 'POST'", "/assets`, {\n      method: 'POST'"]) {
    const start = client.indexOf(fragment);
    assert.notEqual(start, -1, fragment);
    assert.match(client.slice(start, start + 320), /timeoutMs: PROPERTY_MEDIA_REQUEST_TIMEOUT_MS/);
  }
});
