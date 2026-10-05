import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

import ts from 'typescript'

const source = readFileSync(new URL('./dashboard.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
  fileName: 'dashboard.ts',
}).outputText
const moduleRecord = { exports: {} }
const requests = []
vm.runInNewContext(compiled, {
  exports: moduleRecord.exports,
  module: moduleRecord,
  require: (specifier) => {
    if (specifier === '@/lib/validation') return {
      parseDomainInput: (_schema, value) => value,
      validateDomainResponse: (_schema, response) => response,
    }
    if (specifier === 'zod') return {
      z: {
        string: () => ({ trim() { return this }, min() { return this }, max() { return this } }),
      },
    }
    if (specifier === './vimob-client') return {
      vimobAPIRequest: async (path, options) => {
        requests.push({ path, options })
        return path === '/v1/dashboard/creative-media'
          ? { data: { thumbnailUrl: null, imageUrl: null, videoUrl: null, instagramUrl: null, permalinkUrl: null } }
          : { data: { creatives: [] } }
      },
    }
    throw new Error(`Unexpected import: ${specifier}`)
  },
}, { filename: 'dashboard.js' })

const { buildDashboardQuery, getDashboardCreatives, getDashboardCreativeMedia, getDashboardFiltersQueryKey, normalizeDashboardFilters } = moduleRecord.exports

test('dashboard normaliza filtros de campanha sem colidir case ou vírgulas', () => {
  const normalized = normalizeDashboardFilters({
    campaignId: 'legado',
    campaignIds: ['Promo, Setembro', 'promo', 'Promo, Setembro', ' Promo '],
  })

  assert.equal(normalized.campaignId, null)
  assert.deepEqual(Array.from(normalized.campaignIds), ['Promo', 'Promo, Setembro', 'promo'])
  const query = buildDashboardQuery(normalized)
  assert.equal(query.campaignId, undefined)
  assert.deepEqual(Array.from(query.campaignIds), ['Promo', 'Promo, Setembro', 'promo'])
})

test('dashboard usa chave estável para a mesma seleção e separa combinações diferentes', () => {
  const first = getDashboardFiltersQueryKey({ campaignIds: ['B', 'A'] })
  const reordered = getDashboardFiltersQueryKey({ campaignIds: ['A', 'B'] })
  const different = getDashboardFiltersQueryKey({ campaignIds: ['A', 'C'] })
  const commaDifferent = getDashboardFiltersQueryKey({ campaignIds: ['A,B', 'C'] })

  assert.equal(JSON.stringify(first), JSON.stringify(reordered))
  assert.notEqual(JSON.stringify(first), JSON.stringify(different))
  assert.notEqual(JSON.stringify(commaDifferent), JSON.stringify(getDashboardFiltersQueryKey({ campaignIds: ['A', 'B,C'] })))
})

test('destaques de criativos usam o mesmo escopo e filtros combinados da Dashboard', async () => {
  const signal = new AbortController().signal
  const response = await getDashboardCreatives({
    organizationId: '11111111-1111-4111-8111-111111111111',
    signal,
    filters: {
      campaignIds: ['Campanha B', 'Campanha A'],
      userId: '22222222-2222-4222-8222-222222222222',
      pageId: 'pagina-1',
      dateRange: { from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-10-01T00:00:00Z') },
    },
  })

  assert.deepEqual(response, { creatives: [] })
  assert.equal(requests.at(-1)?.path, '/v1/dashboard/creatives')
  assert.equal(requests.at(-1)?.options.organizationId, '11111111-1111-4111-8111-111111111111')
  assert.equal(requests.at(-1)?.options.signal, signal)
  assert.equal(requests.at(-1)?.options.query.campaignId, undefined)
  assert.deepEqual(Array.from(requests.at(-1)?.options.query.campaignIds ?? []), ['Campanha A', 'Campanha B'])
  assert.equal(requests.at(-1)?.options.query.userId, '22222222-2222-4222-8222-222222222222')
  assert.equal(requests.at(-1)?.options.query.pageId, 'pagina-1')
  assert.equal(requests.at(-1)?.options.query.dateFrom, '2026-09-01T00:00:00.000Z')
})

test('atualização de mídia usa a chave e o mesmo escopo filtrado da Dashboard', async () => {
  const signal = new AbortController().signal
  const media = await getDashboardCreativeMedia({
    organizationId: '11111111-1111-4111-8111-111111111111',
    key: 'creative:123',
    signal,
    filters: {
      campaignIds: ['Campanha B', 'Campanha A'],
      userId: '22222222-2222-4222-8222-222222222222',
      dateRange: { from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-10-01T00:00:00Z') },
    },
  })

  assert.equal(media.thumbnailUrl, null)
  assert.equal(requests.at(-1)?.path, '/v1/dashboard/creative-media')
  assert.equal(requests.at(-1)?.options.organizationId, '11111111-1111-4111-8111-111111111111')
  assert.equal(requests.at(-1)?.options.signal, signal)
  assert.equal(requests.at(-1)?.options.query.key, 'creative:123')
  assert.equal(requests.at(-1)?.options.query.campaignId, undefined)
  assert.deepEqual(Array.from(requests.at(-1)?.options.query.campaignIds), ['Campanha A', 'Campanha B'])
  assert.equal(requests.at(-1)?.options.query.userId, '22222222-2222-4222-8222-222222222222')
  assert.equal(requests.at(-1)?.options.query.dateFrom, '2026-09-01T00:00:00.000Z')
})
