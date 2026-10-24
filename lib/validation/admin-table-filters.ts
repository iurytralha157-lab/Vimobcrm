import { z } from 'zod';
import { filterTextSchema } from '@/lib/validation/filter-text';

export const adminTableFilterSchema = z.object({
  search: filterTextSchema(180).optional(),
  limit: z.number().int().min(1).max(200).default(120),
  offset: z.number().int().min(0).max(1_000_000).default(0),
}).strict();

export const adminTablePageSchema = z.object({
  data: z.array(z.record(z.string(), z.unknown())),
  meta: z.object({ nextOffset: z.number().int().nonnegative().nullable() }),
});
