import assert from "node:assert/strict";
import test from "node:test";

import {
  getCalendarEventDensity,
  getCalendarEventWidthPercent,
  isCalendarEventNarrow,
} from "./calendar-event-density";

test("uses one readable line for events shorter than one hour", () => {
  assert.equal(getCalendarEventDensity(15), "compact");
  assert.equal(getCalendarEventDensity(30), "compact");
  assert.equal(getCalendarEventDensity(45), "compact");
  assert.equal(getCalendarEventDensity(59), "compact");
});

test("reveals event details progressively as vertical space increases", () => {
  assert.equal(getCalendarEventDensity(60), "standard");
  assert.equal(getCalendarEventDensity(89), "standard");
  assert.equal(getCalendarEventDensity(90), "detailed");
  assert.equal(getCalendarEventDensity(180), "detailed");
});

test("recognizes narrow overlap columns from their calendar width", () => {
  assert.equal(getCalendarEventWidthPercent("calc(50% - 4px)"), 50);
  assert.equal(getCalendarEventWidthPercent("calc(33.333% - 4px)"), 33.333);
  assert.equal(getCalendarEventWidthPercent("150px"), null);
  assert.equal(isCalendarEventNarrow("calc(50% - 4px)"), true);
  assert.equal(isCalendarEventNarrow("calc(100% - 4px)"), false);
});
