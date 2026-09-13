import type { ScheduleEventDaySegment } from "@/lib/schedule-event-segments";
import {
  getScheduleCivilDateKey,
  getScheduleZonedClockMinutes,
} from "@/lib/schedule-time-zone";

type CalendarGeometryEvent = {
  id: string;
  start_time: string;
  end_time: string;
  is_all_day?: boolean | null;
};

export type ScheduleCalendarSegmentGeometry = {
  startMinutes: number;
  endMinutes: number;
  durationMinutes: number;
};

export type ScheduleCalendarSegmentLayout<
  TEvent extends CalendarGeometryEvent,
> = {
  segment: ScheduleEventDaySegment<TEvent>;
  geometry: ScheduleCalendarSegmentGeometry;
  column: number;
  totalColumns: number;
};

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
): ScheduleCalendarSegmentLayout<TEvent>[] {
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
  if (entries.length === 0) return [];

  const layouts: ScheduleCalendarSegmentLayout<TEvent>[] = [];
  let currentCluster: typeof entries = [];
  let clusterMaxEnd = 0;

  const processCluster = (cluster: typeof entries) => {
    if (cluster.length === 0) return;
    const columns: Array<typeof entries> = [];

    cluster.forEach((entry) => {
      const column = columns.findIndex((items) => {
        const previous = items.at(-1);
        return (
          previous &&
          entry.geometry.startMinutes >= previous.geometry.endMinutes
        );
      });
      const targetColumn = column >= 0 ? column : columns.length;
      if (column >= 0) columns[column]!.push(entry);
      else columns.push([entry]);
      layouts.push({
        ...entry,
        column: targetColumn,
        totalColumns: 0,
      });
    });

    const totalColumns = columns.length;
    cluster.forEach(({ segment }) => {
      const layout = layouts.find((item) => item.segment.key === segment.key);
      if (layout) layout.totalColumns = totalColumns;
    });
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

  return layouts;
}
