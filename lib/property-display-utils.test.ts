import assert from 'node:assert/strict'
import test from 'node:test'

import {
  formatPropertyBoolean,
  formatPropertyArea,
  formatPropertyCurrency,
  formatPropertyDate,
  getNullablePropertyMetadataString,
  getPropertyMetadataString,
  getDisplayPropertyType,
} from './property-display-utils'

test('keeps the property type presentation mapping', () => {
  assert.equal(getDisplayPropertyType('Sobrado'), 'Casa')
  assert.equal(getDisplayPropertyType('Galpão'), 'Galpão')
  assert.equal(getDisplayPropertyType(null), '')
})

test('formats property currency while preserving each missing-value label', () => {
  assert.match(formatPropertyCurrency(1234.5), /1\.234,50/)
  assert.equal(formatPropertyCurrency(null), 'Não informado')
  assert.equal(
    formatPropertyCurrency(undefined, 'BRL', 'Valor não informado'),
    'Valor não informado',
  )
})

test('formats property area while preserving its unit and missing-value label', () => {
  assert.equal(formatPropertyArea(1234.5), '1.234,5 m²')
  assert.equal(formatPropertyArea(0), '0 m²')
  assert.equal(formatPropertyArea(null), 'Não informado')
})

test('formats valid dates and booleans without inventing missing values', () => {
  assert.equal(formatPropertyDate(null), 'Não informado')
  assert.equal(formatPropertyDate(null, true, 'Ainda não processado'), 'Ainda não processado')
  assert.equal(formatPropertyDate('data-inválida'), 'data-inválida')
  assert.notEqual(formatPropertyDate('2026-09-06'), '2026-09-06')
  assert.equal(formatPropertyBoolean(true), 'Sim')
  assert.equal(formatPropertyBoolean(false), 'Não')
  assert.equal(formatPropertyBoolean(null), 'Não informado')
})

test('preserves the two explicit property metadata fallback policies', () => {
  assert.equal(getPropertyMetadataString('  texto  '), '  texto  ')
  assert.equal(getPropertyMetadataString(42), '')
  assert.equal(getNullablePropertyMetadataString('texto'), 'texto')
  assert.equal(getNullablePropertyMetadataString(42), null)
})
