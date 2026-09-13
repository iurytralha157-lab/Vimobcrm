import assert from "node:assert/strict";
import test from "node:test";
import {
  getScheduleLifecycleLabel,
  getScheduleLifecycleState,
  getScheduleOutcomeLabel,
  getSimpleScheduleCompletionOutcome,
  isAttendanceScheduleType,
  isFinalScheduleStatus,
  scheduleStatusForOutcome,
  shouldPreserveAttendanceHistory,
} from "./schedule-outcome";

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
