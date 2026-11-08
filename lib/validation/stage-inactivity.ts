import { z } from 'zod'
import { apiEnvelopeSchema, uuidSchema } from '@/lib/validation/common'

const startModeSchema = z.enum(['new_stage_entries', 'activation'])
export type StageInactivityStartMode = z.infer<typeof startModeSchema>

const inactivityFields = {
  trigger_days: z.number().int().min(1).max(3650),
  alert_message: z.string().trim().max(1000),
  clock: z.literal('last_interaction'),
  start_mode: startModeSchema,
  // Omitted means notify, which older APIs also accept.
  action: z.enum(['notify', 'move_stage', 'redistribute']).optional(),
  target_stage_id: uuidSchema.optional(),
  target_round_robin_id: uuidSchema.optional(),
}

type InactivityActionFields = { action?: 'notify' | 'move_stage' | 'redistribute'; target_stage_id?: string; target_round_robin_id?: string; alert_message: string }
const requireMoveTarget = (value: InactivityActionFields, context: z.RefinementCtx) => {
  if (value.action === 'move_stage') {
    if (!value.target_stage_id) context.addIssue({ code: 'custom', path: ['target_stage_id'], message: 'Escolha a coluna de destino.' })
  } else if (value.target_stage_id) {
    context.addIssue({ code: 'custom', path: ['target_stage_id'], message: 'Somente a mudança de etapa usa coluna de destino.' })
  }
  if (value.action === 'redistribute') {
    if (!value.target_round_robin_id) context.addIssue({ code: 'custom', path: ['target_round_robin_id'], message: 'Escolha a distribuição.' })
  } else if (value.target_round_robin_id) {
    context.addIssue({ code: 'custom', path: ['target_round_robin_id'], message: 'A fila é usada na redistribuição.' })
  }
  if (value.action && value.action !== 'notify' && value.alert_message.trim()) {
    context.addIssue({ code: 'custom', path: ['alert_message'], message: 'A mensagem é usada no aviso de inatividade.' })
  }
}

export const stageInactivityCreateInputSchema = z.object({
  ...inactivityFields,
  stage_id: uuidSchema,
  // A new rule always requires a separate, explicit activation.
  is_enabled: z.literal(false),
}).strict().superRefine(requireMoveTarget)

export const stageInactivityUpdateInputSchema = z.object({
  ...inactivityFields,
  is_enabled: z.boolean(),
  // Preserve the server's exact timestamp, including fractional seconds.
  expected_updated_at: z.string().min(1).datetime({ offset: true }),
  expected_policy_revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
}).strict().superRefine(requireMoveTarget)

export const stageInactivityPolicySchema = z.object({
  revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  clock: z.enum(['last_interaction', 'stage_entry']),
  start_mode: z.enum(['activation', 'include_overdue', 'new_stage_entries']),
  activated_at: z.string().nullable(),
  interaction_coverage_from: z.string().nullish(),
  is_enabled: z.boolean(),
  effective_enabled: z.boolean(),
  runtime_available: z.boolean(),
  action: z.enum(['notify', 'move_stage', 'redistribute']).optional(),
  target_stage_id: uuidSchema.nullable().optional(),
  target_round_robin_id: uuidSchema.nullable().optional(),
}).passthrough()

export const stageInactivityMutationResponseSchema = apiEnvelopeSchema(z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  stage_id: uuidSchema,
  updated_at: z.string().datetime({ offset: true }),
  inactivity_policy: stageInactivityPolicySchema,
  inactivity_runtime_available: z.boolean(),
}).passthrough())

export type StageInactivityCreateInput = z.infer<typeof stageInactivityCreateInputSchema>
export type StageInactivityUpdateInput = z.infer<typeof stageInactivityUpdateInputSchema>
export type StageInactivityPolicy = z.infer<typeof stageInactivityPolicySchema>
