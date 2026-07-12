import { z } from 'zod'

import { apiEnvelopeSchema, nonNegativeIntegerSchema, timestampSchema, uuidSchema } from './common'

export const attentionScopeSchema = z.enum(['mine', 'team', 'organization'])

export const attentionPolicyTypeSchema = z.enum([
  'unassigned',
  'first_contact',
  'stage_inactivity',
  'stage_age',
])

export const attentionPolicyStatusSchema = z.enum(['shadow', 'enabled', 'paused', 'archived'])
export const attentionEngineModeSchema = z.enum(['disabled', 'shadow', 'enabled'])

export const attentionItemStatusSchema = z.enum([
  'monitoring',
  'warning',
  'breached',
  'escalated',
  'acknowledged',
  'resolved',
  'redistributed',
  'cancelled',
  'exception',
])

const nullableUUIDSchema = uuidSchema.nullish()
const nullableTimestampSchema = timestampSchema.nullish()
const nullableTextSchema = z.string().trim().nullish()
const optionalMinutesSchema = nonNegativeIntegerSchema.nullish()

export const apiAttentionPolicySchema = z.object({
  id: uuidSchema,
  organizationId: uuidSchema,
  name: z.string().trim().min(1),
  policyType: attentionPolicyTypeSchema,
  status: attentionPolicyStatusSchema,
  version: z.number().int().positive(),
  pipelineId: nullableUUIDSchema,
  pipelineName: nullableTextSchema,
  stageId: nullableUUIDSchema,
  stageName: nullableTextSchema,
  thresholdMinutes: nonNegativeIntegerSchema,
  warningMinutes: nonNegativeIntegerSchema,
  repeatMinutes: nonNegativeIntegerSchema,
  escalationMinutes: optionalMinutesSchema,
  redistributionMinutes: optionalMinutesSchema,
  businessHoursOnly: z.boolean(),
  config: z.record(z.unknown()).nullish(),
  createdBy: nullableUUIDSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
}).passthrough()

export const apiAttentionItemSchema = z.object({
  id: uuidSchema,
  leadId: uuidSchema,
  leadName: z.string().trim().min(1),
  policyId: uuidSchema,
  policyName: z.string().trim().min(1),
  policyType: attentionPolicyTypeSchema,
  policyStatus: attentionPolicyStatusSchema,
  policyVersion: z.number().int().positive(),
  status: attentionItemStatusSchema,
  assignedUserId: nullableUUIDSchema,
  assignedUserName: nullableTextSchema,
  pipelineId: nullableUUIDSchema,
  pipelineName: nullableTextSchema,
  stageId: nullableUUIDSchema,
  stageName: nullableTextSchema,
  baselineAt: timestampSchema,
  dueAt: timestampSchema,
  nextEvaluationAt: nullableTimestampSchema,
  lastValidActionAt: nullableTimestampSchema,
  warningAt: nullableTimestampSchema,
  breachedAt: nullableTimestampSchema,
  escalatedAt: nullableTimestampSchema,
  acknowledgedAt: nullableTimestampSchema,
  acknowledgedBy: nullableUUIDSchema,
  snoozedUntil: nullableTimestampSchema,
  resolvedAt: nullableTimestampSchema,
  resolutionReason: nullableTextSchema,
  reminderCount: nonNegativeIntegerSchema,
  metadata: z.record(z.unknown()).nullish(),
  updatedAt: timestampSchema,
}).passthrough()

export const apiAttentionSummarySchema = z.object({
  total: nonNegativeIntegerSchema,
  monitoring: nonNegativeIntegerSchema,
  warning: nonNegativeIntegerSchema,
  breached: nonNegativeIntegerSchema,
  escalated: nonNegativeIntegerSchema,
  acknowledged: nonNegativeIntegerSchema,
  dueToday: nonNegativeIntegerSchema,
  overdue: nonNegativeIntegerSchema,
  unassigned: nonNegativeIntegerSchema,
  firstContact: nonNegativeIntegerSchema,
  stageInactivity: nonNegativeIntegerSchema,
  stageAge: nonNegativeIntegerSchema,
}).passthrough()

export const apiAttentionSettingsSchema = z.object({
  engineMode: attentionEngineModeSchema,
  notificationsEnabled: z.boolean(),
  redistributionEnabled: z.boolean(),
  timezone: z.string().trim().min(1).max(100),
  defaultRepeatMinutes: z.number().int().min(15).max(525_600),
  maxReminders: nonNegativeIntegerSchema.max(10_000),
}).passthrough()

export const apiAttentionItemPageSchema = z.object({
  items: z.array(apiAttentionItemSchema),
  nextCursor: z.string().trim().min(1).nullish(),
}).passthrough()

export const apiAttentionPolicyListResponseSchema = apiEnvelopeSchema(z.array(apiAttentionPolicySchema))
export const apiAttentionPolicyResponseSchema = apiEnvelopeSchema(apiAttentionPolicySchema)
export const apiAttentionItemPageResponseSchema = apiEnvelopeSchema(apiAttentionItemPageSchema)
export const apiAttentionItemResponseSchema = apiEnvelopeSchema(apiAttentionItemSchema)
export const apiAttentionSummaryResponseSchema = apiEnvelopeSchema(apiAttentionSummarySchema)
export const apiAttentionSettingsResponseSchema = apiEnvelopeSchema(apiAttentionSettingsSchema)

const attentionPolicyMutationBodySchema = z.object({
  name: z.string().trim().min(2).max(160),
  policyType: attentionPolicyTypeSchema,
  status: attentionPolicyStatusSchema,
  pipelineId: uuidSchema.nullable().optional(),
  stageId: uuidSchema.nullable().optional(),
  thresholdMinutes: z.number().int().min(1).max(525_600),
  warningMinutes: z.number().int().min(0).max(525_600),
  repeatMinutes: z.number().int().min(15).max(525_600),
  escalationMinutes: z.number().int().min(1).max(525_600).nullable().optional(),
  redistributionMinutes: z.number().int().min(1).max(525_600).nullable().optional(),
  businessHoursOnly: z.boolean(),
  config: z.record(z.unknown()).nullable().optional(),
}).strict()

export const createAttentionPolicyInputSchema = attentionPolicyMutationBodySchema.superRefine((value, context) => {
  if (value.warningMinutes >= value.thresholdMinutes) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['warningMinutes'],
      message: 'O aviso deve acontecer antes do vencimento.',
    })
  }

  if ((value.policyType === 'stage_inactivity' || value.policyType === 'stage_age') && !value.stageId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['stageId'],
      message: 'Selecione uma etapa para esta politica.',
    })
  }
})

export const updateAttentionPolicyInputSchema = attentionPolicyMutationBodySchema.partial().strict().superRefine((value, context) => {
  if (
    value.warningMinutes !== undefined
    && value.thresholdMinutes !== undefined
    && value.warningMinutes >= value.thresholdMinutes
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['warningMinutes'],
      message: 'O aviso deve acontecer antes do vencimento.',
    })
  }
})

export const updateAttentionSettingsInputSchema = z.object({
  engineMode: attentionEngineModeSchema.optional(),
  notificationsEnabled: z.boolean().optional(),
  redistributionEnabled: z.boolean().optional(),
  timezone: z.string().trim().min(1).max(100).optional(),
  defaultRepeatMinutes: z.number().int().min(15).max(525_600).optional(),
  maxReminders: z.number().int().min(0).max(10_000).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: 'Informe ao menos uma configuracao.',
})

export const acknowledgeAttentionItemInputSchema = z.object({
  note: z.string().trim().max(1_000).optional(),
}).strict()

export const snoozeAttentionItemInputSchema = z.object({
  minutes: z.number().int().min(5).max(43_200),
  note: z.string().trim().max(1_000).optional(),
}).strict()

export const resolveAttentionItemInputSchema = z.object({
  reason: z.string().trim().min(1).max(120),
  note: z.string().trim().max(1_000).optional(),
}).strict()

export type AttentionScope = z.infer<typeof attentionScopeSchema>
export type AttentionPolicyType = z.infer<typeof attentionPolicyTypeSchema>
export type AttentionPolicyStatus = z.infer<typeof attentionPolicyStatusSchema>
export type AttentionEngineMode = z.infer<typeof attentionEngineModeSchema>
export type AttentionItemStatus = z.infer<typeof attentionItemStatusSchema>
export type AttentionPolicy = z.infer<typeof apiAttentionPolicySchema>
export type AttentionItem = z.infer<typeof apiAttentionItemSchema>
export type AttentionSummary = z.infer<typeof apiAttentionSummarySchema>
export type AttentionSettings = z.infer<typeof apiAttentionSettingsSchema>
export type AttentionItemPage = z.infer<typeof apiAttentionItemPageSchema>
export type CreateAttentionPolicyInput = z.input<typeof createAttentionPolicyInputSchema>
export type UpdateAttentionPolicyInput = z.input<typeof updateAttentionPolicyInputSchema>
export type UpdateAttentionSettingsInput = z.input<typeof updateAttentionSettingsInputSchema>
