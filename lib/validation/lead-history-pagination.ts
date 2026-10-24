import { z } from 'zod';

import { apiEnvelopeSchema, uuidSchema } from './common';

const timestamp = z.string().datetime({ offset: true });
const row = z.object({ id: uuidSchema }).passthrough();
const datedRow = row.extend({ created_at: timestamp.nullable().optional() });
const raw = z.object({
  timelineEvents: z.array(datedRow.extend({ event_type: z.string().min(1), event_at: timestamp.nullable().optional() })),
  activityEvents: z.array(datedRow.extend({ type: z.string().min(1) })),
  entryEvents: z.array(datedRow),
  distributionLogs: z.array(datedRow),
  assignmentLogs: z.array(datedRow),
  auditLogs: z.array(datedRow.extend({ action: z.string().min(1) })),
  queueRuntimeEvents: z.array(datedRow.extend({ event_type: z.string().min(1) })).optional(),
  users: z.array(row.extend({ name: z.string() })),
  lead: row.extend({ created_at: timestamp }),
  leadMeta: z.record(z.string(), z.unknown()).nullable(),
  historyCoverage: z.object({
    complete: z.literal(false),
    canonicalPresence: z.object({
      leadCreated: z.boolean(), firstResponse: z.boolean(), assignment: z.boolean(),
    }),
  }),
}).passthrough();

export const leadHistoryPageResponseSchema = apiEnvelopeSchema(raw).extend({
  pagination: z.object({
    nextCursor: z.string().min(1).max(2048).nullable(),
    hasOlder: z.boolean(),
    snapshotAt: timestamp,
  }).refine(value => value.hasOlder === (value.nextCursor !== null), {
    message: 'Cursor e continuidade do histórico divergem',
  }),
});

// Older APIs return raw history without pagination or coverage markers.
// Recognize that format without treating incomplete pagination as legacy.
export const leadHistoryLegacyResponseSchema = z.unknown().refine(value => {
  if (!value || typeof value !== 'object' || Object.hasOwn(value, 'pagination')) return false;
  if (!('data' in value) || !value.data || typeof value.data !== 'object') return false;
  return !Object.hasOwn(value.data, 'historyCoverage');
}, { message: 'Resposta legada não pode conter marcadores de paginação' })
  .pipe(apiEnvelopeSchema(raw.omit({ historyCoverage: true })));

export const leadHistoryPageInputSchema = z.object({
  pageSize: z.number().int().min(1).max(200).default(100),
  cursor: z.string().min(1).max(2048).optional(),
});
