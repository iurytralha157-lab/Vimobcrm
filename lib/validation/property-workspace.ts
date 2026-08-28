import { z } from 'zod'

import { uuidSchema } from './common'

const nullableDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable()
const workspaceTimestampSchema = z.string().trim().datetime({ offset: true })
const nullableTimestampSchema = workspaceTimestampSchema.nullable()
const nullableTrimmedString = (max: number) => z.string().trim().max(max).nullable()
const nullableStringSchema = z.string().nullable()
const nullableNumberSchema = z.number().finite().nullable()
const nullableBooleanSchema = z.boolean().nullable()
const httpURLSchema = z.string().trim().url().regex(/^https?:\/\//i, 'Use uma URL HTTP ou HTTPS')

// The BFF projects an explicit property allowlist. Repeat the allowlist at the
// client boundary so contract drift still cannot place internal columns in the
// React Query cache.
export const propertyWorkspacePropertySchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  code: z.string().min(1),
  title: nullableStringSchema,
  status: nullableStringSchema,
  tipo: nullableStringSchema,
  tipo_de_imovel: nullableStringSchema,
  tipo_de_negocio: nullableStringSchema.optional(),
  finalidade: nullableStringSchema.optional(),
  published_on_site: nullableBooleanSchema,
  anunciar: nullableBooleanSchema,
  imagem_principal: nullableStringSchema,
  image_urls: z.array(z.string()).nullable(),
  fotos: z.array(z.string()).nullable(),
  quartos: nullableNumberSchema,
  banheiros: nullableNumberSchema,
  vagas: nullableNumberSchema,
  area_util: nullableNumberSchema,
  area_total: nullableNumberSchema,
  descricao: nullableStringSchema,
  descricao_site: nullableStringSchema,
  endereco: nullableStringSchema,
  numero: nullableStringSchema,
  complemento: nullableStringSchema.optional(),
  bairro: nullableStringSchema,
  cidade: nullableStringSchema,
  uf: nullableStringSchema,
  cep: nullableStringSchema,
  address_visibility: nullableStringSchema,
  public_address_visibility: z.string(),
  // Internal registration data is projected only for managers by the BFF.
  numero_matricula: nullableStringSchema.optional(),
  iptu: nullableNumberSchema,
  preco: nullableNumberSchema,
  valor_locacao: nullableNumberSchema,
  condominio: nullableNumberSchema.optional(),
  seguro_incendio: nullableNumberSchema.optional(),
  taxa_de_servico: nullableNumberSchema.optional(),
  suites: nullableNumberSchema.optional(),
  andar: nullableNumberSchema.optional(),
  ano_construcao: nullableNumberSchema.optional(),
  ano_reforma: nullableNumberSchema.optional(),
  mobilia: nullableStringSchema.optional(),
  mobiliado: nullableBooleanSchema.optional(),
  regra_pet: nullableBooleanSchema.optional(),
  detalhes_extras: z.array(z.string()).nullable().optional(),
  latitude: nullableNumberSchema.optional(),
  longitude: nullableNumberSchema.optional(),
  marcadores: z.array(z.string()).nullable().optional(),
  padrao: nullableStringSchema.optional(),
  pais: nullableStringSchema.optional(),
  posicao_localizacao: nullableStringSchema.optional(),
  proximidades: z.array(z.string()).nullable().optional(),
  usou_fgts: nullableBooleanSchema.optional(),
  valor_itr: nullableNumberSchema.optional(),
  valor_seguro_fianca: nullableNumberSchema.optional(),
  zoneamento: nullableStringSchema.optional(),
  video_imovel: nullableStringSchema.optional(),
  tour_virtual: nullableStringSchema.optional(),
  owner_id: uuidSchema.nullable().optional(),
  owner_name: nullableStringSchema,
  responsible_user_id: uuidSchema.nullable().optional(),
  cadastrado_por: uuidSchema.nullable().optional(),
  corretor_id: uuidSchema.nullable().optional(),
  property_type_id: uuidSchema.nullable().optional(),
  condominium_id: uuidSchema.nullable().optional(),
  city_id: uuidSchema.nullable().optional(),
  neighborhood_id: uuidSchema.nullable().optional(),
  destaque: nullableBooleanSchema.optional(),
  is_featured: nullableBooleanSchema.optional(),
  super_destaque: nullableBooleanSchema.optional(),
  placa_no_local: nullableBooleanSchema.optional(),
  aceita_permuta: nullableBooleanSchema.optional(),
  aceita_financiamento: nullableBooleanSchema.optional(),
  exclusividade: nullableBooleanSchema.optional(),
  created_at: nullableTimestampSchema.optional(),
  updated_at: nullableTimestampSchema.optional(),

  // Owner contacts are optional because the BFF omits them unless the active
  // tenant policy allows this viewer to see owner contact data.
  owner_phone_residential: nullableStringSchema.optional(),
  owner_phone_commercial: nullableStringSchema.optional(),
  owner_cellphone: nullableStringSchema.optional(),
  owner_email: nullableStringSchema.optional(),
  owner_notify_email: nullableBooleanSchema.optional(),
  owner_media_source: nullableStringSchema.optional(),

  // Internal registration and commercial fields are projected only for
  // managers. Keeping an explicit allowlist prevents arbitrary database
  // columns from entering the client cache.
  commission_percentage: nullableNumberSchema.optional(),
  comissao_venda: nullableNumberSchema.optional(),
  comissao_locacao: nullableNumberSchema.optional(),
  tipo_comissao: nullableStringSchema.optional(),
  data_inicio_comissao: nullableDateSchema.optional(),
  condicao_comercial: nullableStringSchema.optional(),
  condicao_pagamento: nullableStringSchema.optional(),
  comentarios_internos: nullableStringSchema.optional(),
  local_chaves: nullableStringSchema.optional(),
  codigo_iptu: nullableStringSchema.optional(),
  codigo_eletricidade: nullableStringSchema.optional(),
  codigo_agua: nullableStringSchema.optional(),
  observacoes_documentacao: nullableStringSchema.optional(),
  documents: z.union([z.array(z.unknown()), z.record(z.unknown())]).nullable().optional(),
  arquivos: z.union([z.array(z.unknown()), z.record(z.unknown())]).nullable().optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
  valor_venda_avaliado: nullableNumberSchema.optional(),
  valor_locacao_avaliado: nullableNumberSchema.optional(),
  ocupacao: nullableStringSchema.optional(),
  situacao_imovel: nullableStringSchema.optional(),
  autorizado_comercializacao: nullableBooleanSchema.optional(),
  referencia_alternativa: nullableStringSchema.optional(),
  external_id: nullableStringSchema.optional(),
  external_provider: nullableStringSchema.optional(),
  imoview_codigo: nullableStringSchema.optional(),
  vista_codigo: nullableStringSchema.optional(),
  created_by: uuidSchema.nullable().optional(),
  aprovacao_ambiental: nullableStringSchema.optional(),
  projeto_aprovado: nullableBooleanSchema.optional(),
  status_descritivo: nullableStringSchema.optional(),
}).strip()

const propertyOwnerContactKeys = [
  'owner_phone_residential',
  'owner_phone_commercial',
  'owner_cellphone',
  'owner_email',
  'owner_notify_email',
  'owner_media_source',
] as const satisfies ReadonlyArray<keyof z.infer<typeof propertyWorkspacePropertySchema>>

const propertyManagerOnlyKeys = [
  'commission_percentage',
  'comissao_venda',
  'comissao_locacao',
  'tipo_comissao',
  'data_inicio_comissao',
  'condicao_comercial',
  'condicao_pagamento',
  'comentarios_internos',
  'local_chaves',
  'numero_matricula',
  'codigo_iptu',
  'codigo_eletricidade',
  'codigo_agua',
  'observacoes_documentacao',
  'documents',
  'arquivos',
  'metadata',
  'valor_venda_avaliado',
  'valor_locacao_avaliado',
  'ocupacao',
  'situacao_imovel',
  'autorizado_comercializacao',
  'referencia_alternativa',
  'external_id',
  'external_provider',
  'imoview_codigo',
  'vista_codigo',
  'created_by',
  'aprovacao_ambiental',
  'projeto_aprovado',
  'status_descritivo',
] as const satisfies ReadonlyArray<keyof z.infer<typeof propertyWorkspacePropertySchema>>

function stripWorkspacePropertyFields(
  property: z.infer<typeof propertyWorkspacePropertySchema>,
  fields: ReadonlyArray<keyof z.infer<typeof propertyWorkspacePropertySchema>>,
) {
  const mutable = property as unknown as Record<PropertyKey, unknown>
  for (const field of fields) delete mutable[field]
}

export const propertyOfferTypeSchema = z.enum(['sale', 'rent', 'seasonal'])
export const propertyOfferStatusSchema = z.enum([
  'draft',
  'active',
  'paused',
  'reserved',
  'completed',
  'withdrawn',
  'expired',
])
export const propertyPricePeriodSchema = z.enum(['total', 'daily', 'weekly', 'monthly', 'yearly'])

export const propertyWorkspaceOfferSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  property_id: uuidSchema,
  offer_type: propertyOfferTypeSchema,
  status: propertyOfferStatusSchema,
  price: z.number().finite().min(0).nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  price_period: propertyPricePeriodSchema.nullable(),
  terms: z.record(z.unknown()),
  available_from: nullableDateSchema,
  available_until: nullableDateSchema,
  published_at: nullableTimestampSchema,
  completed_at: nullableTimestampSchema,
  metadata: z.record(z.unknown()),
  created_at: workspaceTimestampSchema,
  updated_at: workspaceTimestampSchema,
}).strip()

export const propertyWorkspaceOwnerSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1),
  phone_residential: z.string().nullable().optional(),
  phone_commercial: z.string().nullable().optional(),
  cellphone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  media_source: z.string().nullable().optional(),
  notify_email: z.boolean().optional(),
  notes: z.string().nullable().optional(),
  created_at: workspaceTimestampSchema,
  updated_at: workspaceTimestampSchema,
}).strip()

export const propertyWorkspaceOwnershipSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  property_id: uuidSchema,
  owner_id: uuidSchema,
  ownership_percentage: z.number().finite().positive().max(100),
  is_primary: z.boolean(),
  valid_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  valid_to: nullableDateSchema,
  notes: z.string().nullable().optional(),
  owner: propertyWorkspaceOwnerSchema,
  created_at: workspaceTimestampSchema,
  updated_at: workspaceTimestampSchema,
}).strip()

export const propertyWorkspaceAssetSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  property_id: uuidSchema,
  asset_type: z.enum(['photo', 'video', 'virtual_tour', 'floor_plan', 'document']),
  visibility: z.enum(['public', 'internal', 'confidential']),
  storage_path: z.string().nullable(),
  external_url: httpURLSchema.nullable(),
  access_url: httpURLSchema.nullable().optional(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  file_name: z.string().nullable(),
  mime_type: z.string().nullable(),
  file_size_bytes: z.number().int().min(0).nullable(),
  sort_order: z.number().int().min(0),
  is_primary: z.boolean(),
  document_category: z.string().nullable(),
  expires_at: nullableDateSchema,
  metadata: z.record(z.unknown()),
  created_at: workspaceTimestampSchema,
  updated_at: workspaceTimestampSchema,
}).strip()

const nullableOwnerField = (max: number) => z.string().trim().max(max).nullable().optional()
const nullableAssetField = (max: number) => z.string().trim().max(max).nullable().optional()

export const propertyOwnerDetailsInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  phone_residential: nullableOwnerField(40),
  phone_commercial: nullableOwnerField(40),
  cellphone: nullableOwnerField(40),
  email: z.string().trim().email().max(160).nullable().optional(),
  media_source: nullableOwnerField(80),
  notify_email: z.boolean().default(false),
  notes: nullableOwnerField(1_200),
}).strict()

export const propertyOwnerUpdateInputSchema = propertyOwnerDetailsInputSchema.extend({
  expected_updated_at: workspaceTimestampSchema,
}).strict()

export const propertyOwnerOptionSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1),
  phone_residential: z.string().nullable().optional(),
  phone_commercial: z.string().nullable().optional(),
  cellphone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
}).strip()

export const apiPropertyOwnerOptionListResponseSchema = z.object({
  data: z.array(propertyOwnerOptionSchema),
}).strict()

const propertyOwnershipRelationshipShape = {
  ownership_percentage: z.number().finite().positive().max(100),
  is_primary: z.boolean(),
  valid_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: nullableTrimmedString(1_200).optional(),
}

export const propertyOwnershipCreateInputSchema = z.object({
  owner_id: uuidSchema.optional(),
  new_owner: propertyOwnerDetailsInputSchema.optional(),
  ...propertyOwnershipRelationshipShape,
}).strict().superRefine((value, context) => {
  if (Boolean(value.owner_id) === Boolean(value.new_owner)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['owner_id'],
      message: 'Selecione um proprietario existente ou cadastre um novo',
    })
  }
})

export const propertyOwnershipUpdateInputSchema = z.object({
  ...propertyOwnershipRelationshipShape,
  owner: propertyOwnerUpdateInputSchema.optional(),
  expected_updated_at: workspaceTimestampSchema,
}).strict()

export const propertyOwnershipEndInputSchema = z.object({
  valid_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expected_updated_at: workspaceTimestampSchema,
}).strict()

export const propertyAssetCreateInputSchema = z.object({
  asset_type: propertyWorkspaceAssetSchema.shape.asset_type,
  visibility: propertyWorkspaceAssetSchema.shape.visibility.default('internal'),
  storage_path: nullableAssetField(2_000),
  external_url: httpURLSchema.max(2_000).nullable().optional(),
  title: nullableAssetField(240),
  description: nullableAssetField(2_000),
  file_name: nullableAssetField(255),
  mime_type: nullableAssetField(160),
  file_size_bytes: z.number().int().min(0).nullable().optional(),
  sort_order: z.number().int().min(0).default(0),
  is_primary: z.boolean().default(false),
  document_category: nullableAssetField(120),
  expires_at: nullableDateSchema.optional(),
  metadata: z.record(z.unknown()).default({}),
}).strict().superRefine((value, context) => {
  const locatorCount = Number(Boolean(value.storage_path)) + Number(Boolean(value.external_url))
  if (locatorCount !== 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['external_url'],
      message: 'Informe exatamente um arquivo armazenado ou uma URL externa',
    })
  }
  if (value.is_primary && value.asset_type !== 'photo') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['is_primary'],
      message: 'Somente fotos podem ser definidas como principais',
    })
  }
  if (value.asset_type !== 'document' && (value.document_category || value.expires_at)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['document_category'],
      message: 'Categoria e validade sao exclusivas de documentos',
    })
  }
})

export const propertyAssetUpdateInputSchema = z.object({
  asset_type: propertyWorkspaceAssetSchema.shape.asset_type,
  visibility: propertyWorkspaceAssetSchema.shape.visibility,
  storage_path: nullableAssetField(2_000),
  external_url: httpURLSchema.max(2_000).nullable().optional(),
  title: nullableAssetField(240),
  description: nullableAssetField(2_000),
  file_name: nullableAssetField(255),
  mime_type: nullableAssetField(160),
  file_size_bytes: z.number().int().min(0).nullable().optional(),
  document_category: nullableAssetField(120),
  expires_at: nullableDateSchema.optional(),
  metadata: z.record(z.unknown()).default({}),
  expected_updated_at: workspaceTimestampSchema,
}).strict().superRefine((value, context) => {
  if (value.storage_path && value.external_url) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['external_url'],
      message: 'Um ativo nao pode ter dois localizadores',
    })
  }
  if (value.asset_type !== 'document' && (value.document_category || value.expires_at)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['document_category'],
      message: 'Categoria e validade sao exclusivas de documentos',
    })
  }
})

export const propertyAssetDeleteInputSchema = z.object({
  expected_updated_at: workspaceTimestampSchema,
}).strict()

export const propertyAssetOrderInputSchema = z.object({
  items: z.array(z.object({
    id: uuidSchema,
    sort_order: z.number().int().min(0),
    expected_updated_at: workspaceTimestampSchema,
  }).strict()).min(1).max(200),
}).strict().superRefine((value, context) => {
  if (new Set(value.items.map((item) => item.id)).size !== value.items.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['items'],
      message: 'A ordem nao pode repetir ativos',
    })
  }
})

export const propertyAssetPrimaryInputSchema = z.object({
  expected_updated_at: workspaceTimestampSchema,
}).strict()

export const propertyAssetUploadIntentInputSchema = z.object({
  asset_type: z.enum(['photo', 'floor_plan', 'document']),
  file_name: z.string().trim().min(1).max(255),
  mime_type: z.enum([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/pdf',
  ]),
  file_size_bytes: z.number().int().positive().max(10 * 1024 * 1024),
}).strict().superRefine((value, context) => {
  if (value.asset_type === 'photo' && value.mime_type === 'application/pdf') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['mime_type'],
      message: 'Fotos precisam usar um formato de imagem',
    })
  }
  if (value.asset_type === 'document' && value.mime_type !== 'application/pdf') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['mime_type'],
      message: 'Documentos armazenados precisam usar PDF',
    })
  }
})

export const propertyAssetUploadIntentSchema = z.object({
  bucket: z.string().min(1).max(120),
  storage_path: z.string().min(1).max(2_000),
  token: z.string().min(1),
  signed_url: httpURLSchema,
  expires_at: workspaceTimestampSchema,
}).strict()

export const propertyWorkspaceKeySchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  property_id: uuidSchema,
  label: z.string().min(1).max(120),
  key_code: z.string().nullable(),
  status: z.enum(['available', 'checked_out', 'lost', 'inactive']),
  current_location: z.string().nullable(),
  holder_user_id: uuidSchema.nullable(),
  holder_name: z.string().nullable(),
  checked_out_at: nullableTimestampSchema,
  expected_return_at: nullableTimestampSchema,
  created_at: workspaceTimestampSchema,
  updated_at: workspaceTimestampSchema,
}).strip()

export const propertyKeyMovementTypeSchema = z.enum([
  'registration',
  'checkout',
  'transfer',
  'return',
  'location_change',
  'mark_lost',
  'mark_found',
  'deactivate',
  'reactivate',
])

export const propertyWorkspaceKeyMovementSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  property_key_id: uuidSchema,
  movement_type: propertyKeyMovementTypeSchema,
  holder_user_id: uuidSchema.nullable(),
  holder_name: z.string().nullable(),
  from_location: z.string().nullable(),
  to_location: z.string().nullable(),
  occurred_at: workspaceTimestampSchema,
  expected_return_at: nullableTimestampSchema,
  created_at: workspaceTimestampSchema,
}).strip()

const propertyPublicationCheckSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  resolved: z.boolean(),
}).strict()

const propertyWorkspaceSummarySchema = z.object({
  completeness_score: z.number().int().min(0).max(100),
  publication_ready: z.boolean(),
  checklist: z.array(propertyPublicationCheckSchema),
  counts: z.object({
    offers: z.number().int().min(0),
    owners: z.number().int().min(0),
    photos: z.number().int().min(0),
    documents: z.number().int().min(0),
    keys: z.number().int().min(0),
    key_history: z.number().int().min(0),
  }).strict(),
}).strict()

const propertyWorkspaceResponseEnvelopeSchema = z.object({
  data: z.object({
    property: propertyWorkspacePropertySchema,
    offers: z.array(propertyWorkspaceOfferSchema),
    ownerships: z.array(propertyWorkspaceOwnershipSchema),
    assets: z.array(propertyWorkspaceAssetSchema),
    keys: z.array(propertyWorkspaceKeySchema),
    recent_key_movements: z.array(propertyWorkspaceKeyMovementSchema),
    summary: propertyWorkspaceSummarySchema,
  }).strict(),
  meta: z.object({
    can_manage: z.boolean(),
    can_view_owner_contacts: z.boolean(),
    can_view_confidential: z.boolean(),
    normalized_resources_available: z.boolean().default(true),
    unavailable_resources: z.array(z.enum([
      'offers',
      'ownerships',
      'assets',
      'keys',
      'key_history',
    ])).default([]),
  }).strict(),
}).strict()

export const apiPropertyWorkspaceResponseSchema = propertyWorkspaceResponseEnvelopeSchema.transform((response) => {
  const property = { ...response.data.property }
  if (!response.meta.can_view_owner_contacts) {
    stripWorkspacePropertyFields(property, propertyOwnerContactKeys)
  }
  if (!response.meta.can_manage) {
    stripWorkspacePropertyFields(property, propertyManagerOnlyKeys)
  }

  const ownerships = response.data.ownerships.map((ownership) => {
    const owner = { ...ownership.owner }
    const safeOwnership = { ...ownership, owner }

    if (!response.meta.can_view_owner_contacts) {
      delete owner.phone_residential
      delete owner.phone_commercial
      delete owner.cellphone
      delete owner.email
      delete owner.media_source
      delete owner.notify_email
    }
    if (!response.meta.can_manage) {
      delete owner.notes
      delete safeOwnership.notes
    }
    return safeOwnership
  })

  return {
    ...response,
    data: {
      ...response.data,
      property,
      ownerships,
      assets: response.meta.can_view_confidential
        ? response.data.assets
        : response.data.assets.filter((asset) => asset.visibility !== 'confidential'),
    },
  }
})

export const propertyOfferUpsertInputSchema = z.object({
  status: propertyOfferStatusSchema.default('draft'),
  price: z.number().finite().min(0).nullable(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).default('BRL'),
  price_period: propertyPricePeriodSchema.nullable().optional(),
  terms: z.record(z.unknown()).default({}),
  available_from: nullableDateSchema.optional(),
  available_until: nullableDateSchema.optional(),
  metadata: z.record(z.unknown()).default({}),
  expected_updated_at: workspaceTimestampSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.status === 'active' && (!value.price || value.price <= 0)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['price'],
      message: 'Uma oferta ativa precisa ter valor maior que zero',
    })
  }
  if (value.available_from && value.available_until && value.available_until < value.available_from) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['available_until'],
      message: 'A data final nao pode ser anterior a data inicial',
    })
  }
})

export const propertyKeyCreateInputSchema = z.object({
  label: z.string().trim().min(1).max(120).default('Chave principal'),
  key_code: nullableTrimmedString(120).optional(),
  current_location: nullableTrimmedString(240).optional(),
  notes: nullableTrimmedString(1_200).optional(),
  metadata: z.record(z.unknown()).default({}),
}).strict()

export const propertyKeyMovementInputSchema = z.object({
  movement_type: propertyKeyMovementTypeSchema.exclude(['registration']),
  holder_user_id: uuidSchema.nullable().optional(),
  holder_name: nullableTrimmedString(160).optional(),
  from_location: nullableTrimmedString(240).optional(),
  to_location: nullableTrimmedString(240).optional(),
  expected_return_at: nullableTimestampSchema.optional(),
  notes: nullableTrimmedString(1_200).optional(),
  metadata: z.record(z.unknown()).default({}),
}).strict().superRefine((value, context) => {
  if (
    (value.movement_type === 'checkout' || value.movement_type === 'transfer')
    && !value.holder_user_id
    && !value.holder_name
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['holder_name'],
      message: 'Informe quem ficara com a chave',
    })
  }
  if (value.movement_type === 'location_change' && !value.to_location) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['to_location'],
      message: 'Informe o novo local da chave',
    })
  }
})

export const apiPropertyWorkspaceOfferResponseSchema = z.object({
  data: propertyWorkspaceOfferSchema,
}).strict()

export const apiPropertyWorkspaceKeyResponseSchema = z.object({
  data: propertyWorkspaceKeySchema,
}).strict()

export const apiPropertyWorkspaceKeyMovementResponseSchema = z.object({
  data: z.object({
    movement: propertyWorkspaceKeyMovementSchema,
    key: propertyWorkspaceKeySchema,
  }).strict(),
}).strict()

export const apiPropertyWorkspaceOwnershipResponseSchema = z.object({
  data: propertyWorkspaceOwnershipSchema,
}).strict()

export const apiPropertyWorkspaceAssetResponseSchema = z.object({
  data: propertyWorkspaceAssetSchema,
}).strict()

export const apiPropertyWorkspaceAssetListResponseSchema = z.object({
  data: z.array(propertyWorkspaceAssetSchema),
}).strict()

export const apiPropertyWorkspaceAssetDeleteResponseSchema = z.object({
  data: z.object({ id: uuidSchema }).strict(),
}).strict()

export const apiPropertyAssetUploadIntentResponseSchema = z.object({
  data: propertyAssetUploadIntentSchema,
}).strict()

export type PropertyOfferType = z.infer<typeof propertyOfferTypeSchema>
export type PropertyOfferStatus = z.infer<typeof propertyOfferStatusSchema>
export type PropertyWorkspaceOffer = z.infer<typeof propertyWorkspaceOfferSchema>
export type PropertyWorkspaceOwnership = z.infer<typeof propertyWorkspaceOwnershipSchema>
export type PropertyWorkspaceAsset = z.infer<typeof propertyWorkspaceAssetSchema>
export type PropertyWorkspaceKey = z.infer<typeof propertyWorkspaceKeySchema>
export type PropertyKeyMovementType = z.infer<typeof propertyKeyMovementTypeSchema>
export type PropertyWorkspaceKeyMovement = z.infer<typeof propertyWorkspaceKeyMovementSchema>
export type PropertyWorkspaceOwner = z.infer<typeof propertyWorkspaceOwnerSchema>
export type PropertyOwnerOption = z.infer<typeof propertyOwnerOptionSchema>
export type PropertyWorkspacePayload = z.infer<typeof apiPropertyWorkspaceResponseSchema>['data']
export type PropertyWorkspaceMeta = z.infer<typeof apiPropertyWorkspaceResponseSchema>['meta']
export type PropertyOfferUpsertInput = z.input<typeof propertyOfferUpsertInputSchema>
export type PropertyKeyCreateInput = z.input<typeof propertyKeyCreateInputSchema>
export type PropertyKeyMovementInput = z.input<typeof propertyKeyMovementInputSchema>
export type PropertyOwnerDetailsInput = z.input<typeof propertyOwnerDetailsInputSchema>
export type PropertyOwnerUpdateInput = z.input<typeof propertyOwnerUpdateInputSchema>
export type PropertyOwnershipCreateInput = z.input<typeof propertyOwnershipCreateInputSchema>
export type PropertyOwnershipUpdateInput = z.input<typeof propertyOwnershipUpdateInputSchema>
export type PropertyOwnershipEndInput = z.input<typeof propertyOwnershipEndInputSchema>
export type PropertyAssetCreateInput = z.input<typeof propertyAssetCreateInputSchema>
export type PropertyAssetUpdateInput = z.input<typeof propertyAssetUpdateInputSchema>
export type PropertyAssetDeleteInput = z.input<typeof propertyAssetDeleteInputSchema>
export type PropertyAssetOrderInput = z.input<typeof propertyAssetOrderInputSchema>
export type PropertyAssetPrimaryInput = z.input<typeof propertyAssetPrimaryInputSchema>
export type PropertyAssetUploadIntentInput = z.input<typeof propertyAssetUploadIntentInputSchema>
export type PropertyAssetUploadIntent = z.infer<typeof propertyAssetUploadIntentSchema>
