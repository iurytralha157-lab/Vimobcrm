import assert from 'node:assert/strict'
import test from 'node:test'
import { propertyDevelopmentPriceTableActivateInputSchema } from '@/lib/validation/property-developments'

test('price activation requires a nonempty valid revision and rejects omitted/null values', () => {
  for (const input of [{}, { expected_updated_at: null }, { expected_updated_at: '' }, { expected_updated_at: ' ' }, { expected_updated_at: 'invalid' }]) {
    assert.equal(propertyDevelopmentPriceTableActivateInputSchema.safeParse(input).success, false)
  }
  const expected_updated_at = '2026-10-13T12:00:00.123456Z'
  assert.deepEqual(propertyDevelopmentPriceTableActivateInputSchema.parse({ expected_updated_at }), { expected_updated_at })
})
