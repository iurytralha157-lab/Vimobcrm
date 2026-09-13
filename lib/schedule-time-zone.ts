import { DEFAULT_SCHEDULE_TIME_ZONE } from "./schedule-outcome";

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const civilDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const clockPattern = /^([01]\d|2[0-3]):([0-5]\d)$/;
const formatterCache = new Map<string, Intl.DateTimeFormat>();
const civilDayStartCache = new Map<string, number>();
const MAX_CACHED_TIME_ZONES = 16;
const MAX_CACHED_CIVIL_DAYS = 512;

function normalizeTimeZone(value: string | null | undefined) {
  const candidate = value?.trim() || DEFAULT_SCHEDULE_TIME_ZONE;
  try {
    getFormatter(candidate).format(new Date(0));
    return candidate;
  } catch {
    return DEFAULT_SCHEDULE_TIME_ZONE;
  }
}

function getFormatter(timeZone: string) {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    calendar: "gregory",
    numberingSystem: "latn",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  if (formatterCache.size >= MAX_CACHED_TIME_ZONES) {
    const oldestKey = formatterCache.keys().next().value;
    if (oldestKey) formatterCache.delete(oldestKey);
  }
  formatterCache.set(timeZone, formatter);
  return formatter;
}

function getZonedParts(
  value: Date | string | number,
  timeZone: string,
): ZonedParts | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const parts = getFormatter(normalizeTimeZone(timeZone)).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.get("year")),
    month: Number(values.get("month")),
    day: Number(values.get("day")),
    hour: Number(values.get("hour")),
    minute: Number(values.get("minute")),
    second: Number(values.get("second")),
  };
}

function parseCivilDate(value: string) {
  const match = civilDatePattern.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function formatCivilDate(parts: Pick<ZonedParts, "year" | "month" | "day">) {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function findFirstZonedInstant(
  civilDate: string,
  targetKey: string,
  timeZone: string,
  keyForTimestamp: (timestamp: number, zone: string) => string | null,
) {
  const parsed = parseCivilDate(civilDate);
  if (!parsed) return null;

  const utcProbe = Date.UTC(parsed.year, parsed.month - 1, parsed.day);
  let lower = utcProbe - 48 * 60 * 60 * 1000;
  let upper = utcProbe + 48 * 60 * 60 * 1000;
  const normalizedTimeZone = normalizeTimeZone(timeZone);

  while (lower < upper) {
    const middle = lower + Math.floor((upper - lower) / 2);
    const key = keyForTimestamp(middle, normalizedTimeZone);
    if (key !== null && key < targetKey) lower = middle + 1;
    else upper = middle;
  }

  return keyForTimestamp(lower, normalizedTimeZone) === targetKey
    ? lower
    : null;
}

function getTimeZoneOffsetMilliseconds(timestamp: number, timeZone: string) {
  const parts = getZonedParts(timestamp, timeZone);
  if (!parts) return null;

  const timestampWithoutMilliseconds = Math.floor(timestamp / 1_000) * 1_000;
  return (
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    ) - timestampWithoutMilliseconds
  );
}

function findZonedDateTimeInstants(
  civilDate: string,
  clock: string,
  timeZone: string,
) {
  const parsedDate = parseCivilDate(civilDate);
  const parsedClock = clockPattern.exec(clock);
  if (!parsedDate || !parsedClock) return [];

  const target = {
    ...parsedDate,
    hour: Number(parsedClock[1]),
    minute: Number(parsedClock[2]),
    second: 0,
  } satisfies ZonedParts;
  const wallClockTimestamp = Date.UTC(
    target.year,
    target.month - 1,
    target.day,
    target.hour,
    target.minute,
    target.second,
  );
  const normalizedTimeZone = normalizeTimeZone(timeZone);
  const probeDistance = 48 * 60 * 60 * 1_000;
  const possibleOffsets = new Set<number>();

  for (const probe of [
    wallClockTimestamp - probeDistance,
    wallClockTimestamp,
    wallClockTimestamp + probeDistance,
  ]) {
    const offset = getTimeZoneOffsetMilliseconds(probe, normalizedTimeZone);
    if (offset !== null) possibleOffsets.add(offset);
  }

  const matches: number[] = [];
  possibleOffsets.forEach((offset) => {
    const candidate = wallClockTimestamp - offset;
    const parts = getZonedParts(candidate, normalizedTimeZone);
    if (
      parts?.year === target.year &&
      parts.month === target.month &&
      parts.day === target.day &&
      parts.hour === target.hour &&
      parts.minute === target.minute &&
      parts.second === target.second
    ) {
      matches.push(candidate);
    }
  });

  return Array.from(new Set(matches)).sort((left, right) => left - right);
}

export interface ScheduleCivilDateTimePreference {
  preferredInstant?: Date | string | number | null;
  occurrence?: "first" | "last";
}

export function getLocalScheduleCivilDateKey(date: Date) {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function getScheduleCivilDateKey(
  value: Date | string | number,
  timeZone = DEFAULT_SCHEDULE_TIME_ZONE,
) {
  const parts = getZonedParts(value, timeZone);
  return parts ? formatCivilDate(parts) : null;
}

export function getNextScheduleCivilDate(value: string) {
  const parsed = parseCivilDate(value);
  if (!parsed) return null;
  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + 1))
    .toISOString()
    .slice(0, 10);
}

export function getScheduleCivilDayStart(
  civilDate: string,
  timeZone = DEFAULT_SCHEDULE_TIME_ZONE,
) {
  const normalizedTimeZone = normalizeTimeZone(timeZone);
  const cacheKey = `${normalizedTimeZone}|${civilDate}`;
  const cachedTimestamp = civilDayStartCache.get(cacheKey);
  if (cachedTimestamp !== undefined) return new Date(cachedTimestamp);

  const timestamp = findFirstZonedInstant(
    civilDate,
    civilDate,
    normalizedTimeZone,
    (candidate, zone) => getScheduleCivilDateKey(candidate, zone),
  );
  if (timestamp === null) return null;

  if (civilDayStartCache.size >= MAX_CACHED_CIVIL_DAYS) {
    const oldestKey = civilDayStartCache.keys().next().value;
    if (oldestKey) civilDayStartCache.delete(oldestKey);
  }
  civilDayStartCache.set(cacheKey, timestamp);
  return new Date(timestamp);
}

export function getScheduleCivilDayRange(
  civilDate: string,
  timeZone = DEFAULT_SCHEDULE_TIME_ZONE,
) {
  const nextDate = getNextScheduleCivilDate(civilDate);
  const start = getScheduleCivilDayStart(civilDate, timeZone);
  const exclusiveEnd = nextDate
    ? getScheduleCivilDayStart(nextDate, timeZone)
    : null;
  if (!start || !exclusiveEnd || exclusiveEnd <= start) return null;

  return {
    startTime: start.toISOString(),
    endTime: new Date(exclusiveEnd.getTime() - 1).toISOString(),
  };
}

export function scheduleCivilDateTimeToDate(
  civilDate: string,
  clock: string,
  timeZone = DEFAULT_SCHEDULE_TIME_ZONE,
  preference: ScheduleCivilDateTimePreference = {},
) {
  const matches = findZonedDateTimeInstants(civilDate, clock, timeZone);
  if (matches.length === 0) return null;

  const preferredDate =
    preference.preferredInstant instanceof Date
      ? preference.preferredInstant
      : typeof preference.preferredInstant === "string" ||
          typeof preference.preferredInstant === "number"
        ? new Date(preference.preferredInstant)
        : null;
  if (preferredDate && !Number.isNaN(preferredDate.getTime())) {
    const preferredParts = getZonedParts(preferredDate, timeZone);
    const preferredOffset = getTimeZoneOffsetMilliseconds(
      preferredDate.getTime(),
      timeZone,
    );
    if (
      preferredParts &&
      preferredOffset !== null &&
      formatCivilDate(preferredParts) === civilDate
    ) {
      const sameOccurrence = matches.find(
        (candidate) =>
          getTimeZoneOffsetMilliseconds(candidate, timeZone) ===
          preferredOffset,
      );
      if (sameOccurrence !== undefined) return new Date(sameOccurrence);
    }
  }

  const timestamp =
    preference.occurrence === "last" ? matches[matches.length - 1] : matches[0];
  return new Date(timestamp);
}

export function scheduleFutureCivilDateTimeToDate(
  civilDate: string,
  clock: string,
  timeZone: string,
  afterInstant: Date | string | number,
) {
  const after =
    afterInstant instanceof Date ? afterInstant : new Date(afterInstant);
  if (Number.isNaN(after.getTime())) return null;

  const nextMatch = findZonedDateTimeInstants(civilDate, clock, timeZone).find(
    (candidate) => candidate > after.getTime(),
  );
  return nextMatch === undefined ? null : new Date(nextMatch);
}

/**
 * Carries an organization civil date through controls that require a native
 * Date. Local noon is intentional: unlike the source clock, it cannot be
 * normalized across the browser's common midnight/early-morning DST gaps.
 * Consumers that need the clock must format the original instant directly.
 */
export function scheduleInstantToLocalDateProxy(
  value: Date | string | number,
  timeZone = DEFAULT_SCHEDULE_TIME_ZONE,
) {
  const civilDate = getScheduleCivilDateKey(value, timeZone);
  return civilDate ? scheduleCivilDateKeyToLocalDate(civilDate) : null;
}

export function getScheduleZonedClockMinutes(
  value: Date | string | number,
  timeZone = DEFAULT_SCHEDULE_TIME_ZONE,
) {
  const parts = getZonedParts(value, timeZone);
  return parts ? parts.hour * 60 + parts.minute + parts.second / 60 : 0;
}

export function formatScheduleZonedTime(
  value: Date | string | number,
  timeZone = DEFAULT_SCHEDULE_TIME_ZONE,
) {
  const parts = getZonedParts(value, timeZone);
  if (!parts) return "--:--";
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

export function scheduleCivilDateKeyToLocalDate(value: string) {
  const parsed = parseCivilDate(value);
  return parsed
    ? new Date(parsed.year, parsed.month - 1, parsed.day, 12, 0, 0, 0)
    : null;
}
