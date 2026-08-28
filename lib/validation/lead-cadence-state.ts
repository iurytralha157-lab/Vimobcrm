import { z } from 'zod'

import {
  apiEnvelopeSchema,
  nonNegativeIntegerSchema,
  timestampSchema,
  uuidSchema,
} from './common'

export const leadCadenceTaskTypeSchema = z.enum(['call', 'message', 'email', 'note'])

export const leadCadenceTaskStateSchema = z.object({
  id: uuidSchema,
  template_task_id: uuidSchema.nullish(),
  // Historical enrollments can still carry pre-stage tasks with negative offsets.
  // New operational rules only write non-negative positions.
  position: z.number().int(),
  type: leadCadenceTaskTypeSchema,
  title: z.string().trim().min(1),
  description: z.string().nullable().optional(),
  observation: z.string().nullable().optional(),
  recommended_message: z.string().nullable().optional(),
  due_at: timestampSchema.nullable().optional(),
  status: z.string().trim().min(1),
  is_done: z.boolean(),
  done_at: timestampSchema.nullable().optional(),
  outcome: z.string().nullable().optional(),
  outcome_notes: z.string().nullable().optional(),
  is_required: z.boolean(),
  outcome_required: z.boolean(),
}).passthrough()

export const leadCadenceEnrollmentStateSchema = z.object({
  id: uuidSchema,
  template_id: uuidSchema,
  template_name: z.string().trim().min(1),
  status: z.string().trim().min(1),
  started_at: timestampSchema,
  completed_at: timestampSchema.nullable().optional(),
}).passthrough()

export const leadCadenceSummarySchema = z.object({
  total: nonNegativeIntegerSchema,
  completed: nonNegativeIntegerSchema,
  pending: nonNegativeIntegerSchema,
  overdue: nonNegativeIntegerSchema,
  next_task_id: uuidSchema.nullish(),
}).passthrough()

export const leadCadenceStateSchema = z.object({
  lead_id: uuidSchema,
  deal_status: z.string().trim().min(1),
  stage_id: uuidSchema,
  stage_name: z.string().trim().min(1),
  stage_cycle_id: uuidSchema.nullish(),
  stage_entered_at: timestampSchema.nullish(),
  cadence_enabled: z.boolean(),
  enrollment: leadCadenceEnrollmentStateSchema.nullish(),
  tasks: z.array(leadCadenceTaskStateSchema),
  summary: leadCadenceSummarySchema,
}).passthrough()

export const apiLeadCadenceStateResponseSchema = apiEnvelopeSchema(leadCadenceStateSchema)

export type LeadCadenceTaskType = z.infer<typeof leadCadenceTaskTypeSchema>
export type LeadCadenceTaskState = z.infer<typeof leadCadenceTaskStateSchema>
export type LeadCadenceEnrollmentState = z.infer<typeof leadCadenceEnrollmentStateSchema>
export type LeadCadenceSummary = z.infer<typeof leadCadenceSummarySchema>
export type LeadCadenceState = z.infer<typeof leadCadenceStateSchema>
