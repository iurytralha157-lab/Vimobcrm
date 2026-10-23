import { z } from 'zod'
import { uuidSchema } from './common'

export const automationMediaTypeSchema = z.enum(['image', 'audio', 'video'])

export const automationMediaListQuerySchema = z.object({
  mediaType: automationMediaTypeSchema,
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).max(10000).optional(),
  search: z.string().trim().max(120).optional(),
}).strict()

export const automationExecutionListQuerySchema = z.object({
  automationId: uuidSchema.optional(), leadId: uuidSchema.optional(), activeOnly: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).optional(), offset: z.number().int().min(0).max(100000).optional(),
  status: z.enum(['all', 'running', 'queued', 'waiting', 'completed', 'failed', 'cancelled', 'canceled']).optional(),
  dateFrom: z.string().datetime({ offset: true }).optional(), dateTo: z.string().datetime({ offset: true }).optional(),
}).strict().superRefine((query, context) => {
  if (query.dateFrom && query.dateTo && Date.parse(query.dateTo) < Date.parse(query.dateFrom)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['dateTo'], message: 'A data final deve ser igual ou posterior à inicial' })
  }
})
