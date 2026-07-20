import { expect, test } from '@playwright/test';

import { signInAs } from './support/auth';

test.describe('navegacao principal', () => {
  test('desktop inicia recolhido e fecha novamente depois da navegacao', async ({ page }) => {
    await signInAs(page, 'user');
    await page.goto('/crm/pipelines');

    const sidebar = page.locator('aside.app-sidebar');
    await expect(sidebar).toBeVisible();
    await expect(sidebar).toHaveCSS('width', '64px');
    await expect(sidebar.locator('a[href="/crm/contacts"]')).toHaveAttribute('aria-label', 'Contatos');

    await page.getByRole('button', { name: 'Expandir menu' }).click();
    await expect(sidebar).toHaveCSS('width', '224px');

    await page.evaluate(() => window.history.pushState(null, '', '/crm/pipelines?search=maria'));
    await expect(sidebar).toHaveCSS('width', '224px');

    const pipelinesLink = sidebar.locator('a[href="/crm/pipelines"]');
    const contactsLink = sidebar.locator('a[href="/crm/contacts"]');
    await contactsLink.click({ button: 'right' });
    await expect(pipelinesLink).toHaveAttribute('aria-current', 'page');
    await expect(contactsLink).not.toHaveAttribute('aria-current', 'page');

    await contactsLink.click();
    await expect(page).toHaveURL(/\/crm\/contacts/);
    await expect(sidebar).toHaveCSS('width', '64px');
  });

  test('mobile fecha o menu Mais ao trocar de pagina', async ({ page }) => {
    await signInAs(page, 'user');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/crm/pipelines');

    const bottomNav = page.locator('nav.app-mobile-bottom-nav');
    await expect(bottomNav).toBeVisible();
    await expect(bottomNav.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(bottomNav.getByRole('button', { name: 'Novo lead' })).toBeVisible();

    await bottomNav.getByRole('button', { name: 'Mais' }).click();
    const menu = page.getByRole('dialog', { name: 'Menu principal' });
    await expect(menu).toBeVisible();

    await menu.getByRole('link', { name: 'Contatos' }).click();
    await expect(page).toHaveURL(/\/crm\/contacts/);
    await expect(menu).toBeHidden();
  });

  test('mobile permite recolher o submenu da secao ativa', async ({ page }) => {
    await signInAs(page, 'admin');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/properties');

    const bottomNav = page.locator('nav.app-mobile-bottom-nav');
    await bottomNav.getByRole('button', { name: 'Mais' }).click();

    const menu = page.getByRole('dialog', { name: 'Menu principal' });
    const propertiesGroup = menu.locator('button[aria-current="page"][aria-expanded]');
    const allPropertiesLink = menu.locator('a[href="/properties"]');
    await expect(propertiesGroup).toHaveAttribute('aria-expanded', 'true');
    await expect(allPropertiesLink).toBeVisible();

    await propertiesGroup.click();
    await expect(propertiesGroup).toHaveAttribute('aria-expanded', 'false');
    await expect(allPropertiesLink).toBeHidden();
  });

  test('acao mobile de novo usuario abre o convite', async ({ page }) => {
    await signInAs(page, 'admin');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/settings?tab=team');

    const bottomNav = page.locator('nav.app-mobile-bottom-nav');
    await expect(bottomNav).toBeVisible();
    await expect(bottomNav).toHaveAttribute('aria-busy', 'false');

    await bottomNav.getByRole('button', { name: 'Novo usuário' }).click();
    await expect(page.getByRole('dialog', { name: 'Convidar usuário' })).toBeVisible();
  });

});
