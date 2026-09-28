import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';

import { E2E_LEADS, E2E_ORGANIZATION_ID, E2E_PIPELINE_ID, E2E_STAGE_ID, getE2EConfig } from './support/e2e-env';
import { authenticatedAPIRequest, signInAs } from './support/auth';

type DashboardStatsPayload = {
  data: { totalLeads: number; totalEntries: number };
};

type DistributionPayload = {
  data: {
    totalLeads: number;
    users: Array<{ id: string | null; kind: string; name: string; leadCount: number }>;
  };
};

const leadId = randomUUID();
const leadName = `Lead sem responsável QA ${leadId.slice(0, 8)}`;
let pool: Pool | undefined;
let inserted = false;

async function dashboardCounts(page: Page, userId?: string) {
  const query = userId ? `?userId=${encodeURIComponent(userId)}` : '';
  const [statsResponse, distributionResponse] = await Promise.all([
    authenticatedAPIRequest(page, 'GET', `/v1/dashboard/stats${query}`),
    authenticatedAPIRequest(page, 'GET', `/v1/dashboard/lead-distribution${query}`),
  ]);
  const [statsBody, distributionBody] = await Promise.all([
    statsResponse.text(),
    distributionResponse.text(),
  ]);
  expect(statsResponse.ok(), statsBody).toBeTruthy();
  expect(distributionResponse.ok(), distributionBody).toBeTruthy();
  return {
    stats: (JSON.parse(statsBody) as DashboardStatsPayload).data,
    distribution: (JSON.parse(distributionBody) as DistributionPayload).data,
  };
}

async function selectUnassigned(page: Page) {
  await page.locator('[data-tour="dashboard-advanced-filters"]').click();
  const filters = page.locator('[data-tour="dashboard-filters-panel"]');
  await expect(filters).toBeVisible();
  const userFilter = filters.locator('button[role="combobox"]').filter({ hasText: /^Todos$/ });
  await expect(userFilter).toBeVisible({ timeout: 20_000 });
  await userFilter.click({ timeout: 20_000 });
  await page.getByRole('option', { name: 'Sem responsável' }).click({ timeout: 20_000 });
  await page.locator('[data-tour="dashboard-advanced-filters"]').click();
  await expect(filters).toBeHidden();
}

async function expectUnassignedChart(page: Page) {
  const { stats, distribution } = await dashboardCounts(page, 'unassigned');
  expect(stats.totalLeads).toBe(1);
  expect(stats.totalEntries).toBe(1);
  expect(distribution.totalLeads).toBe(stats.totalLeads);
  expect(distribution.users.filter((row) => row.leadCount > 0)).toEqual([
    expect.objectContaining({ id: null, kind: 'unassigned', name: 'Sem responsável', leadCount: 1 }),
  ]);

  const kpi = page.locator('[data-tour="dashboard-kpi-leads"][role="button"]');
  await expect(kpi.locator('p').nth(1)).toHaveText('1');
  const chart = page.getByRole('region', { name: 'Leads sem responsável' });
  await expect(chart).toBeVisible();
  await expect(chart.getByRole('button', { name: 'Remover filtro de Sem responsável: 1 lead' }))
    .toHaveAttribute('aria-pressed', 'true');
  return chart;
}

test.describe('gráfico de leads sem responsável na Dashboard QA isolada', () => {
  test.beforeAll(async () => {
    if (!process.env.E2E_SUPABASE_WORKDIR) {
      throw new Error('Este teste exige a stack Supabase QA isolada.');
    }
    const config = getE2EConfig();
    if (
      new URL(config.supabaseURL).port !== '56421' ||
      new URL(config.databaseURL).port !== '56422' ||
      new URL(config.baseURL).port !== '3100' ||
      new URL(config.apiURL).port !== '8181'
    ) {
      throw new Error('Este teste só pode usar a stack QA 56421/56422 com frontend 3100 e API 8181.');
    }

    pool = new Pool({ connectionString: config.databaseURL });
    const baseline = await pool.query<{ count: string }>(
      'select count(*)::text as count from public.leads where organization_id = $1::uuid and assigned_user_id is null',
      [E2E_ORGANIZATION_ID],
    );
    expect(Number(baseline.rows[0]?.count)).toBe(0);

    const createdBy = await pool.query<{ created_by: string }>(
      'select created_by from public.leads where id = $1::uuid and organization_id = $2::uuid',
      [E2E_LEADS.team, E2E_ORGANIZATION_ID],
    );
    expect(createdBy.rows).toHaveLength(1);
    await pool.query(`
      insert into public.leads (
        id, organization_id, pipeline_id, stage_id, assigned_user_id,
        name, source, status, deal_status, priority, created_by, team_id,
        attention_eligible
      ) values (
        $1::uuid, $2::uuid, $3::uuid, $4::uuid, null,
        $5, 'e2e-unassigned-chart', 'new', 'open', 'normal', $6::uuid, null,
        false
      )
    `, [leadId, E2E_ORGANIZATION_ID, E2E_PIPELINE_ID, E2E_STAGE_ID, leadName, createdBy.rows[0].created_by]);
    inserted = true;
  });

  test.afterAll(async () => {
    if (!pool) return;
    try {
      if (inserted) {
        const deleted = await pool.query(
          'delete from public.leads where id = $1::uuid and organization_id = $2::uuid',
          [leadId, E2E_ORGANIZATION_ID],
        );
        expect(deleted.rowCount).toBe(1);
      }
      const residual = await pool.query<{ count: string }>(
        'select count(*)::text as count from public.leads where id = $1::uuid and organization_id = $2::uuid',
        [leadId, E2E_ORGANIZATION_ID],
      );
      expect(Number(residual.rows[0]?.count)).toBe(0);
    } finally {
      await pool.end();
    }
  });

  test('desktop filtra a única barra e limpa a seleção pelo gráfico', async ({ page }) => {
    await signInAs(page, 'admin');
    await page.goto('/dashboard');
    const all = await dashboardCounts(page);
    expect(all.stats.totalLeads).toBeGreaterThan(1);

    await selectUnassigned(page);
    const chart = await expectUnassignedChart(page);
    await chart.getByRole('button', { name: 'Remover filtro de Sem responsável: 1 lead' }).click();
    await expect(page.getByRole('region', { name: 'Leads por corretor' })).toBeVisible();
    await expect(page.locator('[data-tour="dashboard-kpi-leads"][role="button"]').locator('p').nth(1))
      .toHaveText(String(all.stats.totalEntries));
  });

  test('mobile mantém a contagem e limpa a seleção pelo cabeçalho', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signInAs(page, 'admin');
    await page.goto('/dashboard');

    await expect(page.locator('aside.app-sidebar')).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Abrir filtros avançados' })).toBeVisible();

    await selectUnassigned(page);
    await expectUnassignedChart(page);
    await page.getByRole('button', { name: 'Limpar filtro Sem responsável' }).click();
    await expect(page.getByRole('region', { name: 'Leads por corretor' })).toBeVisible();
  });
});
