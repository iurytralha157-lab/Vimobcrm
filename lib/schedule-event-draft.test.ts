import assert from "node:assert/strict";
import test from "node:test";
import {
  buildScheduleAllDayInterval,
  buildScheduleEventInterval,
  buildScheduleMovedEventInterval,
  getScheduleAllDaySpan,
} from "./schedule-event-draft";
import { getStoredDurationMinutes } from "../components/features/schedule/event-sheet/model";
import {
  getScheduleDisplayLifecycle,
  getScheduleDisplayLifecycleLabel,
  getScheduleDisplayTitle,
  matchesScheduleEventType,
} from "../components/features/schedule/schedule-event-presentation";

test("moving a timed event keeps every stored millisecond, including sub-minute intervals", () => {
  for (const delta of [1, 20_000, 5_422_000, 3_633_333, 43 * 3_600_000 + 1, 86_399_999, 172_799_999]) {
    const start = new Date("2026-10-12T12:00:17.000Z");
    const durationMinutes = getStoredDurationMinutes({ start, end: new Date(start.getTime() + delta), eventType: "task" });
    const moved = buildScheduleEventInterval({ date: new Date(2026, 9, 13), time: "10:00", isAllDay: false, durationMinutes, timeZone: "America/Sao_Paulo" });
    assert.ok(moved);
    assert.equal(moved.startTime, "2026-10-13T13:00:00.000Z");
    assert.equal(Date.parse(moved.endTime) - Date.parse(moved.startTime), delta);
  }
});

test("fallback duration is used only when the stored interval is absent or invalid", () => {
  const start = new Date("2026-10-12T12:00:00Z");
  assert.equal(getStoredDurationMinutes({ start, end: null, eventType: "task" }), 30);
  assert.equal(getStoredDurationMinutes({ start, end: new Date(Number.NaN), eventType: "visit" }), 60);
  assert.equal(getStoredDurationMinutes({ start, end: start, eventType: "call" }), 30);
  assert.equal(getStoredDurationMinutes({ start, end: new Date(start.getTime() + 20_000), eventType: "task" }), 1 / 3);
});

test("all-day spans keep both exclusive-midnight and inclusive-end conventions", () => {
  const cases = [
    { end: "2026-10-15T03:00:00.000Z", endExclusive: true, movedEnd: "2026-10-16T03:00:00.000Z" },
    { end: "2026-10-15T02:59:59.999Z", endExclusive: false, movedEnd: "2026-10-16T02:59:59.999Z" },
  ];
  for (const entry of cases) {
    const span = getScheduleAllDaySpan("2026-10-12T03:00:00Z", entry.end, "America/Sao_Paulo");
    assert.deepEqual(span, { dayCount: 3, endExclusive: entry.endExclusive });
    assert.deepEqual(buildScheduleAllDayInterval("2026-10-13", "America/Sao_Paulo", span), { startTime: "2026-10-13T03:00:00.000Z", endTime: entry.movedEnd });
    assert.deepEqual(buildScheduleEventInterval({ date: new Date(2026, 9, 13), time: "00:00", isAllDay: true, durationMinutes: 4320, timeZone: "America/Sao_Paulo", allDaySpan: span }), { startTime: "2026-10-13T03:00:00.000Z", endTime: entry.movedEnd });
  }
});

test("three civil days remain three days when moved across spring and autumn DST", () => {
  const span = getScheduleAllDaySpan("2026-03-07T05:00:00Z", "2026-03-10T04:00:00Z", "America/New_York");
  assert.deepEqual(span, { dayCount: 3, endExclusive: true });
  const spring = buildScheduleAllDayInterval("2026-03-07", "America/New_York", span);
  const autumn = buildScheduleAllDayInterval("2026-10-31", "America/New_York", span);
  assert.deepEqual(spring, { startTime: "2026-03-07T05:00:00.000Z", endTime: "2026-03-10T04:00:00.000Z" });
  assert.deepEqual(autumn, { startTime: "2026-10-31T04:00:00.000Z", endTime: "2026-11-03T05:00:00.000Z" });
  assert.equal(Date.parse(spring!.endTime) - Date.parse(spring!.startTime), 71 * 3_600_000);
  assert.equal(Date.parse(autumn!.endTime) - Date.parse(autumn!.startTime), 73 * 3_600_000);
});

test("a single all-day event on a 23-hour day does not become a two-day event after moving", () => {
  const span = getScheduleAllDaySpan("2026-03-08T05:00:00Z", "2026-03-09T03:59:59.999Z", "America/New_York");
  assert.deepEqual(span, { dayCount: 1, endExclusive: false });
  assert.deepEqual(buildScheduleAllDayInterval("2026-03-12", "America/New_York", span), { startTime: "2026-03-12T04:00:00.000Z", endTime: "2026-03-13T03:59:59.999Z" });
});

test("all-day drag ignores a DST-gap clock while timed drag rejects that clock", () => {
  const input = { startTime: "2026-03-07T05:00:00.000Z", endTime: "2026-03-10T04:00:00.000Z", civilDate: "2026-03-08", time: "02:00", timeZone: "America/New_York" };
  assert.deepEqual(buildScheduleMovedEventInterval({ ...input, isAllDay: true }), { startTime: "2026-03-08T05:00:00.000Z", endTime: "2026-03-11T04:00:00.000Z" });
  assert.equal(buildScheduleMovedEventInterval({ ...input, isAllDay: false }), null);
  const timed = buildScheduleMovedEventInterval({ ...input, startTime: "2026-03-07T12:00:17.123Z", endTime: "2026-03-07T12:00:37.456Z", time: "03:00", isAllDay: false });
  assert.ok(timed);
  assert.equal(Date.parse(timed.endTime) - Date.parse(timed.startTime), 20_333);
});

test("new all-day events preserve the existing one-day inclusive convention and reject invalid spans", () => {
  assert.deepEqual(buildScheduleAllDayInterval("2026-10-12", "Asia/Tokyo"), { startTime: "2026-10-11T15:00:00.000Z", endTime: "2026-10-12T14:59:59.999Z" });
  assert.equal(buildScheduleAllDayInterval("invalid", "Asia/Tokyo"), null);
  for (const dayCount of [0, -1, 1.5, Number.NaN]) assert.equal(buildScheduleAllDayInterval("2026-10-12", "Asia/Tokyo", { dayCount, endExclusive: false }), null);
});

test("busy intervals never claim a type or lifecycle, even before or after their scheduled end", () => {
  const busy = { is_masked: true, title: "private title", event_type: null, status: null, outcome: null, start_time: "2026-10-12T10:00:00Z", end_time: "2026-10-12T11:00:00Z", is_all_day: false };
  for (const now of [Date.parse("2026-10-12T09:00:00Z"), Date.parse("2026-10-12T13:00:00Z")]) {
    const lifecycle = getScheduleDisplayLifecycle(busy, "America/Sao_Paulo", now);
    assert.equal(lifecycle, "busy");
    assert.equal(getScheduleDisplayLifecycleLabel(lifecycle), "Horário ocupado");
    assert.equal(getScheduleDisplayTitle(busy), "Horário ocupado");
    assert.equal(matchesScheduleEventType(busy, "task"), true);
    assert.equal(matchesScheduleEventType(busy, "visit"), true);
  }
  assert.equal(matchesScheduleEventType({ ...busy, is_masked: false, event_type: "task" }, "visit"), false);
});
