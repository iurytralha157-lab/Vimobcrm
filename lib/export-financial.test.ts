import assert from "node:assert/strict";
import test from "node:test";

import { formatCurrency, formatDate } from "./export-financial";

test("formatDate preserves a civil date without shifting it to the previous day", () => {
  assert.equal(formatDate("2026-08-16"), "16/08/2026");
});

test("formatDate fails closed for malformed dates", () => {
  assert.equal(formatDate("not-a-date"), "-");
  assert.equal(formatDate(undefined), "-");
});

test("formatCurrency never renders NaN or Infinity", () => {
  assert.equal(formatCurrency(Number.NaN), "R$ 0,00");
  assert.equal(formatCurrency(Number.POSITIVE_INFINITY), "R$ 0,00");
});
