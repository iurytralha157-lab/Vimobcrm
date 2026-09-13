import { z } from "zod";
import {
  apiEnvelopeSchema,
  nonNegativeIntegerSchema,
  timestampSchema,
  uuidSchema,
} from "./common";

const optionalUUIDValueSchema = z
  .union([uuidSchema, z.literal(""), z.null()])
  .optional();
const optionalNumberValueSchema = z
  .union([
    z.number().finite(),
    z
      .string()
      .trim()
      .regex(/^-?\d+(\.\d+)?$/),
    z.null(),
  ])
  .optional();
const optionalNonNegativeNumberValueSchema = z
  .union([
    z.number().finite().min(0),
    z
      .string()
      .trim()
      .regex(/^\d+(\.\d+)?$/),
    z.null(),
  ])
  .optional();
const optionalNonNegativeIntegerValueSchema = z
  .union([z.number().int().min(0), z.string().trim().regex(/^\d+$/), z.null()])
  .optional();
const optionalNonNegativeFilterSchema = z
  .union([
    z.number().finite().min(0),
    z
      .string()
      .trim()
      .regex(/^\d+(\.\d+)?$/),
  ])
  .optional();
const optionalNonNegativeIntegerFilterSchema = z
  .union([z.number().int().min(0), z.string().trim().regex(/^\d+$/)])
  .optional();

const normalizedPropertyToken = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

const propertyDealTypeValues = new Set([
  "venda",
  "sale",
  "aluguel",
  "locacao",
  "locacao anual",
  "rent",
  "temporada",
  "season",
  "lancamento",
  "launch",
  "release",
  "venda e aluguel",
  "venda locacao",
  "venda/locacao",
  "venda/aluguel",
  "venda_locacao",
]);

const propertyDealTypeInputSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine(
    (value) => propertyDealTypeValues.has(normalizedPropertyToken(value)),
    "Modalidade do imovel invalida",
  );

const propertyDealTypeFilterSchema = propertyDealTypeInputSchema.or(
  z.literal("rental_catalog"),
);

const propertyStatusValues = new Set([
  "draft",
  "rascunho",
  "active",
  "ativo",
  "available",
  "disponivel",
  "reserved",
  "reservado",
  "sold",
  "vendido",
  "rented",
  "alugado",
  "locado",
  "inactive",
  "inativo",
  "archived",
  "arquivado",
]);

const propertyStatusInputSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine(
    (value) => propertyStatusValues.has(normalizedPropertyToken(value)),
    "Status do imovel invalido",
  );

const propertyMutationAliasGroups = [
  ["tipo", "tipo_de_imovel", "text"],
  ["origin_media", "owner_media_source", "text"],
  ["image_urls", "fotos", "json"],
  ["documents", "arquivos", "json"],
  ["responsible_user_id", "cadastrado_por", "uuid"],
  ["is_featured", "destaque", "json"],
] as const;

const PROPERTY_PHOTO_LIMIT = 20;

function stablePropertyAliasValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stablePropertyAliasValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stablePropertyAliasValue(item)]),
    );
  }
  return value;
}

function validatePropertyMutationAliases(
  input: Record<string, unknown>,
  context: z.RefinementCtx,
) {
  for (const [canonical, alias, kind] of propertyMutationAliasGroups) {
    if (!(canonical in input) || !(alias in input)) continue;
    const normalize = (value: unknown) => {
      if (
        kind === "uuid" &&
        (value == null || (typeof value === "string" && value.trim() === ""))
      )
        return null;
      if (kind === "text" && typeof value === "string") return value.trim();
      return stablePropertyAliasValue(value);
    };
    if (
      JSON.stringify(normalize(input[canonical])) !==
      JSON.stringify(normalize(input[alias]))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [alias],
        message: `${canonical} e ${alias} contem valores conflitantes`,
      });
    }
  }
}

function validatePropertyPhotoCapacity(
  input: Record<string, unknown>,
  context: z.RefinementCtx,
) {
  const locators = new Set<string>();
  const addLocator = (value: unknown) => {
    if (typeof value !== "string") return;
    const normalized = value.trim();
    if (normalized) locators.add(normalized);
  };

  addLocator(input.imagem_principal);
  for (const field of ["image_urls", "fotos"] as const) {
    const images = input[field];
    if (!Array.isArray(images)) continue;
    images.forEach(addLocator);
  }

  if (locators.size > PROPERTY_PHOTO_LIMIT) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["image_urls"],
      message: `Cada imovel pode ter no maximo ${PROPERTY_PHOTO_LIMIT} fotos`,
    });
  }
}

export const propertyListQuerySchema = z
  .object({
    limit: z.number().int().min(1).max(1_000).optional(),
    offset: z.number().int().min(0).max(100_000).optional(),
    scope: z.enum(["own"]).optional(),
    search: z.string().trim().max(120).optional(),
    status: propertyStatusInputSchema.optional(),
    tipo_de_negocio: propertyDealTypeFilterSchema.optional(),
    tipo_de_imovel: z.string().trim().max(80).optional(),
    cidade: z.string().trim().max(120).optional(),
    bairro: z.string().trim().max(120).optional(),
    responsavel_id: uuidSchema.optional(),
    quartos_min: optionalNonNegativeIntegerFilterSchema,
    suites_min: optionalNonNegativeIntegerFilterSchema,
    banheiros_min: optionalNonNegativeIntegerFilterSchema,
    valor_min: optionalNonNegativeFilterSchema,
    valor_max: optionalNonNegativeFilterSchema,
    aceita_permuta: z.boolean().optional(),
    aceita_financiamento: z.boolean().optional(),
    published_on_site: z.boolean().optional(),
    owner_id: uuidSchema.optional(),
    condominium_id: uuidSchema.optional(),
    mobilia: z.string().trim().max(80).optional(),
    exclusividade: z.boolean().optional(),
    placa_no_local: z.boolean().optional(),
    destaque: z.boolean().optional(),
    vagas_min: optionalNonNegativeIntegerFilterSchema,
    area_util_min: optionalNonNegativeFilterSchema,
    area_util_max: optionalNonNegativeFilterSchema,
    area_total_min: optionalNonNegativeFilterSchema,
    area_total_max: optionalNonNegativeFilterSchema,
  })
  .strict()
  .superRefine((input, context) => {
    for (const [prefix, minimum, maximum] of [
      ["valor", input.valor_min, input.valor_max],
      ["area_util", input.area_util_min, input.area_util_max],
      ["area_total", input.area_total_min, input.area_total_max],
    ] as const) {
      const parsedMinimum = minimum === undefined ? 0 : Number(minimum);
      const parsedMaximum = maximum === undefined ? 0 : Number(maximum);
      if (parsedMaximum > 0 && parsedMinimum > parsedMaximum) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [`${prefix}_min`],
          message: `O filtro minimo de ${prefix} deve ser menor ou igual ao maximo`,
        });
      }
    }
  });

const propertyMutationShape = {
  title: z.string().trim().min(1).max(4_000).optional(),
  status: propertyStatusInputSchema.nullable().optional(),
  tipo_de_negocio: propertyDealTypeInputSchema.optional(),
  tipo_de_imovel: z.string().trim().min(1).max(120).optional(),
  tipo: z.string().trim().min(1).max(120).optional(),
  created_by: optionalUUIDValueSchema,
  responsible_user_id: optionalUUIDValueSchema,
  cadastrado_por: optionalUUIDValueSchema,
  corretor_id: optionalUUIDValueSchema,
  owner_id: optionalUUIDValueSchema,
  condominium_id: optionalUUIDValueSchema,
  city_id: optionalUUIDValueSchema,
  neighborhood_id: optionalUUIDValueSchema,
  property_type_id: optionalUUIDValueSchema,
  preco: optionalNonNegativeNumberValueSchema,
  valor_locacao: optionalNonNegativeNumberValueSchema,
  condominio: optionalNonNegativeNumberValueSchema,
  iptu: optionalNonNegativeNumberValueSchema,
  area_total: optionalNonNegativeNumberValueSchema,
  area_util: optionalNonNegativeNumberValueSchema,
  quartos: optionalNonNegativeIntegerValueSchema,
  suites: optionalNonNegativeIntegerValueSchema,
  banheiros: optionalNonNegativeIntegerValueSchema,
  vagas: optionalNonNegativeIntegerValueSchema,
  commission_percentage: optionalNonNegativeNumberValueSchema.refine(
    (value) => value == null || Number(value) <= 100,
    "A comissao deve estar entre 0 e 100",
  ),
  latitude: optionalNumberValueSchema.refine(
    (value) => value == null || (Number(value) >= -90 && Number(value) <= 90),
    "Latitude invalida",
  ),
  longitude: optionalNumberValueSchema.refine(
    (value) => value == null || (Number(value) >= -180 && Number(value) <= 180),
    "Longitude invalida",
  ),
  aceita_permuta: z.boolean().nullable().optional(),
  aceita_financiamento: z.boolean().nullable().optional(),
  regra_pet: z.boolean().nullable().optional(),
  mobiliado: z.boolean().nullable().optional(),
  autorizado_comercializacao: z.boolean().nullable().optional(),
  exclusividade: z.boolean().nullable().optional(),
  usou_fgts: z.boolean().nullable().optional(),
  is_featured: z.boolean().nullable().optional(),
  destaque: z.boolean().nullable().optional(),
  super_destaque: z.boolean().nullable().optional(),
  placa_no_local: z.boolean().nullable().optional(),
  projeto_aprovado: z.boolean().nullable().optional(),
  is_demo: z.boolean().nullable().optional(),
  owner_notify_email: z.boolean().optional(),
  andar: optionalNonNegativeIntegerValueSchema,
  ano_construcao: optionalNonNegativeIntegerValueSchema,
  ano_reforma: optionalNonNegativeIntegerValueSchema,
  renda_familiar: optionalNonNegativeNumberValueSchema,
  seguro_incendio: optionalNonNegativeNumberValueSchema,
  taxa_de_servico: optionalNonNegativeNumberValueSchema,
  comissao_venda: optionalNonNegativeNumberValueSchema,
  comissao_locacao: optionalNonNegativeNumberValueSchema,
  valor_itr: optionalNonNegativeNumberValueSchema,
  valor_seguro_fianca: optionalNonNegativeNumberValueSchema,
  valor_venda_avaliado: optionalNonNegativeNumberValueSchema,
  valor_locacao_avaliado: optionalNonNegativeNumberValueSchema,
  imagem_principal: z.string().trim().max(4_000).nullable().optional(),
  image_urls: z.array(z.string()).max(PROPERTY_PHOTO_LIMIT).nullable().optional(),
  fotos: z.array(z.string()).max(PROPERTY_PHOTO_LIMIT).nullable().optional(),
  detalhes_extras: z.array(z.string()).nullable().optional(),
  proximidades: z.array(z.string()).nullable().optional(),
  marcadores: z.array(z.string()).nullable().optional(),
  documents: z.unknown().optional(),
  arquivos: z.unknown().optional(),
  metadata: z.record(z.unknown()).optional(),
  finalidade: z.string().trim().max(4_000).nullable().optional(),
  aprovacao_ambiental: z.string().trim().max(4_000).nullable().optional(),
  bairro: z.string().trim().max(4_000).nullable().optional(),
  cep: z.string().trim().max(4_000).nullable().optional(),
  cidade: z.string().trim().max(4_000).nullable().optional(),
  codigo_agua: z.string().trim().max(4_000).nullable().optional(),
  codigo_eletricidade: z.string().trim().max(4_000).nullable().optional(),
  codigo_iptu: z.string().trim().max(4_000).nullable().optional(),
  comentarios_internos: z.string().trim().max(4_000).nullable().optional(),
  complemento: z.string().trim().max(4_000).nullable().optional(),
  condicao_comercial: z.string().trim().max(4_000).nullable().optional(),
  condicao_pagamento: z.string().trim().max(4_000).nullable().optional(),
  data_inicio_comissao: z.string().trim().max(4_000).nullable().optional(),
  descricao: z.string().trim().max(4_000).nullable().optional(),
  descricao_site: z.string().trim().max(4_000).nullable().optional(),
  endereco: z.string().trim().max(4_000).nullable().optional(),
  external_id: z.string().trim().max(4_000).nullable().optional(),
  external_provider: z.string().trim().max(4_000).nullable().optional(),
  faixa_valor_imovel: z.string().trim().max(4_000).nullable().optional(),
  imoview_codigo: z.string().trim().max(4_000).nullable().optional(),
  local_chaves: z.string().trim().max(4_000).nullable().optional(),
  mobilia: z.string().trim().max(4_000).nullable().optional(),
  numero: z.string().trim().max(4_000).nullable().optional(),
  numero_matricula: z.string().trim().max(4_000).nullable().optional(),
  observacoes_documentacao: z.string().trim().max(4_000).nullable().optional(),
  ocupacao: z.string().trim().max(4_000).nullable().optional(),
  origin_media: z.string().trim().max(80).nullable().optional(),
  owner_cellphone: z.string().trim().max(40).nullable().optional(),
  owner_email: z
    .union([z.string().trim().max(160).email(), z.literal(""), z.null()])
    .optional(),
  owner_media_source: z.string().trim().max(80).nullable().optional(),
  owner_name: z.string().trim().max(160).nullable().optional(),
  owner_phone_commercial: z.string().trim().max(40).nullable().optional(),
  owner_phone_residential: z.string().trim().max(40).nullable().optional(),
  padrao: z.string().trim().max(4_000).nullable().optional(),
  pais: z.string().trim().max(4_000).nullable().optional(),
  posicao_localizacao: z.string().trim().max(4_000).nullable().optional(),
  public_address_visibility: z.string().trim().max(4_000).nullable().optional(),
  referencia_alternativa: z.string().trim().max(4_000).nullable().optional(),
  situacao_imovel: z.string().trim().max(4_000).nullable().optional(),
  status_descritivo: z.string().trim().max(4_000).nullable().optional(),
  tipo_comissao: z.string().trim().max(4_000).nullable().optional(),
  tour_virtual: z.string().trim().max(4_000).nullable().optional(),
  uf: z.string().trim().max(4_000).nullable().optional(),
  video_imovel: z.string().trim().max(4_000).nullable().optional(),
  vista_codigo: z.string().trim().max(4_000).nullable().optional(),
  zoneamento: z.string().trim().max(4_000).nullable().optional(),
};

export const propertyCreateInputSchema = z
  .object({
    ...propertyMutationShape,
    title: z.string().trim().min(1).max(4_000),
    tipo_de_imovel: z.string().trim().min(1).max(120),
    tipo_de_negocio: propertyDealTypeInputSchema,
  })
  .strict()
  .superRefine((input, context) => {
    validatePropertyMutationAliases(input, context);
    validatePropertyPhotoCapacity(input, context);
    if (
      input.owner_notify_email &&
      !input.owner_id &&
      !input.owner_email?.trim()
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["owner_email"],
        message: "Informe o email para ativar notificacoes do proprietario",
      });
    }
  });

export const propertyUpdateInputSchema = z
  .object({
    ...propertyMutationShape,
    expected_updated_at: z
      .string()
      .trim()
      .datetime({ offset: true }),
  })
  .strict()
  .refine(
    (input) => Object.keys(input).some((key) => key !== "expected_updated_at"),
    "Informe ao menos uma alteracao",
  )
  .superRefine((input, context) => {
    validatePropertyMutationAliases(input, context);
    validatePropertyPhotoCapacity(input, context);
    if (
      input.owner_notify_email &&
      "owner_email" in input &&
      !input.owner_id &&
      !input.owner_email?.trim()
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["owner_email"],
        message: "Informe o email para ativar notificacoes do proprietario",
      });
    }
  });

export const propertyDeleteInputSchema = z
  .object({
    expected_updated_at: z.string().trim().datetime({ offset: true }),
  })
  .strict();

export const apiPropertySchema = z
  .object({
    id: uuidSchema,
    organization_id: uuidSchema,
    title: z.string().nullable().optional(),
    updated_at: z.string().trim().datetime({ offset: true }),
  })
  .passthrough();

export const apiPropertyManagedTermsSchema = z
  .object({
    condominium_exempt: z.boolean(),
    property_tax_exempt: z.boolean(),
    financing_mode: z.enum(["sim", "nao", "mcmv"]),
  })
  .strict();

export const apiPropertyWithCapabilitiesSchema = apiPropertySchema.extend({
  can_edit: z.boolean(),
  managed_terms: apiPropertyManagedTermsSchema,
});

export const apiPropertyListResponseSchema = z
  .object({
    data: z.array(apiPropertyWithCapabilitiesSchema),
    total: nonNegativeIntegerSchema,
    limit: z.number().int().min(1).max(1_000),
    offset: nonNegativeIntegerSchema,
  })
  .passthrough();

export const apiPropertyCreateResponseSchema = apiEnvelopeSchema(apiPropertySchema);
export const apiPropertyResponseSchema = apiEnvelopeSchema(
  apiPropertyWithCapabilitiesSchema,
);
export const apiPropertyStatsSchema = z
  .object({
    total: nonNegativeIntegerSchema,
    sale: nonNegativeIntegerSchema,
    rental: nonNegativeIntegerSchema,
    launches: nonNegativeIntegerSchema,
    available: nonNegativeIntegerSchema,
    reserved: nonNegativeIntegerSchema,
    sold: nonNegativeIntegerSchema,
    rented: nonNegativeIntegerSchema,
    private: nonNegativeIntegerSchema,
  })
  .passthrough();

export const apiPropertyHistoryResponseSchema = apiEnvelopeSchema(
  z.array(
    z
      .object({
        id: z.string().min(1),
        type: z.string().min(1),
        title: z.string().min(1),
        metadata: z.record(z.unknown()),
        created_at: timestampSchema,
      })
      .passthrough(),
  ),
);
