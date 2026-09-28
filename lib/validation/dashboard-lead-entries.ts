import { z } from 'zod'

import { apiEnvelopeSchema, nonNegativeIntegerSchema, uuidSchema } from './common'

export const dashboardLeadEntryCursorSchema = z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/).nullable()

export const dashboardLeadEntrySchema = z.object({
  entryId: z.string().trim().min(1).max(80),
  leadId: uuidSchema,
  name: z.string().trim().min(1).max(500),
  occurredAt: z.string().datetime({ offset: true }),
  source: z.string().trim().max(180).nullable(),
  campaignName: z.string().trim().max(500).nullable(),
  pipelineId: uuidSchema.nullable(),
  pipelineName: z.string().trim().max(300).nullable(),
  entryType: z.enum(['initial', 'reentry']),
  leadUrl: z.string().regex(/^\/crm\/pipelines\?lead=[0-9a-f-]{36}$/i),
}).passthrough().superRefine((entry, context) => {
  if (entry.leadUrl !== `/crm/pipelines?lead=${entry.leadId}`) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['leadUrl'],
      message: 'leadUrl must identify this lead',
    })
  }
})

export const dashboardLeadEntriesPageSchema = z.object({
  total: nonNegativeIntegerSchema,
  items: z.array(dashboardLeadEntrySchema),
  hasMore: z.boolean(),
  nextCursor: dashboardLeadEntryCursorSchema,
}).passthrough().superRefine((page, context) => {
  if (page.hasMore && !page.nextCursor) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['nextCursor'],
      message: 'nextCursor is required when hasMore is true',
    })
  }
})

export const dashboardLeadEntriesResponseSchema = apiEnvelopeSchema(dashboardLeadEntriesPageSchema)

export type DashboardLeadEntry = z.infer<typeof dashboardLeadEntrySchema>
export type DashboardLeadEntriesPage = z.infer<typeof dashboardLeadEntriesPageSchema>
