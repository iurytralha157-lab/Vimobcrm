import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildLeadSourceOptions,
  DEFAULT_LEAD_SOURCE_OPTIONS,
  resolveLeadSourceInput,
} from './lead-source-options'

test('mantem as origens padrao sem valores ou rotulos duplicados', () => {
  assert.equal(
    new Set(DEFAULT_LEAD_SOURCE_OPTIONS.map((option) => option.value)).size,
    DEFAULT_LEAD_SOURCE_OPTIONS.length,
  )
  assert.equal(
    new Set(DEFAULT_LEAD_SOURCE_OPTIONS.map((option) => option.label)).size,
    DEFAULT_LEAD_SOURCE_OPTIONS.length,
  )
})

test('normaliza uma nova origem personalizada sem trocar seu nome comercial', () => {
  assert.deepEqual(resolveLeadSourceInput('  Feirão   de   Setembro  '), {
    success: true,
    value: 'Feirão de Setembro',
    label: 'Feirão de Setembro',
    isCustom: true,
  })
})

test('reutiliza a chave canonica quando o nome corresponde a uma origem padrao', () => {
  assert.deepEqual(resolveLeadSourceInput('  MÉTA   ADS '), {
    success: true,
    value: 'meta',
    label: 'Meta Ads',
    isCustom: false,
  })
  assert.deepEqual(resolveLeadSourceInput('indicação'), {
    success: true,
    value: 'indicacao',
    label: 'Indicação',
    isCustom: false,
  })
})

test('rejeita nomes vazios, reservados, longos ou com caracteres de controle', () => {
  for (const value of ['', '   ', 'all', 'custom', '__none__', '__create_lead_source__']) {
    assert.equal(resolveLeadSourceInput(value).success, false)
  }
  assert.equal(resolveLeadSourceInput('x'.repeat(81)).success, false)
  assert.equal(resolveLeadSourceInput('Origem\nquebrada').success, false)
})

test('preserva origem personalizada ao editar um lead antigo', () => {
  const options = buildLeadSourceOptions('Evento Regional')
  assert.deepEqual(options.at(-1), {
    value: 'Evento Regional',
    label: 'Evento Regional',
  })
})
