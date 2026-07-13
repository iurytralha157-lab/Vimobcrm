import { z } from 'zod'
import { apiEnvelopeSchema, nonNegativeIntegerSchema, timestampSchema, uuidSchema } from './common'

const optionalUUIDValueSchema = z.union([uuidSchema, z.literal(''), z.null()]).optional()
const optionalNumberValueSchema = z.union([
  z.number().finite(),
  z.string().trim().regex(/^-?\d+(\.\d+)?$/),
  z.null(),
]).optional()
const optionalNonNegativeFilterSchema = z.union([
  z.number().finite().min(0),
  z.string().trim().regex(/^\d+(\.\d+)?$/),
]).optional()

export const propertyListQuerySchema = z.object({
  limit: z.number().int().min(1).max(1_000).optional(),
  offset: z.number().int().min(0).max(100_000).optional(),
  search: z.string().trim().max(120).optional(),
  status: z.string().trim().max(80).optional(),
  tipo_de_negocio: z.string().trim().max(80).optional(),
  tipo_de_imovel: z.string().trim().max(80).optional(),
  cidade: z.string().trim().max(120).optional(),
  bairro: z.string().trim().max(120).optional(),
  responsavel_id: uuidSchema.optional(),
  quartos_min: optionalNonNegativeFilterSchema,
  suites_min: optionalNonNegativeFilterSchema,
  banheiros_min: optionalNonNegativeFilterSchema,
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
  vagas_min: optionalNonNegativeFilterSchema,
  area_util_min: optionalNonNegativeFilterSchema,
  area_util_max: optionalNonNegativeFilterSchema,
  area_total_min: optionalNonNegativeFilterSchema,
  area_total_max: optionalNonNegativeFilterSchema,
}).strict()

const propertyMutationShape = {
  title: z.string().trim().min(1).max(4_000).optional(),
  status: z.string().trim().max(80).nullable().optional(),
  tipo_de_negocio: z.string().trim().max(80).nullable().optional(),
  tipo_de_imovel: z.string().trim().max(120).nullable().optional(),
  property_id: optionalUUIDValueSchema,
  responsible_user_id: optionalUUIDValueSchema,
  cadastrado_por: optionalUUIDValueSchema,
  corretor_id: optionalUUIDValueSchema,
  owner_id: optionalUUIDValueSchema,
  condominium_id: optionalUUIDValueSchema,
  city_id: optionalUUIDValueSchema,
  neighborhood_id: optionalUUIDValueSchema,
  property_type_id: optionalUUIDValueSchema,
  preco: optionalNumberValueSchema,
  valor_locacao: optionalNumberValueSchema,
  area_total: optionalNumberValueSchema,
  area_util: optionalNumberValueSchema,
  quartos: optionalNumberValueSchema,
  suites: optionalNumberValueSchema,
  banheiros: optionalNumberValueSchema,
  vagas: optionalNumberValueSchema,
  aceita_permuta: z.boolean().nullable().optional(),
  aceita_financiamento: z.boolean().nullable().optional(),
  published_on_site: z.boolean().nullable().optional(),
  image_urls: z.array(z.string()).nullable().optional(),
  fotos: z.array(z.string()).nullable().optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
}

export const propertyCreateInputSchema = z.object(propertyMutationShape).catchall(z.unknown()).refine(
  (input) => typeof input.title === 'string' && input.title.trim().length > 0,
  { path: ['title'], message: 'Título do imóvel é obrigatório' },
)

export const propertyUpdateInputSchema = z.object(propertyMutationShape).catchall(z.unknown()).refine(
  (input) => Object.keys(input).length > 0,
  'Informe ao menos uma alteracao',
)

export const apiPropertySchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  title: z.string().nullable().optional(),
}).passthrough()

export const apiPropertyListResponseSchema = z.object({
  data: z.array(apiPropertySchema),
  total: nonNegativeIntegerSchema,
  limit: z.number().int().min(1).max(1_000),
  offset: nonNegativeIntegerSchema,
}).passthrough()

export const apiPropertyResponseSchema = apiEnvelopeSchema(apiPropertySchema)
export const apiPropertyStatsSchema = z.object({
  total: nonNegativeIntegerSchema,
  sale: nonNegativeIntegerSchema,
  rental: nonNegativeIntegerSchema,
  available: nonNegativeIntegerSchema,
  reserved: nonNegativeIntegerSchema,
  sold: nonNegativeIntegerSchema,
  rented: nonNegativeIntegerSchema,
  private: nonNegativeIntegerSchema,
}).passthrough()

export const apiPropertyHistoryResponseSchema = apiEnvelopeSchema(z.array(z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  title: z.string().min(1),
  metadata: z.record(z.unknown()),
  created_at: timestampSchema,
}).passthrough()))
