import assert from "node:assert/strict";
import test from "node:test";

const modulePath = "./property-form-mapping.ts";
const { propertyToFormData } = await import(modulePath);
const modelModulePath = "./property-form-model.ts";
const { buildPropertyMutationInput } = await import(modelModulePath);

test("resumo gerenciado hidrata isenções e MCMV sem expor metadata", () => {
  const form = propertyToFormData({
    id: "11111111-1111-4111-8111-111111111111",
    organization_id: "22222222-2222-4222-8222-222222222222",
    title: "Apartamento",
    updated_at: "2026-09-08T03:04:05Z",
    tipo_de_imovel: "Apartamento",
    tipo_de_negocio: "Venda",
    condominio: 850,
    iptu: 275,
    aceita_financiamento: false,
    can_edit: true,
    managed_terms: {
      condominium_exempt: true,
      property_tax_exempt: true,
      financing_mode: "mcmv",
    },
  });

  assert.equal(form.condominio_isento, true);
  assert.equal(form.iptu_isento, true);
  assert.equal(form.condominio, "");
  assert.equal(form.iptu, "");
  assert.equal(form.financing_mode, "mcmv");
});

test("edição legada sem finalidade de uso não inventa Residencial", () => {
  const form = propertyToFormData({
    id: "11111111-1111-4111-8111-111111111111",
    organization_id: "22222222-2222-4222-8222-222222222222",
    title: "Apartamento",
    updated_at: "2026-09-08T03:04:05Z",
    tipo_de_imovel: "Apartamento",
    tipo_de_negocio: "Venda",
    finalidade: null,
    can_edit: true,
    managed_terms: {
      condominium_exempt: false,
      property_tax_exempt: false,
      financing_mode: "sim",
    },
  });

  assert.equal(form.tipo_de_negocio, "Venda");
  assert.equal(form.finalidade, "");

  const mutation = buildPropertyMutationInput(form, {
    isEditing: true,
    canAssignProperty: true,
    canManagePropertyCatalogs: true,
  });
  assert.equal(mutation.tipo_de_negocio, "Venda");
  assert.equal(mutation.finalidade, null);
});
