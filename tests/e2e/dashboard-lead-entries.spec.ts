import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';
import { Pool } from 'pg';

import { E2E_LEADS, E2E_ORGANIZATION_ID, E2E_PIPELINE_ID, E2E_STAGE_ID, getE2EConfig } from './support/e2e-env';
import { authenticatedAPIRequest, signInAs } from './support/auth';

type EntryPage = {
  data: {
    total: number;
    items: Array<{ entryId: string; leadId: string; entryType: 'initial' | 'reentry'; source: string | null }>;
  };
};

const entryId = randomUUID();
const source = `e2e-popup-${entryId.slice(0, 8)}`;
const campaignName = `Campanha do popup ${entryId.slice(0, 8)}`;
let pool: Pool | undefined;
let inserted = false;

async function openEntries(page: Page) {
  const kpi = page.locator('[data-tour="dashboard-kpi-leads"][role="button"]');
  await expect(kpi).toBeVisible();
  await kpi.click();
  const dialog = page.getByRole('dialog', { name: 'Entradas de leads' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('status', { name: 'Carregando entradas de leads' })).toBeHidden();
  await expect(dialog.getByText(/entradas nos filtros atuais/)).toBeVisible();
  return { kpi, dialog };
}

async function entryPage(page: Page, query = '') {
  const response = await authenticatedAPIRequest(page, 'GET', `/v1/dashboard/lead-entries?limit=25${query}`);
  const body = await response.text();
  expect(response.ok(), body).toBeTruthy();
  return (JSON.parse(body) as EntryPage).data;
}

test.describe('entradas de leads na Dashboard local isolada', () => {
  test.beforeAll(async () => {
    if (!process.env.E2E_SUPABASE_WORKDIR) {
      throw new Error('Este teste insere uma reentrada apenas na stack QA Supabase isolada.');
    }
    pool = new Pool({ connectionString: getE2EConfig().databaseURL });
    await pool.query(`
      insert into public.lead_entry_events (
        id, organization_id, lead_id, entry_type, source, provider,
        occurred_at, is_countable, campaign_name, pipeline_id, stage_id, metadata
      ) values (
        $1::uuid, $2::uuid, $3::uuid, 'reentry', $4, 'manual',
        now(), true, $5, $6::uuid, $7::uuid, '{"e2e":"dashboard-lead-entries"}'::jsonb
      )
    `, [entryId, E2E_ORGANIZATION_ID, E2E_LEADS.team, source, campaignName, E2E_PIPELINE_ID, E2E_STAGE_ID]);
    inserted = true;
  });

  test.afterAll(async () => {
    if (!pool) return;
    try {
      if (inserted) {
        const deleted = await pool.query(
          'delete from public.lead_entry_events where id = $1::uuid and organization_id = $2::uuid',
          [entryId, E2E_ORGANIZATION_ID],
        );
        expect(deleted.rowCount).toBe(1);
      }
    } finally {
      await pool.end();
    }
  });

  test('administrador abre a lista, confere reentrada e filtra pela origem da entrada', async ({ page }) => {
    await signInAs(page, 'admin');
    await page.goto('/dashboard');

    const initialPage = await entryPage(page);
    expect(initialPage.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ entryId, leadId: E2E_LEADS.team, entryType: 'reentry', source }),
    ]));
    expect(initialPage.items.some((entry) => entry.leadId === E2E_LEADS.outside)).toBe(true);
    expect(initialPage.total).toBeLessThanOrEqual(25);

    const { kpi, dialog } = await openEntries(page);
    await expect(kpi).toContainText(initialPage.total.toLocaleString('pt-BR'));
    await expect(dialog.getByText(`${initialPage.total.toLocaleString('pt-BR')} entradas nos filtros atuais`)).toBeVisible();
    await expect(dialog.locator('li')).toHaveCount(initialPage.total);
    const reentry = dialog.locator('li').filter({ hasText: campaignName });
    await expect(reentry).toContainText('Reentrada');
    await expect(reentry).toContainText(source);
    await expect(reentry.getByRole('link', { name: 'Ver card de Lead da Equipe E2E' }))
      .toHaveAttribute('href', `/crm/pipelines?lead=${E2E_LEADS.team}`);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await page.locator('[data-tour="dashboard-advanced-filters"]').click();
    const filters = page.locator('[data-tour="dashboard-filters-panel"]');
    await expect(filters).toBeVisible();
    await filters.getByRole('combobox').filter({ hasText: 'Todas origens' }).click();
    await page.getByRole('option', { name: new RegExp(source, 'i') }).click();
    await page.keyboard.press('Escape');

    const filteredPage = await entryPage(page, `&source=${encodeURIComponent(source)}`);
    expect(filteredPage.total).toBe(1);
    expect(filteredPage.items[0]).toMatchObject({ entryId, entryType: 'reentry', leadId: E2E_LEADS.team });

    const filtered = await openEntries(page);
    await expect(filtered.kpi).toContainText('1');
    await expect(filtered.dialog.getByText('1 entradas nos filtros atuais')).toBeVisible();
    await expect(filtered.dialog.locator('li')).toHaveCount(1);
    await expect(filtered.dialog.locator('li').first()).toContainText(campaignName);
  });

  test('corretor vê a reentrada do próprio lead e não vê o lead de outra equipe', async ({ page }) => {
    await signInAs(page, 'user');
    await page.goto('/dashboard');

    const scopedPage = await entryPage(page);
    expect(scopedPage.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ entryId, leadId: E2E_LEADS.team, entryType: 'reentry' }),
    ]));
    expect(scopedPage.items.some((entry) => entry.leadId === E2E_LEADS.outside)).toBe(false);
    expect(scopedPage.total).toBeLessThanOrEqual(25);

    const { kpi, dialog } = await openEntries(page);
    await expect(kpi).toContainText(scopedPage.total.toLocaleString('pt-BR'));
    await expect(dialog.getByText(`${scopedPage.total.toLocaleString('pt-BR')} entradas nos filtros atuais`)).toBeVisible();
    await expect(dialog.locator('li')).toHaveCount(scopedPage.total);
    await expect(dialog.locator('li').filter({ hasText: campaignName })).toContainText('Reentrada');
    await expect(dialog).not.toContainText('Lead Externo E2E');
  });

  test('corretor abre a lista no layout mobile com a mesma contagem', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signInAs(page, 'user');
    await page.goto('/dashboard');

    const scopedPage = await entryPage(page);
    const { kpi, dialog } = await openEntries(page);
    await expect(kpi).toContainText(scopedPage.total.toLocaleString('pt-BR'));
    await expect(dialog.getByText(`${scopedPage.total.toLocaleString('pt-BR')} entradas nos filtros atuais`)).toBeVisible();
    await expect(dialog.locator('li').filter({ hasText: campaignName })).toContainText('Reentrada');
  });
});
