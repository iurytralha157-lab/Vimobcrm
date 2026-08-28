const SCHEDULE_CLOCK_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/

interface BuildScheduleEventIntervalInput {
  date: Date | undefined
  time: string
  isAllDay: boolean
  durationMinutes: number
}

export interface ScheduleEventInterval {
  startTime: string
  endTime: string
}

export function buildScheduleEventInterval({
  date,
  time,
  isAllDay,
  durationMinutes,
}: BuildScheduleEventIntervalInput): ScheduleEventInterval | null {
  if (!date || !Number.isFinite(date.getTime())) return null

  const start = new Date(date)
  let end: Date

  if (isAllDay) {
    start.setHours(0, 0, 0, 0)
    end = new Date(start)
    end.setHours(23, 59, 59, 999)
  } else {
    if (!SCHEDULE_CLOCK_PATTERN.test(time)) return null
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return null

    const [hours, minutes] = time.split(':').map(Number)
    start.setHours(hours, minutes, 0, 0)
    end = new Date(start.getTime() + durationMinutes * 60_000)
  }

  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return null
  }

  return {
    startTime: start.toISOString(),
    endTime: end.toISOString(),
  }
}
