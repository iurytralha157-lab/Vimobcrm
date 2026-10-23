import assert from 'node:assert/strict'
import test from 'node:test'

import type { PropertyFormData } from './property-form-model'

const locationSelectionPath = './property-location-selection.ts'
const { selectLocationCity, selectLocationNeighborhood, selectLocationCondominium, setManualLocationField } = await import(locationSelectionPath)

function location(overrides: Partial<PropertyFormData> = {}): PropertyFormData {
  return {
    cep: '27935-320', endereco: 'Rua Curitiba', uf: 'RJ', cidade: 'Macaé', city_id: 'city-macae',
    bairro: 'Riviera Fluminense', neighborhood_id: 'bairro-riviera',
    condominium_id: 'condo-riviera', ...overrides,
  } as PropertyFormData
}

test('trocar cidade limpa bairro, CEP e IDs antigos antes de publicar', () => {
  assert.deepEqual(
    (({ cep, uf, cidade, bairro, city_id, neighborhood_id, condominium_id }) =>
      ({ cep, uf, cidade, bairro, city_id, neighborhood_id, condominium_id }))(
      selectLocationCity(location(), { id: 'city-rio', name: 'Rio de Janeiro', uf: 'RJ' }),
    ),
    { cep: '', uf: 'RJ', cidade: 'Rio de Janeiro', bairro: '', city_id: 'city-rio', neighborhood_id: '', condominium_id: '' },
  )
})

test('catalogar a mesma cidade ou bairro não descarta o CEP válido', () => {
  const manual = location({ city_id: '', neighborhood_id: '', condominium_id: '' })
  const selectedCity = selectLocationCity(manual, { id: 'city-macae', name: 'Macaé', uf: 'RJ' })
  assert.equal(selectedCity.cep, '27935-320')
  assert.equal(selectedCity.bairro, 'Riviera Fluminense')
  const selectedNeighborhood = selectLocationNeighborhood(manual, {
    id: 'bairro-riviera', name: 'Riviera Fluminense',
    city: { id: 'city-macae', name: 'Macaé', uf: 'RJ' },
  })
  assert.equal(selectedNeighborhood.cep, '27935-320')
})

test('trocar CEP ou digitar outra cidade elimina localização previamente selecionada', () => {
  const changedCep = setManualLocationField(location(), 'cep', '01001-000')
  assert.equal(changedCep.endereco, '')
  assert.equal(changedCep.cidade, '')
  assert.equal(changedCep.bairro, '')
  assert.equal(changedCep.neighborhood_id, '')
  const changedCity = setManualLocationField(location(), 'cidade', 'Niterói')
  assert.equal(changedCity.cep, '')
  assert.equal(changedCity.endereco, '')
  assert.equal(changedCity.bairro, '')
  assert.equal(changedCity.city_id, '')
})

test('editar bairro manualmente remove vínculo anterior do catálogo', () => {
  const changed = setManualLocationField(location(), 'bairro', 'Maringá')
  assert.equal(changed.bairro, 'Maringá')
  assert.equal(changed.neighborhood_id, '')
  assert.equal(changed.condominium_id, '')
})

test('condomínio da mesma cidade preserva endereço do CEP com IDs ausentes ou diferentes', () => {
  for (const city_id of ['', 'derived-city']) {
    const previous = location({ city_id })
    const result = selectLocationCondominium(previous, {
      id: 'new-condo', city: { id: 'catalog-city', name: '  MACAE ', uf: 'rj' },
      address: null, cep: null,
    })
    assert.equal(result.city_id, 'catalog-city')
    assert.equal(result.condominium_id, 'new-condo')
    assert.equal(result.cep, previous.cep)
    assert.equal(result.endereco, previous.endereco)
    assert.equal(result.bairro, previous.bairro)
  }
})

test('condomínio de outra cidade ou UF limpa endereço antigo sem endereço próprio', () => {
  for (const city of [{ id: 'other-city', name: 'Niterói', uf: 'RJ' }, { id: 'other-state', name: 'Macaé', uf: 'SP' }]) {
    const result = selectLocationCondominium(location(), { id: 'other-condo', city })
    assert.equal(result.cep, '')
    assert.equal(result.endereco, '')
    assert.equal(result.bairro, '')
    assert.equal(result.neighborhood_id, '')
  }
})

test('endereço explícito do condomínio substitui os dados anteriores e desmarcar preserva localização', () => {
  const selected = selectLocationCondominium(location(), {
    id: 'new-condo', city: { id: 'city-rio', name: 'Rio de Janeiro', uf: 'RJ' },
    neighborhood: { id: 'new-neighborhood', name: 'Centro' },
    address: 'Rua do condomínio', cep: '20040002', default_condominium_fee: 800.5,
  })
  assert.equal(selected.cep, '20040-002')
  assert.equal(selected.endereco, 'Rua do condomínio')
  assert.equal(selected.condominio, '800,5')
  assert.deepEqual(selectLocationCondominium(selected, null), { ...selected, condominium_id: '' })
})
