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
    "components/features/site/dashboard/site-dashboard-format.ts",
    "utf8",
  );

  assert.match(source, /summary\.otherDevicePct/);
  assert.match(source, /Outros \/ não identificados/);
  assert.doesNotMatch(source, /desktopPct\s*\/\s*\([^)]*desktopPct/);
});

test("taxa de conversao do dashboard usa sessoes convertidas sem alterar eventos brutos", () => {
  const origins = readFileSync(
    "components/features/site/dashboard/SiteOriginsTab.tsx",
    "utf8",
  );
  const journeys = readFileSync(
    "components/features/site/dashboard/SiteJourneysTab.tsx",
    "utf8",
  );

  assert.match(origins, /percentOf\(channel\.row\.converted_sessions, channel\.row\.sessions\)/);
  assert.match(origins, /percentOf\(row\.converted_sessions, row\.sessions\)/);
  assert.doesNotMatch(origins, /percentOf\([^)]*form_submits[^)]*sessions/);
  assert.match(journeys, /value: current\.form_submits/);
});

const DETAILED_WITHOUT_INSIGHTS = {
  topProperties: [],
  topPages: [],
  dailyViews: [],
  conversionRate: 0,
  totalSessions: 0,
  totalConversions: 0,
  siteLeads: 0,
  campaigns: [],
  searchTerms: [],
  pagesPerSession: 0,
  bounceRate: 0,
  liveVisitors: 0,
};

const INSIGHTS = {
  pages: [
    {
      page_path: "/imovel/ap1",
      title: "Apto Noroeste",
      views: 4,
      sessions: 2,
      entries: 1,
      bounce_rate: 0,
      measured_sessions: 1,
      avg_duration: 90,
      leads: 1,
      conversion_rate: 100,
    },
    {
      page_path: "/sem-medicao",
      title: null,
      views: 1,
      sessions: 1,
      entries: 0,
      bounce_rate: null,
      measured_sessions: 0,
      avg_duration: null,
      leads: 0,
      conversion_rate: null,
    },
  ],
  leadPages: [{ page_path: "/", title: null, leads: 2 }],
  properties: [
    {
      property_id: "00000000-0000-4000-8000-0000000000a1",
      title: "Apto Noroeste",
      code: "AP1",
      business_type: "Venda",
      property_type: null,
      neighborhood: "Noroeste",
      city: null,
      bedrooms: 3,
      sale_price: 780000,
      rent_price: null,
      photo_url: null,
      page_path: "/imovel/ap1",
      views: 4,
      sessions: 2,
      favorites: 1,
      whatsapp_clicks: 1,
      form_submits: 2,
      leads: 2,
      avg_duration: null,
      conversion_rate: 100,
    },
  ],
  sources: [{ source_type: "social", sessions: 1, prev_sessions: 0, converted_sessions: 1, leads: 1 }],
  devices: [{ device_type: "mobile", sessions: 1, converted_sessions: 1, leads: 1 }],
  campaigns: [{ campaign: "Park Sul", source: "meta", medium: "cpc", sessions: 1, converted_sessions: 1, leads: 1 }],
  contactPaths: [{ path: "Imóvel › Formulário", sessions: 1 }],
  daily: [{ date: "2026-06-15", sessions: 1, views: 2, leads: 1 }],
  searchQueries: [{ term: "noroeste", searches: 1 }],
  current: { sessions: 3, median_seconds_to_contact: 270, avg_pages_to_contact: 1.5, viewed_properties: 1, leads: 3, returning_leads: 1 },
  previous: { sessions: 2, site_leads: 0 },
};

test("o detalhamento do dashboard do site é aditivo e não exige insights", () => {
  for (const insights of [undefined, null]) {
    const parsed = apiSiteAnalyticsDetailedResponseSchema.parse({
      data: { ...DETAILED_WITHOUT_INSIGHTS, ...(insights === undefined ? {} : { insights }) },
    });
    assert.equal(parsed.data.insights, null);
  }
});

test("o detalhamento preserva métricas sem medição como nulas, sem virar zero", () => {
  const { insights } = apiSiteAnalyticsDetailedResponseSchema.parse({
    data: { ...DETAILED_WITHOUT_INSIGHTS, insights: INSIGHTS },
  }).data;
  assert.ok(insights);
  assert.equal(insights.pages[1].avg_duration, null);
  assert.equal(insights.pages[1].bounce_rate, null);
  assert.equal(insights.pages[1].title, null);
  assert.equal(insights.properties[0].avg_duration, null);
  assert.equal(insights.current.median_seconds_to_contact, 270);
  assert.equal(insights.previous.median_seconds_to_contact, null);
  assert.equal(insights.previous.views, 0);
});

test("dado fora do contrato no detalhamento perde o detalhamento, não a tela", () => {
  for (const patch of [
    { sources: [{ ...INSIGHTS.sources[0], source_type: "desconhecido" }] },
    { devices: [{ ...INSIGHTS.devices[0], device_type: "tv" }] },
  ]) {
    const parsed = apiSiteAnalyticsDetailedResponseSchema.parse({
      data: { ...DETAILED_WITHOUT_INSIGHTS, insights: { ...INSIGHTS, ...patch } },
    });
    assert.equal(parsed.data.insights, null);
  }
});

test("texto longo vindo do rastreamento público é encurtado, sem derrubar a tela", () => {
  const long = "x".repeat(300);
  const parsed = apiSiteAnalyticsDetailedResponseSchema.parse({
    data: {
      ...DETAILED_WITHOUT_INSIGHTS,
      campaigns: [{ campaign: long, source: long, sessions: 1, converted_sessions: 0, leads: 0, conversions: 0 }],
      insights: {
        ...INSIGHTS,
        campaigns: [{ ...INSIGHTS.campaigns[0], source: long }],
        properties: [{ ...INSIGHTS.properties[0], code: long, title: "y".repeat(600) }],
      },
    },
  }).data;
  assert.equal(parsed.campaigns[0].source.length, 255);
  assert.ok(parsed.insights);
  assert.equal(parsed.insights.campaigns[0].source.length, 255);
  assert.equal(parsed.insights.properties[0].code.length, 120);
  assert.equal(parsed.insights.properties[0].title.length, 500);
});
