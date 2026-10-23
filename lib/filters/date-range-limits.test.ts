import assert from "node:assert/strict";
import test from "node:test";
import { MAX_SHARED_REPORT_RANGE_DAYS, validateDateRangeLimit } from "./date-range-limits";

test("all-time ranges remain unrestricted and exactly 1830 elapsed days are accepted", () => {
  assert.equal(validateDateRangeLimit(null, MAX_SHARED_REPORT_RANGE_DAYS), null);
  assert.equal(validateDateRangeLimit(undefined, MAX_SHARED_REPORT_RANGE_DAYS), null);
  const from = new Date("2020-01-01T03:00:00.000Z");
  const to = new Date(from.getTime() + MAX_SHARED_REPORT_RANGE_DAYS * 86_400_000);
  assert.equal(validateDateRangeLimit({ from, to }, MAX_SHARED_REPORT_RANGE_DAYS), null);
  assert.match(validateDateRangeLimit({ from, to: new Date(to.getTime() + 1) }, MAX_SHARED_REPORT_RANGE_DAYS)!, /até cinco anos/);
});

test("bounds compare elapsed time including offset changes without mutating dates", () => {
  const range = { from: new Date("2026-03-07T00:00:00-05:00"), to: new Date("2026-03-08T23:59:59-04:00") };
  const original = { from: range.from.toISOString(), to: range.to.toISOString() };
  assert.equal(validateDateRangeLimit(range, 2), null);
  assert.match(validateDateRangeLimit(range, 1)!, /até 1 dia/);
  assert.deepEqual({ from: range.from.toISOString(), to: range.to.toISOString() }, original);
});

test("invalid dates, reversed ranges and invalid configured bounds fail closed", () => {
  const day = new Date("2026-10-12T00:00:00Z");
  assert.match(validateDateRangeLimit({ from: new Date("invalid"), to: day }, 1830)!, /válido/);
  assert.match(validateDateRangeLimit({ from: day, to: new Date(day.getTime() - 1) }, 1830)!, /data final/);
  assert.match(validateDateRangeLimit({ from: day, to: day }, 1830)!, /data final/);
  assert.equal(validateDateRangeLimit({ from: day, to: new Date(day.getTime() + 86_400_000 - 1) }, 1830), null);
  for (const limit of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.match(validateDateRangeLimit({ from: day, to: day }, limit)!, /limite/);
  }
});
