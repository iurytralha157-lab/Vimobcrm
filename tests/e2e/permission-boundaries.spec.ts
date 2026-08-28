import { expect, test, type Page } from '@playwright/test';

import { authenticatedAPIRequest, fetchTenantContext, signInAs } from './support/auth';

async function expectAPIStatus(page: Page, method: string, path: string, expectedStatus: number) {
  const response = await authenticatedAPIRequest(page, method, path, method === 'GET' ? undefined : {});
  const body = await response.text();
  expect(response.status(), body).toBe(expectedStatus);
}

async function expectAPINotForbidden(page: Page, method: string, path: string) {
  const response = await authenticatedAPIRequest(page, method, path, method === 'GET' ? undefined : {});
  const body = await response.text();
  expect(response.status(), body).not.toBe(403);
}

async function expectRouteAllowed(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByText('Acesso nao disponivel')).toHaveCount(0);
}

async function expectRouteDenied(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByText('Acesso nao disponivel')).toBeVisible();
}

test.describe('limites de modulo e pagina por perfil', () => {
  test.describe.configure({ timeout: 120_000 });

  test('administrador atravessa todos os limites administrativos', async ({ page }) => {
    await signInAs(page, 'admin');
    const context = await fetchTenantContext(page);
    expect(context.permissions).toContain('*');

    await expectAPINotForbidden(page, 'GET', '/v1/contacts?mode=export&limit=1');
    await expectAPINotForbidden(page, 'POST', '/v1/properties');
    await expectAPINotForbidden(page, 'GET', '/v1/round-robins');
    await expectAPINotForbidden(page, 'GET', '/v1/settings/roles');
    await expectRouteAllowed(page, `/settings/users/${context.userId}`);
    await expectRouteAllowed(page, '/dashboard/site');
    await expectRouteAllowed(page, '/marketing');
    await expectRouteAllowed(page, '/properties/new');
  });

  test('lider administra sua equipe sem distribuicao, exportacao ou paginas de admin', async ({ page }) => {
    await signInAs(page, 'leader');
    const context = await fetchTenantContext(page);
    expect(context.permissions).toEqual(expect.arrayContaining([
      'dashboard_view',
      'lead_view_own',
      'lead_view_team',
      'lead_operate',
      'team_view',
      'team_manage',
      'property_view',
      'whatsapp_view',
      'schedule_view',
    ]));
    expect(context.permissions).not.toEqual(expect.arrayContaining([
      'dashboard_site_view',
      'dashboard_campaigns_view',
      'lead_export',
      'distribution_manage',
      'property_manage',
      'permissions_manage',
    ]));

    await expectAPINotForbidden(page, 'GET', '/v1/teams');
    await expectAPIStatus(page, 'GET', '/v1/round-robins', 403);
    await expectAPIStatus(page, 'GET', '/v1/contacts?mode=export&limit=1', 403);
    await expectAPINotForbidden(page, 'GET', '/v1/properties?limit=1');
    await expectAPIStatus(page, 'POST', '/v1/properties', 403);
    await expectAPIStatus(page, 'GET', '/v1/settings/roles', 403);
    await expectAPIStatus(page, 'GET', `/v1/settings/users/${context.userId}/permissions`, 403);
    await expectRouteDenied(page, `/settings/users/${context.userId}`);
    await expectRouteDenied(page, '/dashboard/site');
    await expectRouteDenied(page, '/marketing');
    await expectRouteDenied(page, '/properties/new');
    await expectRouteAllowed(page, '/crm/contacts');
    await expectRouteAllowed(page, '/crm/conversas');
  });

  test('usuario usa operacao comercial sem acessar gestao ou exportacao', async ({ page }) => {
    await signInAs(page, 'user');
    const context = await fetchTenantContext(page);
    expect(context.permissions).toEqual(expect.arrayContaining([
      'dashboard_view',
      'lead_view_own',
      'lead_operate',
      'lead_create',
      'lead_import',
      'property_view',
      'whatsapp_view',
      'schedule_view',
    ]));
    expect(context.permissions).not.toEqual(expect.arrayContaining([
      'lead_view_team',
      'lead_view_all',
      'lead_export',
      'team_view',
      'team_manage',
      'property_manage',
      'permissions_manage',
    ]));

    await expectAPIStatus(page, 'GET', '/v1/teams', 403);
    await expectAPIStatus(page, 'GET', '/v1/contacts?mode=export&limit=1', 403);
    await expectAPINotForbidden(page, 'GET', '/v1/properties?limit=1');
    await expectAPIStatus(page, 'POST', '/v1/properties', 403);
    await expectAPIStatus(page, 'GET', `/v1/settings/users/${context.userId}/permissions`, 403);
    await expectRouteDenied(page, `/settings/users/${context.userId}`);
    await expectRouteDenied(page, '/dashboard/site');
    await expectRouteDenied(page, '/marketing');
    await expectRouteDenied(page, '/properties/new');
    await expectRouteAllowed(page, '/crm/pipelines');
    await expectRouteAllowed(page, '/crm/contacts');
    await expectRouteAllowed(page, '/crm/conversas');
  });
});
