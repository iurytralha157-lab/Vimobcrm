import { z } from 'zod'

import { apiEnvelopeSchema, nonNegativeIntegerSchema, uuidSchema } from './common'

const calendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}, 'Data inválida')
const finiteNumberSchema = z.number().finite()
const nonNegativeNumberSchema = finiteNumberSchema.min(0)
const percentageSchema = nonNegativeNumberSchema.max(100)
const nullableTextSchema = z.string().trim().max(4_096).nullable()
const eventTypeSchema = z.string().trim().min(1).max(120)
const pagePathSchema = z.string().trim().max(4_096).nullable().transform((value) => value || '/')
const timestampValueSchema = z.string().trim().min(1).max(80).refine(
  (value) => Number.isFinite(new Date(value).getTime()),
  'Data e hora inválidas',
)

export function formatSiteAnalyticsDate(value?: Date | null) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) return null
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export const siteAnalyticsQuerySchema = z.object({
  dateFrom: calendarDateSchema,
  dateTo: calendarDateSchema,
}).strict().superRefine((query, context) => {
  const start = new Date(`${query.dateFrom}T00:00:00.000Z`)
  const end = new Date(`${query.dateTo}T00:00:00.000Z`)

  if (end < start) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['dateTo'],
      message: 'A data final deve ser igual ou posterior à inicial',
    })
    return
  }

  if (end.getTime() - start.getTime() > 365 * 24 * 60 * 60 * 1_000) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['dateTo'],
      message: 'O período não pode ultrapassar 366 dias',
    })
  }
})

export const siteAnalyticsSummarySchema = z.object({
  totalViews: nonNegativeIntegerSchema,
  totalPages: nonNegativeIntegerSchema,
  uniquePages: nonNegativeIntegerSchema,
  uniqueSessions: nonNegativeIntegerSchema,
  avgDuration: nonNegativeNumberSchema,
  desktopPct: percentageSchema,
  mobilePct: percentageSchema,
  tabletPct: percentageSchema,
  directPct: percentageSchema,
  searchPct: percentageSchema,
  socialPct: percentageSchema,
  campaignPct: percentageSchema,
  referralPct: percentageSchema,
  conversions: nonNegativeIntegerSchema,
  prevSessions: nonNegativeIntegerSchema,
  prevViews: nonNegativeIntegerSchema,
  prevPages: nonNegativeIntegerSchema,
  prevUniquePages: nonNegativeIntegerSchema,
  prevAvgDuration: nonNegativeNumberSchema,
  prevDesktopPct: percentageSchema,
  prevMobilePct: percentageSchema,
  prevConversions: nonNegativeIntegerSchema,
  prevConversionRate: percentageSchema,
}).passthrough()

const topPropertySchema = z.object({
  property_id: uuidSchema,
  title: z.string().trim().max(500).nullable().transform((value) => value || 'Imóvel'),
  code: z.string().trim().max(120).nullable().transform((value) => value || '—'),
  views: nonNegativeIntegerSchema,
  favorites: nonNegativeIntegerSchema,
}).passthrough()

const topPageSchema = z.object({
  page_path: pagePathSchema,
  views: nonNegativeIntegerSchema,
}).passthrough()

const dailyViewSchema = z.object({
  date: calendarDateSchema,
  views: nonNegativeIntegerSchema,
}).passthrough()

const campaignSchema = z.object({
  source: z.string().trim().max(255).nullable().transform((value) => value || 'Direto'),
  campaign: z.string().trim().max(500).nullable().transform((value) => value || 'Sem campanha'),
  sessions: nonNegativeIntegerSchema,
  conversions: nonNegativeIntegerSchema,
}).passthrough()

const searchTermSchema = z.object({
  term: z.string().trim().min(1).max(500),
  searches: nonNegativeIntegerSchema,
}).passthrough()

export const siteAnalyticsDetailedSchema = z.object({
  topProperties: z.array(topPropertySchema).max(100),
  topPages: z.array(topPageSchema).max(100),
  dailyViews: z.array(dailyViewSchema).max(366),
  conversionRate: percentageSchema,
  totalSessions: nonNegativeIntegerSchema,
  totalConversions: nonNegativeIntegerSchema,
  siteLeads: nonNegativeIntegerSchema,
  campaigns: z.array(campaignSchema).max(100),
  searchTerms: z.array(searchTermSchema).max(100),
  pagesPerSession: nonNegativeNumberSchema,
  bounceRate: percentageSchema,
  liveVisitors: nonNegativeIntegerSchema,
}).passthrough()

export const leadJourneySchema = z.object({
  session_id: z.string().trim().min(1).max(255),
  path_sequence: z.array(pagePathSchema).max(10_000),
  event_sequence: z.array(eventTypeSchema).max(10_000),
  first_event: timestampValueSchema,
  last_event: timestampValueSchema,
  total_events: nonNegativeIntegerSchema,
  converted: z.boolean(),
  device_type: nullableTextSchema,
  browser: nullableTextSchema,
  os: nullableTextSchema,
  city: nullableTextSchema,
  region: nullableTextSchema,
  country: nullableTextSchema,
  utm_source: nullableTextSchema,
  referrer: nullableTextSchema,
}).passthrough()

const funnelStepSchema = z.object({
  event_type: eventTypeSchema,
  total: nonNegativeIntegerSchema,
}).passthrough()

const deviceBreakdownSchema = z.object({
  device_type: z.string().trim().min(1).max(120),
  total: nonNegativeIntegerSchema,
}).passthrough()

export const siteVisitorLocationSchema = z.object({
  city: z.string().trim().min(1).max(255),
  region: nullableTextSchema,
  country: nullableTextSchema,
  lat: finiteNumberSchema.min(-90).max(90).nullable(),
  lng: finiteNumberSchema.min(-180).max(180).nullable(),
  sessions: nonNegativeIntegerSchema,
}).passthrough()

export const leadAnalyticsDataSchema = z.object({
  journeys: z.array(leadJourneySchema).max(100),
  funnel: z.array(funnelStepSchema).max(1_000),
  top_pages: z.array(topPageSchema).max(100),
  daily_views: z.array(dailyViewSchema).max(366),
  total_sessions: nonNegativeIntegerSchema,
  total_conversions: nonNegativeIntegerSchema,
  device_breakdown: z.array(deviceBreakdownSchema).max(100),
  locations: z.array(siteVisitorLocationSchema).max(100),
}).passthrough()

export const apiSiteAnalyticsSummaryResponseSchema = apiEnvelopeSchema(siteAnalyticsSummarySchema)
export const apiSiteAnalyticsDetailedResponseSchema = apiEnvelopeSchema(siteAnalyticsDetailedSchema)
export const apiLeadAnalyticsResponseSchema = apiEnvelopeSchema(leadAnalyticsDataSchema)

export type SiteAnalyticsQuery = z.infer<typeof siteAnalyticsQuerySchema>
export type SiteAnalyticsSummary = z.infer<typeof siteAnalyticsSummarySchema>
export type SiteAnalyticsDetailed = z.infer<typeof siteAnalyticsDetailedSchema>
export type LeadAnalyticsData = z.infer<typeof leadAnalyticsDataSchema>
export type LeadJourney = z.infer<typeof leadJourneySchema>
export type FunnelStep = z.infer<typeof funnelStepSchema>
export type TopPage = z.infer<typeof topPageSchema>
export type DailyView = z.infer<typeof dailyViewSchema>
export type DeviceBreakdown = z.infer<typeof deviceBreakdownSchema>
export type LocationData = z.infer<typeof siteVisitorLocationSchema>
