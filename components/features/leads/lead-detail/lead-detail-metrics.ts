const DAY_MS = 24 * 60 * 60 * 1000;

/** A lead without contact for longer than this is shown in red on the card. */
export const STALE_CONTACT_DAYS = 7;

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

/** Whole days between `from` and `now`, or null when the date is missing/invalid. */
export function daysSince(from: string | null | undefined, now: number): number | null {
  const time = parseTime(from);
  if (time === null) return null;
  return Math.max(0, Math.floor((now - time) / DAY_MS));
}

/** Short Portuguese label that never wraps: "hoje", "1 dia", "12 dias", "3 meses", "2 anos". */
export function formatElapsedShort(from: string | null | undefined, now: number): string | null {
  const days = daysSince(from, now);
  if (days === null) return null;
  if (days === 0) return 'hoje';
  if (days < 30) return days === 1 ? '1 dia' : `${days} dias`;
  const months = Math.floor(days / 30);
  if (months < 12) return months === 1 ? '1 mês' : `${months} meses`;
  const years = Math.floor(days / 365);
  return years <= 1 ? '1 ano' : `${years} anos`;
}

export function isContactStale(lastContactAt: string | null | undefined, now: number): boolean {
  const days = daysSince(lastContactAt, now);
  return days !== null && days > STALE_CONTACT_DAYS;
}

/** The "entrou de novo" notice is shown for this long after the last re-entry. */
export const REENTRY_NOTICE_DAYS = 7;

const pad = (value: number) => String(value).padStart(2, '0');

/** "hoje, às 15:12" / "ontem, às 09:05" / "em 24/11, às 18:40" (local time), or null when it is not recent. */
export function describeRecentReentry(count: number | null | undefined, lastEntryAt: string | null | undefined, now: number): string | null {
  if (!count || count <= 0) return null;
  const time = parseTime(lastEntryAt);
  if (time === null || now - time > REENTRY_NOTICE_DAYS * DAY_MS) return null;
  const entry = new Date(time), today = new Date(now);
  const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(today) - startOfDay(entry)) / DAY_MS);
  const clock = `${pad(entry.getHours())}:${pad(entry.getMinutes())}`;
  if (dayDiff <= 0) return `hoje, às ${clock}`;
  if (dayDiff === 1) return `ontem, às ${clock}`;
  return `em ${pad(entry.getDate())}/${pad(entry.getMonth() + 1)}, às ${clock}`;
}
