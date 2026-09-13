import assert from 'node:assert/strict'
import test from 'node:test'

import {
  formatBRLCurrencyWithDefaultDecimals,
  formatBRLCurrencyWithMinimumTwoDecimals,
  formatCompactBRLCurrency,
  formatFixedBRLCurrency,
  formatLocalizedBRLCurrency,
  formatPtBRNumber,
  formatUnspacedBRLCurrency,
  formatWholePtBRCurrency,
} from './formatting'

test('formata números pt-BR sem impor fallback ou casas decimais', () => {
  assert.equal(formatPtBRNumber(1_234_567.89), '1.234.567,89')
  assert.equal(formatPtBRNumber(0), '0')
})

test('mantém o perfil BRL textual com espaço normal e duas casas fixas', () => {
  assert.equal(formatFixedBRLCurrency(1_234.5), 'R$ 1.234,50')
  assert.equal(formatFixedBRLCurrency(0), 'R$ 0,00')
  assert.equal(formatFixedBRLCurrency(-12.345), 'R$ -12,35')
})

test('mantém o perfil monetário Intl com espaço não separável e duas casas', () => {
  assert.equal(formatLocalizedBRLCurrency(1_234.5), 'R$\u00a01.234,50')
  assert.equal(formatLocalizedBRLCurrency(0), 'R$\u00a00,00')
  assert.equal(formatLocalizedBRLCurrency(-12.345), '-R$\u00a012,35')
})

test('mantém o perfil monetário Intl inteiro e aceita moeda explícita', () => {
  assert.equal(formatWholePtBRCurrency(1_234.5), 'R$\u00a01.235')
  assert.equal(formatWholePtBRCurrency(1_234.5, 'USD'), 'US$\u00a01.235')
})

test('mantém o perfil BRL textual com a precisão padrão do locale', () => {
  assert.equal(formatBRLCurrencyWithDefaultDecimals(1_234.5), 'R$ 1.234,5')
  assert.equal(formatBRLCurrencyWithDefaultDecimals(1_000), 'R$ 1.000')
})

test('mantém o perfil BRL textual com no mínimo duas casas', () => {
  assert.equal(formatBRLCurrencyWithMinimumTwoDecimals(1_234), 'R$ 1.234,00')
  assert.equal(formatBRLCurrencyWithMinimumTwoDecimals(1_234.5), 'R$ 1.234,50')
  assert.equal(formatBRLCurrencyWithMinimumTwoDecimals(1_234.5678), 'R$ 1.234,568')
})

test('mantém o perfil BRL textual sem espaço', () => {
  assert.equal(formatUnspacedBRLCurrency(1_234.5), 'R$1.234,5')
  assert.equal(formatUnspacedBRLCurrency(0), 'R$0')
})

test('compacta somente milhares e milhões positivos com os sufixos existentes', () => {
  assert.equal(formatCompactBRLCurrency(999), 'R$999')
  assert.equal(formatCompactBRLCurrency(1_500), 'R$1,5K')
  assert.equal(formatCompactBRLCurrency(2_000_000), 'R$2M')
  assert.equal(formatCompactBRLCurrency(1_250_000), 'R$1,3M')
  assert.equal(formatCompactBRLCurrency(-1_500), 'R$-1.500')
})
