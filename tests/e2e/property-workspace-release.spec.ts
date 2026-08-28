import { expect, test, type Page } from '@playwright/test';

import { E2E_PROPERTY_ID, type E2EUserKey } from './support/e2e-env';
import { signInAs } from './support/auth';

const PROPERTY_TITLE = 'Imovel publico E2E';

async function expectSuccessfulNavigation(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response, `document response for ${path}`).not.toBeNull();
  expect(response?.status(), `document status for ${path}`).toBeLessThan(400);
  await expect(page.getByText('Acesso nao disponivel')).toHaveCount(0);
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(
    () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
}

async function openPropertyMenu(page: Page) {
  await page.getByRole('button', { name: `Ações de ${PROPERTY_TITLE}` }).click();
}

test.describe.serial('carteira, pop-ups e ficha 360 do imóvel', () => {
  test.describe.configure({ timeout: 120_000 });

  test('administrador percorre lista, visualização rápida, histórico e ficha dedicada', async ({ page }) => {
    await signInAs(page, 'admin');
    await expectSuccessfulNavigation(page, '/properties');

    await expect(page.getByText(PROPERTY_TITLE, { exact: true }).first()).toBeVisible();

    await openPropertyMenu(page);
    await page.getByRole('menuitem', { name: 'Visualização rápida' }).click();
    const preview = page.getByRole('dialog', { name: 'Visualizar imóvel' });
    await expect(preview).toBeVisible();
    await expect(preview.getByRole('heading', { name: PROPERTY_TITLE })).toBeVisible();
    await expect(preview.getByText('E2E-SITE-001', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(preview).toBeHidden();

    await openPropertyMenu(page);
    await page.getByRole('menuitem', { name: 'Histórico' }).click();
    const history = page.getByRole('dialog', { name: 'Histórico do imóvel' });
    await expect(history).toBeVisible();
    await expect(history.getByText(/E2E-SITE-001/)).toBeVisible();
    await expect(history.getByText('Não foi possível carregar o histórico.')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(history).toBeHidden();

    await openPropertyMenu(page);
    await page.getByRole('menuitem', { name: 'Abrir ficha 360°' }).click();
    await expect(page).toHaveURL(new RegExp(`/properties/${E2E_PROPERTY_ID}$`));
    await expect(page.getByRole('heading', { name: PROPERTY_TITLE, level: 1 })).toBeVisible();
    await expect(page.getByText('Não foi possível abrir a ficha')).toHaveCount(0);
    await expect(page.getByText('Ficha básica disponível')).toHaveCount(0);
    await expect(page.getByText('Cadastro legado', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Dados normalizados', { exact: true })).toHaveCount(0);
    for (const label of ['Ofertas', 'Proprietários', 'Fotos', 'Documentos', 'Chaves', 'Movimentações']) {
      await expect(page.getByText(`${label} · parcial`, { exact: true })).toHaveCount(0);
    }
    await expect(page.getByRole('button', { name: 'Editar imóvel' })).toBeVisible();
    await page.getByRole('button', { name: /Ações do imóvel/ }).click();
    await expect(page.getByRole('menuitem', { name: 'Marcar como reservado' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Marcar como vendido' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Gerenciar publicação' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('tab', { name: 'Visão geral' })).toBeVisible();
    for (const tabName of [
      'Ficha técnica',
      'Comercial',
      'Responsáveis',
      'Mídia e documentos',
      'Publicação',
      'Chaves',
      'Histórico',
    ]) {
      await expect(page.getByRole('tab', { name: tabName })).toBeVisible();
    }

    await page.getByRole('tab', { name: 'Ficha técnica' }).click();
    await expect(page.getByRole('heading', { name: 'Características do imóvel' })).toBeVisible();

    await page.getByRole('tab', { name: 'Mídia e documentos' }).click();
    await expect(page.getByRole('heading', { name: 'Mídias e documentos' })).toBeVisible();

    await page.getByRole('tab', { name: 'Histórico' }).click();
    await expect(page.getByRole('heading', { name: 'Histórico do imóvel' })).toBeVisible();
  });

  for (const persona of ['leader', 'user'] as E2EUserKey[]) {
    test(`${persona} abre a carteira e a ficha permitida pelo escopo`, async ({ page }) => {
      await signInAs(page, persona);
      await expectSuccessfulNavigation(page, '/properties');
      await expect(page.getByText(PROPERTY_TITLE, { exact: true }).first()).toBeVisible();

      await expectSuccessfulNavigation(page, `/properties/${E2E_PROPERTY_ID}`);
      await expect(page.getByRole('heading', { name: PROPERTY_TITLE, level: 1 })).toBeVisible();
      await expect(page.getByText('Não foi possível abrir a ficha')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Editar imóvel' })).toHaveCount(0);
    });
  }

  test('lista, quick view e ficha permanecem utilizáveis no mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signInAs(page, 'user');
    await expectSuccessfulNavigation(page, '/properties');

    await expect(page.getByText(PROPERTY_TITLE, { exact: true }).first()).toBeVisible();
    await openPropertyMenu(page);
    await page.getByRole('menuitem', { name: 'Visualização rápida' }).click();
    const preview = page.getByRole('dialog', { name: 'Visualizar imóvel' });
    await expect(preview).toBeVisible();
    await expect(preview.getByRole('heading', { name: PROPERTY_TITLE })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.keyboard.press('Escape');

    await expectSuccessfulNavigation(page, `/properties/${E2E_PROPERTY_ID}`);
    await expect(page.getByRole('heading', { name: PROPERTY_TITLE, level: 1 })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Visão geral' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Ficha técnica' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Mídia e documentos' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Histórico' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
