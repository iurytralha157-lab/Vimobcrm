import assert from "node:assert/strict";
import test from "node:test";

import {
  createDefaultAvailabilityWeek,
  isValidAvailabilityWeek,
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

test("availability rejects overnight intervals and equal clocks", () => {
  const overnight = createDefaultAvailabilityWeek();
  overnight[1] = { ...overnight[1], start_time: "22:00", end_time: "06:00" };
  assert.equal(isValidAvailabilityWeek(overnight), false);

  const equalClocks = createDefaultAvailabilityWeek();
  equalClocks[1] = {
    ...equalClocks[1],
    start_time: "08:00",
    end_time: "08:00",
  };
  assert.equal(isValidAvailabilityWeek(equalClocks), false);
});
