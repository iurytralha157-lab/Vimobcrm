import assert from "node:assert/strict";
import test from "node:test";

import {
  propertySettingsUpdateResponseSchema,
  updatePropertySettingsInputSchema,
} from "./settings";

const EXPECTED_UPDATED_AT = "2026-09-08T12:00:00Z";

test("configuracoes de imoveis aceitam patches canonicos parciais", () => {
  assert.equal(
    updatePropertySettingsInputSchema.safeParse({
      expected_updated_at: EXPECTED_UPDATED_AT,
      property_edit_policy: "everyone",
    }).success,
    true,
  );
  assert.equal(
    updatePropertySettingsInputSchema.safeParse({
      expected_updated_at: EXPECTED_UPDATED_AT,
      property_owner_contact_visibility: "hidden",
    }).success,
    true,
  );
  assert.equal(
    updatePropertySettingsInputSchema.safeParse({
      expected_updated_at: EXPECTED_UPDATED_AT,
      property_edit_policy: "responsible_or_admin",
      property_owner_contact_visibility: "visible",
    }).success,
    true,
  );
});

test("configuracoes de imoveis rejeitam patch vazio, valores invalidos e campos gerais", () => {
  assert.equal(updatePropertySettingsInputSchema.safeParse({}).success, false);
  assert.equal(
    updatePropertySettingsInputSchema.safeParse({
      expected_updated_at: EXPECTED_UPDATED_AT,
    }).success,
    false,
  );
  assert.equal(
    updatePropertySettingsInputSchema.safeParse({
      expected_updated_at: EXPECTED_UPDATED_AT,
      property_edit_policy: "custom",
    }).success,
    false,
  );
  assert.equal(
    updatePropertySettingsInputSchema.safeParse({
      expected_updated_at: EXPECTED_UPDATED_AT,
      property_owner_contact_visibility: "private",
    }).success,
    false,
  );
  assert.equal(
    updatePropertySettingsInputSchema.safeParse({
      expected_updated_at: EXPECTED_UPDATED_AT,
      property_edit_policy: "everyone",
      name: "Snapshot antigo",
    }).success,
    false,
  );
  assert.equal(
    updatePropertySettingsInputSchema.safeParse({
      expected_updated_at: "ontem",
      property_edit_policy: "everyone",
    }).success,
    false,
  );
});

test("resposta das configuracoes devolve a nova revisao CAS", () => {
  assert.deepEqual(
    propertySettingsUpdateResponseSchema.parse({
      ok: true,
      updated_at: "2026-09-08T12:01:00Z",
    }),
    {
      ok: true,
      updated_at: "2026-09-08T12:01:00Z",
    },
  );
  assert.equal(
    propertySettingsUpdateResponseSchema.safeParse({ ok: true }).success,
    false,
  );
});
