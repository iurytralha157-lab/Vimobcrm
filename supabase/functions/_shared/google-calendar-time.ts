export const DEFAULT_GOOGLE_CALENDAR_TIME_ZONE = "America/Sao_Paulo";

type CivilDate = {
  year: number;
  month: number;
  day: number;
};

const civilDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const zonedFormatterCache = new Map<string, Intl.DateTimeFormat>();
const MAX_CACHED_TIME_ZONES = 16;

function parseCivilDate(value: string): CivilDate {
  const match = civilDatePattern.exec(value);
  if (!match) throw new RangeError(`Data civil invalida: ${value}`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));

  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new RangeError(`Data civil invalida: ${value}`);
  }

  return { year, month, day };
}

function getZonedFormatter(timeZone: string) {
  const cached = zonedFormatterCache.get(timeZone);
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
  if (zonedFormatterCache.size >= MAX_CACHED_TIME_ZONES) {
    const oldestKey = zonedFormatterCache.keys().next().value;
    if (oldestKey) zonedFormatterCache.delete(oldestKey);
  }
  zonedFormatterCache.set(timeZone, formatter);
  return formatter;
}

function zonedParts(timestamp: number, timeZone: string) {
  const parts = getZonedFormatter(timeZone).formatToParts(new Date(timestamp));
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

function civilDateKey(timestamp: number, timeZone: string) {
  const parts = zonedParts(timestamp, timeZone);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function civilDayStartToEpoch(value: string, timeZone: string) {
  const civil = parseCivilDate(value);
  const utcProbe = Date.UTC(civil.year, civil.month - 1, civil.day);
  let lower = utcProbe - 48 * 60 * 60 * 1000;
  let upper = utcProbe + 48 * 60 * 60 * 1000;

  // Find the first representable instant of the civil day. This deliberately
  // handles zones whose DST transition skips local midnight.
  while (lower < upper) {
    const middle = lower + Math.floor((upper - lower) / 2);
    if (civilDateKey(middle, timeZone) < value) lower = middle + 1;
    else upper = middle;
  }

  if (civilDateKey(lower, timeZone) !== value) {
    throw new RangeError(`A data ${value} nao existe no fuso ${timeZone}.`);
  }

  return lower;
}

export function normalizeGoogleCalendarTimeZone(value: unknown) {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (!candidate) return DEFAULT_GOOGLE_CALENDAR_TIME_ZONE;

  try {
    getZonedFormatter(candidate).format(new Date(0));
    return candidate;
  } catch {
    return DEFAULT_GOOGLE_CALENDAR_TIME_ZONE;
  }
}

export function nextGoogleCivilDate(value: string) {
  const civil = parseCivilDate(value);
  return new Date(Date.UTC(civil.year, civil.month - 1, civil.day + 1))
    .toISOString()
    .slice(0, 10);
}

export function scheduleInstantToGoogleDate(value: string, timeZone: string) {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError(`Instante invalido: ${value}`);
  }

  const normalizedTimeZone = normalizeGoogleCalendarTimeZone(timeZone);
  const parts = zonedParts(instant.getTime(), normalizedTimeZone);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function googleAllDayRangeToScheduleRange(
  startDate: string,
  exclusiveEndDate: string,
  timeZone: string,
) {
  const normalizedTimeZone = normalizeGoogleCalendarTimeZone(timeZone);
  const startTimestamp = civilDayStartToEpoch(startDate, normalizedTimeZone);
  const exclusiveEndTimestamp = civilDayStartToEpoch(
    exclusiveEndDate,
    normalizedTimeZone,
  );

  if (exclusiveEndTimestamp <= startTimestamp) {
    throw new RangeError(
      `Fim exclusivo ${exclusiveEndDate} deve ser posterior a ${startDate}.`,
    );
  }

  return {
    startTime: new Date(startTimestamp).toISOString(),
    endTime: new Date(exclusiveEndTimestamp - 1).toISOString(),
  };
}
