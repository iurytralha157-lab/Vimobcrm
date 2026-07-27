export interface ScheduleEventInterval {
  id: string
  start_time: string
  end_time: string
}

export interface ScheduleEventDaySegment<TEvent extends ScheduleEventInterval> {
  key: string
  dateKey: string
  event: TEvent
  start: Date
  end: Date
  isFirst: boolean
  isLast: boolean
}

function localDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function startOfNextLocalDay(date: Date) {
  const nextDay = new Date(date)
  nextDay.setHours(0, 0, 0, 0)
  nextDay.setDate(nextDay.getDate() + 1)
  return nextDay
}

/**
 * Splits an event at each local midnight so calendar grids can render every
 * portion inside its own day column. An event ending exactly at midnight does
 * not create an empty segment on the following day.
 */
export function splitScheduleEventByDay<TEvent extends ScheduleEventInterval>(
  event: TEvent,
): ScheduleEventDaySegment<TEvent>[] {
  const eventStart = new Date(event.start_time)
  const eventEnd = new Date(event.end_time)

  if (
    Number.isNaN(eventStart.getTime())
    || Number.isNaN(eventEnd.getTime())
    || eventEnd.getTime() <= eventStart.getTime()
  ) {
    return []
  }

  const segments: ScheduleEventDaySegment<TEvent>[] = []
  let segmentStart = eventStart

  while (segmentStart.getTime() < eventEnd.getTime()) {
    const nextDay = startOfNextLocalDay(segmentStart)
    const segmentEnd = eventEnd.getTime() < nextDay.getTime() ? eventEnd : nextDay
    const dateKey = localDateKey(segmentStart)

    segments.push({
      key: `${event.id}:${dateKey}`,
      dateKey,
      event,
      start: segmentStart,
      end: segmentEnd,
      isFirst: segmentStart.getTime() === eventStart.getTime(),
      isLast: segmentEnd.getTime() === eventEnd.getTime(),
    })

    segmentStart = segmentEnd
  }

  return segments
}
