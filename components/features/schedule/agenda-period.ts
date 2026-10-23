import { addDays, addMonths, addYears, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear } from "date-fns";

export type AgendaPeriodMode = "day" | "week" | "month" | "year" | "list";

export function navigateAgendaPeriod(date: Date, mode: AgendaPeriodMode, direction: -1 | 1) {
  if (mode === "month" || mode === "list") return addMonths(date, direction);
  if (mode === "year") return addYears(date, direction);
  return addDays(date, direction * (mode === "week" ? 7 : 1));
}

export function getAgendaLocalPeriod(date: Date, mode: AgendaPeriodMode) {
  if (mode === "day") return { start: startOfDay(date), end: endOfDay(date) };
  if (mode === "week") return { start: startOfWeek(date, { weekStartsOn: 0 }), end: endOfWeek(date, { weekStartsOn: 0 }) };
  if (mode === "year") return { start: startOfYear(date), end: endOfYear(date) };
  if (mode === "list") return { start: startOfMonth(date), end: endOfMonth(date) };
  return { start: startOfWeek(startOfMonth(date), { weekStartsOn: 0 }), end: endOfWeek(endOfMonth(date), { weekStartsOn: 0 }) };
}

export function getAgendaEventsPage<T>(events: readonly T[], visibleCount: number, pageSize = 20) {
  const count = Math.max(pageSize, visibleCount);
  return { items: events.slice(0, count), total: events.length, hasMore: events.length > count };
}
