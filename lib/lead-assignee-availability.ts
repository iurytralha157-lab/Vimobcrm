import type { MemberAvailability } from '@/lib/api/teams';
import { DEFAULT_SCHEDULE_TIME_ZONE } from '@/lib/schedule-outcome';
import { getScheduleCivilDateKey, getScheduleZonedClockMinutes } from '@/lib/schedule-time-zone';

export function getLeadAssigneeAvailability(
  records: MemberAvailability[], memberId: string, now: Date, timeZone = DEFAULT_SCHEDULE_TIME_ZONE,
) {
  const dayKey = getScheduleCivilDateKey(now, timeZone);
  const day = dayKey ? new Date(`${dayKey}T12:00:00Z`).getUTCDay() : -1;
  const clock = getScheduleZonedClockMinutes(now, timeZone);
  const entries = records.filter((item) => item.team_member_id === memberId && item.is_active);
  const toMinutes = (value: string | null) => {
    if (!value) return null;
    const [hour, minute, second = 0] = value.split(':').map(Number);
    return hour * 60 + minute + second / 60;
  };
  const available = entries.some((item) => {
    if (item.is_all_day) return item.day_of_week === day;
    const start = toMinutes(item.start_time);
    const end = toMinutes(item.end_time);
    if (start === null || end === null || start === end) return false;
    if (start < end) return item.day_of_week === day && clock >= start && clock <= end;
    return (item.day_of_week === day && clock >= start) ||
      (item.day_of_week === (day + 6) % 7 && clock <= end);
  });
  return { available, today: entries.find((item) => item.day_of_week === day), timeZone };
}
