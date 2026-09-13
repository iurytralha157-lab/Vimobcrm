import assert from 'node:assert/strict'
import test from 'node:test'

import {
  EMPTY_CITY_FORM,
  EMPTY_CONDOMINIUM_FORM,
  EMPTY_NEIGHBORHOOD_FORM,
  buildCondominiumPayload,
  buildCondominiumUpdatePayload,
  catalogLocationIdForMutation,
  catalogLocationsOnly,
  cityFormFromCity,
  condominiumFormFromCondominium,
  createCityAssignment,
  createNeighborhoodAssignment,
  createOwnerAssignment,
  getOwnerContact,
  getOwnerPropertyCount,
  neighborhoodFormFromNeighborhood,
  ownerFormFromOwner,
  parseCurrencyInput,
  propertyAssignmentInvalidationKeys,
  propertyLocationsHref,
  summarizePropertyAssignmentResults,
  type CatalogLocation,
} from './model'

test('hidrata os formulários de edição de cidade, bairro e condomínio', () => {
  assert.deepEqual(cityFormFromCity({ name: 'São Paulo', uf: 'SP' }), {
    name: 'São Paulo',
    uf: 'SP',
  })
  assert.deepEqual(cityFormFromCity(), EMPTY_CITY_FORM)

  assert.deepEqual(
    neighborhoodFormFromNeighborhood({ name: 'Centro', city_id: 'city-1' }),
    { name: 'Centro', city_id: 'city-1' },
  )
  assert.deepEqual(neighborhoodFormFromNeighborhood(), EMPTY_NEIGHBORHOOD_FORM)

  assert.deepEqual(
    condominiumFormFromCondominium({
      name: 'Residencial Flores',
      city_id: 'city-1',
      neighborhood_id: 'neighborhood-1',
      address: 'Rua Um',
      photo_url: 'https://example.com/condominio.jpg',
      cep: '01000-000',
      number: '10',
      complement: 'Bloco A',
      default_condominium_fee: 850.5,
      has_concierge: true,
      concierge_type: '24h',
      notes: 'Entrada lateral',
    }),
    {
      name: 'Residencial Flores',
      city_id: 'city-1',
      neighborhood_id: 'neighborhood-1',
      address: 'Rua Um',
      photo_url: 'https://example.com/condominio.jpg',
      cep: '01000-000',
      number: '10',
      complement: 'Bloco A',
      default_condominium_fee: '850.5',
      has_concierge: true,
      concierge_type: '24h',
      notes: 'Entrada lateral',
    },
  )
  assert.deepEqual(condominiumFormFromCondominium(), EMPTY_CONDOMINIUM_FORM)
})

test('interpreta a taxa de condomínio sem mudar os formatos aceitos', () => {
  assert.equal(parseCurrencyInput(''), undefined)
  assert.equal(parseCurrencyInput(' 1.234,56 '), 1234.56)
  assert.equal(parseCurrencyInput('1234.56'), 1234.56)
  assert.equal(parseCurrencyInput('0'), 0)
  assert.equal(parseCurrencyInput('-1'), undefined)
  assert.equal(parseCurrencyInput('inválido'), undefined)
})

test('normaliza o payload do condomínio mantendo opcionais vazios ausentes', () => {
  assert.deepEqual(
    buildCondominiumPayload(
      {
        ...EMPTY_CONDOMINIUM_FORM,
        name: '  Residencial Flores  ',
        city_id: 'city-1',
        address: '  Rua Um  ',
        default_condominium_fee: '800,50',
        has_concierge: true,
        concierge_type: '  24h  ',
      },
      800.5,
    ),
    {
      name: 'Residencial Flores',
      city_id: 'city-1',
      neighborhood_id: undefined,
      address: 'Rua Um',
      photo_url: undefined,
      cep: undefined,
      number: undefined,
      complement: undefined,
      default_condominium_fee: 800.5,
      has_concierge: true,
      concierge_type: '24h',
      notes: undefined,
    },
  )
})

test('mantém valores legados somente na listagem e fora dos seletores', () => {
  const catalog = { id: 'catalog', catalog_source: 'catalog' as const }
  const legacy = { id: 'legacy', catalog_source: 'property' as const }
  const withoutSource = { id: 'without-source' }
  const locations: Array<{ id: string } & CatalogLocation> = [
    catalog,
    legacy,
    withoutSource,
  ]

  assert.deepEqual(
    catalogLocationsOnly(locations).map(({ id }) => id),
    ['catalog', 'without-source'],
  )
  assert.equal(catalogLocationIdForMutation(locations, 'legacy'), '')
  assert.equal(catalogLocationIdForMutation(locations, 'catalog'), 'catalog')
  assert.equal(
    catalogLocationIdForMutation(locations, 'not-loaded-yet'),
    'not-loaded-yet',
  )
})

test('na edição do condomínio envia null para remover campos opcionais', () => {
  assert.deepEqual(
    buildCondominiumUpdatePayload(
      {
        ...EMPTY_CONDOMINIUM_FORM,
        name: '  Residencial Flores  ',
        has_concierge: true,
      },
      undefined,
    ),
    {
      name: 'Residencial Flores',
      city_id: null,
      neighborhood_id: null,
      address: null,
      photo_url: null,
      cep: null,
      number: null,
      complement: null,
      default_condominium_fee: null,
      has_concierge: true,
      concierge_type: null,
      notes: null,
    },
  )
})

test('preserva as rotas de cada aba e parâmetros não relacionados', () => {
  assert.equal(propertyLocationsHref('cities', '?tab=owners'), '/properties/locations')
  assert.equal(
    propertyLocationsHref('neighborhoods', '?source=menu&tab=owners'),
    '/properties/locations?source=menu&tab=neighborhoods',
  )
  assert.equal(
    propertyLocationsHref('condominiums', '?tab=neighborhoods&source=menu'),
    '/properties/condominiums?source=menu',
  )
  assert.equal(
    propertyLocationsHref('owners', '?source=menu'),
    '/properties/owners?source=menu',
  )
})

test('mantém os payloads de vínculo para cidade, bairro e proprietário', () => {
  assert.deepEqual(
    createCityAssignment({
      id: 'city-1',
      name: 'São Paulo',
      uf: 'SP',
    }),
    {
      type: 'cities',
      id: 'city-1',
      title: 'São Paulo',
      subtitle: 'Cidade - SP',
      payload: {
        city_id: 'city-1',
        cidade: 'São Paulo',
        uf: 'SP',
      },
    },
  )

  assert.deepEqual(
    createNeighborhoodAssignment({
      id: 'neighborhood-1',
      name: 'Centro',
      city_id: 'city-1',
      city: { name: 'São Paulo', uf: 'SP' },
    }),
    {
      type: 'neighborhoods',
      id: 'neighborhood-1',
      title: 'Centro',
      subtitle: 'São Paulo',
      payload: {
        neighborhood_id: 'neighborhood-1',
        bairro: 'Centro',
        city_id: 'city-1',
        cidade: 'São Paulo',
        uf: 'SP',
      },
    },
  )

  assert.deepEqual(
    createOwnerAssignment({
      id: 'owner-1',
      name: 'Ana',
      phone_residential: null,
      phone_commercial: '1133334444',
      cellphone: '11999998888',
      email: 'ana@example.com',
      media_source: 'Indicação',
      notify_email: true,
    }),
    {
      type: 'owners',
      id: 'owner-1',
      title: 'Ana',
      subtitle: 'Proprietário',
      payload: {
        owner_id: 'owner-1',
        owner_name: 'Ana',
        owner_phone_residential: null,
        owner_phone_commercial: '1133334444',
        owner_cellphone: '11999998888',
        owner_email: 'ana@example.com',
        owner_media_source: 'Indicação',
        owner_notify_email: true,
      },
    },
  )
})

test('mantém precedência de contato, contagem e preenchimento do proprietário', () => {
  const owner = {
    id: 'owner-1',
    name: 'Ana',
    phone_residential: '1111',
    phone_commercial: '2222',
    cellphone: '3333',
    email: 'ana@example.com',
    media_source: null,
    notify_email: true,
    notes: 'Observação',
    property_count: 4,
    properties: [{ id: 'property-1' }],
  }

  assert.equal(getOwnerContact(owner), '3333')
  assert.equal(getOwnerPropertyCount(owner), 4)
  assert.deepEqual(ownerFormFromOwner(owner), {
    name: 'Ana',
    phone_residential: '1111',
    phone_commercial: '2222',
    cellphone: '3333',
    email: 'ana@example.com',
    media_source: '',
    notify_email: true,
    notes: 'Observação',
  })
})

test('separa os imóveis vinculados dos que falharam em uma operação parcial', () => {
  const results: PromiseSettledResult<unknown>[] = [
    { status: 'fulfilled', value: undefined },
    { status: 'rejected', reason: new Error('indisponível') },
    { status: 'fulfilled', value: undefined },
  ]

  assert.deepEqual(
    summarizePropertyAssignmentResults(
      ['property-1', 'property-2', 'property-3'],
      results,
    ),
    {
      succeededIds: ['property-1', 'property-3'],
      failedIds: ['property-2'],
    },
  )
})

test('invalida listas, ficha e histórico de cada imóvel vinculado com sucesso', () => {
  const invalidationKeys = propertyAssignmentInvalidationKeys(
    'org-1',
    ['property-1', 'property-3'],
  )

  assert.deepEqual(
    invalidationKeys,
    [
      ['properties'],
      ['properties-infinite'],
      ['property-owners'],
      ['property-cities'],
      ['property-neighborhoods'],
      ['property-condominiums'],
      ['property-workspace', 'org-1'],
      ['property', 'org-1', 'property-1'],
      ['property-history', 'org-1', 'property-1'],
      ['property', 'org-1', 'property-3'],
      ['property-history', 'org-1', 'property-3'],
    ],
  )

  const workspaceDetailKey = [
    'property-workspace',
    'org-1',
    'access-signature',
    'property-1',
  ]
  assert.ok(
    invalidationKeys.some((prefix) =>
      prefix.every((part, index) => workspaceDetailKey[index] === part),
    ),
  )
  assert.ok(
    invalidationKeys.some(
      (key) =>
        JSON.stringify(key) ===
        JSON.stringify(['property-history', 'org-1', 'property-1']),
    ),
  )
})
