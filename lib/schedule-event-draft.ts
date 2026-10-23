import {
  getLocalScheduleCivilDateKey,
  getScheduleCivilDateKey,
  getScheduleCivilDayRange,
  scheduleCivilDateTimeToDate,
} from "./schedule-time-zone";
import { getScheduleAllDayLastOccupiedInstant } from "@/lib/schedule-outcome";

const SCHEDULE_CLOCK_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

interface BuildScheduleEventIntervalInput {
  date: Date | undefined;
  time: string;
  isAllDay: boolean;
  durationMinutes: number;
  timeZone?: string;
  preferredStartTime?: Date | string | number | null;
  allDaySpan?: ScheduleAllDaySpan;
}

export interface ScheduleEventInterval {
  startTime: string;
  endTime: string;
}

export interface ScheduleAllDaySpan {
  dayCount: number;
  endExclusive: boolean;
}

/** Count calendar dates, rather than 24-hour periods, across DST boundaries. */
export function getScheduleAllDaySpan(
  startTime: Date | string | number | null | undefined,
  endTime: Date | string | number | null | undefined,
  timeZone: string,
): ScheduleAllDaySpan {
  const fallback = { dayCount: 1, endExclusive: false };
  if (startTime == null || endTime == null) return fallback;
  const start = new Date(startTime);
  const end = new Date(endTime);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
    return fallback;
  }
  const startDate = getScheduleCivilDateKey(start, timeZone);
  const lastInstant = getScheduleAllDayLastOccupiedInstant(start, end, timeZone);
  const endExclusive = lastInstant === end.getTime() - 1;
  const lastDate = lastInstant == null ? null : getScheduleCivilDateKey(lastInstant, timeZone);
  if (!startDate || !lastDate) return fallback;
  const dayCount = Math.round(
    (Date.parse(`${lastDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000,
  ) + 1;
  return Number.isSafeInteger(dayCount) && dayCount > 0
    ? { dayCount, endExclusive }
    : fallback;
}

export function buildScheduleAllDayInterval(
  civilDate: string,
  timeZone: string,
  span: ScheduleAllDaySpan = { dayCount: 1, endExclusive: false },
): ScheduleEventInterval | null {
  if (!Number.isSafeInteger(span.dayCount) || span.dayCount <= 0) return null;
  const lastDate = new Date(`${civilDate}T00:00:00Z`);
  if (!Number.isFinite(lastDate.getTime())) return null;
  lastDate.setUTCDate(lastDate.getUTCDate() + span.dayCount - 1);
  if (!Number.isFinite(lastDate.getTime())) return null;
  const firstDay = getScheduleCivilDayRange(civilDate, timeZone);
  const lastDay = getScheduleCivilDayRange(lastDate.toISOString().slice(0, 10), timeZone);
  if (!firstDay || !lastDay) return null;
  return {
    startTime: firstDay.startTime,
    endTime: span.endExclusive
      ? new Date(Date.parse(lastDay.endTime) + 1).toISOString()
      : lastDay.endTime,
  };
}

/** All-day moves use civil dates even when the target clock is inside a DST gap. */
export function buildScheduleMovedEventInterval({
  startTime,
  endTime,
  isAllDay,
  civilDate,
  time,
  timeZone,
}: {
  startTime: string;
  endTime: string;
  isAllDay: boolean;
  civilDate: string;
  time: string;
  timeZone: string;
}): ScheduleEventInterval | null {
  const start = new Date(startTime);
  const end = new Date(endTime);
  const duration = end.getTime() - start.getTime();
  if (!Number.isSafeInteger(duration) || duration <= 0) return null;
  if (isAllDay) {
    return buildScheduleAllDayInterval(
      civilDate,
      timeZone,
      getScheduleAllDaySpan(start, end, timeZone),
    );
  }
  const movedStart = scheduleCivilDateTimeToDate(civilDate, time, timeZone, {
    preferredInstant: start,
  });
  if (!movedStart) return null;
  const movedEnd = new Date(movedStart.getTime() + duration);
  if (!Number.isFinite(movedEnd.getTime())) return null;
  return { startTime: movedStart.toISOString(), endTime: movedEnd.toISOString() };
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
  allDaySpan,
}: BuildScheduleEventIntervalInput): ScheduleEventInterval | null {
  if (!date || !Number.isFinite(date.getTime())) return null;

  const civilDate = getLocalScheduleCivilDateKey(date);
  if (timeZone && isAllDay) {
    return buildScheduleAllDayInterval(civilDate, timeZone, allDaySpan);
  }

  if (timeZone && !isAllDay) {
    if (!SCHEDULE_CLOCK_PATTERN.test(time)) return null;
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return null;
    const durationMilliseconds = Math.round(durationMinutes * 60_000);
    if (!Number.isSafeInteger(durationMilliseconds) || durationMilliseconds <= 0) return null;
    const zonedStart = scheduleCivilDateTimeToDate(civilDate, time, timeZone, {
      preferredInstant: preferredStartTime,
    });
    if (!zonedStart) return null;
    const end = new Date(zonedStart.getTime() + durationMilliseconds);
    if (!Number.isFinite(end.getTime())) return null;
    return {
      startTime: zonedStart.toISOString(),
      endTime: end.toISOString(),
    };
  }

  const start = new Date(date);
  let end: Date;

  if (isAllDay) {
    const span = allDaySpan || { dayCount: 1, endExclusive: false };
    if (!Number.isSafeInteger(span.dayCount) || span.dayCount <= 0) return null;
    start.setHours(0, 0, 0, 0);
    end = new Date(start);
    end.setDate(end.getDate() + span.dayCount - (span.endExclusive ? 0 : 1));
    if (span.endExclusive) end.setHours(0, 0, 0, 0);
    else end.setHours(23, 59, 59, 999);
  } else {
    if (!SCHEDULE_CLOCK_PATTERN.test(time)) return null;
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return null;
    const durationMilliseconds = Math.round(durationMinutes * 60_000);
    if (!Number.isSafeInteger(durationMilliseconds) || durationMilliseconds <= 0) return null;

    const [hours, minutes] = time.split(":").map(Number);
    start.setHours(hours, minutes, 0, 0);
    end = new Date(start.getTime() + durationMilliseconds);
  }

  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return null;
  }

  return {
    startTime: start.toISOString(),
    endTime: end.toISOString(),
  };
}
