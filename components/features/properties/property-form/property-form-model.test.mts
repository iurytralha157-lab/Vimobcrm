import assert from "node:assert/strict";
import test from "node:test";
import type {
  PropertyFormData,
  ValidationIssue,
} from "./property-form-model";

const propertyFormModelPath = "./property-form-model.ts";
const {
  appendUniqueOption,
  buildPropertyMutationInput,
  formatCurrencyDisplay,
  getPropertyFormRules,
  getPropertyValidationIssues,
  initialFormData,
  isSupportedDealType,
  normalizeLocaleNumberString,
  normalizePropertyStatus,
} = await import(propertyFormModelPath);

function validSaleForm(
  overrides: Partial<PropertyFormData> = {},
): PropertyFormData {
  return {
    ...initialFormData,
    cadastrado_por: "user-1",
    owner_name: "Maria Proprietária",
    owner_cellphone: "11999999999",
    title: "Apartamento central",
    tipo_de_imovel: "Apartamento",
    tipo_de_negocio: "Venda",
    public_address_visibility: "parcial",
    preco: "650000",
    quartos: "2",
    imagem_principal: "https://cdn.example/main.jpg",
    fotos: ["https://cdn.example/main.jpg"],
    ...overrides,
  };
}

test("normaliza moeda brasileira sem alterar a precisão aceita pelo formulário", () => {
  assert.equal(normalizeLocaleNumberString("R$ 1.234,56", 2), "1234.56");
  assert.equal(normalizeLocaleNumberString("1.234", 2), "1234");
  assert.equal(normalizeLocaleNumberString("12,345", 2), "12.34");
  assert.equal(formatCurrencyDisplay("1234.5"), "R$ 1.234,50");
});

test("opções personalizadas continuam sem duplicatas por caixa ou acento", () => {
  const options = ["Venda", "Lançamento"];
  assert.deepEqual(appendUniqueOption(options, "lancamento"), options);
  assert.deepEqual(appendUniqueOption(options, "  Permuta  "), [
    ...options,
    "Permuta",
  ]);
});

test("regras distinguem venda, locação, modalidade combinada e temporada", () => {
  assert.deepEqual(getPropertyFormRules(validSaleForm()), {
    isLand: false,
    isRental: false,
    isSale: true,
    isSeasonal: false,
    supportsRentalContractTerms: false,
    supportsSaleTerms: true,
  });

  const combined = getPropertyFormRules(
    validSaleForm({ tipo_de_negocio: "Venda e Aluguel" }),
  );
  assert.equal(combined.isSale, true);
  assert.equal(combined.isRental, true);
  assert.equal(combined.supportsRentalContractTerms, true);
  assert.equal(combined.supportsSaleTerms, true);

  const seasonal = getPropertyFormRules(
    validSaleForm({ tipo_de_negocio: "Temporada" }),
  );
  assert.equal(seasonal.isRental, true);
  assert.equal(seasonal.supportsRentalContractTerms, false);
  assert.equal(seasonal.supportsSaleTerms, false);
});

test("mapeia status canônico e legado para as opções em português", () => {
  assert.equal(normalizePropertyStatus("active"), "ativo");
  assert.equal(normalizePropertyStatus("reserved"), "reservado");
  assert.equal(normalizePropertyStatus("sold"), "vendido");
  assert.equal(normalizePropertyStatus("rented"), "alugado");
  assert.equal(normalizePropertyStatus("inactive"), "inativo");
  assert.equal(normalizePropertyStatus("draft"), "rascunho");
  assert.equal(normalizePropertyStatus("archived"), "arquivado");
});

test("restringe modalidade às aliases aceitas pelo backend", () => {
  assert.equal(isSupportedDealType("Lançamento"), true);
  assert.equal(isSupportedDealType("venda_locacao"), true);
  assert.equal(isSupportedDealType("Permuta"), false);
  assert.deepEqual(
    getPropertyValidationIssues(
      validSaleForm({ tipo_de_negocio: "Permuta" }),
    ).map((issue: ValidationIssue) => issue.label),
    ["Modalidade válida"],
  );
});

test("classifica todas as aliases de modalidade aceitas pelo backend", () => {
  for (const alias of ["Venda", "sale", "Lançamento", "launch", "release"]) {
    const rules = getPropertyFormRules(
      validSaleForm({ tipo_de_negocio: alias }),
    );
    assert.equal(rules.isSale, true, `${alias} deve ser venda`);
    assert.equal(rules.isRental, false, `${alias} não deve ser locação`);
    assert.equal(rules.supportsSaleTerms, true, `${alias} aceita termos de venda`);
  }

  for (const alias of ["Aluguel", "Locação", "locacao anual", "rent"]) {
    const rules = getPropertyFormRules(
      validSaleForm({ tipo_de_negocio: alias }),
    );
    assert.equal(rules.isRental, true, `${alias} deve ser locação`);
    assert.equal(rules.isSale, false, `${alias} não deve ser venda`);
    assert.equal(
      rules.supportsRentalContractTerms,
      true,
      `${alias} aceita termos de locação`,
    );
  }

  for (const alias of ["Temporada", "season"]) {
    const rules = getPropertyFormRules(
      validSaleForm({ tipo_de_negocio: alias }),
    );
    assert.equal(rules.isRental, true, `${alias} deve ser locação`);
    assert.equal(rules.isSeasonal, true, `${alias} deve ser temporada`);
    assert.equal(rules.supportsRentalContractTerms, false);
  }

  for (const alias of [
    "Venda e Aluguel",
    "Venda e Locação",
    "venda locacao",
    "venda/locacao",
    "venda/aluguel",
    "venda_locacao",
  ]) {
    const rules = getPropertyFormRules(
      validSaleForm({ tipo_de_negocio: alias }),
    );
    assert.equal(rules.isSale, true, `${alias} deve incluir venda`);
    assert.equal(rules.isRental, true, `${alias} deve incluir locação`);
    assert.equal(rules.supportsSaleTerms, true);
    assert.equal(rules.supportsRentalContractTerms, true);
  }
});

test("validação mantém obrigatórios condicionais por tipo e modalidade", () => {
  assert.deepEqual(getPropertyValidationIssues(validSaleForm()), []);

  const editIssues = getPropertyValidationIssues(
    validSaleForm({ imagem_principal: "", fotos: [] }),
    { isEditing: true },
  );
  assert.equal(
    editIssues.some((issue: ValidationIssue) => issue.tab === "media"),
    false,
  );

  const landIssues = getPropertyValidationIssues(
    validSaleForm({ tipo_de_imovel: "Terreno", quartos: "", area_total: "" }),
  );
  assert.deepEqual(
    landIssues.map((issue: ValidationIssue) => issue.label),
    ["Área total"],
  );

  const rentalIssues = getPropertyValidationIssues(
    validSaleForm({ tipo_de_negocio: "Aluguel", preco: "", valor_locacao: "" }),
  );
  assert.deepEqual(
    rentalIssues.map((issue: ValidationIssue) => issue.label),
    ["Valor de locação"],
  );
});

test("payload preserva conversões financeiras e limpa termos incompatíveis", () => {
  const salePayload = buildPropertyMutationInput(
    validSaleForm({
      preco: "1.234.567,89",
      aceita_permuta: true,
      exchange_details: "Imóvel menor",
      financing_mode: "mcmv",
      financing_details: "Carta de crédito",
      valor_locacao: "4500",
    }),
    {
      isEditing: false,
      canAssignProperty: true,
      canManagePropertyCatalogs: true,
    },
  );
  assert.equal(salePayload.preco, 1234567.89);
  assert.equal(salePayload.valor_locacao, null);
  assert.equal(salePayload.aceita_financiamento, true);
  assert.equal(salePayload.aceita_permuta, true);
  assert.deepEqual(salePayload.metadata, {
    financing_details: "Carta de crédito",
    exchange_details: "Imóvel menor",
    condominio_isento: false,
    iptu_isento: false,
    iptu_period: "mensal",
    rent_adjustment_index: null,
    financing_mode: "mcmv",
    quadra: null,
    lote: null,
  });

  const rentalPayload = buildPropertyMutationInput(
    validSaleForm({
      tipo_de_negocio: "Aluguel",
      preco: "900000",
      valor_locacao: "4.500,25",
      valor_seguro_fianca: "3000",
      rent_adjustment_index: "IPCA",
      usou_fgts: true,
      aceita_financiamento: true,
      aceita_permuta: true,
      financing_mode: "sim",
    }),
    {
      isEditing: false,
      canAssignProperty: true,
      canManagePropertyCatalogs: true,
    },
  );
  assert.equal(rentalPayload.preco, null);
  assert.equal(rentalPayload.valor_locacao, 4500.25);
  assert.equal(rentalPayload.valor_seguro_fianca, 3000);
  assert.equal(rentalPayload.usou_fgts, false);
  assert.equal(rentalPayload.aceita_financiamento, false);
  assert.equal(rentalPayload.aceita_permuta, false);
  assert.equal(rentalPayload.metadata?.rent_adjustment_index, "IPCA");
  assert.equal(rentalPayload.metadata?.financing_mode, "nao");
});

test("payload preserva zero em campos inteiros válidos", () => {
  const payload = buildPropertyMutationInput(
    validSaleForm({
      quartos: "0",
      suites: "0",
      banheiros: "0",
      vagas: "0",
      andar: "0",
    }),
    {
      isEditing: false,
      canAssignProperty: true,
      canManagePropertyCatalogs: true,
    },
  );

  assert.equal(payload.quartos, 0);
  assert.equal(payload.suites, 0);
  assert.equal(payload.banheiros, 0);
  assert.equal(payload.vagas, 0);
  assert.equal(payload.andar, 0);
});

test("payload não replica URLs legadas; fotos seguem pelo catálogo canônico", () => {
  const payload = buildPropertyMutationInput(validSaleForm(), {
    isEditing: false,
    canAssignProperty: true,
    canManagePropertyCatalogs: true,
  });

  assert.equal(Object.hasOwn(payload, "imagem_principal"), false);
  assert.equal(Object.hasOwn(payload, "fotos"), false);
  assert.equal(
    Object.hasOwn(payload.metadata ?? {}, "hidden_site_image_urls"),
    false,
  );
});

test("uma única foto válida basta na criação, como principal ou galeria", () => {
  for (const form of [
    validSaleForm({ fotos: [] }),
    validSaleForm({
      imagem_principal: "",
      fotos: ["https://cdn.example/only.jpg"],
    }),
  ]) {
    assert.equal(
      getPropertyValidationIssues(form).some(
        (issue: ValidationIssue) => issue.tab === "media",
      ),
      false,
    );
  }

  assert.deepEqual(
    getPropertyValidationIssues(
      validSaleForm({ imagem_principal: " ", fotos: [" "] }),
    ).map((issue: ValidationIssue) => issue.label),
    ["Ao menos uma foto do imóvel"],
  );
});

test("validação aceita vinte fotos únicas e bloqueia a vigésima primeira", () => {
  const twentyPhotos = Array.from(
    { length: 20 },
    (_, index) => `https://cdn.example/photo-${index}.jpg`,
  );

  assert.equal(
    getPropertyValidationIssues(
      validSaleForm({ imagem_principal: twentyPhotos[0], fotos: twentyPhotos.slice(1) }),
    ).some((issue: ValidationIssue) => issue.tab === "media"),
    false,
  );
  assert.deepEqual(
    getPropertyValidationIssues(
      validSaleForm({
        imagem_principal: twentyPhotos[0],
        fotos: [...twentyPhotos.slice(1), "https://cdn.example/photo-20.jpg"],
      }),
    ).map((issue: ValidationIssue) => issue.label),
    ["No máximo 20 fotos do imóvel"],
  );
});

test("proprietário cadastrado envia somente a referência canônica", () => {
  const payload = buildPropertyMutationInput(
    validSaleForm({
      owner_id: "11111111-1111-4111-8111-111111111111",
      owner_name: "Nome possivelmente defasado",
      owner_email: "antigo@example.test",
      owner_cellphone: "11900000000",
    }),
    {
      isEditing: true,
      canAssignProperty: true,
      canManagePropertyCatalogs: true,
      canEditOwnerDetails: true,
    },
  );

  assert.equal(payload.owner_id, "11111111-1111-4111-8111-111111111111");
  for (const field of [
    "owner_name",
    "owner_phone_residential",
    "owner_phone_commercial",
    "owner_cellphone",
    "owner_email",
    "owner_media_source",
    "owner_notify_email",
  ]) {
    assert.equal(Object.hasOwn(payload, field), false, `${field} foi reenviado`);
  }
});

test("edição sem permissão de atribuição omite responsável e tipo imutável", () => {
  const payload = buildPropertyMutationInput(validSaleForm(), {
    isEditing: true,
    canAssignProperty: false,
    canManagePropertyCatalogs: false,
  });

  assert.equal(Object.hasOwn(payload, "cadastrado_por"), false);
  assert.equal(Object.hasOwn(payload, "corretor_id"), false);
  assert.equal(Object.hasOwn(payload, "tipo_de_imovel"), false);
  assert.equal(Object.hasOwn(payload, "property_type_id"), false);
});

test("editor liberado por policy envia somente campos base, sem internos ou mídia", () => {
  const payload = buildPropertyMutationInput(
    validSaleForm({
      commission_percentage: "6",
      condicao_pagamento: "Entrada e parcelas",
      comentarios_internos: "Não expor",
      referencia_alternativa: "REF-INTERNA",
      valor_venda_avaliado: "700000",
      situacao_imovel: "ocupado",
      video_imovel: "https://video.example.test/watch/1",
      tour_virtual: "https://tour.example.test/1",
      zoneamento: "ZR-4",
      descricao: "Descrição permitida",
      descricao_site: "Descrição pública permitida",
    }),
    {
      isEditing: true,
      canAssignProperty: false,
      canManagePropertyCatalogs: false,
      canEditOwnerDetails: true,
    },
  );

  for (const field of [
    "commission_percentage",
    "condicao_pagamento",
    "comentarios_internos",
    "referencia_alternativa",
    "valor_venda_avaliado",
    "situacao_imovel",
    "metadata",
    "video_imovel",
    "tour_virtual",
    "corretor_id",
  ]) {
    assert.equal(Object.hasOwn(payload, field), false, `${field} foi reenviado`);
  }
  assert.equal(payload.title, "Apartamento central");
  assert.equal(payload.zoneamento, "ZR-4");
  assert.equal(payload.descricao, "Descrição permitida");
  assert.equal(payload.descricao_site, "Descrição pública permitida");
  assert.equal(payload.owner_name, "Maria Proprietária");
});

test("editor por policy preserva metadata legado sem criar valores contraditórios", () => {
  const payload = buildPropertyMutationInput(
    validSaleForm({
      condominio: "850",
      condominio_isento: true,
      iptu: "275",
      iptu_isento: true,
      financing_mode: "mcmv",
      aceita_financiamento: true,
    }),
    {
      isEditing: true,
      canAssignProperty: false,
      canManagePropertyCatalogs: false,
      canEditOwnerDetails: true,
    },
  );

  assert.equal(Object.hasOwn(payload, "metadata"), false);
  assert.equal(payload.condominio, null);
  assert.equal(payload.iptu, null);
  assert.equal(payload.aceita_financiamento, true);
});

test("gestor mantém campos internos e mídia no payload de edição", () => {
  const payload = buildPropertyMutationInput(
    validSaleForm({
      commission_percentage: "6",
      comentarios_internos: "Uso interno",
      video_imovel: "https://video.example.test/watch/1",
      tour_virtual: "https://tour.example.test/1",
    }),
    {
      isEditing: true,
      canAssignProperty: true,
      canManagePropertyCatalogs: true,
    },
  );

  assert.equal(payload.commission_percentage, 6);
  assert.equal(payload.comentarios_internos, "Uso interno");
  assert.equal(payload.video_imovel, "https://video.example.test/watch/1");
  assert.equal(payload.tour_virtual, "https://tour.example.test/1");
  assert.ok(Object.hasOwn(payload, "metadata"));
});

test("edição com contatos ocultos não exige nem reenvia dados do proprietário", () => {
  const redactedForm = validSaleForm({
    owner_id: "",
    owner_name: "",
    owner_phone_residential: "",
    owner_phone_commercial: "",
    owner_cellphone: "",
    owner_email: "",
    owner_media_source: "",
    owner_notify_email: false,
  });

  const issues = getPropertyValidationIssues(redactedForm, {
    isEditing: true,
    canEditOwnerDetails: false,
  });
  assert.equal(
    issues.some((issue: ValidationIssue) => issue.tab === "owner"),
    false,
  );

  const payload = buildPropertyMutationInput(redactedForm, {
    isEditing: true,
    canAssignProperty: false,
    canManagePropertyCatalogs: false,
    canEditOwnerDetails: false,
  });
  for (const field of [
    "owner_id",
    "owner_name",
    "owner_phone_residential",
    "owner_phone_commercial",
    "owner_cellphone",
    "owner_email",
    "owner_media_source",
    "owner_notify_email",
  ]) {
    assert.equal(Object.hasOwn(payload, field), false, `${field} foi reenviado`);
  }
  assert.equal(payload.title, "Apartamento central");
});
