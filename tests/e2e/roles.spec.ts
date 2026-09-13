import { expect, test, type Page } from '@playwright/test';

import {
  E2E_ORGANIZATION_ID,
  E2E_OUTSIDE_TEAM_ID,
  E2E_TEAM_ID,
} from './support/e2e-env';
import { authenticatedAPIRequest, fetchTenantContext, signInAs } from './support/auth';

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

  test('gestor vê todos os leads e consulta equipes sem administrar a organização', async ({ page }) => {
    await signInAs(page, 'manager');

    const context = await fetchTenantContext(page);
    expect(context.organizationId).toBe(E2E_ORGANIZATION_ID);
    expect(context.memberRole).toBe('manager');
    expect(context.isTeamLeader).toBe(false);
    expect(context.permissions).toContain('lead_view_all');
    expect(context.permissions).toContain('team_view');
    expect(context.permissions).not.toContain('team_manage');
    expect(context.permissions).not.toContain('users_manage');

    const teamsResponse = await authenticatedAPIRequest(page, 'GET', '/v1/teams?include_inactive=true');
    const teamsPayload = await teamsResponse.json() as { data: Array<{ id: string }> };
    expect(teamsResponse.ok()).toBeTruthy();
    expect(teamsPayload.data.map((team) => team.id)).toEqual(expect.arrayContaining([
      E2E_TEAM_ID,
      E2E_OUTSIDE_TEAM_ID,
    ]));

    await expect(managementButton(page)).toBeVisible();
    await managementButton(page).click();
    await expect(page.getByRole('menuitem', { name: /Equipes/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Distribui/ })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: /Pipelines/ })).toHaveCount(0);

    await page.goto('/crm/management?tab=teams');
    await expect(page.locator('[data-tour="management-team-list"]')).toBeVisible();
    await expect(page.locator('[data-tour="management-team-edit"]')).toHaveCount(0);
    const memberAvailability = page.locator('[data-tour="management-team-member"]').first();
    await expect(memberAvailability).toBeVisible();
    await memberAvailability.click();
    await expect(page.getByText('Somente leitura', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Salvar', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Fechar disponibilidade' }).click();
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
