import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getMarketingPeriodValidation } from './marketing-period'

test('Marketing accepts 366 inclusive civil days and rejects 367 without changing the selected range', () => {
  const from = new Date(2024, 0, 1)
  const to = new Date(2024, 11, 31)
  assert.equal(getMarketingPeriodValidation({ from, to }).message, null)
  const selected = { from, to: new Date(2025, 0, 1) }
  const times = [selected.from.getTime(), selected.to.getTime()]
  const invalid = getMarketingPeriodValidation(selected)
  assert.match(invalid.message ?? '', /366 dias/)
  assert.equal(invalid.error?.direction, 'input')
  assert.deepEqual([selected.from.getTime(), selected.to.getTime()], times)
  assert.equal(invalid.dateFrom, '2024-01-01')
  assert.equal(invalid.dateTo, '2025-01-01')
})

test('Marketing period validation handles reversed or invalid dates before a query', () => {
  assert.match(getMarketingPeriodValidation({ from: new Date(2026, 9, 2), to: new Date(2026, 9, 1) }).message ?? '', /posterior/)
  assert.match(getMarketingPeriodValidation({ from: new Date(Number.NaN), to: new Date(2026, 9, 1) }).message ?? '', /completo e válido/)
})
