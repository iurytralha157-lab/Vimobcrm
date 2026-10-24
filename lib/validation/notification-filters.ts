import { z } from 'zod';

export const notificationListFiltersSchema = z.object({
  userId: z.string().regex(z.regexes.guid, "Invalid uuid").optional(),
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().max(512).nullable().optional(),
  unreadOnly: z.boolean().optional(),
  categories: z.array(z.enum(['leads', 'whatsapp', 'tasks', 'system'])).max(4).optional(),
}).strict();

export type NotificationCategory = 'leads' | 'whatsapp' | 'tasks' | 'system';
