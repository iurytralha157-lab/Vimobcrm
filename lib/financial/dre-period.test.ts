import assert from 'node:assert/strict'
import test from 'node:test'
import { format } from 'date-fns'
import { previousDREPeriod } from './dre-period'

test('previous month includes its last days even when the selected month is shorter', () => {
  const period = previousDREPeriod(new Date(2026, 1, 1), new Date(2026, 1, 28, 23, 59, 59))
  assert.equal(format(period.start, 'yyyy-MM-dd'), '2026-01-01')
  assert.equal(format(period.end, 'yyyy-MM-dd'), '2026-01-31')
})
test('quarter and year comparisons use whole civil periods, including leap-year February', () => {
  for (const [start, end, expectedStart, expectedEnd] of [
    [new Date(2026, 3, 1), new Date(2026, 5, 30), '2026-01-01', '2026-03-31'],
    [new Date(2025, 0, 1), new Date(2025, 11, 31), '2024-01-01', '2024-12-31'],
    [new Date(2024, 2, 1), new Date(2024, 2, 31), '2024-02-01', '2024-02-29'],
  ] as const) {
    const period = previousDREPeriod(start, end)
    assert.equal(format(period.start, 'yyyy-MM-dd'), expectedStart)
    assert.equal(format(period.end, 'yyyy-MM-dd'), expectedEnd)
  }
})
