import assert from "node:assert/strict";
import test from "node:test";
import {
  getScheduleLifecycleLabel,
  getScheduleLifecycleState,
  getScheduleAllDayLastOccupiedInstant,
  getScheduleOutcomeLabel,
  getSimpleScheduleCompletionOutcome,
  isAttendanceScheduleType,
  isFinalScheduleStatus,
  scheduleStatusForOutcome,
  shouldPreserveAttendanceHistory,
} from "./schedule-outcome";

const allDayIntervals = [
  { zone: "America/Sao_Paulo", start: "2026-10-12T03:00:00Z", end: "2026-10-13T03:00:00Z" },
  { zone: "America/New_York", start: "2026-03-08T05:00:00Z", end: "2026-03-09T04:00:00Z" },
  { zone: "America/New_York", start: "2026-11-01T04:00:00Z", end: "2026-11-02T05:00:00Z" },
  { zone: "Pacific/Kiritimati", start: "2026-10-11T10:00:00Z", end: "2026-10-12T10:00:00Z" },
  { zone: "America/Sao_Paulo", start: "2026-10-10T03:00:00Z", end: "2026-10-13T03:00:00Z" },
];

for (const { zone, start, end } of allDayIntervals) {
  test(`all-day inclusive and exclusive ends agree across civil boundary ${zone} ${start}`, () => {
    const endInstant = Date.parse(end);
    const inclusiveEnd = new Date(endInstant - 1).toISOString();
    assert.equal(getScheduleAllDayLastOccupiedInstant(start, end, zone), endInstant - 1);
    assert.equal(getScheduleAllDayLastOccupiedInstant(start, inclusiveEnd, zone), endInstant - 1);
    for (const candidateEnd of [end, inclusiveEnd]) {
      const input = { startTime: start, endTime: candidateEnd, timeZone: zone, isAllDay: true };
      assert.equal(getScheduleLifecycleState({ ...input, now: endInstant - 1 }), "open");
      assert.equal(getScheduleLifecycleState({ ...input, now: endInstant }), "overdue");
    }
  });
}

test("all-day end normalization preserves fractional midnight, invalid and legacy zero intervals", () => {
  const start = "2026-10-12T03:00:00Z";
  const midnight = "2026-10-13T03:00:00Z";
  const fractional = "2026-10-13T03:00:00.001Z";
  assert.equal(getScheduleAllDayLastOccupiedInstant(start, fractional, "America/Sao_Paulo"), Date.parse(fractional));
  assert.equal(getScheduleAllDayLastOccupiedInstant(midnight, midnight, "America/Sao_Paulo"), Date.parse(midnight));
  assert.equal(getScheduleAllDayLastOccupiedInstant(null, midnight, "America/Sao_Paulo"), Date.parse(midnight));
  assert.equal(getScheduleAllDayLastOccupiedInstant(start, "invalid", "America/Sao_Paulo"), null);
  assert.equal(getScheduleAllDayLastOccupiedInstant(start, null, "America/Sao_Paulo"), null);
  assert.equal(getScheduleLifecycleState({ startTime: start, endTime: midnight, isAllDay: true, timeZone: "Invalid/Zone", now: Date.parse(midnight) }), "overdue");
});

test("limits attendance outcomes to visits and meetings", () => {
  assert.equal(isAttendanceScheduleType("visit"), true);
  assert.equal(isAttendanceScheduleType("meeting"), true);
  assert.equal(isAttendanceScheduleType("call"), false);
  assert.equal(isAttendanceScheduleType("task"), false);
  assert.equal(getSimpleScheduleCompletionOutcome("call"), "contacted");
  assert.equal(getSimpleScheduleCompletionOutcome("email"), "contacted");
  assert.equal(getSimpleScheduleCompletionOutcome("message"), "contacted");
  assert.equal(
    getSimpleScheduleCompletionOutcome("task"),
    "activity_completed",
  );
  assert.equal(getSimpleScheduleCompletionOutcome("visit"), null);
  assert.equal(getSimpleScheduleCompletionOutcome("meeting"), null);
});

test("keeps rescheduled appointments out of completed totals", () => {
  assert.equal(scheduleStatusForOutcome("visit_completed"), "completed");
  assert.equal(scheduleStatusForOutcome("meeting_completed"), "completed");
  assert.equal(scheduleStatusForOutcome("no_show"), "no_show");
  assert.equal(scheduleStatusForOutcome("cancelled"), "cancelled");
  assert.equal(scheduleStatusForOutcome("rescheduled"), "cancelled");
});

test("presents final states before evaluating overdue time", () => {
  const now = Date.parse("2026-09-12T15:00:00.000Z");
  const oldStart = "2026-09-10T15:00:00.000Z";

  assert.equal(
    getScheduleLifecycleState({
      status: "cancelled",
      outcome: "rescheduled",
      startTime: oldStart,
      endTime: "2026-09-10T16:00:00.000Z",
      now,
    }),
    "rescheduled",
  );
  assert.equal(
    getScheduleLifecycleState({
      status: "no_show",
      startTime: oldStart,
      endTime: "2026-09-10T16:00:00.000Z",
      now,
    }),
    "no_show",
  );
  assert.equal(
    getScheduleLifecycleState({
      status: "scheduled",
      startTime: oldStart,
      endTime: "2026-09-10T16:00:00.000Z",
      now,
    }),
    "overdue",
  );
  assert.equal(
    getScheduleLifecycleState({
      status: "scheduled",
      startTime: "2026-09-13T15:00:00.000Z",
      endTime: "2026-09-13T16:00:00.000Z",
      now,
    }),
    "open",
  );
  assert.equal(
    getScheduleLifecycleState({
      status: "scheduled",
      startTime: "2026-09-12T14:30:00.000Z",
      endTime: "2026-09-12T15:30:00.000Z",
      now,
    }),
    "open",
  );
});

test("uses concise CRM labels for no-show and lifecycle states", () => {
  assert.equal(getScheduleOutcomeLabel("no_show"), "No-show");
  assert.equal(getScheduleOutcomeLabel("rescheduled"), "Remarcado");
  assert.equal(getScheduleLifecycleLabel("overdue"), "Em atraso");
  assert.equal(getScheduleLifecycleLabel("no_show"), "No-show");
  assert.equal(isFinalScheduleStatus("completed"), true);
  assert.equal(isFinalScheduleStatus("no_show"), true);
  assert.equal(isFinalScheduleStatus("scheduled"), false);
  assert.equal(shouldPreserveAttendanceHistory("visit", "completed"), true);
  assert.equal(shouldPreserveAttendanceHistory("meeting", "no_show"), true);
  assert.equal(shouldPreserveAttendanceHistory("visit", "scheduled"), false);
  assert.equal(shouldPreserveAttendanceHistory("call", "completed"), false);
});

test("keeps all-day appointments open for their whole civil day", () => {
  const googleAllDayEnd = "2026-09-12T03:00:00.000Z";

  assert.equal(
    getScheduleLifecycleState({
      status: "scheduled",
      startTime: googleAllDayEnd,
      endTime: googleAllDayEnd,
      isAllDay: true,
      timeZone: "America/Sao_Paulo",
      now: Date.parse("2026-09-12T18:00:00.000Z"),
    }),
    "open",
  );
  assert.equal(
    getScheduleLifecycleState({
      status: "scheduled",
      startTime: googleAllDayEnd,
      endTime: googleAllDayEnd,
      isAllDay: true,
      timeZone: "America/Sao_Paulo",
      now: Date.parse("2026-09-13T03:00:00.000Z"),
    }),
    "overdue",
  );
  assert.equal(
    getScheduleLifecycleState({
      status: "scheduled",
      endTime: "2026-09-12T15:00:00.000Z",
      isAllDay: false,
      timeZone: "America/Sao_Paulo",
      now: Date.parse("2026-09-12T18:00:00.000Z"),
    }),
    "overdue",
  );
});
