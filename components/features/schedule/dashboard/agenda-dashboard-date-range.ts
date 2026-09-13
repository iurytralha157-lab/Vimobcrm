export const AGENDA_DASHBOARD_FALLBACK_TIME_ZONE = "America/Sao_Paulo";

export type AgendaDashboardDatePreset =
  | "today"
  | "yesterday"
  | "this_week"
  | "last_week"
  | "next_week"
  | "this_month"
  | "last_30_days"
  | "next_30_days";

type CivilDate = {
  year: number;
  month: number;
  day: number;
};

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1_000;

function getCivilDateInTimeZone(referenceDate: Date, timeZone: string) {
  const readParts = (resolvedTimeZone: string) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: resolvedTimeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(referenceDate);
    const values = new Map(parts.map((part) => [part.type, part.value]));

    return {
      year: Number(values.get("year")),
      month: Number(values.get("month")),
      day: Number(values.get("day")),
    } satisfies CivilDate;
  };

  try {
    return readParts(timeZone);
  } catch {
    return readParts(AGENDA_DASHBOARD_FALLBACK_TIME_ZONE);
  }
}

function civilDateToDayNumber(date: CivilDate) {
  return Math.floor(
    Date.UTC(date.year, date.month - 1, date.day) / DAY_IN_MILLISECONDS,
  );
}

function dayNumberToCivilDate(dayNumber: number): CivilDate {
  const date = new Date(dayNumber * DAY_IN_MILLISECONDS);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function addCivilDays(date: CivilDate, amount: number) {
  return dayNumberToCivilDate(civilDateToDayNumber(date) + amount);
}

function startOfCivilWeek(date: CivilDate) {
  const weekDay = new Date(
    Date.UTC(date.year, date.month - 1, date.day),
  ).getUTCDay();
  const daysSinceMonday = (weekDay + 6) % 7;
  return addCivilDays(date, -daysSinceMonday);
}

function endOfCivilMonth(date: CivilDate): CivilDate {
  const lastDay = new Date(Date.UTC(date.year, date.month, 0));
  return {
    year: lastDay.getUTCFullYear(),
    month: lastDay.getUTCMonth() + 1,
    day: lastDay.getUTCDate(),
  };
}

function formatCivilDate(date: CivilDate) {
  return `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

export function getAgendaDashboardPresetRange(
  preset: AgendaDashboardDatePreset,
  referenceDate = new Date(),
  timeZone = AGENDA_DASHBOARD_FALLBACK_TIME_ZONE,
) {
  const today = getCivilDateInTimeZone(referenceDate, timeZone);
  let from = today;
  let to = today;

  switch (preset) {
    case "yesterday":
      from = addCivilDays(today, -1);
      to = from;
      break;
    case "this_week":
      from = startOfCivilWeek(today);
      to = addCivilDays(from, 6);
      break;
    case "last_week":
      from = addCivilDays(startOfCivilWeek(today), -7);
      to = addCivilDays(from, 6);
      break;
    case "next_week":
      from = addCivilDays(startOfCivilWeek(today), 7);
      to = addCivilDays(from, 6);
      break;
    case "this_month":
      from = { year: today.year, month: today.month, day: 1 };
      to = endOfCivilMonth(today);
      break;
    case "last_30_days":
      from = addCivilDays(today, -29);
      break;
    case "next_30_days":
      to = addCivilDays(today, 29);
      break;
    case "today":
      break;
  }

  return {
    dateFrom: formatCivilDate(from),
    dateTo: formatCivilDate(to),
  };
}
