import { z } from 'zod';
import { filterTextSchema } from '@/lib/validation/filter-text';
import { dashboardSourceFilterTextSchema } from '@/lib/validation/dashboard-filter-text';

const nullableId = z.string().uuid().nullable().default(null);
const nullableText = filterTextSchema(255, 1).nullable().default(null);
export const sharedFilterSnapshotSchema = z.object({
  version: z.literal(2),
  datePreset: z.enum(['today', 'yesterday', 'last7days', 'last30days', 'thisMonth', 'lastMonth', 'thisQuarter', 'thisYear', 'custom']).nullable().default(null),
  customDateRange: z.object({ from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }) }).nullable().default(null),
  pipelineId: nullableId, teamId: nullableId,
  userId: z.union([z.string().uuid(), z.literal('unassigned')]).nullable().default(null),
  source: dashboardSourceFilterTextSchema.nullable().default(null),
  pageId: nullableText, campaignId: nullableText,
  campaignIds: z.array(filterTextSchema(255, 1)).max(50).default([]),
  adSetId: nullableText, adId: nullableText,
  tagIds: z.array(z.string().uuid()).max(50).default([]),
  dealStatus: z.enum(['open', 'won', 'lost']).nullable().default(null),
  searchQuery: filterTextSchema(180).default(''),
}).strict().superRefine((value, ctx) => {
  if (value.datePreset === 'custom' && !value.customDateRange) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['customDateRange'], message: 'Selecione o período personalizado.' });
  }
  if (value.customDateRange && Date.parse(value.customDateRange.from) > Date.parse(value.customDateRange.to)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['customDateRange'], message: 'Período inválido.' });
  }
});

export type SharedFilterSnapshot = z.infer<typeof sharedFilterSnapshotSchema>;
