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

const positiveMinutesSchema = z.number().int().min(1)
const optionalTaskTextSchema = (max: number) => (
  z.string().trim().max(max).nullish().transform((value) => value || undefined)
)

export const stageOperationalCadenceTaskSchema = z.object({
  id: uuidSchema.optional(),
  position: nonNegativeIntegerSchema,
  type: cadenceTaskTypeSchema,
  title: z.string().trim().min(1, 'Informe o título da tarefa.').max(180),
  description: optionalTaskTextSchema(2_000),
  observation: optionalTaskTextSchema(2_000),
  recommended_message: optionalTaskTextSchema(4_000),
  due_minutes: nonNegativeIntegerSchema,
  warning_minutes: nonNegativeIntegerSchema.optional(),
  is_required: z.boolean(),
  outcome_required: z.boolean(),
}).strict().superRefine((task, context) => {
  if (
    task.warning_minutes != null
    && task.warning_minutes > 0
    && task.warning_minutes >= task.due_minutes
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['warning_minutes'],
      message: 'O aviso da tarefa precisa acontecer antes do prazo.',
    })
  }

  if (task.type === 'note' && task.outcome_required) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['outcome_required'],
      message: 'Anotações não podem exigir resultado de contato.',
    })
  }
})

export const stageOperationalAttentionModeSchema = z.enum(['disabled', 'shadow', 'enabled'])
export const stageOperationalAttentionSourceModeSchema = z.enum(['inherit', 'local'])

export const stageOperationalAttentionSchema = z.object({
  source_mode: stageOperationalAttentionSourceModeSchema.default('inherit'),
  mode: stageOperationalAttentionModeSchema,
  first_outreach_minutes: positiveMinutesSchema.optional(),
  first_effective_contact_minutes: positiveMinutesSchema.optional(),
  stage_inactivity_minutes: positiveMinutesSchema.optional(),
  stage_max_age_minutes: positiveMinutesSchema.optional(),
  warning_minutes: nonNegativeIntegerSchema,
  escalation_minutes: positiveMinutesSchema.optional(),
  business_hours_only: z.boolean(),
}).strict().superRefine((attention, context) => {
  const thresholds = [
    'first_outreach_minutes',
    'first_effective_contact_minutes',
    'stage_inactivity_minutes',
    'stage_max_age_minutes',
  ] as const

  thresholds.forEach((field) => {
    const threshold = attention[field]
    if (
      threshold != null
      && attention.warning_minutes > 0
      && attention.warning_minutes >= threshold
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['warning_minutes'],
        message: 'O aviso precisa acontecer antes de cada limite ativo.',
      })
    }
  })
})

export const stageOperationalLifecycleSchema = z.object({
  on_stage_move: z.literal('skip_pending'),
  on_won: z.literal('cancel_pending'),
  on_lost: z.literal('cancel_pending'),
  on_reopen: z.literal('new_cycle'),
}).strict()

export const stageOperationalRulesSchema = z.object({
  stage_id: uuidSchema,
  pipeline_id: uuidSchema,
  revision: nonNegativeIntegerSchema,
  cadence: z.object({
    enabled: z.boolean(),
    template_id: uuidSchema.optional(),
    tasks: z.array(stageOperationalCadenceTaskSchema).max(100),
  }).strict(),
  attention: stageOperationalAttentionSchema,
  lifecycle: stageOperationalLifecycleSchema,
}).strict().superRefine((rules, context) => {
  const positions = new Set<number>()
  rules.cadence.tasks.forEach((task, index) => {
    if (positions.has(task.position)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cadence', 'tasks', index, 'position'],
        message: 'Cada tarefa precisa ter uma posição única.',
      })
    }
    positions.add(task.position)
  })
})

export const updateStageOperationalRulesInputSchema = stageOperationalRulesSchema
export const apiStageOperationalRulesResponseSchema = apiEnvelopeSchema(stageOperationalRulesSchema)

export type StageOperationalCadenceTask = z.infer<typeof stageOperationalCadenceTaskSchema>
export type StageOperationalAttentionMode = z.infer<typeof stageOperationalAttentionModeSchema>
export type StageOperationalAttentionSourceMode = z.infer<typeof stageOperationalAttentionSourceModeSchema>
export type StageOperationalAttention = z.infer<typeof stageOperationalAttentionSchema>
export type StageOperationalLifecycle = z.infer<typeof stageOperationalLifecycleSchema>
export type StageOperationalRules = z.infer<typeof stageOperationalRulesSchema>
export type UpdateStageOperationalRulesInput = z.input<typeof updateStageOperationalRulesInputSchema>
