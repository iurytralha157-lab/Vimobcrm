import assert from "node:assert/strict";
import test from "node:test";

import {
  apiPropertyCreateResponseSchema,
  apiPropertyListResponseSchema,
  apiPropertyResponseSchema,
  apiPropertySchema,
  apiPropertyWithCapabilitiesSchema,
  propertyUpdateInputSchema,
} from "./properties";

const PROPERTY_ID = "11111111-1111-4111-8111-111111111111";
const ORGANIZATION_ID = "22222222-2222-4222-8222-222222222222";

test("PATCH de imóvel aceita versão ISO com offset junto de uma alteração", () => {
  const result = propertyUpdateInputSchema.safeParse({
    status: "ativo",
    expected_updated_at: "2026-09-08T00:04:05.123456-03:00",
  });

  assert.equal(result.success, true);
});

test("PATCH de imóvel rejeita versão inválida", () => {
  const result = propertyUpdateInputSchema.safeParse({
    status: "ativo",
    expected_updated_at: "ontem",
  });

  assert.equal(result.success, false);
});

test("PATCH de imóvel rejeita alteração sem versão", () => {
  const result = propertyUpdateInputSchema.safeParse({
    status: "ativo",
  });

  assert.equal(result.success, false);
});

test("payload de imóvel aceita metadata somente como objeto JSON", () => {
  const expectedUpdatedAt = "2026-09-08T03:04:05.123456Z";

  assert.equal(
    propertyUpdateInputSchema.safeParse({
      metadata: { financing_mode: "sim" },
      expected_updated_at: expectedUpdatedAt,
    }).success,
    true,
  );
  for (const metadata of [null, [], "texto", 1, true]) {
    assert.equal(
      propertyUpdateInputSchema.safeParse({
        metadata,
        expected_updated_at: expectedUpdatedAt,
      }).success,
      false,
    );
  }
});

test("versão otimista não conta sozinha como alteração de imóvel", () => {
  const result = propertyUpdateInputSchema.safeParse({
    expected_updated_at: "2026-09-08T03:04:05.123456Z",
  });

  assert.equal(result.success, false);
});

test("resposta de imóvel sempre transporta a versão necessária ao PATCH", () => {
  const base = {
    id: PROPERTY_ID,
    organization_id: ORGANIZATION_ID,
    title: "Apartamento central",
  };

  assert.equal(apiPropertySchema.safeParse(base).success, false);
  assert.equal(
    apiPropertySchema.safeParse({
      ...base,
      updated_at: "2026-09-08T03:04:05.123456Z",
    }).success,
    true,
  );
});

test("lista, detalhe e update exigem can_edit, mas create aceita o registro base", () => {
  const property = {
    id: PROPERTY_ID,
    organization_id: ORGANIZATION_ID,
    title: "Apartamento central",
    updated_at: "2026-09-08T03:04:05.123456Z",
  };

  assert.equal(apiPropertySchema.safeParse(property).success, true);
  assert.equal(apiPropertyWithCapabilitiesSchema.safeParse(property).success, false);
  assert.equal(
    apiPropertyCreateResponseSchema.safeParse({ data: property }).success,
    true,
  );
  assert.equal(apiPropertyResponseSchema.safeParse({ data: property }).success, false);
  assert.equal(
    apiPropertyListResponseSchema.safeParse({
      data: [property],
      total: 1,
      limit: 24,
      offset: 0,
    }).success,
    false,
  );

  const propertyWithCapability = {
    ...property,
    can_edit: false,
    managed_terms: {
      condominium_exempt: false,
      property_tax_exempt: false,
      financing_mode: "sim",
    },
  };
  assert.equal(
    apiPropertyResponseSchema.safeParse({ data: propertyWithCapability }).success,
    true,
  );
  assert.equal(
    apiPropertyListResponseSchema.safeParse({
      data: [propertyWithCapability],
      total: 1,
      limit: 24,
      offset: 0,
    }).success,
    true,
  );
});
