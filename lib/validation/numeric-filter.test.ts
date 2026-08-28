import assert from 'node:assert/strict'
import test from 'node:test'

import { parseNumericFilter } from './numeric-filter'

test('parseNumericFilter accepts plain and localized monetary values', () => {
  const cases: Array<[string, number]> = [
    ['500000', 500000],
    ['500.000', 500000],
    ['500.000,00', 500000],
    ['R$ 500.000,00', 500000],
    ['1.234.567,89', 1234567.89],
    ['1,234,567.89', 1234567.89],
    ['12,50', 12.5],
    ['12.50', 12.5],
    ['0', 0],
  ]

  for (const [input, expected] of cases) {
    assert.equal(parseNumericFilter(input), expected, input)
  }
})

test('parseNumericFilter rejects malformed, negative, and exponential inputs', () => {
  for (const input of ['', 'R$', '-1', '1e3', '1.23.45', 'abc500']) {
    assert.equal(parseNumericFilter(input), undefined, input)
  }
})
