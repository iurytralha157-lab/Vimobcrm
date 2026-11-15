import assert from "node:assert/strict";
import test from "node:test";

import { formatCurrency, formatDate, prepareFinancialEntriesExport } from "./export-financial";

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

test("financial exports expose nominal and open balance without counting mirrored payments twice", () => {
  const [row] = prepareFinancialEntriesExport([{ amount: 100, paid_amount: 25, paid_value: 25, status: 'partial' }]);
  assert.equal(row.Valor, formatCurrency(100));
  assert.equal(row['Saldo aberto'], formatCurrency(75));
  assert.equal(row['Valor Pago'], formatCurrency(25));
  assert.equal(row.Status, 'Parcialmente pago');
  const [legacy] = prepareFinancialEntriesExport([{ amount: 100, paid_amount: 25, paid_value: 0, status: 'partial' }]);
  assert.equal(legacy['Saldo aberto'], formatCurrency(75));
  const [paid] = prepareFinancialEntriesExport([{ amount: 100, status: 'paid' }]);
  assert.equal(paid['Saldo aberto'], formatCurrency(0));
  assert.equal(paid['Valor Pago'], formatCurrency(100));
});
