import { z } from 'zod'

import { apiEnvelopeSchema, nonNegativeIntegerSchema } from './common'

const finiteNumberSchema = z.number().finite()
const nullableMetricSchema = finiteNumberSchema.nullable()
const nullableTextSchema = z.string().trim().max(20_000).nullable()
const providerIdSchema = z.string().trim().min(1).max(255)
const calendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}, 'Data inválida')

function optionalQueryText(maxLength: number) {
  return z.preprocess(
    (value) => {
      if (value === null || value === undefined) return undefined
      if (typeof value !== 'string') return value
      const normalized = value.trim()
      return !normalized || normalized.toLowerCase() === 'all' ? undefined : normalized
    },
    z.string().min(1).max(maxLength).optional(),
  )
}

function optionalQueryUUID() {
  return z.preprocess(
    (value) => {
      if (value === null || value === undefined) return undefined
      if (typeof value !== 'string') return value
      const normalized = value.trim()
      return !normalized || normalized.toLowerCase() === 'all' ? undefined : normalized
    },
    z.string().uuid().optional(),
  )
}

export const campaignInsightsQuerySchema = z.object({
  dateFrom: calendarDateSchema,
  dateTo: calendarDateSchema,
  teamId: optionalQueryUUID(),
  userId: optionalQueryUUID(),
  source: optionalQueryText(120),
  campaignId: optionalQueryText(255),
  adSetId: optionalQueryText(255),
  adId: optionalQueryText(255),
  tagId: optionalQueryUUID(),
  dealStatus: z.preprocess(
    (value) => {
      if (value === null || value === undefined) return undefined
      if (typeof value !== 'string') return value
      const normalized = value.trim().toLowerCase()
      return !normalized || normalized === 'all' ? undefined : normalized
    },
    z.enum(['open', 'won', 'lost']).optional(),
  ),
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

export const metaMarketingSyncInputSchema = z.object({
  date_start: calendarDateSchema,
  date_stop: calendarDateSchema,
}).strict().superRefine((input, context) => {
  const start = new Date(`${input.date_start}T00:00:00.000Z`)
  const end = new Date(`${input.date_stop}T00:00:00.000Z`)
  if (end < start) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['date_stop'],
      message: 'A data final deve ser igual ou posterior à inicial',
    })
    return
  }
  if (end.getTime() - start.getTime() > 89 * 24 * 60 * 60 * 1_000) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['date_stop'],
      message: 'Cada sincronização pode abranger no máximo 90 dias',
    })
  }
})

export const metaMarketingSyncResponseSchema = z.object({
  success: z.boolean().optional().default(true),
  synced: nonNegativeIntegerSchema.optional().default(0),
  media_synced: nonNegativeIntegerSchema.optional().default(0),
  social_synced: nonNegativeIntegerSchema.optional().default(0),
  errors: z.array(z.string().trim().min(1).max(255)).max(1_000).optional().default([]),
}).passthrough()

export type MetaMarketingSyncInput = z.infer<typeof metaMarketingSyncInputSchema>
export type MetaMarketingSyncResponse = z.infer<typeof metaMarketingSyncResponseSchema>

const marketingAdSchema = z.object({
  ad_id: providerIdSchema,
  ad_name: z.string().trim().min(1).max(500),
  spend: nullableMetricSchema.optional().default(null),
  impressions: nullableMetricSchema.optional().default(null),
  reach: nullableMetricSchema.optional().default(null),
  clicks: nullableMetricSchema.optional().default(null),
  link_clicks: nullableMetricSchema.optional().default(null),
  leads_reported: nonNegativeIntegerSchema.optional().default(0),
  leads_count: nonNegativeIntegerSchema.optional().default(0),
  contacted_count: nonNegativeIntegerSchema.optional().default(0),
  responded_count: nonNegativeIntegerSchema.optional().default(0),
  qualified_count: nonNegativeIntegerSchema.optional().default(0),
  won_count: nonNegativeIntegerSchema.optional().default(0),
  lost_count: nonNegativeIntegerSchema.optional().default(0),
  open_count: nonNegativeIntegerSchema.optional().default(0),
  conversations_count: nonNegativeIntegerSchema.optional().default(0),
  revenue: finiteNumberSchema.optional().default(0),
  cpl: nullableMetricSchema.optional().default(null),
  ctr: nullableMetricSchema.optional().default(null),
  cpc: nullableMetricSchema.optional().default(null),
  hook_rate: nullableMetricSchema.optional().default(null),
  creative_url: nullableTextSchema.optional().default(null),
  creative_video_url: nullableTextSchema.optional().default(null),
  creative_permalink_url: nullableTextSchema.optional().default(null),
  thumbnail_url: nullableTextSchema.optional().default(null),
  currency: z.string().trim().min(1).max(16).nullable().optional().default(null),
}).passthrough()

const marketingAdsetSchema = z.object({
  adset_id: providerIdSchema,
  adset_name: z.string().trim().min(1).max(500),
  spend: nullableMetricSchema.optional().default(null),
  impressions: nullableMetricSchema.optional().default(null),
  reach: nullableMetricSchema.optional().default(null),
  clicks: nullableMetricSchema.optional().default(null),
  link_clicks: nullableMetricSchema.optional().default(null),
  leads_reported: nonNegativeIntegerSchema.optional().default(0),
  leads_count: nonNegativeIntegerSchema.optional().default(0),
  contacted_count: nonNegativeIntegerSchema.optional().default(0),
  responded_count: nonNegativeIntegerSchema.optional().default(0),
  qualified_count: nonNegativeIntegerSchema.optional().default(0),
  won_count: nonNegativeIntegerSchema.optional().default(0),
  lost_count: nonNegativeIntegerSchema.optional().default(0),
  open_count: nonNegativeIntegerSchema.optional().default(0),
  conversations_count: nonNegativeIntegerSchema.optional().default(0),
  revenue: finiteNumberSchema.optional().default(0),
  cpl: nullableMetricSchema.optional().default(null),
  ctr: nullableMetricSchema.optional().default(null),
  cpc: nullableMetricSchema.optional().default(null),
  hook_rate: nullableMetricSchema.optional().default(null),
  currency: z.string().trim().min(1).max(16).nullable().optional().default(null),
  ads: z.array(marketingAdSchema).max(10_000).optional().default([]),
}).passthrough()

const marketingCampaignSchema = z.object({
  campaign_id: providerIdSchema,
  campaign_name: z.string().trim().min(1).max(500),
  spend: nullableMetricSchema,
  impressions: nullableMetricSchema,
  reach: nullableMetricSchema,
  clicks: nullableMetricSchema.optional().default(null),
  link_clicks: nullableMetricSchema.optional().default(null),
  leads_reported: nonNegativeIntegerSchema.optional().default(0),
  leads_count: nonNegativeIntegerSchema,
  contacted_count: nonNegativeIntegerSchema.optional().default(0),
  responded_count: nonNegativeIntegerSchema.optional().default(0),
  qualified_count: nonNegativeIntegerSchema.optional().default(0),
  conversations_count: nonNegativeIntegerSchema,
  won_count: nonNegativeIntegerSchema,
  lost_count: nonNegativeIntegerSchema.optional().default(0),
  open_count: nonNegativeIntegerSchema.optional().default(0),
  revenue: finiteNumberSchema,
  cpl: nullableMetricSchema,
  reported_cpl: nullableMetricSchema.optional().default(null),
  cpql: nullableMetricSchema.optional().default(null),
  cac: nullableMetricSchema.optional().default(null),
  ctr: nullableMetricSchema,
  cpc: nullableMetricSchema.optional().default(null),
  cpm: nullableMetricSchema.optional().default(null),
  frequency: nullableMetricSchema.optional().default(null),
  hook_rate: nullableMetricSchema,
  status: nullableTextSchema,
  budget: nullableMetricSchema,
  budget_type: nullableTextSchema,
  objective: nullableTextSchema,
  currency: z.string().trim().min(1).max(16).nullable().optional().default(null),
  adsets: z.array(marketingAdsetSchema).max(10_000),
}).passthrough()

const marketingTopCreativeSchema = z.object({
  ad_id: providerIdSchema,
  ad_name: z.string().trim().min(1).max(500).nullish()
    .transform((value) => value || 'Anúncio'),
  campaign_name: z.string().trim().min(1).max(500).nullish()
    .transform((value) => value || 'Campanha'),
  leads_count: nonNegativeIntegerSchema,
  leads_reported: nonNegativeIntegerSchema.optional().default(0),
  contacted_count: nonNegativeIntegerSchema.optional().default(0),
  responded_count: nonNegativeIntegerSchema.optional().default(0),
  qualified_count: nonNegativeIntegerSchema.optional().default(0),
  won_count: nonNegativeIntegerSchema,
  lost_count: nonNegativeIntegerSchema.optional().default(0),
  revenue: finiteNumberSchema,
  score: finiteNumberSchema,
  creative_url: nullableTextSchema,
  creative_video_url: nullableTextSchema,
  creative_permalink_url: nullableTextSchema,
  thumbnail_url: nullableTextSchema.optional().default(null),
  spend: nullableMetricSchema,
  cpl: nullableMetricSchema,
  ctr: nullableMetricSchema,
  cpc: nullableMetricSchema.optional().default(null),
  hook_rate: nullableMetricSchema,
  currency: z.string().trim().min(1).max(16).nullable().optional().default(null),
}).passthrough()

const marketingDailyPerformanceSchema = z.object({
  date: calendarDateSchema,
  spend: finiteNumberSchema.optional().default(0),
  impressions: nonNegativeIntegerSchema.optional().default(0),
  reach: nonNegativeIntegerSchema.optional().default(0),
  clicks: nonNegativeIntegerSchema.optional().default(0),
  linkClicks: nonNegativeIntegerSchema.optional().default(0),
  leadsReported: nonNegativeIntegerSchema.optional().default(0),
  leads: nonNegativeIntegerSchema,
  contacted: nonNegativeIntegerSchema.optional().default(0),
  responded: nonNegativeIntegerSchema.optional().default(0),
  qualified: nonNegativeIntegerSchema.optional().default(0),
  won: nonNegativeIntegerSchema.optional().default(0),
  lost: nonNegativeIntegerSchema.optional().default(0),
  revenue: finiteNumberSchema.optional().default(0),
  conversations: nonNegativeIntegerSchema,
  total: nonNegativeIntegerSchema,
}).passthrough()

const marketingMediaAssetSchema = z.object({
  id: z.string().trim().min(1).max(255),
  provider: z.string().trim().min(1).max(80),
  source_kind: z.enum(['paid', 'organic']),
  external_media_id: providerIdSchema,
  media_type: nullableTextSchema,
  title: nullableTextSchema,
  caption: nullableTextSchema,
  campaign_id: nullableTextSchema,
  campaign_name: nullableTextSchema,
  adset_id: nullableTextSchema,
  adset_name: nullableTextSchema,
  ad_id: nullableTextSchema,
  ad_name: nullableTextSchema,
  creative_id: nullableTextSchema,
  thumbnail_url: nullableTextSchema,
  media_url: nullableTextSchema,
  video_url: nullableTextSchema,
  permalink_url: nullableTextSchema,
  published_at: nullableTextSchema,
  metrics: z.record(z.unknown()).default({}),
  last_synced_at: z.string().trim().min(1).max(64),
}).passthrough()

const currencyBreakdownSchema = z.array(z.object({
  currency: z.string().trim().min(1).max(16),
  spend: finiteNumberSchema,
}).passthrough()).max(100)

const marketingSocialSchema = z.object({
  provider: nullableTextSchema.optional().default(null),
  profileName: nullableTextSchema.optional().default(null),
  profileCount: nonNegativeIntegerSchema.optional().default(0),
  followers: nonNegativeIntegerSchema.nullable().optional().default(null),
  followerGrowth: finiteNumberSchema.optional().default(0),
  posts: nonNegativeIntegerSchema.optional().default(0),
  impressions: nonNegativeIntegerSchema.optional().default(0),
  reach: nonNegativeIntegerSchema.optional().default(0),
  interactions: nonNegativeIntegerSchema.optional().default(0),
  likes: nonNegativeIntegerSchema.optional().default(0),
  comments: nonNegativeIntegerSchema.optional().default(0),
  saves: nonNegativeIntegerSchema.optional().default(0),
  shares: nonNegativeIntegerSchema.optional().default(0),
  profileViews: nonNegativeIntegerSchema.optional().default(0),
  websiteClicks: nonNegativeIntegerSchema.optional().default(0),
  videoViews: nonNegativeIntegerSchema.optional().default(0),
  lastSync: nullableTextSchema.optional().default(null),
}).passthrough()

const marketingSummarySchema = z.object({
  totalLeads: nonNegativeIntegerSchema,
  reportedLeads: nonNegativeIntegerSchema.optional().default(0),
  totalContacted: nonNegativeIntegerSchema.optional().default(0),
  totalResponded: nonNegativeIntegerSchema.optional().default(0),
  totalQualified: nonNegativeIntegerSchema.optional().default(0),
  totalWon: nonNegativeIntegerSchema,
  totalLost: nonNegativeIntegerSchema.optional().default(0),
  totalOpen: nonNegativeIntegerSchema.optional().default(0),
  totalRevenue: finiteNumberSchema,
  totalCampaigns: nonNegativeIntegerSchema,
  totalAdsets: nonNegativeIntegerSchema,
  totalAds: nonNegativeIntegerSchema,
  totalSpend: nullableMetricSchema,
  currency: z.string().trim().min(1).max(16).nullable().optional().default(null),
  currencyBreakdown: currencyBreakdownSchema.optional().default([]),
  avgCpl: nullableMetricSchema,
  totalImpressions: nullableMetricSchema,
  totalReach: nullableMetricSchema,
  totalClicks: nullableMetricSchema.optional().default(null),
  totalLinkClicks: nullableMetricSchema.optional().default(null),
  conversations_count: nonNegativeIntegerSchema,
  reportedCpl: nullableMetricSchema.optional().default(null),
  cpql: nullableMetricSchema.optional().default(null),
  cac: nullableMetricSchema.optional().default(null),
  ctr: nullableMetricSchema.optional().default(null),
  cpc: nullableMetricSchema.optional().default(null),
  cpm: nullableMetricSchema.optional().default(null),
  responseRate: nullableMetricSchema.optional().default(null),
  qualificationRate: nullableMetricSchema.optional().default(null),
  conversionRate: nullableMetricSchema.optional().default(null),
  roas: nullableMetricSchema.optional().default(null),
}).passthrough()

const marketingConnectionSchema = z.object({
  isConnected: z.boolean().optional().default(false),
  connectedPages: nonNegativeIntegerSchema.optional().default(0),
  adAccounts: nonNegativeIntegerSchema.optional().default(0),
  instagramAccounts: nonNegativeIntegerSchema.optional().default(0),
  lastIntegrationSync: nullableTextSchema.optional().default(null),
}).passthrough()

const marketingDataQualitySchema = z.object({
  model: z.string().trim().min(1).max(120).optional().default('legacy_campaign_insights'),
  attribution: z.string().trim().min(1).max(160).optional().default('unavailable'),
  qualification: z.string().trim().min(1).max(160).optional().default('unavailable'),
  hasDailyFacts: z.boolean().optional().default(false),
  hasAccountFacts: z.boolean().optional().default(false),
  hasCRMAttribution: z.boolean().optional().default(false),
  hasCRMEvents: z.boolean().optional().default(false),
  hasCRMScopedFilters: z.boolean().optional().default(false),
  coverageFrom: calendarDateSchema.nullable().optional().default(null),
  coverageTo: calendarDateSchema.nullable().optional().default(null),
  reportTimezone: z.string().trim().min(1).max(120).optional().default('America/Sao_Paulo'),
  socialProfileCount: nonNegativeIntegerSchema.optional().default(0),
  reachAggregation: z.string().trim().min(1).max(120).optional().default('unknown'),
  reachIsUniqueAcrossPeriod: z.boolean().optional().default(false),
  multipleCurrencies: z.boolean().optional().default(false),
  currencyBreakdown: currencyBreakdownSchema.optional().default([]),
  summaryLevel: z.string().trim().min(1).max(120).optional().default('campaign_fallback'),
  legacyRowsIgnored: nonNegativeIntegerSchema.optional().default(0),
}).passthrough()

const EMPTY_SOCIAL = marketingSocialSchema.parse({})
const EMPTY_CONNECTION = marketingConnectionSchema.parse({})
const EMPTY_DATA_QUALITY = marketingDataQualitySchema.parse({})

export const marketingCampaignInsightsSchema = z.object({
  campaigns: z.array(marketingCampaignSchema).max(10_000),
  topCreatives: z.array(marketingTopCreativeSchema).max(10_000),
  dailyData: z.array(marketingDailyPerformanceSchema).max(2_000),
  media: z.array(marketingMediaAssetSchema).max(10_000).optional().default([]),
  social: marketingSocialSchema.optional().default(EMPTY_SOCIAL),
  summary: marketingSummarySchema,
  connection: marketingConnectionSchema.optional().default(EMPTY_CONNECTION),
  dataQuality: marketingDataQualitySchema.optional().default(EMPTY_DATA_QUALITY),
  lastSync: nullableTextSchema,
  hasSpendData: z.boolean(),
}).passthrough()

export const apiMarketingCampaignInsightsResponseSchema = apiEnvelopeSchema(
  marketingCampaignInsightsSchema,
)

export type MarketingCampaignInsights = z.infer<typeof marketingCampaignInsightsSchema>
export type CampaignInsightsQuery = z.infer<typeof campaignInsightsQuerySchema>

export function createEmptyMarketingCampaignInsights(): MarketingCampaignInsights {
  return marketingCampaignInsightsSchema.parse({
    campaigns: [],
    topCreatives: [],
    dailyData: [],
    summary: {
      totalLeads: 0,
      totalWon: 0,
      totalRevenue: 0,
      totalCampaigns: 0,
      totalAdsets: 0,
      totalAds: 0,
      totalSpend: null,
      avgCpl: null,
      totalImpressions: null,
      totalReach: null,
      conversations_count: 0,
    },
    lastSync: null,
    hasSpendData: false,
  })
}
