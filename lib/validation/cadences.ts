import { z } from 'zod'
import { apiEnvelopeSchema, nonNegativeIntegerSchema, timestampSchema, uuidSchema } from './common'

export const cadenceTaskTypeSchema = z.enum(['call', 'message', 'email', 'note'])

const cadenceTaskBodySchema = z.object({
  day_offset: nonNegativeIntegerSchema,
  type: cadenceTaskTypeSchema,
  title: z.string().trim().min(1).max(180),
  description: z.string().trim().max(2_000).nullish(),
  observation: z.string().trim().max(2_000).nullish(),
  recommended_message: z.string().trim().max(4_000).nullish(),
}).strict()

export const createCadenceTaskInputSchema = cadenceTaskBodySchema.extend({
  cadence_template_id: uuidSchema,
})
export const updateCadenceTaskBodySchema = cadenceTaskBodySchema
export const switchLeadCadenceInputSchema = z.object({
  cadence_template_id: uuidSchema,
}).strict()

export const apiCadenceTaskSchema = z.object({
  id: uuidSchema,
  cadence_template_id: uuidSchema,
  // Historical templates can contain pre-stage tasks represented by negative days.
  // Mutation schemas remain non-negative, so new invalid offsets are still rejected.
  day_offset: z.number().int(),
  title: z.string().min(1),
  description: z.string().nullable(),
  position: nonNegativeIntegerSchema.nullable(),
  type: z.string().nullable(),
  observation: z.string().nullable(),
  recommended_message: z.string().nullable(),
}).passthrough()

export const apiCadenceTemplateSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  pipeline_id: uuidSchema.nullable(),
  stage_id: uuidSchema.nullable(),
  stage_key: z.string().nullable(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
  created_at: timestampSchema,
  updated_at: timestampSchema.nullable().optional(),
  tasks: z.array(apiCadenceTaskSchema),
}).passthrough()

export const apiCadenceTemplateListResponseSchema = apiEnvelopeSchema(z.array(apiCadenceTemplateSchema))
export const apiCadenceTaskResponseSchema = apiEnvelopeSchema(apiCadenceTaskSchema)
export const apiSwitchLeadCadenceResponseSchema = apiEnvelopeSchema(z.object({
  enrollment_id: uuidSchema,
  lead_id: uuidSchema,
  cadence_template_id: uuidSchema,
}))
