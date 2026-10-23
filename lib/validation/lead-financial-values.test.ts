import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { leadCreateInputSchema, leadUpdateInputSchema } from './leads'

const invalid = ['NaN', 'Infinity', '-Infinity', '-1', '-0.001', '-1e-999', '1e-999', '1e999',
  '0x10', '0b10', '1_000', '1,23', '1.234,56', '1e', '.', '--1', '\ufeff1', '1\ufeff', '1'.repeat(41)]
for (const value of invalid) {
  test(`create/update reject invalid interest value ${JSON.stringify(value)}`, () => {
    assert.equal(leadCreateInputSchema.safeParse({ name: 'Synthetic lead', interestValue: value }).success, false)
    assert.equal(leadUpdateInputSchema.safeParse({ interestValue: value }).success, false)
  })
  test(`update rejects invalid commission ${JSON.stringify(value)}`, () => {
    assert.equal(leadUpdateInputSchema.safeParse({ commissionPercentage: value }).success, false)
  })
}
for (const value of ['101', '100.0000000000000000001', '1.00000000000000000001e2', '1e20']) {
  test(`commission rejects exact value above 100: ${value}`, () => {
    assert.equal(leadUpdateInputSchema.safeParse({ commissionPercentage: value }).success, false)
  })
}
for (const [value, normalized] of [['0', '0'], ['-0', '0'], ['+0.000e999999999', '0'], ['1.5', '1.5'],
  ['+1.5e1', '+1.5e1'], ['.5', '.5'], ['1.', '1.'], [' 5 ', '5'], ['\u00855\u0085', '5']]) {
  test(`valid decimal preserves its exact wire form ${JSON.stringify(value)}`, () => {
    const created = leadCreateInputSchema.parse({ name: 'Synthetic lead', interestValue: value })
    assert.equal(created.interestValue, normalized)
    assert.equal(leadUpdateInputSchema.parse({ interestValue: value }).interestValue, normalized)
    assert.equal(leadUpdateInputSchema.parse({ commissionPercentage: value }).commissionPercentage, normalized)
  })
}
test('finite large interest has no arbitrary business ceiling; commission remains bounded', () => {
  assert.equal(leadCreateInputSchema.parse({ name: 'Synthetic lead', interestValue: '1e20' }).interestValue, '1e20')
  assert.equal(leadUpdateInputSchema.parse({ interestValue: '1e308' }).interestValue, '1e308')
  assert.equal(leadUpdateInputSchema.parse({ commissionPercentage: '100' }).commissionPercentage, '100')
})
test('blank create becomes null, blank update is refused, and null/omission/zero are distinct', () => {
  assert.equal(leadCreateInputSchema.parse({ name: 'Synthetic lead', interestValue: ' \u0085 ' }).interestValue, null)
  assert.equal(leadCreateInputSchema.parse({ name: 'Synthetic lead' }).interestValue, undefined)
  assert.equal(leadCreateInputSchema.parse({ name: 'Synthetic lead', interestValue: null }).interestValue, null)
  for (const key of ['interestValue', 'commissionPercentage']) {
    assert.equal(leadUpdateInputSchema.safeParse({ [key]: ' \u0085 ' }).success, false)
    assert.equal(leadUpdateInputSchema.parse({ [key]: null })[key as 'interestValue'], null)
    assert.equal(leadUpdateInputSchema.parse({ [key]: '0' })[key as 'interestValue'], '0')
  }
  assert.equal(leadUpdateInputSchema.parse({ name: 'Unrelated contact edit' }).interestValue, undefined)
})
test('frontend schemas match every shared Go financial vector without changing the input', () => {
  const fixture = JSON.parse(readFileSync('apps/api/internal/leads/testdata/lead_financial_cases.json', 'utf8')) as {
    version: number; cases: Array<{ name: string; field: 'interestValue' | 'commissionPercentage'; mode: 'create' | 'update'; input: string | null; valid: boolean; normalized?: string | null }>
  }
  assert.equal(fixture.version, 1)
  for (const vector of fixture.cases) {
    const input = { ...(vector.mode === 'create' ? { name: 'Synthetic lead' } : {}), [vector.field]: vector.input }
    const before = structuredClone(input)
    const result = (vector.mode === 'create' ? leadCreateInputSchema : leadUpdateInputSchema).safeParse(input)
    assert.equal(result.success, vector.valid, vector.name)
    if (result.success) {
      const data: { interestValue?: string | null; commissionPercentage?: string | null } = result.data
      assert.equal(data[vector.field], vector.normalized, vector.name)
    }
    assert.deepEqual(input, before, vector.name)
  }
})
