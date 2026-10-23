import assert from "node:assert/strict";
import test from "node:test";

import {
  createDefaultAvailabilityWeek,
  isValidAvailabilityWeek,
  availabilityToWeek,
  availabilityTimeOptions,
  availabilityWeekReviewReason,
  toAvailabilityInput,
} from "./availability-week";

test("default availability keeps weekdays active", () => {
  const week = createDefaultAvailabilityWeek();
  assert.equal(isValidAvailabilityWeek(week), true);
  assert.deepEqual(
    week.filter((day) => day.is_active).map((day) => day.day_of_week),
    [1, 2, 3, 4, 5],
  );
});

test("availability rejects an entirely inactive week", () => {
  const week = createDefaultAvailabilityWeek().map((day) => ({
    ...day,
    is_active: false,
  }));
  assert.equal(isValidAvailabilityWeek(week), false);
});

test("availability allows overnight intervals but rejects equal clocks", () => {
  const overnight = createDefaultAvailabilityWeek();
  overnight[1] = { ...overnight[1], start_time: "22:00", end_time: "06:00" };
  assert.equal(isValidAvailabilityWeek(overnight), true);

  const equalClocks = createDefaultAvailabilityWeek();
  equalClocks[1] = {
    ...equalClocks[1],
    start_time: "08:00",
    end_time: "08:00",
  };
  assert.equal(isValidAvailabilityWeek(equalClocks), false);
});

test("saved seconds and non-half-hour minutes survive an unrelated team save", () => {
  const input = createDefaultAvailabilityWeek().map((day) => ({ ...day, start_time: "09:15:30", end_time: "18:45:45" }));
  const week = availabilityToWeek(input);
  assert.equal(availabilityWeekReviewReason(input), null);
  assert.equal(isValidAvailabilityWeek(week), true);
  assert.equal(week[1].start_time, "09:15:30");
  assert.equal(toAvailabilityInput(week)[1].start_time, "09:15:30");
  assert.equal(toAvailabilityInput(week)[1].end_time, "18:45:45");
  assert.ok(availabilityTimeOptions(week[1].start_time).includes("09:15:30"));
  assert.ok(availabilityTimeOptions("09:15").includes("09:15"));
  week[1].end_time = "19:00";
  assert.equal(toAvailabilityInput(week)[1].start_time, "09:15:30");
  assert.equal(toAvailabilityInput(week)[1].end_time, "19:00:00");
});

test("seconds distinguish a real window from equal clocks in different formats", () => {
  const week = createDefaultAvailabilityWeek();
  week[1] = { ...week[1], start_time: "08:00:01", end_time: "08:00:02" };
  assert.equal(isValidAvailabilityWeek(week), true);
  week[1] = { ...week[1], start_time: "08:00", end_time: "08:00:00" };
  assert.equal(isValidAvailabilityWeek(week), false);
});

test("complete legacy weeks with missing or invalid active clocks need repair and cannot invent 08-18", () => {
  for (const clock of [null, "99:17", "malformed"]) {
    const saved = createDefaultAvailabilityWeek().map((day) => ({ ...day, start_time: clock }));
    const week = availabilityToWeek(saved);
    assert.equal(availabilityWeekReviewReason(saved), "invalid");
    assert.equal(week[1].start_time, "");
    assert.equal(isValidAvailabilityWeek(week), false);
    assert.equal(toAvailabilityInput(week)[1].start_time, null);
  }
});

test("incomplete and inactive malformed legacy weeks remain flagged for explicit review", () => {
  const incomplete = createDefaultAvailabilityWeek().slice(1);
  assert.equal(availabilityWeekReviewReason(incomplete), "incomplete");
  const saved = createDefaultAvailabilityWeek();
  saved[0] = { ...saved[0], start_time: "99:17" };
  assert.equal(availabilityWeekReviewReason(saved), "invalid");
  assert.equal(availabilityToWeek(saved)[0].start_time, "");
});
