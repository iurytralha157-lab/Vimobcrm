import assert from "node:assert/strict";
import test from "node:test";
import { isAvailableAtClock } from "./availability-clock";

test("current availability honors saved seconds at both boundaries", () => {
  const week = [{ day_of_week: 1, is_active: true, is_all_day: false, start_time: "09:15:30", end_time: "18:45:45" }];
  assert.equal(isAvailableAtClock(week, 1, 9 * 3600 + 15 * 60 + 29), false);
  assert.equal(isAvailableAtClock(week, 1, 9 * 3600 + 15 * 60 + 30), true);
  assert.equal(isAvailableAtClock(week, 1, 18 * 3600 + 45 * 60 + 45), true);
  assert.equal(isAvailableAtClock(week, 1, 18 * 3600 + 45 * 60 + 46), false);
});

test("overnight seconds roll into the next day and malformed clocks cannot invent a shift", () => {
  const week = [{ day_of_week: 1, is_active: true, start_time: "22:15:30", end_time: "06:15:45" }];
  assert.equal(isAvailableAtClock(week, 2, 6 * 3600 + 15 * 60 + 45), true);
  assert.equal(isAvailableAtClock(week, 2, 6 * 3600 + 15 * 60 + 46), false);
  assert.equal(isAvailableAtClock([{ ...week[0], start_time: "invalid" }], 1, 23 * 3600), false);
  assert.equal(isAvailableAtClock([], 1, 0), true);
});
