import assert from "node:assert/strict";
import test from "node:test";

import { propertyCreateInputSchema, propertyUpdateInputSchema } from "./properties";
import { propertyAssetUploadIntentInputSchema } from "./property-workspace";

const requiredProperty = {
  title: "Imovel com galeria",
  tipo_de_imovel: "Apartamento",
  tipo_de_negocio: "venda",
};

function gallery(size: number) {
  return Array.from(
    { length: size },
    (_, index) => `https://media.example.test/${index + 1}.jpg`,
  );
}

test("property mutations enforce one 20-photo contract across legacy fields", () => {
  const twentyPhotos = gallery(20);

  assert.equal(
    propertyCreateInputSchema.safeParse({
      ...requiredProperty,
      imagem_principal: twentyPhotos[0],
      image_urls: twentyPhotos,
    }).success,
    true,
  );
  assert.equal(
    propertyCreateInputSchema.safeParse({
      ...requiredProperty,
      imagem_principal: "https://media.example.test/extra.jpg",
      image_urls: twentyPhotos,
    }).success,
    false,
  );
  assert.equal(
    propertyUpdateInputSchema.safeParse({ image_urls: gallery(21) }).success,
    false,
  );
  assert.equal(
    propertyUpdateInputSchema.safeParse({ fotos: gallery(21) }).success,
    false,
  );
});

test("property upload intent rejects an overlong physical file name", () => {
  const base = {
    asset_type: "photo" as const,
    mime_type: "image/jpeg" as const,
    file_size_bytes: 1024,
  };

  assert.equal(
    propertyAssetUploadIntentInputSchema.safeParse({
      ...base,
      file_name: "a".repeat(240),
    }).success,
    true,
  );
  assert.equal(
    propertyAssetUploadIntentInputSchema.safeParse({
      ...base,
      file_name: "a".repeat(241),
    }).success,
    false,
  );
});
