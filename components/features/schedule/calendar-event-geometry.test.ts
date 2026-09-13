import assert from "node:assert/strict";
import test from "node:test";

import type { ScheduleEventDaySegment } from "../../../lib/schedule-event-segments";
import {
  getScheduleCalendarSegmentGeometry,
  layoutScheduleCalendarSegments,
} from "./calendar-event-geometry";

type TestEvent = {
  id: string;
  start_time: string;
  end_time: string;
  is_all_day?: boolean;
};

function segment(
  id: string,
  start: string,
  end: string,
  dateKey: string,
): ScheduleEventDaySegment<TestEvent> {
  return {
    key: `${id}:${dateKey}`,
    dateKey,
    event: { id, start_time: start, end_time: end },
    start: new Date(start),
    end: new Date(end),
    isFirst: true,
    isLast: true,
  };
}

test("uses civil geometry when DST skips an hour", () => {
  const geometry = getScheduleCalendarSegmentGeometry(
    segment(
      "spring",
      "2026-03-08T06:30:00.000Z",
      "2026-03-08T07:30:00.000Z",
      "2026-03-08",
    ),
    "America/New_York",
  );

  assert.deepEqual(geometry, {
    startMinutes: 90,
    endMinutes: 210,
    durationMinutes: 120,
  });
});

test("keeps both repeated-hour occurrences visible in separate columns", () => {
  const layouts = layoutScheduleCalendarSegments(
    [
      segment(
        "first",
        "2026-11-01T05:00:00.000Z",
        "2026-11-01T05:30:00.000Z",
        "2026-11-01",
      ),
      segment(
        "second",
        "2026-11-01T06:00:00.000Z",
        "2026-11-01T06:30:00.000Z",
        "2026-11-01",
      ),
    ],
    "America/New_York",
  );

  assert.deepEqual(
    layouts.map(({ column, totalColumns, geometry }) => ({
      column,
      totalColumns,
      geometry,
    })),
    [
      {
        column: 0,
        totalColumns: 2,
        geometry: { startMinutes: 60, endMinutes: 90, durationMinutes: 30 },
      },
      {
        column: 1,
        totalColumns: 2,
        geometry: { startMinutes: 60, endMinutes: 90, durationMinutes: 30 },
      },
    ],
  );
});
