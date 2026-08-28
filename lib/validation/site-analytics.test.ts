import assert from 'node:assert/strict'
import test from 'node:test'

import {
  apiLeadAnalyticsResponseSchema,
  apiSiteAnalyticsDetailedResponseSchema,
  apiSiteAnalyticsSummaryResponseSchema,
  formatSiteAnalyticsDate,
  siteAnalyticsQuerySchema,
} from './site-analytics'

const SUMMARY = {
  totalViews: 12,
  totalPages: 12,
  uniquePages: 4,
  uniqueSessions: 5,
  avgDuration: 30,
  desktopPct: 40,
  mobilePct: 60,
  tabletPct: 0,
  directPct: 20,
  searchPct: 20,
  socialPct: 20,
  campaignPct: 20,
  referralPct: 20,
  conversions: 1,
  prevSessions: 3,
  prevViews: 8,
  prevPages: 8,
  prevUniquePages: 3,
  prevAvgDuration: 20,
  prevDesktopPct: 50,
  prevMobilePct: 50,
  prevConversions: 0,
  prevConversionRate: 0,
}

test('consulta de analytics do site usa datas civis e limita o período', () => {
  assert.equal(formatSiteAnalyticsDate(new Date(Number.NaN)), null)
  assert.equal(formatSiteAnalyticsDate(new Date(2026, 7, 16, 23, 30)), '2026-08-16')
  assert.equal(siteAnalyticsQuerySchema.safeParse({
    dateFrom: '2026-01-01',
    dateTo: '2026-12-31',
  }).success, true)
  assert.equal(siteAnalyticsQuerySchema.safeParse({
    dateFrom: '2026-01-01T03:00:00.000Z',
    dateTo: '2026-01-31T02:59:59.999Z',
  }).success, false)
  assert.equal(siteAnalyticsQuerySchema.safeParse({
    dateFrom: '2026-08-02',
    dateTo: '2026-08-01',
  }).success, false)
  assert.equal(siteAnalyticsQuerySchema.safeParse({
    dateFrom: '2025-01-01',
    dateTo: '2026-01-02',
  }).success, false)
})

test('resumo do site rejeita percentuais e números inválidos', () => {
  assert.equal(apiSiteAnalyticsSummaryResponseSchema.safeParse({ data: SUMMARY }).success, true)
  assert.equal(apiSiteAnalyticsSummaryResponseSchema.safeParse({
    data: { ...SUMMARY, totalViews: Number.NaN },
  }).success, false)
  assert.equal(apiSiteAnalyticsSummaryResponseSchema.safeParse({
    data: { ...SUMMARY, mobilePct: 101 },
  }).success, false)
})

test('detalhamento do site normaliza textos nulos sem aceitar coleções malformadas', () => {
  const result = apiSiteAnalyticsDetailedResponseSchema.parse({
    data: {
      topProperties: [],
      topPages: [{ page_path: null, views: 2 }],
      dailyViews: [{ date: '2026-08-01', views: 2 }],
      conversionRate: 0,
      totalSessions: 1,
      totalConversions: 0,
      siteLeads: 0,
      campaigns: [],
      searchTerms: [],
      pagesPerSession: 2,
      bounceRate: 0,
      liveVisitors: 1,
    },
  })
  assert.equal(result.data.topPages[0]?.page_path, '/')
  assert.equal(apiSiteAnalyticsDetailedResponseSchema.safeParse({
    data: { ...result.data, dailyViews: 'inválido' },
  }).success, false)
})

test('jornadas validam datas, coordenadas e sequências antes de renderizar', () => {
  const valid = {
    data: {
      journeys: [{
        session_id: 'session-1',
        path_sequence: ['/imoveis'],
        event_sequence: ['page_view'],
        first_event: '2026-08-01T12:00:00Z',
        last_event: '2026-08-01T12:01:00Z',
        total_events: 1,
        converted: false,
        device_type: 'mobile',
        browser: 'Chrome',
        os: null,
        city: 'Macaé',
        region: 'RJ',
        country: 'BR',
        utm_source: null,
        referrer: null,
      }],
      funnel: [{ event_type: 'page_view', total: 1 }],
      top_pages: [{ page_path: '/imoveis', views: 1 }],
      daily_views: [{ date: '2026-08-01', views: 1 }],
      total_sessions: 1,
      total_conversions: 0,
      device_breakdown: [{ device_type: 'mobile', total: 1 }],
      locations: [{ city: 'Macaé', region: 'RJ', country: 'BR', lat: -22.37, lng: -41.78, sessions: 1 }],
    },
  }
  assert.equal(apiLeadAnalyticsResponseSchema.safeParse(valid).success, true)
  assert.equal(apiLeadAnalyticsResponseSchema.safeParse({
    data: {
      ...valid.data,
      locations: [{ ...valid.data.locations[0], lat: 120 }],
    },
  }).success, false)
  assert.equal(apiLeadAnalyticsResponseSchema.safeParse({
    data: {
      ...valid.data,
      journeys: [{ ...valid.data.journeys[0], first_event: 'data-inválida' }],
    },
  }).success, false)
})
