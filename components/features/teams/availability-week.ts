import type {
  MemberAvailability,
  TeamMemberAvailabilityInput,
} from "@/lib/api/teams";

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
  availability: readonly MemberAvailability[],
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
      is_active: saved.is_active,
      is_all_day: saved.is_all_day,
      start_time: saved.start_time?.slice(0, 5) || fallback.start_time,
      end_time: saved.end_time?.slice(0, 5) || fallback.end_time,
    };
  });
}

export function isValidAvailabilityWeek(week: readonly DaySchedule[]) {
  if (week.length !== 7) return false;
  const days = new Set(week.map((entry) => entry.day_of_week));
  if (days.size !== 7) return false;
  if (!week.some((entry) => entry.is_active)) return false;

  const clockPattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  return week.every((entry) => {
    if (entry.day_of_week < 0 || entry.day_of_week > 6) return false;
    if (!entry.is_active || entry.is_all_day) return true;
    return (
      clockPattern.test(entry.start_time) &&
      clockPattern.test(entry.end_time) &&
      entry.start_time < entry.end_time
    );
  });
}

export function toAvailabilityInput(
  week: readonly DaySchedule[],
): TeamMemberAvailabilityInput[] {
  return week
    .slice()
    .sort((left, right) => left.day_of_week - right.day_of_week)
    .map((entry) => ({
      day_of_week: entry.day_of_week,
      start_time: entry.is_all_day ? null : `${entry.start_time}:00`,
      end_time: entry.is_all_day ? null : `${entry.end_time}:00`,
      is_all_day: entry.is_all_day,
      is_active: entry.is_active,
    }));
}
