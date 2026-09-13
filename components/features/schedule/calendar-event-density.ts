export type CalendarEventDensity = "compact" | "standard" | "detailed";

const COMPACT_EVENT_LIMIT_MINUTES = 60;
const DETAILED_EVENT_START_MINUTES = 90;

export function getCalendarEventDensity(
  durationMinutes: number,
): CalendarEventDensity {
  if (durationMinutes < COMPACT_EVENT_LIMIT_MINUTES) return "compact";
  if (durationMinutes < DETAILED_EVENT_START_MINUTES) return "standard";
  return "detailed";
}

export function getCalendarEventWidthPercent(width?: string) {
  if (!width) return null;

  const match = /calc\(\s*(\d+(?:\.\d+)?)%/i.exec(width);
  if (!match) return null;

  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isCalendarEventNarrow(width?: string) {
  const widthPercent = getCalendarEventWidthPercent(width);
  return widthPercent !== null && widthPercent <= 50;
}
