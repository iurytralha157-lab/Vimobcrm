import type { ScheduleEventDaySegment } from "@/lib/schedule-event-segments";
import { isAttendanceScheduleType } from "@/lib/schedule-outcome";
import {
  getScheduleCivilDateKey,
  getScheduleZonedClockMinutes,
} from "@/lib/schedule-time-zone";

type CalendarGeometryEvent = {
  id: string;
  start_time: string;
  end_time: string;
  is_all_day?: boolean | null;
  event_type?: string | null;
  is_masked?: boolean | null;
};

export type ScheduleCalendarSegmentGeometry = {
  startMinutes: number;
  endMinutes: number;
  durationMinutes: number;
};

type ScheduleCalendarSegmentLayout<
  TEvent extends CalendarGeometryEvent,
> = {
  segment: ScheduleEventDaySegment<TEvent>;
  geometry: ScheduleCalendarSegmentGeometry;
  column: number;
  totalColumns: number;
};

export const CALENDAR_OVERFLOW_MINUTES = 30;

function getDisplayPriority(event: CalendarGeometryEvent) {
  if (event.is_masked || event.event_type === "task") return 2;
  return isAttendanceScheduleType(event.event_type) ? 0 : 1;
}

export function getScheduleCalendarSegmentGeometry<
  TEvent extends CalendarGeometryEvent,
>(
  segment: ScheduleEventDaySegment<TEvent>,
  timeZone: string,
): ScheduleCalendarSegmentGeometry {
  if (segment.event.is_all_day) {
    return { startMinutes: 0, endMinutes: 24 * 60, durationMinutes: 24 * 60 };
  }

  const startMinutes = getScheduleZonedClockMinutes(segment.start, timeZone);
  const endDateKey = getScheduleCivilDateKey(segment.end, timeZone);
  const civilEndMinutes =
    endDateKey !== segment.dateKey
      ? 24 * 60
      : getScheduleZonedClockMinutes(segment.end, timeZone);
  const realDurationMinutes = Math.max(
    (segment.end.getTime() - segment.start.getTime()) / 60_000,
    1,
  );
  const unclampedEnd =
    civilEndMinutes > startMinutes
      ? civilEndMinutes
      : startMinutes + realDurationMinutes;
  const endMinutes = Math.min(
    24 * 60,
    Math.max(unclampedEnd, startMinutes + 15),
  );

  return {
    startMinutes,
    endMinutes,
    durationMinutes: endMinutes - startMinutes,
  };
}

export function layoutScheduleCalendarSegments<
  TEvent extends CalendarGeometryEvent,
>(
  daySegments: ScheduleEventDaySegment<TEvent>[],
  timeZone: string,
  maxColumns: number,
) {
  const entries = daySegments
    .map((segment) => ({
      segment,
      geometry: getScheduleCalendarSegmentGeometry(segment, timeZone),
    }))
    .sort(
      (left, right) =>
        left.geometry.startMinutes - right.geometry.startMinutes ||
        right.geometry.durationMinutes - left.geometry.durationMinutes ||
        left.segment.start.getTime() - right.segment.start.getTime(),
    );
  const cards: ScheduleCalendarSegmentLayout<TEvent>[] = [];
  const overflow: Array<{
    startMinutes: number;
    segments: ScheduleEventDaySegment<TEvent>[];
  }> = [];
  let currentCluster: typeof entries = [];
  let clusterMaxEnd = 0;

  const processCluster = (cluster: typeof entries) => {
    const columnEnds: number[] = [];
    const assigned = new Map<(typeof entries)[number], number>();
    for (const entry of cluster) {
      const freeColumn = columnEnds.findIndex((end) => end <= entry.geometry.startMinutes);
      const column = freeColumn === -1 ? columnEnds.length : freeColumn;
      if (column === maxColumns) break;
      columnEnds[column] = entry.geometry.endMinutes;
      assigned.set(entry, column);
    }

    let totalColumns = columnEnds.length;
    if (assigned.size < cluster.length) {
      assigned.clear();
      totalColumns = maxColumns - 1;
      const columns = Array.from({ length: totalColumns }, () => [] as typeof entries);
      const preferred = [...cluster].sort((left, right) =>
        getDisplayPriority(left.segment.event) - getDisplayPriority(right.segment.event),
      );
      for (const entry of preferred) {
        const column = columns.findIndex((items) => !items.some(({ geometry }) =>
          geometry.startMinutes < entry.geometry.endMinutes &&
          entry.geometry.startMinutes < geometry.endMinutes,
        ));
        if (column === -1) continue;
        columns[column].push(entry);
        assigned.set(entry, column);
      }
    }

    for (const entry of cluster) {
      const column = assigned.get(entry);
      if (column !== undefined) {
        cards.push({ ...entry, column, totalColumns });
        continue;
      }

      const startMinutes = Math.min(entry.geometry.startMinutes, 24 * 60 - CALENDAR_OVERFLOW_MINUTES);
      const previous = overflow.at(-1);
      if (previous && startMinutes < previous.startMinutes + CALENDAR_OVERFLOW_MINUTES) {
        previous.segments.push(entry.segment);
      } else {
        overflow.push({ startMinutes, segments: [entry.segment] });
      }
    }
  };

  entries.forEach((entry) => {
    if (
      entry.geometry.startMinutes >= clusterMaxEnd &&
      currentCluster.length > 0
    ) {
      processCluster(currentCluster);
      currentCluster = [];
      clusterMaxEnd = 0;
    }
    currentCluster.push(entry);
    clusterMaxEnd = Math.max(clusterMaxEnd, entry.geometry.endMinutes);
  });
  processCluster(currentCluster);

  return { cards, overflow };
}
