import assert from 'node:assert/strict'
import test from 'node:test'
import { getPropertyNumericFilterErrors, propertyNumericFilterValue, getPropertyCatalogLocationId } from './property-filter-input'
import { propertyListQuerySchema } from './properties'

test('a populated malformed bound cannot silently become an absent filter', () => {
  assert.equal(propertyNumericFilterValue('  '), undefined)
  for (const input of ['-1', 'abc500', '1e3', '1.23.45']) {
    const value = propertyNumericFilterValue(input)
    assert.notEqual(value, undefined)
    assert.equal(propertyListQuerySchema.safeParse({ valor_min: value }).success, false)
    assert.ok(getPropertyNumericFilterErrors({ valor_min: input }).valor_min)
  }
  assert.equal(propertyNumericFilterValue('R$ 500.000,00'), 500000)
})

test('zero bounds and reversed areas have feedback without clearing the populated field', () => {
  assert.equal(propertyNumericFilterValue('0'), 0)
  assert.deepEqual(getPropertyNumericFilterErrors({ valor_min: '0', valor_max: '0' }), {})
  assert.ok(getPropertyNumericFilterErrors({ area_util_min: '20', area_util_max: '10' }).area_util_min)
  assert.ok(getPropertyNumericFilterErrors({ valor_min: '20', valor_max: '0' }).valor_min)
})

test('synthetic legacy locations never become UUID query filters, including old unmarked responses', () => {
  const id='11111111-1111-4111-8111-111111111111'
  assert.equal(getPropertyCatalogLocationId({id}),id)
  assert.equal(getPropertyCatalogLocationId({id,catalog_source:'property'}),undefined)
  assert.equal(getPropertyCatalogLocationId({id:'legacy-city:Santa Maria'}),undefined)
  assert.equal(getPropertyCatalogLocationId(null),undefined)
})
