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
  event_type?: string;
  is_masked?: boolean;
};

function segment(
  id: string,
  start: string,
  end: string,
  dateKey: string,
  eventType?: string,
): ScheduleEventDaySegment<TestEvent> {
  return {
    key: `${id}:${dateKey}`,
    dateKey,
    event: { id, start_time: start, end_time: end, event_type: eventType },
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
  const { cards, overflow } = layoutScheduleCalendarSegments(
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
    2,
  );

  assert.equal(overflow.length, 0);
  assert.deepEqual(
    cards.map(({ column, totalColumns, geometry }) => ({
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

test("keeps visits and meetings readable when 30 cadences overlap", () => {
  const dateKey = "2026-11-21";
  const timed = (id: string, from: string, to: string, type: string) =>
    segment(id, `${dateKey}T${from}:00Z`, `${dateKey}T${to}:00Z`, dateKey, type);

  const cadences = Array.from({ length: 30 }, (_, i) => timed(`cadence-${i}`, "16:00", "17:00", "task"));
  const busy = timed("busy", "16:00", "17:00", "visit");
  busy.event.is_masked = true;
  const visit = timed("visit", "16:15", "16:45", "visit");
  const meeting = timed("meeting", "16:45", "17:00", "meeting");
  const later = timed("later", "17:30", "18:00", "task");
  const { cards, overflow } = layoutScheduleCalendarSegments(
    [busy, ...cadences, visit, meeting, later],
    "America/Sao_Paulo",
    2,
  );

  assert.deepEqual(cards.map(({ segment }) => segment.event.id), ["visit", "meeting", "later"]);
  assert.ok(cards.every(({ column, totalColumns }) => column === 0 && totalColumns === 1));
  assert.deepEqual(overflow, [{ startMinutes: 13 * 60, segments: [busy, ...cadences] }]);
});

test("retains a single overflow occurrence per event across the day, including midnight", () => {
  const dateKey = "2026-11-21";
  const at = (clock: string, end: string, group: string) => Array.from({ length: 5 }, (_, i) =>
    segment(`${group}-${i}`, `${dateKey}T${clock}:00Z`, end, dateKey),
  );
  const earlier = at("13:05", `${dateKey}T13:20:00Z`, "early");
  const later = at("13:25", `${dateKey}T13:40:00Z`, "later");
  const midnight = at("23:55", "2026-11-22T00:00:00Z", "midnight");
  const { cards, overflow } = layoutScheduleCalendarSegments([...earlier, ...later, ...midnight], "UTC", 4);

  assert.equal(cards.length, 9);
  assert.deepEqual(overflow.map(({ startMinutes, segments }) => [startMinutes, segments.length]), [
    [13 * 60 + 5, 4],
    [23 * 60 + 30, 2],
  ]);
  const allSegments = [...cards.map((card) => card.segment), ...overflow.flatMap((group) => group.segments)];
  assert.equal(allSegments.length, earlier.length + later.length + midnight.length);
  assert.deepEqual(new Set(allSegments), new Set([...earlier, ...later, ...midnight]));
});
