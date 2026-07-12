import { z } from 'zod'
import { apiEnvelopeSchema, nonNegativeIntegerSchema, uuidSchema } from './common'

export const vistaIntegrationInputSchema = z.object({
  api_url: z.string().trim().url().max(2_000),
  api_key: z.string().trim().min(1).max(2_000),
}).strict()
export const imoviewIntegrationInputSchema = z.object({
  api_key: z.string().trim().min(1).max(2_000),
}).strict()
export const metaFormConfigInputSchema = z.object({
  integrationId: uuidSchema,
  formId: z.string().trim().min(1).max(255),
  formName: z.string().trim().max(255).nullish(),
  propertyId: uuidSchema.nullish(),
  roundRobinId: uuidSchema.nullish(),
  purpose: z.string().trim().max(120).nullish(),
  source: z.string().trim().max(120).nullish(),
  sourceDetails: z.string().trim().max(500).nullish(),
  defaultValues: z.record(z.unknown()).optional(),
  autoTags: z.array(z.string().trim().min(1).max(120)).max(100).optional(),
  fieldMapping: z.record(z.string()).optional(),
  customFieldsConfig: z.array(z.string()).max(200).optional(),
  isActive: z.boolean().optional(),
}).strict()
export const toggleMetaFormConfigInputSchema = z.object({
  integrationId: uuidSchema,
  formId: z.string().trim().min(1).max(255),
  isActive: z.boolean(),
}).strict()
export const deleteMetaFormConfigInputSchema = toggleMetaFormConfigInputSchema.omit({ isActive: true })

export const apiIntegrationRecordSchema = z.record(z.unknown())
export const apiOptionalIntegrationResponseSchema = apiEnvelopeSchema(apiIntegrationRecordSchema.nullable())
export const apiIntegrationResponseSchema = apiEnvelopeSchema(apiIntegrationRecordSchema)
export const apiIntegrationListResponseSchema = apiEnvelopeSchema(z.array(apiIntegrationRecordSchema))
export const apiMetaWebhookHealthResponseSchema = apiEnvelopeSchema(z.object({
  counts: z.record(nonNegativeIntegerSchema),
  lastError: z.string().nullable(),
  missing: z.boolean(),
}).passthrough())
