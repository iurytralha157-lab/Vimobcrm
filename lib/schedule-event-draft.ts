import {
  getLocalScheduleCivilDateKey,
  getScheduleCivilDayRange,
  scheduleCivilDateTimeToDate,
} from "./schedule-time-zone";

const SCHEDULE_CLOCK_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

interface BuildScheduleEventIntervalInput {
  date: Date | undefined;
  time: string;
  isAllDay: boolean;
  durationMinutes: number;
  timeZone?: string;
  preferredStartTime?: Date | string | number | null;
}

export interface ScheduleEventInterval {
  startTime: string;
  endTime: string;
}

interface BuildScheduleEventTimingPatchInput {
  preserveAppointmentTiming: boolean;
  startTime: string;
  endTime: string;
  isAllDay: boolean;
  reminderMinutes?: number | null;
}

export interface ScheduleEventTimingPatch {
  start_time?: string;
  end_time?: string;
  is_all_day?: boolean;
  reminder_minutes?: number | null;
}

export function buildScheduleEventTimingPatch({
  preserveAppointmentTiming,
  startTime,
  endTime,
  isAllDay,
  reminderMinutes,
}: BuildScheduleEventTimingPatchInput): ScheduleEventTimingPatch {
  const reminderPatch = { reminder_minutes: reminderMinutes };
  if (preserveAppointmentTiming) return reminderPatch;

  return {
    start_time: startTime,
    end_time: endTime,
    is_all_day: isAllDay,
    ...reminderPatch,
  };
}

export function buildScheduleEventInterval({
  date,
  time,
  isAllDay,
  durationMinutes,
  timeZone,
  preferredStartTime,
}: BuildScheduleEventIntervalInput): ScheduleEventInterval | null {
  if (!date || !Number.isFinite(date.getTime())) return null;

  const civilDate = getLocalScheduleCivilDateKey(date);
  if (timeZone && isAllDay) {
    return getScheduleCivilDayRange(civilDate, timeZone);
  }

  if (timeZone && !isAllDay) {
    if (!SCHEDULE_CLOCK_PATTERN.test(time)) return null;
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return null;
    const zonedStart = scheduleCivilDateTimeToDate(civilDate, time, timeZone, {
      preferredInstant: preferredStartTime,
    });
    if (!zonedStart) return null;
    return {
      startTime: zonedStart.toISOString(),
      endTime: new Date(
        zonedStart.getTime() + durationMinutes * 60_000,
      ).toISOString(),
    };
  }

  const start = new Date(date);
  let end: Date;

  if (isAllDay) {
    start.setHours(0, 0, 0, 0);
    end = new Date(start);
    end.setHours(23, 59, 59, 999);
  } else {
    if (!SCHEDULE_CLOCK_PATTERN.test(time)) return null;
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return null;

    const [hours, minutes] = time.split(":").map(Number);
    start.setHours(hours, minutes, 0, 0);
    end = new Date(start.getTime() + durationMinutes * 60_000);
  }

  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return null;
  }

  return {
    startTime: start.toISOString(),
    endTime: end.toISOString(),
  };
}
