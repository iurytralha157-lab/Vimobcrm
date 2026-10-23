import type { TeamMemberAvailabilityInput } from "@/lib/api/teams";
const CLOCK_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

export function isAvailabilityClock(value: unknown): value is string {
  return typeof value === "string" && CLOCK_PATTERN.test(value);
}

export function availabilityClockSeconds(value: string): number | null {
  if (!isAvailabilityClock(value)) return null;
  const [hours, minutes, seconds = "0"] = value.split(":");
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

export function availabilityClockForEditor(value: unknown): string {
  if (!isAvailabilityClock(value)) return "";
  return value.length === 8 && value.endsWith(":00") ? value.slice(0, 5) : value;
}

export function availabilityClockForInput(value: string): string | null {
  if (!value) return null;
  return value.length === 5 ? `${value}:00` : value;
}

export function isAvailableAtClock(availability: readonly TeamMemberAvailabilityInput[], dayOfWeek: number, seconds: number): boolean {
  if (availability.length === 0) return true;
  const today = availability.find((day) => day.day_of_week === dayOfWeek);
  if (today && today.is_active !== false) {
    if (today.is_all_day) return true;
    const start = availabilityClockSeconds(today.start_time || "");
    const end = availabilityClockSeconds(today.end_time || "");
    if (start !== null && end !== null && start !== end) {
      if (start < end && seconds >= start && seconds <= end) return true;
      if (start > end && seconds >= start) return true;
    }
  }
  const previous = availability.find((day) => day.day_of_week === (dayOfWeek + 6) % 7);
  if (!previous || previous.is_active === false || previous.is_all_day) return false;
  const start = availabilityClockSeconds(previous.start_time || "");
  const end = availabilityClockSeconds(previous.end_time || "");
  return start !== null && end !== null && start > end && seconds <= end;
}
