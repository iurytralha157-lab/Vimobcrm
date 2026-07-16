import { expect, test, type Page } from '@playwright/test';

import { E2E_ORGANIZATION_ID } from './support/e2e-env';
import { fetchTenantContext, signInAs } from './support/auth';

const managementButton = (page: Page) => page.getByRole('button', { name: /^Gestão$/ });

test.describe.serial('acesso por perfil', () => {
  test('administrador acessa a gestão da organização', async ({ page }) => {
    await signInAs(page, 'admin');

    const context = await fetchTenantContext(page);
    expect(context.organizationId).toBe(E2E_ORGANIZATION_ID);
    expect(context.memberRole).toBe('admin');
    expect(context.permissions).toContain('*');

    await expect(managementButton(page)).toBeVisible();
    await managementButton(page).click();
    await expect(page.getByRole('menuitem', { name: /Equipes/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Pipelines/ })).toBeVisible();
  });

  test('líder acessa gestão limitada por liderança de time', async ({ page }) => {
    await signInAs(page, 'leader');

    const context = await fetchTenantContext(page);
    expect(context.organizationId).toBe(E2E_ORGANIZATION_ID);
    expect(context.memberRole).toBe('user');
    expect(context.isTeamLeader).toBe(true);
    expect(context.permissions).toContain('lead_view_team');

    await expect(managementButton(page)).toBeVisible();
    await managementButton(page).click();
    await expect(page.getByRole('menuitem', { name: /Equipes/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Distribui/ })).toHaveCount(0);
  });

  test('usuário comum não recebe navegação administrativa', async ({ page }) => {
    await signInAs(page, 'user');

    const context = await fetchTenantContext(page);
    expect(context.organizationId).toBe(E2E_ORGANIZATION_ID);
    expect(context.memberRole).toBe('user');
    expect(context.isTeamLeader).toBe(false);
    expect(context.permissions).not.toContain('*');

    await expect(managementButton(page)).toHaveCount(0);
  });
});
