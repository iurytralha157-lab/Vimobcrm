import { expect, test } from '@playwright/test';

import { E2E_ORGANIZATION_ID, E2E_USERS, getE2EConfig } from './support/e2e-env';
import {
  authenticatedAPIRequest,
  getAuthenticatedAccessToken,
  signInAs,
} from './support/auth';

type OrganizationUser = {
  id: string;
  email: string;
  is_active: boolean;
};

test('desativação preserva o membro, bloqueia acesso e permite reativação', async ({ browser, page }) => {
  const config = getE2EConfig();
  const managerContext = await browser.newContext({ baseURL: config.baseURL });
  const managerPage = await managerContext.newPage();
  await signInAs(managerPage, 'manager');
  const managerAccessToken = getAuthenticatedAccessToken(managerPage);

  await signInAs(page, 'admin');

  const managementBefore = await authenticatedAPIRequest(page, 'GET', '/v1/users?include_inactive=true');
  expect(managementBefore.ok()).toBeTruthy();
  const managementBeforePayload = await managementBefore.json() as { data: OrganizationUser[] };
  const manager = managementBeforePayload.data.find((user) => user.email === E2E_USERS.manager.email);
  expect(manager).toBeTruthy();

  try {
    const deactivate = await authenticatedAPIRequest(page, 'PATCH', `/v1/users/${manager!.id}`, {
      updates: { is_active: false },
    });
    expect(deactivate.ok(), await deactivate.text()).toBeTruthy();
    await expect(managerPage).toHaveURL(/\/select-organization(?:\?|$)/, {
      timeout: 15_000,
    });

    const managementAfter = await authenticatedAPIRequest(page, 'GET', '/v1/users?include_inactive=true');
    const managementAfterPayload = await managementAfter.json() as { data: OrganizationUser[] };
    expect(managementAfter.ok()).toBeTruthy();
    expect(managementAfterPayload.data.find((user) => user.id === manager!.id)?.is_active).toBe(false);

    const activeAfter = await authenticatedAPIRequest(page, 'GET', '/v1/users');
    const activeAfterPayload = await activeAfter.json() as { data: OrganizationUser[] };
    expect(activeAfter.ok()).toBeTruthy();
    expect(activeAfterPayload.data.some((user) => user.id === manager!.id)).toBe(false);

    const permissionProfile = await authenticatedAPIRequest(
      page,
      'GET',
      `/v1/settings/users/${manager!.id}/permissions`,
    );
    const permissionProfileBody = await permissionProfile.text();
    expect(permissionProfile.ok(), permissionProfileBody).toBeTruthy();
    expect(JSON.parse(permissionProfileBody)).toMatchObject({
      data: {
        userId: manager!.id,
        email: E2E_USERS.manager.email,
        isActive: false,
      },
    });

    const denied = await page.request.get(`${config.apiURL}/v1/me`, {
      headers: {
        Authorization: `Bearer ${managerAccessToken}`,
        'X-Organization-ID': E2E_ORGANIZATION_ID,
      },
    });
    expect(denied.status()).toBe(403);
  } finally {
    try {
      const reactivate = await authenticatedAPIRequest(page, 'PATCH', `/v1/users/${manager!.id}`, {
        updates: { is_active: true },
      });
      expect(reactivate.ok(), await reactivate.text()).toBeTruthy();
    } finally {
      await managerContext.close();
    }
  }

  const managementRestored = await authenticatedAPIRequest(page, 'GET', '/v1/users?include_inactive=true');
  const managementRestoredPayload = await managementRestored.json() as { data: OrganizationUser[] };
  expect(managementRestoredPayload.data.find((user) => user.id === manager!.id)?.is_active).toBe(true);
});
