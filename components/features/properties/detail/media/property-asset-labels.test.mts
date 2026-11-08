import assert from "node:assert/strict";
import test from "node:test";

const modulePath = "./property-asset-labels.ts";
const { assetDisplayLabel, assetUsageLabel } = await import(modulePath);

const base = { asset_type: "photo", title: null, file_name: "9f3a1c2e7b4d.jpg", document_category: null };

test("uses the real legend and never the stored file name", () => {
  assert.equal(assetDisplayLabel({ ...base, title: "Fachada" }, 1), "Fachada");
  assert.equal(assetDisplayLabel(base, 3), "Foto 3");
  assert.equal(assetDisplayLabel({ ...base, title: "9f3a1c2e7b4d.jpg" }, 2), "Foto 2");
  assert.equal(assetDisplayLabel({ ...base, title: "IMG_2041.jpeg", file_name: null }, 4), "Foto 4");
  assert.equal(assetDisplayLabel({ ...base, title: "a81bc3f09d", file_name: null }, 5), "Foto 5");
});

test("documents fall back to their category before a numbered label", () => {
  const document = { ...base, asset_type: "document" };
  assert.equal(assetDisplayLabel({ ...document, document_category: "Matrícula" }, 1), "Matrícula");
  assert.equal(assetDisplayLabel(document, 2), "Documento 2");
});

test("usage text marks the cover and unprotected external sources", () => {
  assert.equal(assetUsageLabel({ asset_type: "photo", visibility: "public", is_primary: true, external_url: null }), "Capa · Publicável");
  assert.equal(assetUsageLabel({ asset_type: "photo", visibility: "internal", is_primary: false, external_url: null }), "Uso interno");
  assert.match(assetUsageLabel({ asset_type: "photo", visibility: "internal", is_primary: false, external_url: "https://x.test/a.jpg" }), /não protegida/);
});
