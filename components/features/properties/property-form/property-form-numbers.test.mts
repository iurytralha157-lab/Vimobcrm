import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCurrencyInput, parseDecimalInput, parseLocaleNumber, formatCurrencyEditable } from '@/components/features/properties/property-form/property-form-numbers';
import { initialFormData, buildPropertyMutationInput } from '@/components/features/properties/property-form/property-form-model';
import { propertyToFormData } from '@/components/features/properties/property-form/property-form-mapping';
import { propertyUpdateInputSchema } from '@/lib/validation/properties';

const options = { isEditing: true, canAssignProperty: true, canManagePropertyCatalogs: true };
test('canonical three-decimal values survive hydration, formatting and save without magnitude changes', () => {
  const form = propertyToFormData({ area_util: 82.125, area_total: 103.625, preco: 1000.125, tipo_de_negocio: 'Venda' } as Parameters<typeof propertyToFormData>[0]);
  const payload = buildPropertyMutationInput(form, options);
  assert.equal(payload.area_util, 82.125);
  assert.equal(payload.area_total, 103.625);
  assert.equal(payload.preco, 1000.125);
  assert.equal(formatCurrencyEditable(form.preco), '1.000,125');
  assert.equal(parseCurrencyInput(formatCurrencyEditable(form.preco)), '1000.125');
});
test('raw Brazilian monetary grouping remains separate from canonical dot-decimal fields', () => {
  assert.equal(parseCurrencyInput('R$ 1.234,56'), '1234.56');
  assert.equal(parseCurrencyInput('1.234'), '1234');
  assert.equal(parseLocaleNumber(parseCurrencyInput('1.234')), 1234);
  assert.equal(parseLocaleNumber('82.125'), 82.125);
  assert.equal(parseLocaleNumber(parseDecimalInput('82,125')), 82.125);
  assert.equal(parseLocaleNumber('1.234.567,89'), 1234567.89);
  assert.equal(parseCurrencyInput('1,234,567.89'), '1234567.89');
  assert.equal(parseLocaleNumber('1,234.56'), 1234.56);
});
test('invalid numeric strings reach Zod rather than silently clearing or rewriting an amount', () => {
  for (const value of ['abc', '1e6', '1,2,3', '12..5', '-100,50', '.', ',', '-']) {
    const form = { ...initialFormData, tipo_de_negocio: 'Venda', preco: parseCurrencyInput(value), area_util: parseDecimalInput(value) };
    const payload = buildPropertyMutationInput(form, options);
    const parsed = propertyUpdateInputSchema.safeParse({ preco: payload.preco, area_util: payload.area_util, expected_updated_at: '2026-10-12T12:00:00Z' });
    assert.equal(parsed.success, false, value);
    assert.notEqual(payload.preco, null, value);
    assert.notEqual(payload.area_util, null, value);
  }
  assert.equal(parseLocaleNumber(''), null);
  assert.equal(parseLocaleNumber('0'), 0);
});
