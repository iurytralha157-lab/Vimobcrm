import { z } from 'zod'
import { apiEnvelopeSchema, uuidSchema } from '@/lib/validation/common'

const inactivityFields = {
  trigger_days: z.number().int().min(1).max(3650),
  alert_message: z.string().trim().max(1000),
  clock: z.literal('last_interaction'),
  start_mode: z.literal('activation'),
}

export const stageInactivityCreateInputSchema = z.object({
  ...inactivityFields,
  stage_id: uuidSchema,
  // A new rule always requires a separate, explicit activation.
  is_enabled: z.literal(false),
}).strict()

export const stageInactivityUpdateInputSchema = z.object({
  ...inactivityFields,
  is_enabled: z.boolean(),
  // Preserve the server's exact timestamp, including fractional seconds.
  expected_updated_at: z.string().min(1).datetime({ offset: true }),
  expected_policy_revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
}).strict()

export const stageInactivityPolicySchema = z.object({
  revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  clock: z.enum(['last_interaction', 'stage_entry']),
  start_mode: z.enum(['activation', 'include_overdue']),
  activated_at: z.string().nullable(),
  interaction_coverage_from: z.string().nullable(),
  is_enabled: z.boolean(),
  effective_enabled: z.boolean(),
  runtime_available: z.boolean(),
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
