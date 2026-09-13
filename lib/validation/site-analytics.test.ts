import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  apiLeadAnalyticsResponseSchema,
  apiSiteAnalyticsDetailedResponseSchema,
  apiSiteAnalyticsSummaryResponseSchema,
  formatSiteAnalyticsDate,
  siteAnalyticsQuerySchema,
} from "./site-analytics";

const SUMMARY = {
  lastCollectedAt: "2026-08-16T18:30:00Z",
  totalViews: 12,
  totalPages: 12,
  uniquePages: 4,
  uniqueSessions: 5,
  measuredSessions: 3,
  avgDuration: 30,
  desktopPct: 40,
  mobilePct: 50,
  tabletPct: 0,
  otherDevicePct: 10,
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
};

test("consulta de analytics do site usa datas civis e limita o período", () => {
  assert.equal(formatSiteAnalyticsDate(new Date(Number.NaN)), null);
  assert.equal(
    formatSiteAnalyticsDate(new Date(2026, 7, 16, 23, 30)),
    "2026-08-16",
  );
  assert.equal(
    siteAnalyticsQuerySchema.safeParse({
      dateFrom: "2026-01-01",
      dateTo: "2026-12-31",
    }).success,
    true,
  );
  assert.equal(
    siteAnalyticsQuerySchema.safeParse({
      dateFrom: "2026-01-01T03:00:00.000Z",
      dateTo: "2026-01-31T02:59:59.999Z",
    }).success,
    false,
  );
  assert.equal(
    siteAnalyticsQuerySchema.safeParse({
      dateFrom: "2026-08-02",
      dateTo: "2026-08-01",
    }).success,
    false,
  );
  assert.equal(
    siteAnalyticsQuerySchema.safeParse({
      dateFrom: "2025-01-01",
      dateTo: "2026-01-02",
    }).success,
    false,
  );
});

test("resumo do site rejeita percentuais e números inválidos", () => {
  assert.equal(
    apiSiteAnalyticsSummaryResponseSchema.safeParse({ data: SUMMARY }).success,
    true,
  );
  assert.equal(
    SUMMARY.desktopPct +
      SUMMARY.mobilePct +
      SUMMARY.tabletPct +
      SUMMARY.otherDevicePct,
    100,
  );
  assert.equal(
    apiSiteAnalyticsSummaryResponseSchema.parse({
      data: { ...SUMMARY, lastCollectedAt: undefined },
    }).data.lastCollectedAt,
    null,
  );
  const withoutOtherDevice = { ...SUMMARY } as Partial<typeof SUMMARY>;
  delete withoutOtherDevice.otherDevicePct;
  assert.equal(
    apiSiteAnalyticsSummaryResponseSchema.parse({ data: withoutOtherDevice })
      .data.otherDevicePct,
    0,
  );
  const withoutMeasuredSessions = { ...SUMMARY } as Partial<typeof SUMMARY>;
  delete withoutMeasuredSessions.measuredSessions;
  assert.equal(
    apiSiteAnalyticsSummaryResponseSchema.parse({
      data: withoutMeasuredSessions,
    }).data.measuredSessions,
    0,
  );
  assert.equal(
    apiSiteAnalyticsSummaryResponseSchema.safeParse({
      data: { ...SUMMARY, totalViews: Number.NaN },
    }).success,
    false,
  );
  assert.equal(
    apiSiteAnalyticsSummaryResponseSchema.safeParse({
      data: { ...SUMMARY, mobilePct: 101 },
    }).success,
    false,
  );
  assert.equal(
    apiSiteAnalyticsSummaryResponseSchema.safeParse({
      data: { ...SUMMARY, lastCollectedAt: "data-inválida" },
    }).success,
    false,
  );
});

test("detalhamento do site normaliza textos nulos sem aceitar coleções malformadas", () => {
  const result = apiSiteAnalyticsDetailedResponseSchema.parse({
    data: {
      topProperties: [],
      topPages: [{ page_path: null, views: 2 }],
      dailyViews: [{ date: "2026-08-01", views: 2 }],
      conversionRate: 0,
      totalSessions: 1,
      totalConversions: 0,
      siteLeads: 0,
      campaigns: [
        {
          source: "google",
          campaign: "imoveis-sp",
          source_type: "campaign",
          sessions: 1,
          conversions: 0,
        },
      ],
      searchTerms: [],
      pagesPerSession: 2,
      bounceRate: 0,
      liveVisitors: 1,
    },
  });
  assert.equal(result.data.topPages[0]?.page_path, "/");
  assert.equal(result.data.campaigns[0]?.source_type, "campaign");
  assert.equal(
    apiSiteAnalyticsDetailedResponseSchema.safeParse({
      data: { ...result.data, dailyViews: "inválido" },
    }).success,
    false,
  );
  assert.equal(
    apiSiteAnalyticsDetailedResponseSchema.safeParse({
      data: {
        ...result.data,
        campaigns: [
          { ...result.data.campaigns[0], source_type: "organic-paid" },
        ],
      },
    }).success,
    false,
  );
});

test("jornadas validam datas, coordenadas e sequências antes de renderizar", () => {
  const valid = {
    data: {
      journeys: [
        {
          session_id: "session-1",
          path_sequence: ["/imoveis"],
          event_sequence: ["page_view"],
          first_event: "2026-08-01T12:00:00Z",
          last_event: "2026-08-01T12:01:00Z",
          total_events: 1,
          converted: false,
          device_type: "mobile",
          browser: "Chrome",
          os: null,
          city: "Macaé",
          region: "RJ",
          country: "BR",
          utm_source: null,
          referrer: null,
        },
      ],
      funnel: [{ event_type: "page_view", total: 1 }],
      top_pages: [{ page_path: "/imoveis", views: 1 }],
      daily_views: [{ date: "2026-08-01", views: 1 }],
      total_sessions: 1,
      total_conversions: 2,
      total_converted_sessions: 1,
      total_interactions: 1,
      device_breakdown: [{ device_type: "mobile", total: 1 }],
      locations: [
        {
          city: "Macaé",
          region: "RJ",
          country: "BR",
          lat: -22.37,
          lng: -41.78,
          sessions: 1,
        },
      ],
    },
  };
  assert.equal(apiLeadAnalyticsResponseSchema.safeParse(valid).success, true);
  const withoutConvertedSessions: Record<string, unknown> = { ...valid.data };
  delete withoutConvertedSessions.total_converted_sessions;
  assert.equal(
    apiLeadAnalyticsResponseSchema.safeParse({ data: withoutConvertedSessions })
      .success,
    false,
  );
  const withoutInteractions: Record<string, unknown> = { ...valid.data };
  delete withoutInteractions.total_interactions;
  assert.equal(
    apiLeadAnalyticsResponseSchema.parse({ data: withoutInteractions }).data
      .total_interactions,
    0,
  );
  assert.equal(
    apiLeadAnalyticsResponseSchema.safeParse({
      data: {
        ...valid.data,
        locations: [{ ...valid.data.locations[0], lat: 120 }],
      },
    }).success,
    false,
  );
  assert.equal(
    apiLeadAnalyticsResponseSchema.safeParse({
      data: {
        ...valid.data,
        journeys: [{ ...valid.data.journeys[0], first_event: "data-inválida" }],
      },
    }).success,
    false,
  );
  assert.equal(
    apiLeadAnalyticsResponseSchema.safeParse({
      data: {
        ...valid.data,
        device_breakdown: [{ device_type: "smart-tv", total: 1 }],
      },
    }).success,
    false,
  );
});

test("dashboard mostra explicitamente dispositivos desconhecidos sem renormalizar os conhecidos", () => {
  const source = readFileSync(
    "components/features/site/SiteAnalyticsTab.tsx",
    "utf8",
  );

  assert.match(source, /data\?\.otherDevicePct/);
  assert.match(source, /Outros \/ não identificados/);
  assert.doesNotMatch(source, /desktopPct\s*\/\s*\([^)]*desktopPct/);
});

test("taxa de conversao da jornada usa sessoes convertidas sem alterar eventos brutos", () => {
  const source = readFileSync(
    "components/features/site/LeadJourneyDashboard.tsx",
    "utf8",
  );

  assert.match(
    source,
    /analytics\.total_converted_sessions \/ analytics\.total_sessions/,
  );
  assert.doesNotMatch(
    source,
    /analytics\.total_conversions \/ analytics\.total_sessions/,
  );
  assert.match(source, /\{analytics\.total_conversions\}/);
});
