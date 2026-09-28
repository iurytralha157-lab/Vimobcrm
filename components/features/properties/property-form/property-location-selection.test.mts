import assert from 'node:assert/strict'
import test from 'node:test'

import type { PropertyFormData } from './property-form-model'

const locationSelectionPath = './property-location-selection.ts'
const { selectLocationCity, selectLocationNeighborhood, setManualLocationField } = await import(locationSelectionPath)

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
