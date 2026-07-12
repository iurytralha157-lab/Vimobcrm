import { z } from 'zod'
import { apiEnvelopeSchema, nonNegativeIntegerSchema, timestampSchema, uuidSchema } from './common'

const nameSchema = z.string().trim().min(2).max(120)
const colorSchema = z.string().trim().max(20)

export const pipelineCreateInputSchema = z.object({
  name: nameSchema,
  isDefault: z.boolean().optional(),
}).strict()

export const pipelineUpdateInputSchema = z.object({
  name: nameSchema.optional(),
  isDefault: z.boolean().optional(),
}).strict().refine(
  (input) => Object.values(input).some((value) => value !== undefined),
  'Informe ao menos uma alteracao',
)

export const stageCreateInputSchema = z.object({
  name: nameSchema,
  color: colorSchema.optional(),
}).strict()

export const stageUpdateInputSchema = z.object({
  name: nameSchema.optional(),
  color: colorSchema.nullable().optional(),
  stageKey: z.string().trim().max(80).nullable().optional(),
  isWon: z.boolean().optional(),
  isLost: z.boolean().optional(),
  isActive: z.boolean().optional(),
}).strict().refine(
  (input) => Object.values(input).some((value) => value !== undefined),
  'Informe ao menos uma alteracao',
)

export const stageOrderItemInputSchema = z.object({
  id: uuidSchema,
  name: nameSchema,
  color: colorSchema.optional(),
  stageKey: z.string().trim().max(80).optional(),
}).strict()

export const stagesReorderInputSchema = z.object({
  stages: z.array(stageOrderItemInputSchema).min(1).max(100),
}).strict().superRefine((input, ctx) => {
  const ids = new Set<string>()
  input.stages.forEach((stage, index) => {
    if (ids.has(stage.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['stages', index, 'id'],
        message: 'Etapa duplicada',
      })
    }
    ids.add(stage.id)
  })
})

export const pipelineRoundRobinInputSchema = z.object({
  roundRobinId: uuidSchema.nullable(),
}).strict()

export const apiPipelineSchema = z.object({
  id: uuidSchema,
  organizationId: uuidSchema,
  name: z.string().min(1),
  isDefault: z.boolean(),
  isActive: z.boolean(),
  position: nonNegativeIntegerSchema,
  defaultRoundRobinId: uuidSchema.optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
}).passthrough()

export const apiStageSchema = z.object({
  id: uuidSchema,
  organizationId: uuidSchema,
  pipelineId: uuidSchema,
  name: z.string().min(1),
  color: z.string().optional(),
  stageKey: z.string().optional(),
  position: nonNegativeIntegerSchema,
  isWon: z.boolean(),
  isLost: z.boolean(),
  isActive: z.boolean(),
  slaHours: nonNegativeIntegerSchema.optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
}).passthrough()

export const apiPipelineListResponseSchema = apiEnvelopeSchema(z.array(apiPipelineSchema))
export const apiPipelineResponseSchema = apiEnvelopeSchema(apiPipelineSchema)
export const apiStageListResponseSchema = apiEnvelopeSchema(z.array(apiStageSchema))
export const apiStageResponseSchema = apiEnvelopeSchema(apiStageSchema)

export const pipelineBoardLeadSchema = z.object({
  id: uuidSchema,
  board_order_at: timestampSchema.nullable().optional(),
  stage_entered_at: timestampSchema.nullable().optional(),
}).passthrough()
export const pipelineBoardStageSchema = z.object({
  id: uuidSchema,
  leads: z.array(pipelineBoardLeadSchema),
  total_lead_count: nonNegativeIntegerSchema,
  has_more: z.boolean(),
}).passthrough()

export const pipelineBoardResponseSchema = apiEnvelopeSchema(z.array(pipelineBoardStageSchema))
export const pipelineStageLeadsResponseSchema = z.object({
  stageId: uuidSchema,
  leads: z.array(pipelineBoardLeadSchema),
}).passthrough()
export const pipelineStageCountsResponseSchema = apiEnvelopeSchema(
  z.record(nonNegativeIntegerSchema),
)

const metaOptionSchema = z.object({ id: z.string().min(1), name: z.string() }).passthrough()
export const leadMetaFiltersResponseSchema = apiEnvelopeSchema(z.object({
  campaigns: z.array(metaOptionSchema),
  adsets: z.array(metaOptionSchema.extend({ campaignId: z.string().min(1) })),
  ads: z.array(metaOptionSchema.extend({
    adsetId: z.string().min(1),
    campaignId: z.string().min(1),
  })),
}).passthrough())
