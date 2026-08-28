import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildMarketingTabHrefs,
  normalizeMarketingTab,
} from '../../components/features/marketing/marketing-tabs'
import {
  campaignInsightsQuerySchema,
  createEmptyMarketingCampaignInsights,
  marketingCampaignInsightsSchema,
  metaMarketingSyncInputSchema,
  metaMarketingSyncResponseSchema,
} from './marketing'

test('abas de Marketing mantêm a URL como fonte e preservam outros parâmetros', () => {
  const hrefs = buildMarketingTabHrefs({
    tab: 'paid',
    period: '30d',
    source: ['meta', 'instagram'],
  })

  assert.equal(normalizeMarketingTab('unknown'), 'overview')
  assert.equal(
    hrefs.media,
    '/marketing?period=30d&source=meta&source=instagram&tab=media',
  )
})

test('consulta de Marketing usa datas civis e remove sentinelas antigas', () => {
  const parsed = campaignInsightsQuerySchema.parse({
    dateFrom: '2026-07-01',
    dateTo: '2026-07-31',
    teamId: 'all',
    userId: null,
    source: '  meta  ',
    dealStatus: 'ALL',
  })

  assert.equal(parsed.dateFrom, '2026-07-01')
  assert.equal(parsed.dateTo, '2026-07-31')
  assert.equal(parsed.teamId, undefined)
  assert.equal(parsed.userId, undefined)
  assert.equal(parsed.source, 'meta')
  assert.equal(parsed.dealStatus, undefined)
  assert.equal(campaignInsightsQuerySchema.safeParse({
    dateFrom: '2026-07-01T03:00:00.000Z',
    dateTo: '2026-07-31',
  }).success, false)
})

test('consulta de Marketing rejeita período invertido ou maior que 366 dias', () => {
  assert.equal(campaignInsightsQuerySchema.safeParse({
    dateFrom: '2026-08-01',
    dateTo: '2026-07-31',
  }).success, false)
  assert.equal(campaignInsightsQuerySchema.safeParse({
    dateFrom: '2025-01-01',
    dateTo: '2026-01-02',
  }).success, false)
})

test('sincronização Meta limita cada lote a 90 dias e normaliza a resposta', () => {
  assert.equal(metaMarketingSyncInputSchema.safeParse({
    date_start: '2026-01-01',
    date_stop: '2026-03-31',
  }).success, true)
  assert.equal(metaMarketingSyncInputSchema.safeParse({
    date_start: '2026-01-01',
    date_stop: '2026-04-01',
  }).success, false)

  const response = metaMarketingSyncResponseSchema.parse({ synced: 4 })
  assert.equal(response.success, true)
  assert.equal(response.synced, 4)
  assert.deepEqual(response.errors, [])
})

test('contrato de Marketing normaliza resposta legada sem inventar atribuição', () => {
  const parsed = marketingCampaignInsightsSchema.parse({
    campaigns: [],
    topCreatives: [],
    dailyData: [{
      date: '2026-07-10',
      leads: 2,
      conversations: 1,
      total: 3,
    }],
    summary: {
      totalLeads: 2,
      totalWon: 0,
      totalRevenue: 0,
      totalCampaigns: 0,
      totalAdsets: 0,
      totalAds: 0,
      totalSpend: 10,
      avgCpl: 5,
      totalImpressions: 100,
      totalReach: 80,
      conversations_count: 1,
    },
    lastSync: '2026-07-10T12:00:00Z',
    hasSpendData: true,
  })

  assert.equal(parsed.dailyData[0]?.clicks, 0)
  assert.deepEqual(parsed.media, [])
  assert.equal(parsed.connection.isConnected, false)
  assert.equal(parsed.dataQuality.hasCRMAttribution, false)
})

test('contrato de Marketing rejeita números não finitos e coleções malformadas', () => {
  const empty = createEmptyMarketingCampaignInsights()
  assert.equal(empty.summary.totalLeads, 0)
  assert.equal(marketingCampaignInsightsSchema.safeParse({
    ...empty,
    campaigns: {},
  }).success, false)
  assert.equal(marketingCampaignInsightsSchema.safeParse({
    ...empty,
    summary: { ...empty.summary, totalRevenue: Number.NaN },
  }).success, false)
})
