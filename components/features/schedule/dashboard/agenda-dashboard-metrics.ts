import type {
  ScheduleDashboardDailyPoint,
  ScheduleDashboardData,
  ScheduleDashboardOverdueOwner,
  ScheduleDashboardPerformerRanking,
} from "@/lib/validation/schedule-dashboard";

import { getAgendaSelectedDayCount } from "./agenda-adaptive-chart-model";
import { getAgendaPerformanceHighlights } from "./agenda-dashboard-model";

const DAY_IN_MS = 24 * 60 * 60 * 1_000;
const WEEKDAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const MAX_WEEKS = 8;

function parseDay(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function formatDay(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

/** `daily` is already grouped by civil day in the report timezone, on the selected date basis. */
export function buildWeekdayDistribution(
  daily: readonly Pick<ScheduleDashboardDailyPoint, "date" | "total">[],
) {
  const totals = new Map<number, number>();
  daily.forEach((point) => {
    const weekday = new Date(parseDay(point.date)).getUTCDay();
    totals.set(weekday, (totals.get(weekday) ?? 0) + point.total);
  });
  return WEEKDAY_ORDER.map((weekday) => ({
    key: String(weekday),
    label: WEEKDAY_LABELS[weekday],
    total: totals.get(weekday) ?? 0,
  }));
}

export type AgendaWeeklyCompletion = {
  key: string;
  label: string;
  completed: number;
  eligible: number;
  rate: number;
};

function shortDay(timestamp: number) {
  const date = new Date(timestamp);
  return {
    day: String(date.getUTCDate()).padStart(2, "0"),
    month: String(date.getUTCMonth() + 1).padStart(2, "0"),
  };
}

/**
 * Monday-based weeks, clipped to the selected period. Weeks with nothing to rate
 * are left out, and a report without `daily.eligible` (older replica) has no
 * series: the rate cannot be rebuilt from the other counters without guessing.
 */
export function buildWeeklyCompletion(
  daily: readonly ScheduleDashboardDailyPoint[],
): AgendaWeeklyCompletion[] {
  const weeks = new Map<number, { first: number; last: number; completed: number; eligible: number }>();
  for (const point of daily) {
    if (point.eligible === undefined) return [];
    const timestamp = parseDay(point.date);
    const weekStart = timestamp - ((new Date(timestamp).getUTCDay() + 6) % 7) * DAY_IN_MS;
    const week = weeks.get(weekStart) ?? { first: timestamp, last: timestamp, completed: 0, eligible: 0 };
    week.first = Math.min(week.first, timestamp);
    week.last = Math.max(week.last, timestamp);
    week.completed += point.completed;
    week.eligible += point.eligible;
    weeks.set(weekStart, week);
  }
  return Array.from(weeks.entries())
    .sort(([left], [right]) => left - right)
    .filter(([, week]) => week.eligible > 0)
    .slice(-MAX_WEEKS)
    .map(([weekStart, week]) => {
      const first = shortDay(week.first);
      const last = shortDay(week.last);
      return {
        key: formatDay(weekStart),
        label:
          week.first === week.last
            ? `${first.day}/${first.month}`
            : first.month === last.month
              ? `${first.day} a ${last.day}/${last.month}`
              : `${first.day}/${first.month} a ${last.day}/${last.month}`,
        completed: week.completed,
        eligible: week.eligible,
        rate: (week.completed / week.eligible) * 100,
      };
    });
}

/** From the first to the last busy hour, keeping quiet hours in between visible. */
export function buildHourRows(
  report: Pick<ScheduleDashboardData, "hour_distribution">,
) {
  const points = report.hour_distribution;
  if (!points) return null;
  const busy = points.filter((point) => point.total > 0).map((point) => point.hour);
  if (busy.length === 0) return [];
  const first = Math.min(...busy);
  const last = Math.max(...busy);
  return points
    .filter((point) => point.hour >= first && point.hour <= last)
    .map((point) => ({
      key: String(point.hour),
      label: `${String(point.hour).padStart(2, "0")}h`,
      total: point.total,
    }));
}

/** The same number of days immediately before the selected period. */
export function getPreviousPeriod(dateFrom: string, dateTo: string) {
  const dayCount = getAgendaSelectedDayCount(dateFrom, dateTo);
  if (dayCount < 1) return null;
  const start = parseDay(dateFrom);
  return {
    dateFrom: formatDay(start - dayCount * DAY_IN_MS),
    dateTo: formatDay(start - DAY_IN_MS),
  };
}

export type AgendaDelta = { label: string; tone: "good" | "bad" | "neutral" };

function signed(value: number, decimals: number) {
  const formatted = Math.abs(value).toLocaleString("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${value > 0 ? "+" : value < 0 ? "-" : ""}${formatted}`;
}

function toneFor(difference: number, goodWhen: "up" | "down"): AgendaDelta["tone"] {
  if (Math.abs(difference) < 0.05) return "neutral";
  return difference > 0 === (goodWhen === "up") ? "good" : "bad";
}

export function percentDelta(
  current: number,
  previous: number | null | undefined,
  goodWhen: "up" | "down" = "up",
): AgendaDelta | null {
  // Growth over zero has no meaningful percentage.
  if (previous === null || previous === undefined || previous <= 0) return null;
  const change = ((current - previous) / previous) * 100;
  return { label: `${signed(change, 1)}%`, tone: toneFor(change, goodWhen) };
}

export function countDelta(
  current: number,
  previous: number | null | undefined,
  goodWhen: "up" | "down" = "up",
): AgendaDelta | null {
  if (previous === null || previous === undefined) return null;
  const change = current - previous;
  return { label: signed(change, 0), tone: toneFor(change, goodWhen) };
}

export function pointsDelta(
  current: number,
  previous: number | null | undefined,
  previousBase: number | null | undefined,
  goodWhen: "up" | "down" = "up",
): AgendaDelta | null {
  // A rate over an empty base is reported as 0 and is not a real reading.
  if (previous === null || previous === undefined || !previousBase) return null;
  const change = current - previous;
  return { label: `${signed(change, 1)} p.p.`, tone: toneFor(change, goodWhen) };
}

export function buildTeamSummary(
  ranking: ScheduleDashboardPerformerRanking[],
  overdueOwners: ScheduleDashboardOverdueOwner[],
) {
  const active = ranking.filter((person) => person.total > 0);
  const highlights = getAgendaPerformanceHighlights(ranking);
  const worstOverdue = overdueOwners.reduce<ScheduleDashboardOverdueOwner | null>(
    (worst, owner) => (owner.overdue > (worst?.overdue ?? 0) ? owner : worst),
    null,
  );
  return {
    activeCount: active.length,
    // A shared event counts once for each participant, as in the ranking.
    averagePerPerson:
      active.length > 0
        ? active.reduce((sum, person) => sum + person.total, 0) / active.length
        : null,
    best: highlights.best,
    bestTied: highlights.bestTied,
    worstOverdue,
  };
}
