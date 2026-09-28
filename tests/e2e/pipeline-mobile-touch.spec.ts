import { expect, test, type Locator } from '@playwright/test';

import { getE2EConfig } from './support/e2e-env';
import { signInAs } from './support/auth';

async function expectTouchTarget(locator: Locator, minSize = 40) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(minSize);
  expect(box?.height).toBeGreaterThanOrEqual(minSize);
}

test('Pipeline mantém ações e detalhe alcançáveis por toque no mobile QA', async ({ page }) => {
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

  await page.setViewportSize({ width: 390, height: 844 });
  await signInAs(page, 'admin');
  await page.goto('/crm/pipelines');

  const openCard = page.getByRole('button', { name: 'Abrir detalhes do lead Lead da Equipe E2E' });
  await expect(openCard).toBeVisible({ timeout: 180_000 });
  const column = page.locator('[data-tour="pipeline-column"]');
  const previousStage = page.getByRole('button', { name: 'Ver coluna anterior' });
  const nextStage = page.getByRole('button', { name: 'Ver próxima coluna' });
  await expectTouchTarget(previousStage, 56);
  await expectTouchTarget(nextStage, 56);
  await expect(previousStage).toHaveAttribute('aria-disabled', 'true');

  const columnBox = await column.boundingBox();
  const nextStageBox = await nextStage.boundingBox();
  const bottomNavBox = await page.locator('nav.app-mobile-bottom-nav').boundingBox();
  expect(columnBox).not.toBeNull();
  expect(nextStageBox).not.toBeNull();
  expect(bottomNavBox).not.toBeNull();
  expect(nextStageBox!.y).toBeGreaterThan(columnBox!.y + 80);
  expect(Math.abs(nextStageBox!.y + nextStageBox!.height / 2 - (columnBox!.y + columnBox!.height / 2))).toBeLessThan(40);
  expect(bottomNavBox!.y - (columnBox!.y + columnBox!.height)).toBeGreaterThanOrEqual(0);
  expect(bottomNavBox!.y - (columnBox!.y + columnBox!.height)).toBeLessThanOrEqual(16);

  await nextStage.click({ position: { x: 52, y: 4 } });
  await expect(previousStage).toHaveAttribute('aria-disabled', 'false');
  await expect(page.locator('.lead-mobile-drawer')).toBeHidden();
  await previousStage.click({ position: { x: 4, y: 4 } });
  await expect(previousStage).toHaveAttribute('aria-disabled', 'true');
  await expect(openCard).toBeVisible();
  await expect(page.locator('.lead-mobile-drawer')).toBeHidden();

  const card = page.locator('article').filter({ has: openCard });
  const quickActions = card.locator('button[aria-label*="Lead da Equipe E2E"]');
  await expect(quickActions).toHaveCount(3);
  for (let index = 0; index < 3; index += 1) {
    await expectTouchTarget(quickActions.nth(index));
  }

  await openCard.click();
  const drawer = page.locator('.lead-mobile-drawer');
  await expect(drawer).toBeVisible();
  await expectTouchTarget(drawer.locator('[data-lead-stage-step]').first());
  await expectTouchTarget(drawer.getByRole('button', { name: 'Fechar detalhes do lead' }));
  await expectTouchTarget(drawer.getByRole('button', { name: 'Alterar responsável pelo lead' }));
  await expectTouchTarget(drawer.getByRole('tab', { name: 'Histórico' }));
  await drawer.getByRole('tab', { name: 'Histórico' }).click();
  await expect(drawer.getByRole('tab', { name: 'Histórico' })).toHaveAttribute('aria-selected', 'true');
  await page.screenshot({ path: '.codex-tmp/pipeline-mobile-touch.png' });
  await drawer.getByRole('button', { name: 'Fechar detalhes do lead' }).click();
  await expect(drawer).toBeHidden();
});
