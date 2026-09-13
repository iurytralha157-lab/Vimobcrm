import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const propertyOwnerPrivacyPath = "./property-owner-privacy.ts";
const {
  PROPERTY_OWNER_MUTATION_FIELDS,
  removePropertyOwnerMutationFields,
  shouldRequirePropertyOwnerDetails,
} = await import(propertyOwnerPrivacyPath);

test("edição com proprietário oculto não exige os dados redigidos", () => {
  assert.equal(shouldRequirePropertyOwnerDetails(true, false), false);
  assert.equal(shouldRequirePropertyOwnerDetails(true, true), true);
  assert.equal(shouldRequirePropertyOwnerDetails(false, false), true);
});

test("payload protegido omite owner_id e todos os campos owner", () => {
  const payload: Record<string, unknown> = {
    title: "Novo título",
    owner_id: null,
    owner_name: "",
    owner_phone_residential: "",
    owner_phone_commercial: "",
    owner_cellphone: "",
    owner_email: "",
    owner_media_source: "",
    owner_notify_email: false,
  };

  removePropertyOwnerMutationFields(payload);

  assert.equal(payload.title, "Novo título");
  for (const field of PROPERTY_OWNER_MUTATION_FIELDS) {
    assert.equal(Object.hasOwn(payload, field), false, `${field} foi reenviado`);
  }
});

test("proprietário cadastrado mantém seus detalhes somente leitura no formulário", () => {
  const source = readFileSync(
    "components/features/properties/property-form/sections/OwnerSection.tsx",
    "utf8",
  );

  assert.match(source, /const hasRegisteredOwner = Boolean\(formData\.owner_id\)/);
  assert.match(
    source,
    /const canEditInlineOwnerDetails = canEditOwnerDetails && !hasRegisteredOwner/,
  );
  assert.match(source, /href="\/properties\/owners"/);
  assert.match(source, /disabled=\{!canEditInlineOwnerDetails\}/);
  assert.match(source, /Digitar novo proprietário/);
});
