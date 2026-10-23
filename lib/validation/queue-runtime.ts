import { z } from 'zod';
import { timestampSchema, uuidSchema } from '@/lib/validation/common';

const clockSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Informe um horário válido.');
export const queueOperatingDaySchema = z.object({
  day_of_week: z.number().int().min(0).max(6),
  is_active: z.boolean(),
  is_all_day: z.boolean(),
  start_time: clockSchema.nullable(),
  end_time: clockSchema.nullable(),
}).strict().superRefine((day, context) => {
  if (!day.is_active) return;
  if (day.is_all_day) {
    if (day.start_time !== null || day.end_time !== null) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Dia inteiro não utiliza horários de início e fim.' });
  } else if (!day.start_time || !day.end_time || day.start_time === day.end_time) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Defina início e fim diferentes ou selecione dia inteiro.' });
  }
});

export const queueOperatingScheduleSchema = z.object({
  version: z.literal(1),
  timezone: z.string().trim().min(1, 'Informe o fuso horário.').max(100).refine((value) => {
    try { new Intl.DateTimeFormat('pt-BR', { timeZone: value }).format(0); return true; } catch { return false; }
  }, 'Informe um fuso horário válido, como America/Sao_Paulo.'),
  days: z.array(queueOperatingDaySchema).length(7),
}).strict().superRefine((schedule, context) => {
  if (new Set(schedule.days.map((day) => day.day_of_week)).size !== 7) context.addIssue({ code: z.ZodIssueCode.custom, path: ['days'], message: 'Defina cada dia da semana uma única vez.' });
});

export type QueueOperatingSchedule = z.infer<typeof queueOperatingScheduleSchema>;
export type QueueOperatingDay = z.infer<typeof queueOperatingDaySchema>;

export const queuePoolClaimInputSchema = z.object({
  roundRobinId: uuidSchema,
  episodeId: uuidSchema,
  expectedRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();
export const apiQueuePoolSchema = z.object({
  roundRobinId: uuidSchema,
  episodeId: uuidSchema,
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  state: z.string().min(1).max(80),
  reason: z.string().max(160),
  enteredAt: timestampSchema.optional(),
  nextActionAt: timestampSchema.optional(),
  canClaim: z.boolean(),
}).strict();
export const queuePoolSchema = z.object({
  round_robin_id: uuidSchema,
  episode_id: uuidSchema,
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  state: z.string().min(1).max(80),
  reason: z.string().max(160),
  entered_at: timestampSchema.optional(),
  next_action_at: timestampSchema.optional(),
  can_claim: z.boolean(),
}).strict();
export type APIQueuePool = z.infer<typeof apiQueuePoolSchema>;
export type QueuePool = z.infer<typeof queuePoolSchema>;
export type QueuePoolClaimInput = z.infer<typeof queuePoolClaimInputSchema>;
