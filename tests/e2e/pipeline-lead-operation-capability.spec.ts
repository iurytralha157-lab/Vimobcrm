import { expect, test } from '@playwright/test';
import { Pool } from 'pg';

import {
  E2E_LEADS,
  E2E_ORGANIZATION_ID,
  E2E_OUTSIDE_TEAM_ID,
  E2E_PIPELINE_ID,
  E2E_TEAM_ID,
  getE2EConfig,
} from './support/e2e-env';
import { authenticatedAPIRequest, signInAs } from './support/auth';

let pool: Pool | undefined;
let originalTeamId: string | null = null;
let originalOutsideSource: string | null = null;
let changed = false;

test.describe('permissão de operação por card na Pipeline QA isolada', () => {
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
    const lead = await pool.query<{ team_id: string | null }>(`
      select team_id::text
      from public.leads
      where id = $1::uuid and organization_id = $2::uuid
    `, [E2E_LEADS.team, E2E_ORGANIZATION_ID]);
    expect(lead.rows).toHaveLength(1);
    originalTeamId = lead.rows[0].team_id;
    expect(originalTeamId).toBe(E2E_TEAM_ID);

    const outsideLead = await pool.query<{ source: string }>(`
      select source
      from public.leads
      where id = $1::uuid and organization_id = $2::uuid
    `, [E2E_LEADS.outside, E2E_ORGANIZATION_ID]);
    expect(outsideLead.rows).toHaveLength(1);
    originalOutsideSource = outsideLead.rows[0].source;

    await pool.query(`
      update public.leads
      set team_id = $3::uuid
      where id = $1::uuid and organization_id = $2::uuid
    `, [E2E_LEADS.team, E2E_ORGANIZATION_ID, E2E_OUTSIDE_TEAM_ID]);
    changed = true;
    await pool.query(`
      update public.leads
      set source = 'qa-only-outside-team'
      where id = $1::uuid and organization_id = $2::uuid
    `, [E2E_LEADS.outside, E2E_ORGANIZATION_ID]);
  });

  test.afterAll(async () => {
    if (!pool) return;
    try {
      if (changed) {
        await pool.query(`
          update public.leads
          set team_id = $3::uuid
          where id = $1::uuid and organization_id = $2::uuid
        `, [E2E_LEADS.team, E2E_ORGANIZATION_ID, originalTeamId]);
        await pool.query(`
          update public.leads
          set source = $3
          where id = $1::uuid and organization_id = $2::uuid
        `, [E2E_LEADS.outside, E2E_ORGANIZATION_ID, originalOutsideSource]);
      }
      const restored = await pool.query<{ team_id: string | null }>(`
        select team_id::text
        from public.leads
        where id = $1::uuid and organization_id = $2::uuid
      `, [E2E_LEADS.team, E2E_ORGANIZATION_ID]);
      expect(restored.rows[0]?.team_id).toBe(E2E_TEAM_ID);
      const restoredOutside = await pool.query<{ source: string }>(`
        select source
        from public.leads
        where id = $1::uuid and organization_id = $2::uuid
      `, [E2E_LEADS.outside, E2E_ORGANIZATION_ID]);
      expect(restoredOutside.rows[0]?.source).toBe(originalOutsideSource);
    } finally {
      await pool.end();
    }
  });

  test('líder lê lead de membro da equipe, mas não recebe arraste ou edição', async ({ page }) => {
    await signInAs(page, 'leader');

    const detailResponse = await authenticatedAPIRequest(page, 'GET', `/v1/leads/${E2E_LEADS.team}`);
    const detailBody = await detailResponse.text();
    expect(detailResponse.status(), detailBody).toBe(200);
    const detail = JSON.parse(detailBody) as { data: { canOperate?: boolean } };
    expect(detail.data.canOperate).toBe(false);

    const boardResponse = await authenticatedAPIRequest(
      page,
      'GET',
      `/v1/pipeline-board?pipelineId=${E2E_PIPELINE_ID}`,
    );
    const boardBody = await boardResponse.text();
    expect(boardResponse.status(), boardBody).toBe(200);
    const board = JSON.parse(boardBody) as {
      data: Array<{ leads: Array<{ id: string; can_operate: boolean }> }>;
    };
    const card = board.data.flatMap((stage) => stage.leads).find((lead) => lead.id === E2E_LEADS.team);
    expect(card?.can_operate).toBe(false);

    await page.goto('/crm/pipelines');
    const cardButton = page.getByRole('button', { name: 'Abrir detalhes do lead Lead da Equipe E2E' });
    await expect(cardButton).toBeVisible({ timeout: 180_000 });
    await cardButton.click();
    const dialog = page.locator('[data-tour="lead-detail-dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Editar', exact: true })).toHaveCount(0);
  });

  test('opções da Pipeline seguem equipe e removem origem exclusiva de outra equipe', async ({ page }) => {
    await signInAs(page, 'admin');
    await page.goto('/crm/pipelines');
    await page.getByRole('button', { name: 'Abrir filtros avançados' }).click();
    const filters = page.locator('[data-tour="pipeline-filters-panel"]');
    await expect(filters).toBeVisible();

    const teamFilter = filters.locator('button[role="combobox"]').filter({ hasText: 'Todas equipes' });
    await teamFilter.click();
    const optionsResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === '/v1/lead-meta-filters' &&
        url.searchParams.get('teamId') === E2E_TEAM_ID;
    }, { timeout: 60_000 });
    await page.getByRole('option', { name: 'Equipe E2E', exact: true }).click();

    const response = await optionsResponse;
    const body = await response.text();
    expect(response.status(), body).toBe(200);
    const payload = JSON.parse(body) as { data: { sources: string[] } };
    expect(payload.data.sources).toContain('e2e');
    expect(payload.data.sources).not.toContain('qa-only-outside-team');
  });

  test('cabeçalho da Pipeline permanece legível no mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signInAs(page, 'admin');
    await page.goto('/crm/pipelines');

    await expect(page.locator('aside.app-sidebar')).toBeHidden();
    const title = page.getByRole('heading', { name: 'Pipeline', exact: true });
    await expect(title).toBeVisible();
    await expect(page.getByRole('button', { name: 'Abrir filtros avançados' })).toBeVisible();
    const box = await title.boundingBox();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    await page.screenshot({ path: '.codex-tmp/pipeline-mobile-header.png' });
  });
});
