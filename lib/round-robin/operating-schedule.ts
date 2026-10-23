import { queueOperatingScheduleSchema, type QueueOperatingSchedule } from '@/lib/validation/queue-runtime';

export const QUEUE_WEEKDAYS = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'] as const;

/** No timezone, day or hour is silently chosen on behalf of the operator. */
export function createQueueOperatingSchedule(): QueueOperatingSchedule {
  return {
    version: 1, timezone: '',
    days: QUEUE_WEEKDAYS.map((_, day_of_week) => ({ day_of_week, is_active: false, is_all_day: false, start_time: null, end_time: null })),
  };
}

export function queueScheduleError(value: unknown, required = false): string | null {
  if (value === undefined) return required ? 'Defina o horário semanal da fila antes de salvar.' : null;
  const parsed = queueOperatingScheduleSchema.safeParse(value);
  return parsed.success ? null : parsed.error.issues[0]?.message || 'Revise o horário semanal da fila.';
}

export function isQueueOperatingScheduleDraft(value: unknown): value is QueueOperatingSchedule {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const schedule = value as Record<string, unknown>;
  if (schedule.version !== 1 || typeof schedule.timezone !== 'string' || !Array.isArray(schedule.days) || schedule.days.length !== 7) return false;
  const days = schedule.days as Array<Record<string, unknown>>;
  return days.every((day) => day && Number.isInteger(day.day_of_week) && Number(day.day_of_week) >= 0 && Number(day.day_of_week) <= 6 && typeof day.is_active === 'boolean' && typeof day.is_all_day === 'boolean' && (day.start_time === null || typeof day.start_time === 'string') && (day.end_time === null || typeof day.end_time === 'string')) && new Set(days.map((day) => day.day_of_week)).size === 7;
}

export function queueWarningMinutes(timeout: number, warning?: number): number {
  return timeout <= 5 ? 0 : Math.max(0, Math.min(timeout - 1, warning ?? 5));
}
