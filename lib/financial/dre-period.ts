import { differenceInCalendarMonths, endOfDay, endOfMonth, startOfDay, subMonths } from 'date-fns'

/** Compare complete civil months, including differing month lengths and leap years. */
export function previousDREPeriod(start: Date, end: Date) {
  const months = differenceInCalendarMonths(end, start) + 1
  const previousStart = startOfDay(subMonths(start, months))
  const previousEnd = endOfDay(subMonths(end, months))
  return {
    start: previousStart,
    end: end.getDate() === endOfMonth(end).getDate() ? endOfMonth(previousEnd) : previousEnd,
  }
}
