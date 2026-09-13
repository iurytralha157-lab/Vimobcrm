import { expect, test, type Page } from "@playwright/test";
import { Pool } from "pg";

import { authenticatedAPIRequest, signInAs } from "./support/auth";
import { E2E_ORGANIZATION_ID, getE2EConfig } from "./support/e2e-env";

const DASHBOARD_RUN_ID = `${process.pid}-${Date.now()}`;
const DASHBOARD_SESSIONS = [
  `e2e-site-dashboard-${DASHBOARD_RUN_ID}-a`,
  `e2e-site-dashboard-${DASHBOARD_RUN_ID}-b`,
] as const;
const DASHBOARD_PAGE_PATH = `/e2e/dashboard-release/${DASHBOARD_RUN_ID}`;

type SiteSummary = {
  uniqueSessions: number;
  totalPages: number;
};

type SiteDetailed = {
  conversionRate: number;
  topPages: Array<{ page_path: string; views: number }>;
};

function metricCard(page: Page, label: string) {
  return page
    .getByText(label, { exact: true })
    .first()
    .locator(
      'xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " app-card ")][1]',
    );
}

test("renderiza as métricas reais da API na dashboard do site", async ({
  page,
}) => {
  const config = getE2EConfig();
  const pool = new Pool({ connectionString: config.databaseURL });

  try {
    await pool.query(
      `delete from public.site_analytics_events
       where organization_id = $1::uuid
         and session_id = any($2::text[])`,
      [E2E_ORGANIZATION_ID, DASHBOARD_SESSIONS],
    );

    const existingTopPage = await pool.query<{ threshold_views: number }>(
      `with report_settings as (
         select coalesce(
           (
             select nullif(btrim(settings.timezone), '')
             from public.organization_attention_settings as settings
             where settings.organization_id = $1::uuid
           ),
           'America/Sao_Paulo'
         ) as timezone_name
       ), time_bounds as (
         select (
             (current_timestamp at time zone timezone_name)::date - 29
           )::timestamp at time zone timezone_name as starts_at,
           (
             (current_timestamp at time zone timezone_name)::date + 1
           )::timestamp at time zone timezone_name as ends_at
         from report_settings
       ), ranked_pages as (
         select count(*)::int as page_views
         from public.site_analytics_events as event
         cross join time_bounds
         where event.organization_id = $1::uuid
           and event.event_type in ('pageview', 'page_view')
           and event.created_at >= time_bounds.starts_at
           and event.created_at < time_bounds.ends_at
         group by event.page_path
         order by page_views desc
         offset 19 limit 1
       )
       select coalesce((select page_views from ranked_pages), 0)::int as threshold_views`,
      [E2E_ORGANIZATION_ID],
    );
    const dashboardPageViewCount = Math.max(
      25,
      (existingTopPage.rows[0]?.threshold_views ?? 0) + 1,
    );

    await pool.query(
      `insert into public.site_analytics_events (
         organization_id,
         session_id,
         event_type,
         page_path,
         page_title,
         device_type,
         browser,
         duration_seconds,
         utm_source,
         utm_medium,
         utm_campaign,
         metadata,
         created_at,
         last_seen_at
       )
       select $1::uuid, $2, 'pageview', $3, 'Dashboard release E2E', 'desktop', 'chrome', null,
           'google', 'cpc', 'dashboard-release-e2e',
           '{"city":"São Paulo","region":"SP","country":"BR","lat":"-23.5505","lng":"-46.6333"}'::jsonb,
            now() - interval '5 minutes', null
       from generate_series(1, $4::int)`,
      [
        E2E_ORGANIZATION_ID,
        DASHBOARD_SESSIONS[0],
        DASHBOARD_PAGE_PATH,
        dashboardPageViewCount,
      ],
    );

    await pool.query(
      `insert into public.site_analytics_events (
         organization_id,
         session_id,
         event_type,
         page_path,
         page_title,
         device_type,
         browser,
         duration_seconds,
         utm_source,
         utm_medium,
         utm_campaign,
         metadata,
         created_at,
         last_seen_at
       ) values
         ($1::uuid, $2, 'page_duration', $4, 'Dashboard release E2E', 'desktop', 'chrome', 90,
           'google', 'cpc', 'dashboard-release-e2e', '{}'::jsonb, now() - interval '3 minutes', now() - interval '1 minute'),
         ($1::uuid, $2, 'form_submit', $4, 'Dashboard release E2E', 'desktop', 'chrome', null,
          'google', 'cpc', 'dashboard-release-e2e', '{}'::jsonb, now() - interval '2 minutes', null),
         ($1::uuid, $3, 'pageview', '/e2e/dashboard-release/obrigado', 'Dashboard release E2E', 'mobile', 'safari', null,
          null, null, null, '{}'::jsonb, now() - interval '1 minute', null)`,
      [
        E2E_ORGANIZATION_ID,
        DASHBOARD_SESSIONS[0],
        DASHBOARD_SESSIONS[1],
        DASHBOARD_PAGE_PATH,
      ],
    );

    await signInAs(page, "admin");

    const summaryResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/v1/analytics/site-summary") &&
        response.request().method() === "GET",
    );
    const detailedResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/v1/analytics/site-detailed") &&
        response.request().method() === "GET",
    );
    const leadAnalyticsResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/v1/analytics/lead") &&
        response.request().method() === "GET",
    );

    await page.goto("/dashboard/site");

    const [summaryResponse, detailedResponse, leadAnalyticsResponse] =
      await Promise.all([
        summaryResponsePromise,
        detailedResponsePromise,
        leadAnalyticsResponsePromise,
      ]);
    expect(summaryResponse.status(), await summaryResponse.text()).toBe(200);
    expect(detailedResponse.status(), await detailedResponse.text()).toBe(200);
    expect(
      leadAnalyticsResponse.status(),
      await leadAnalyticsResponse.text(),
    ).toBe(200);

    const summaryEnvelope = (await summaryResponse.json()) as {
      data: SiteSummary;
    };
    const detailedEnvelope = (await detailedResponse.json()) as {
      data: SiteDetailed;
    };
    const summary = summaryEnvelope.data;
    const detailed = detailedEnvelope.data;

    expect(summary.uniqueSessions).toBeGreaterThanOrEqual(2);
    expect(summary.totalPages).toBeGreaterThanOrEqual(2);
    expect(detailed.conversionRate).toBeGreaterThan(0);
    expect(detailed.topPages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          page_path: DASHBOARD_PAGE_PATH,
          views: dashboardPageViewCount,
        }),
      ]),
    );

    await expect(
      page.getByText("Não foi possível carregar o dashboard do site"),
    ).toHaveCount(0);
    await expect(
      metricCard(page, "Sessões").getByTestId("metric-value"),
    ).toHaveText(String(summary.uniqueSessions));
    await expect(
      metricCard(page, "Páginas vistas").getByTestId("metric-value"),
    ).toHaveText(String(summary.totalPages));
    await expect(
      metricCard(page, "Conversão por sessão").getByTestId("metric-value"),
    ).toHaveText(`${detailed.conversionRate}%`);
    await expect(
      page.getByText(DASHBOARD_PAGE_PATH, { exact: true }),
    ).toBeVisible();
    const originsCard = page.getByTestId("site-visitor-origins-card");
    await expect(originsCard).toBeVisible();
    await expect(originsCard).toContainText("São Paulo, SP, Brasil");
    await expect(originsCard.locator(".leaflet-container")).toBeVisible();
    await expect(
      originsCard.getByText("Não foi possível carregar o mapa"),
    ).toHaveCount(0);
    const mapMarker = originsCard
      .locator('[role="button"][aria-label*="São Paulo"]')
      .first();
    await expect(mapMarker).toBeVisible();
    await mapMarker.focus();
    await mapMarker.press("Enter");
    await expect(originsCard.locator(".leaflet-popup")).toContainText(
      "São Paulo, SP, Brasil",
    );

    await page
      .getByRole("tab", { name: "Percurso dos Leads", exact: true })
      .click();
    await expect(
      page.getByText("Envios de formulário", { exact: true }),
    ).toBeVisible();
    const journeyButton = page.getByRole("button", {
      name: `Ver jornada da sessão ${DASHBOARD_SESSIONS[0]}`,
      exact: true,
    });
    await journeyButton.click();
    await expect(
      page.getByRole("dialog", { name: "Jornada da Sessão" }),
    ).toBeVisible();

    const authenticatedSummary = await authenticatedAPIRequest(
      page,
      "GET",
      new URL(summaryResponse.url()).pathname +
        new URL(summaryResponse.url()).search,
    );
    expect(
      authenticatedSummary.status(),
      await authenticatedSummary.text(),
    ).toBe(200);
  } finally {
    try {
      await pool.query(
        `delete from public.site_analytics_events
         where organization_id = $1::uuid
           and session_id = any($2::text[])`,
        [E2E_ORGANIZATION_ID, DASHBOARD_SESSIONS],
      );
    } finally {
      await pool.end();
    }
  }
});
