import assert from "node:assert/strict";
import test from "node:test";

import {
  MARKETING_TABS,
  buildMarketingTabHrefs,
  normalizeMarketingTab,
} from "../../components/features/marketing/marketing-tabs";
import {
  campaignInsightsQuerySchema,
  createEmptyMarketingCampaignInsights,
  marketingCampaignInsightsSchema,
  metaMarketingSyncInputSchema,
  metaMarketingSyncResponseSchema,
} from "./marketing";

test("abas de Marketing mantêm a URL como fonte e preservam outros parâmetros", () => {
  const hrefs = buildMarketingTabHrefs({
    tab: "paid",
    period: "30d",
    source: ["meta", "instagram"],
  });

  assert.equal(normalizeMarketingTab("unknown"), "overview");
  assert.deepEqual(
    MARKETING_TABS.map(({ key, label }) => ({ key, label })),
    [
      { key: "overview", label: "Visão geral" },
      { key: "paid", label: "Campanhas" },
      { key: "media", label: "Mídia" },
      { key: "acquisition", label: "Aquisição" },
      { key: "social", label: "Social" },
    ],
  );
  for (const removedTab of ["relationship", "reputation", "intelligence"]) {
    assert.equal(normalizeMarketingTab(removedTab), "overview");
  }
  assert.equal(
    hrefs.media,
    "/marketing?period=30d&source=meta&source=instagram&tab=media",
  );
});

test("consulta de Marketing usa datas civis e remove sentinelas antigas", () => {
  const parsed = campaignInsightsQuerySchema.parse({
    dateFrom: "2026-07-01",
    dateTo: "2026-07-31",
    accountId: "act_123456789",
    objective: "OUTCOME_LEADS",
    teamId: "all",
    userId: null,
    source: "  meta  ",
    dealStatus: "ALL",
  });

  assert.equal(parsed.dateFrom, "2026-07-01");
  assert.equal(parsed.accountId, "act_123456789");
  assert.equal(parsed.objective, "OUTCOME_LEADS");
  assert.equal(parsed.dateTo, "2026-07-31");
  assert.equal(parsed.teamId, undefined);
  assert.equal(parsed.userId, undefined);
  assert.equal(parsed.source, "meta");
  assert.equal(parsed.dealStatus, undefined);
  assert.equal(
    campaignInsightsQuerySchema.safeParse({
      dateFrom: "2026-07-01T03:00:00.000Z",
      dateTo: "2026-07-31",
    }).success,
    false,
  );
});

test("consulta de Marketing aceita múltiplas tags e rejeita UUID inválido", () => {
  const parsed = campaignInsightsQuerySchema.parse({
    dateFrom: "2026-07-01",
    dateTo: "2026-07-31",
    tagIds:
      "33333333-3333-4333-8333-333333333333,44444444-4444-4444-8444-444444444444,33333333-3333-4333-8333-333333333333",
  });

  assert.equal(
    parsed.tagIds,
    "33333333-3333-4333-8333-333333333333,44444444-4444-4444-8444-444444444444",
  );
  assert.equal(
    campaignInsightsQuerySchema.safeParse({
      dateFrom: "2026-07-01",
      dateTo: "2026-07-31",
      tagIds: "33333333-3333-4333-8333-333333333333,inválida",
    }).success,
    false,
  );
});

test("consulta de Marketing rejeita período invertido ou maior que 366 dias", () => {
  assert.equal(
    campaignInsightsQuerySchema.safeParse({
      dateFrom: "2026-08-01",
      dateTo: "2026-07-31",
    }).success,
    false,
  );
  assert.equal(
    campaignInsightsQuerySchema.safeParse({
      dateFrom: "2025-01-01",
      dateTo: "2026-01-02",
    }).success,
    false,
  );
});

test("sincronização Meta limita cada lote a 90 dias e normaliza a resposta", () => {
  assert.equal(
    metaMarketingSyncInputSchema.safeParse({
      date_start: "2026-01-01",
      date_stop: "2026-03-31",
    }).success,
    true,
  );
  assert.equal(
    metaMarketingSyncInputSchema.safeParse({
      date_start: "2026-01-01",
      date_stop: "2026-04-01",
    }).success,
    false,
  );

  const response = metaMarketingSyncResponseSchema.parse({ synced: 4 });
  assert.equal(response.success, true);
  assert.equal(response.synced, 4);
  assert.deepEqual(response.errors, []);
});

test("contrato de Marketing normaliza resposta legada sem inventar atribuição", () => {
  const parsed = marketingCampaignInsightsSchema.parse({
    campaigns: [],
    topCreatives: [],
    dailyData: [
      {
        date: "2026-07-10",
        leads: 2,
        conversations: 1,
        total: 3,
      },
    ],
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
    lastSync: "2026-07-10T12:00:00Z",
    hasSpendData: true,
  });

  assert.equal(parsed.dailyData[0]?.clicks, 0);
  assert.deepEqual(parsed.media, []);
  assert.equal(parsed.connection.isConnected, false);
  assert.equal(parsed.connection.marketingTokenAvailable, false);
  assert.equal(parsed.connection.instagramInsightsAvailable, false);
  assert.equal(parsed.dataQuality.hasCRMAttribution, false);
});

test("contrato de Marketing aceita capacidades sanitizadas sem credenciais", () => {
  const parsed = marketingCampaignInsightsSchema.parse({
    ...createEmptyMarketingCampaignInsights(),
    connection: {
      isConnected: true,
      connectedPages: 1,
      adAccounts: 1,
      instagramAccounts: 1,
      marketingTokenAvailable: true,
      instagramInsightsAvailable: true,
      lastIntegrationSync: null,
    },
  });

  assert.equal(parsed.connection.marketingTokenAvailable, true);
  assert.equal(parsed.connection.instagramInsightsAvailable, true);
});

test("contrato de Marketing separa resultados Meta de leads atribuídos no CRM", () => {
  const parsed = marketingCampaignInsightsSchema.parse({
    ...createEmptyMarketingCampaignInsights(),
    filterOptions: {
      accounts: [{ id: "act_123", name: "Conta principal", currency: "BRL" }],
      objectives: [{ value: "OUTCOME_LEADS", label: "Outcome Leads" }],
    },
    summary: {
      ...createEmptyMarketingCampaignInsights().summary,
      reportedLeads: 5,
      metaReportedLeads: 5,
      metaReportedConversations: 3,
      reportedResults: 8,
      totalLeads: 4,
      crmAttributedLeads: 4,
      captureGap: 4,
      captureRate: 50,
    },
  });

  assert.equal(parsed.summary.reportedResults, 8);
  assert.equal(parsed.summary.crmAttributedLeads, 4);
  assert.equal(parsed.summary.captureGap, 4);
  assert.equal(parsed.dataQuality.reportedResultsMayOverlap, true);
  assert.equal(parsed.filterOptions.accounts[0]?.id, "act_123");
  assert.equal(parsed.filterOptions.objectives[0]?.value, "OUTCOME_LEADS");
});

test("contrato de Marketing preserva metadados reais de conjuntos e anúncios", () => {
  const parsed = marketingCampaignInsightsSchema.parse({
    ...createEmptyMarketingCampaignInsights(),
    campaigns: [
      {
        campaign_id: "campaign_1",
        campaign_name: "Campanha residencial",
        spend: 100,
        impressions: 1_000,
        reach: 800,
        leads_count: 3,
        conversations_count: 2,
        won_count: 1,
        revenue: 450_000,
        cpl: 33.33,
        ctr: 1.5,
        hook_rate: 20,
        status: "ACTIVE",
        budget: 50,
        budget_type: "daily",
        objective: "OUTCOME_LEADS",
        adsets: [
          {
            adset_id: "adset_1",
            adset_name: "Público interessado",
            status: "ACTIVE",
            budget: 25,
            budget_type: "daily",
            optimization_goal: "LEAD_GENERATION",
            ads: [
              {
                ad_id: "ad_1",
                ad_name: "Criativo principal",
                status: "PAUSED",
                creative_id: "creative_1",
              },
            ],
          },
        ],
      },
    ],
  });

  const adset = parsed.campaigns[0]?.adsets[0];
  const ad = adset?.ads[0];
  assert.equal(adset?.budget, 25);
  assert.equal(adset?.budget_type, "daily");
  assert.equal(adset?.optimization_goal, "LEAD_GENERATION");
  assert.equal(ad?.status, "PAUSED");
  assert.equal(ad?.creative_id, "creative_1");
});

test("contrato de Marketing rejeita números não finitos e coleções malformadas", () => {
  const empty = createEmptyMarketingCampaignInsights();
  assert.equal(empty.summary.totalLeads, 0);
  assert.equal(
    marketingCampaignInsightsSchema.safeParse({
      ...empty,
      campaigns: {},
    }).success,
    false,
  );
  assert.equal(
    marketingCampaignInsightsSchema.safeParse({
      ...empty,
      summary: { ...empty.summary, totalRevenue: Number.NaN },
    }).success,
    false,
  );
});
