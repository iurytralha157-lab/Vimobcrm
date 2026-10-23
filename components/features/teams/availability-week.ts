import type {
  MemberAvailability,
  TeamMemberAvailabilityInput,
} from "@/lib/api/teams";
import { availabilityClockForEditor, availabilityClockForInput, availabilityClockSeconds, isAvailabilityClock } from "@/lib/teams/availability-clock";

export interface DaySchedule {
  day_of_week: number;
  is_active: boolean;
  is_all_day: boolean;
  start_time: string;
  end_time: string;
}

export const DAYS_OF_WEEK = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
] as const;

export const DAYS_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"] as const;

export const TIME_OPTIONS = Array.from({ length: 48 }, (_, index) => {
  const hours = Math.floor(index / 2)
    .toString()
    .padStart(2, "0");
  const minutes = index % 2 === 0 ? "00" : "30";
  return `${hours}:${minutes}`;
}).concat("23:59");

export function availabilityTimeOptions(...savedClocks: string[]) {
  return [...new Set([...TIME_OPTIONS, ...savedClocks.filter(isAvailabilityClock)])].sort();
}

export function createDefaultAvailabilityWeek(): DaySchedule[] {
  return Array.from({ length: 7 }, (_, day) => ({
    day_of_week: day,
    is_active: day >= 1 && day <= 5,
    is_all_day: false,
    start_time: "08:00",
    end_time: "18:00",
  }));
}

export function hasCompleteAvailabilityWeek(
  availability: readonly Pick<MemberAvailability, "day_of_week">[],
) {
  return (
    availability.length === 7 &&
    new Set(availability.map((entry) => entry.day_of_week)).size === 7 &&
    Array.from({ length: 7 }, (_, day) => day).every((day) =>
      availability.some((entry) => entry.day_of_week === day),
    )
  );
}

export function availabilityToWeek(
  availability: readonly TeamMemberAvailabilityInput[],
): DaySchedule[] {
  const defaults = createDefaultAvailabilityWeek();
  const hasAnySavedDay = availability.length > 0;

  return defaults.map((fallback) => {
    const saved = availability.find(
      (entry) => entry.day_of_week === fallback.day_of_week,
    );
    if (!saved) {
      return hasAnySavedDay ? { ...fallback, is_active: false } : fallback;
    }
    return {
      day_of_week: saved.day_of_week,
      is_active: saved.is_active !== false,
      is_all_day: saved.is_all_day === true,
      // A missing or malformed saved clock needs an explicit repair. It must
      // not become the default shift merely because another field is saved.
      start_time: availabilityClockForEditor(saved.start_time),
      end_time: availabilityClockForEditor(saved.end_time),
    };
  });
}

export function isValidAvailabilityWeek(week: readonly DaySchedule[]) {
  if (week.length !== 7) return false;
  const days = new Set(week.map((entry) => entry.day_of_week));
  if (days.size !== 7) return false;
  if (!week.some((entry) => entry.is_active)) return false;

  return week.every((entry) => {
    if (entry.day_of_week < 0 || entry.day_of_week > 6) return false;
    if (entry.is_all_day) return true;
    if (!entry.is_active) return (!entry.start_time || isAvailabilityClock(entry.start_time)) && (!entry.end_time || isAvailabilityClock(entry.end_time));
    // start_time > end_time is allowed: it represents a shift that starts on
    // this day and rolls over past midnight into the next day (e.g. 22:00
    // to 06:00). Only an exact match (zero-length shift) is invalid.
    return (
      isAvailabilityClock(entry.start_time) &&
      isAvailabilityClock(entry.end_time) &&
      availabilityClockSeconds(entry.start_time) !== availabilityClockSeconds(entry.end_time)
    );
  });
}

export type AvailabilityWeekReviewReason = "missing" | "incomplete" | "invalid";

export function availabilityWeekReviewReason(availability: readonly TeamMemberAvailabilityInput[]): AvailabilityWeekReviewReason | null {
  if (availability.length === 0) return "missing";
  if (!hasCompleteAvailabilityWeek(availability)) return "incomplete";
  if (availability.some((day) => !day.is_all_day && (
    (day.start_time != null && !isAvailabilityClock(day.start_time)) ||
    (day.end_time != null && !isAvailabilityClock(day.end_time)) ||
    (day.is_active !== false && (!isAvailabilityClock(day.start_time) || !isAvailabilityClock(day.end_time)))
  )) || !isValidAvailabilityWeek(availabilityToWeek(availability))) return "invalid";
  return null;
}

export function toAvailabilityInput(
  week: readonly DaySchedule[],
): TeamMemberAvailabilityInput[] {
  return week
    .slice()
    .sort((left, right) => left.day_of_week - right.day_of_week)
    .map((entry) => ({
      day_of_week: entry.day_of_week,
      start_time: entry.is_all_day ? null : availabilityClockForInput(entry.start_time),
      end_time: entry.is_all_day ? null : availabilityClockForInput(entry.end_time),
      is_all_day: entry.is_all_day,
      is_active: entry.is_active,
    }));
}
