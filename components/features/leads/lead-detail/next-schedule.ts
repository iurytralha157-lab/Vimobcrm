import { isFinalScheduleStatus } from '@/lib/schedule-outcome';

/** The appointment turns red this long before it starts (and stays red while overdue). */
export const NEXT_SCHEDULE_ALERT_MINUTES = 60;

type SchedulePoint = { id: string; start_time: string | null; status?: string | null };

/** Earliest appointment that was not completed, cancelled or marked as no-show (overdue ones included). */
export function pickNextScheduleEvent<T extends SchedulePoint>(events: T[]): T | null {
  let next: T | null = null;
  let nextTime = Number.POSITIVE_INFINITY;
  for (const event of events) {
    if (isFinalScheduleStatus(event.status)) continue;
    const time = event.start_time ? Date.parse(event.start_time) : Number.NaN;
    if (!Number.isFinite(time) || time >= nextTime) continue;
    next = event;
    nextTime = time;
  }
  return next;
}

/** "em 3 dias", "em 2h 5min", "em 40 min", "agora", "atrasado há 20 min". */
export function describeScheduleCountdown(startTime: string, now: number): { label: string; alert: boolean } {
  const diffMinutes = Math.round((Date.parse(startTime) - now) / 60_000);
  const span = (minutes: number) => {
    if (minutes < 60) return `${minutes} min`;
    if (minutes < 24 * 60) {
      const hours = Math.floor(minutes / 60), rest = minutes % 60;
      return rest ? `${hours}h ${rest}min` : `${hours}h`;
    }
    const days = Math.floor(minutes / (24 * 60));
    return days === 1 ? '1 dia' : `${days} dias`;
  };
  if (diffMinutes < 0) return { label: `atrasado há ${span(-diffMinutes)}`, alert: true };
  if (diffMinutes === 0) return { label: 'agora', alert: true };
  return { label: `em ${span(diffMinutes)}`, alert: diffMinutes <= NEXT_SCHEDULE_ALERT_MINUTES };
}
