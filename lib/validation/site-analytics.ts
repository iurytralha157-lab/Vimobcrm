import { z } from "zod";

import {
  apiEnvelopeSchema,
  nonNegativeIntegerSchema,
  uuidSchema,
} from "./common";

const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return (
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, "Data inválida");
const finiteNumberSchema = z.number().finite();
const nonNegativeNumberSchema = finiteNumberSchema.min(0);
const percentageSchema = nonNegativeNumberSchema.max(100);
const nullableTextSchema = z.string().trim().max(4_096).nullable();
// Anonymous visitors write these values, so the longest stored value decides:
// shorten for display rather than let one visit break the screen.
const clippedTextSchema = (maxLength: number) =>
  z.string().transform((value) => value.trim().slice(0, maxLength));
const clippedNullableTextSchema = (maxLength: number, fallback: string) =>
  z
    .string()
    .nullable()
    .transform((value) => value?.trim().slice(0, maxLength) || fallback);
const eventTypeSchema = z.string().trim().min(1).max(120);
const pagePathSchema = z
  .string()
  .trim()
  .max(4_096)
  .nullable()
  .transform((value) => value || "/");
const acquisitionSourceTypeSchema = z.enum([
  "direct",
  "search",
  "social",
  "campaign",
  "referral",
]);
const siteDeviceTypeSchema = z.enum(["desktop", "mobile", "tablet", "other"]);
const timestampValueSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine(
    (value) => Number.isFinite(new Date(value).getTime()),
    "Data e hora inválidas",
  );

export function formatSiteAnalyticsDate(value?: Date | null) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
    return null;
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export const siteAnalyticsQuerySchema = z
  .object({
    dateFrom: calendarDateSchema,
    dateTo: calendarDateSchema,
  })
  .strict()
  .superRefine((query, context) => {
    const start = new Date(`${query.dateFrom}T00:00:00.000Z`);
    const end = new Date(`${query.dateTo}T00:00:00.000Z`);

    if (end < start) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dateTo"],
        message: "A data final deve ser igual ou posterior à inicial",
      });
      return;
    }

    if (end.getTime() - start.getTime() > 365 * 24 * 60 * 60 * 1_000) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dateTo"],
        message: "O período não pode ultrapassar 366 dias",
      });
    }
  });

export const siteAnalyticsSummarySchema = z
  .object({
    lastCollectedAt: timestampValueSchema.nullable().optional().default(null),
    totalViews: nonNegativeIntegerSchema,
    totalPages: nonNegativeIntegerSchema,
    uniquePages: nonNegativeIntegerSchema,
    uniqueSessions: nonNegativeIntegerSchema,
    measuredSessions: nonNegativeIntegerSchema.optional().default(0),
    avgDuration: nonNegativeNumberSchema,
    desktopPct: percentageSchema,
    mobilePct: percentageSchema,
    tabletPct: percentageSchema,
    otherDevicePct: percentageSchema.optional().default(0),
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
  })
  .passthrough();

const topPropertySchema = z
  .object({
    property_id: uuidSchema,
    title: clippedNullableTextSchema(500, "Imóvel"),
    code: clippedNullableTextSchema(120, "—"),
    views: nonNegativeIntegerSchema,
    favorites: nonNegativeIntegerSchema,
  })
  .passthrough();

const topPageSchema = z
  .object({
    page_path: pagePathSchema,
    views: nonNegativeIntegerSchema,
  })
  .passthrough();

const dailyViewSchema = z
  .object({
    date: calendarDateSchema,
    views: nonNegativeIntegerSchema,
  })
  .passthrough();

const campaignSchema = z
  .object({
    source: clippedNullableTextSchema(255, "Direto"),
    campaign: clippedNullableTextSchema(500, "Sem campanha"),
    source_type: acquisitionSourceTypeSchema.optional(),
    sessions: nonNegativeIntegerSchema,
    conversions: nonNegativeIntegerSchema,
  })
  .passthrough();

const searchTermSchema = z
  .object({
    term: z.string().trim().min(1).max(500),
    searches: nonNegativeIntegerSchema,
  })
  .passthrough();

const nullableCountSchema = nonNegativeNumberSchema.nullable().optional().default(null);
const nullablePercentageSchema = percentageSchema.nullable().optional().default(null);
const insightTitleSchema = z
  .string()
  .trim()
  .nullable()
  .optional()
  .transform((value) => value?.slice(0, 500) ?? null);

const insightPageSchema = z
  .object({
    page_path: pagePathSchema,
    title: insightTitleSchema,
    views: nonNegativeIntegerSchema,
    sessions: nonNegativeIntegerSchema,
    entries: nonNegativeIntegerSchema,
    bounce_rate: nullablePercentageSchema,
    measured_sessions: nonNegativeIntegerSchema,
    avg_duration: nullableCountSchema,
    leads: nonNegativeIntegerSchema,
    conversion_rate: nullablePercentageSchema,
  })
  .passthrough();

const insightLeadPageSchema = z
  .object({
    page_path: pagePathSchema,
    title: insightTitleSchema,
    leads: nonNegativeIntegerSchema,
  })
  .passthrough();

const insightPropertySchema = z
  .object({
    property_id: uuidSchema,
    title: clippedTextSchema(500),
    code: clippedTextSchema(120),
    business_type: nullableTextSchema.optional().default(null),
    property_type: nullableTextSchema.optional().default(null),
    neighborhood: nullableTextSchema.optional().default(null),
    city: nullableTextSchema.optional().default(null),
    bedrooms: nullableCountSchema,
    sale_price: nullableCountSchema,
    rent_price: nullableCountSchema,
    photo_url: nullableTextSchema.optional().default(null),
    page_path: pagePathSchema,
    views: nonNegativeIntegerSchema,
    sessions: nonNegativeIntegerSchema,
    favorites: nonNegativeIntegerSchema,
    whatsapp_clicks: nonNegativeIntegerSchema,
    form_submits: nonNegativeIntegerSchema,
    leads: nonNegativeIntegerSchema,
    avg_duration: nullableCountSchema,
    conversion_rate: nullablePercentageSchema,
  })
  .passthrough();

const insightSourceSchema = z
  .object({
    source_type: acquisitionSourceTypeSchema,
    sessions: nonNegativeIntegerSchema,
    prev_sessions: nonNegativeIntegerSchema,
    converted_sessions: nonNegativeIntegerSchema,
    leads: nonNegativeIntegerSchema,
  })
  .passthrough();

const insightDeviceSchema = z
  .object({
    device_type: siteDeviceTypeSchema,
    sessions: nonNegativeIntegerSchema,
    converted_sessions: nonNegativeIntegerSchema,
    leads: nonNegativeIntegerSchema,
  })
  .passthrough();

const insightCampaignSchema = z
  .object({
    campaign: clippedTextSchema(500),
    source: clippedTextSchema(255),
    medium: nullableTextSchema.optional().default(null),
    sessions: nonNegativeIntegerSchema,
    converted_sessions: nonNegativeIntegerSchema,
    leads: nonNegativeIntegerSchema,
  })
  .passthrough();

const insightContactPathSchema = z
  .object({
    path: z.string().trim().min(1).max(4_096),
    sessions: nonNegativeIntegerSchema,
  })
  .passthrough();

const insightDailySchema = z
  .object({
    date: calendarDateSchema,
    sessions: nonNegativeIntegerSchema,
    views: nonNegativeIntegerSchema,
    leads: nonNegativeIntegerSchema,
  })
  .passthrough();

const optionalCount = nonNegativeIntegerSchema.optional().default(0);

const insightPeriodSchema = z
  .object({
    sessions: optionalCount,
    property_sessions: optionalCount,
    search_sessions: optionalCount,
    interaction_sessions: optionalCount,
    contact_sessions: optionalCount,
    lead_sessions: optionalCount,
    converted_sessions: optionalCount,
    pages_per_session: nonNegativeNumberSchema.optional().default(0),
    bounce_rate: percentageSchema.optional().default(0),
    median_seconds_to_contact: nullableCountSchema,
    views: optionalCount,
    property_views: optionalCount,
    searches: optionalCount,
    favorites: optionalCount,
    whatsapp_clicks: optionalCount,
    cta_clicks: optionalCount,
    form_submits: optionalCount,
    contacts: optionalCount,
  })
  .passthrough();

export const siteDashboardInsightsSchema = z
  .object({
    pages: z.array(insightPageSchema).max(100),
    leadPages: z.array(insightLeadPageSchema).max(100),
    properties: z.array(insightPropertySchema).max(100),
    sources: z.array(insightSourceSchema).max(10),
    devices: z.array(insightDeviceSchema).max(10),
    campaigns: z.array(insightCampaignSchema).max(100),
    contactPaths: z.array(insightContactPathSchema).max(100),
    daily: z.array(insightDailySchema).max(366),
    searchQueries: z.array(searchTermSchema).max(100),
    current: insightPeriodSchema.extend({
      viewed_properties: optionalCount,
      leads: optionalCount,
      returning_leads: optionalCount,
      avg_pages_to_contact: nullableCountSchema,
    }),
    previous: insightPeriodSchema.extend({
      site_leads: optionalCount,
    }),
  })
  .passthrough();

export const siteAnalyticsDetailedSchema = z
  .object({
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
    // The breakdown is optional for the screen: unexpected data loses it, not the page.
    insights: siteDashboardInsightsSchema.nullable().optional().default(null).catch(null),
  })
  .passthrough();

export const leadJourneySchema = z
  .object({
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
    has_lead: z.boolean().optional().default(false),
    seconds_to_contact: nonNegativeNumberSchema.nullable().optional().default(null),
    pages_to_contact: nonNegativeNumberSchema.nullable().optional().default(null),
  })
  .passthrough();

const funnelStepSchema = z
  .object({
    event_type: eventTypeSchema,
    total: nonNegativeIntegerSchema,
  })
  .passthrough();

const deviceBreakdownSchema = z
  .object({
    device_type: siteDeviceTypeSchema,
    total: nonNegativeIntegerSchema,
  })
  .passthrough();

export const siteVisitorLocationSchema = z
  .object({
    city: z.string().trim().min(1).max(255),
    region: nullableTextSchema,
    country: nullableTextSchema,
    lat: finiteNumberSchema.min(-90).max(90).nullable(),
    lng: finiteNumberSchema.min(-180).max(180).nullable(),
    sessions: nonNegativeIntegerSchema,
  })
  .passthrough();

export const leadAnalyticsDataSchema = z
  .object({
    journeys: z.array(leadJourneySchema).max(100),
    funnel: z.array(funnelStepSchema).max(1_000),
    top_pages: z.array(topPageSchema).max(100),
    daily_views: z.array(dailyViewSchema).max(366),
    total_sessions: nonNegativeIntegerSchema,
    total_conversions: nonNegativeIntegerSchema,
    total_converted_sessions: nonNegativeIntegerSchema,
    total_interactions: nonNegativeIntegerSchema.optional().default(0),
    device_breakdown: z.array(deviceBreakdownSchema).max(100),
    locations: z.array(siteVisitorLocationSchema).max(100),
  })
  .passthrough();

export const apiSiteAnalyticsSummaryResponseSchema = apiEnvelopeSchema(
  siteAnalyticsSummarySchema,
);
export const apiSiteAnalyticsDetailedResponseSchema = apiEnvelopeSchema(
  siteAnalyticsDetailedSchema,
);
export const apiLeadAnalyticsResponseSchema = apiEnvelopeSchema(
  leadAnalyticsDataSchema,
);

export type SiteAnalyticsQuery = z.infer<typeof siteAnalyticsQuerySchema>;
export type SiteAnalyticsSummary = z.infer<typeof siteAnalyticsSummarySchema>;
export type SiteAnalyticsDetailed = z.infer<typeof siteAnalyticsDetailedSchema>;
export type SiteDashboardInsights = z.infer<typeof siteDashboardInsightsSchema>;
export type LeadAnalyticsData = z.infer<typeof leadAnalyticsDataSchema>;
export type LeadJourney = z.infer<typeof leadJourneySchema>;
export type FunnelStep = z.infer<typeof funnelStepSchema>;
export type TopPage = z.infer<typeof topPageSchema>;
export type DailyView = z.infer<typeof dailyViewSchema>;
export type DeviceBreakdown = z.infer<typeof deviceBreakdownSchema>;
export type LocationData = z.infer<typeof siteVisitorLocationSchema>;
