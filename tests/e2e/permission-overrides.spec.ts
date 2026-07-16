import { expect, test, type Page, type Response } from '@playwright/test';

import { E2E_USERS } from './support/e2e-env';
import { authenticatedAPIRequest, fetchTenantContext, signInAs } from './support/auth';

type UserListPayload = {
  data: Array<{ id: string; email: string }>;
};

async function findUserID(adminPage: Page, email: string) {
  const response = await authenticatedAPIRequest(adminPage, 'GET', '/v1/users');
  const body = await response.text();
  expect(response.ok(), body).toBeTruthy();
  const payload = JSON.parse(body) as UserListPayload;
  const user = payload.data.find((candidate) => candidate.email.toLowerCase() === email.toLowerCase());
  expect(user, `Expected ${email} in the organization user list`).toBeTruthy();
  return user!.id;
}

async function openContactsActions(page: Page) {
  const trigger = page.locator('[data-tour="contacts-import"]');
  await expect(trigger).toBeVisible();
  if (await trigger.getAttribute('aria-expanded') !== 'true') {
    await trigger.click();
  }
}

async function closeContactsActions(page: Page) {
  const trigger = page.locator('[data-tour="contacts-import"]');
  if (await trigger.getAttribute('aria-expanded') === 'true') {
    await trigger.click({ force: true });
  }
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
}

async function reloadAndWaitForPermissions(page: Page, expectedLeadExport: boolean) {
  const reloadStartedAt = Date.now();
  const hasExpectedPermission = async (response: Response, pathname: string) => {
    const url = new URL(response.url());
    if (
      url.port !== '8181' ||
      url.pathname !== pathname ||
      response.status() !== 200 ||
      response.request().timing().startTime < reloadStartedAt
    ) return false;

    const payload = await response.json() as { context?: { permissions?: string[] } };
    return Boolean(payload.context?.permissions?.includes('lead_export')) === expectedLeadExport;
  };
  const profileResponse = page.waitForResponse((response) => hasExpectedPermission(response, '/v1/me/profile'));
  await page.reload();
  await profileResponse;
  await expect(page.locator('aside.app-sidebar')).toBeVisible();
}

test('override individual controla interface e API e pode ser restaurado', async ({ browser }) => {
  test.setTimeout(120_000);
  const userContext = await browser.newContext();
  const adminContext = await browser.newContext();
  const userPage = await userContext.newPage();
  const adminPage = await adminContext.newPage();
  let userID = '';
  let permissionsReset = false;

  try {
    await signInAs(adminPage, 'admin');
    userID = await findUserID(adminPage, E2E_USERS.user.email);

    const realtimeConnected = userPage.waitForResponse((response) =>
      response.url().includes('/v1/realtime/events') && response.status() === 200,
    );
    await signInAs(userPage, 'user');
    await realtimeConnected;
    await userPage.goto('/crm/contacts');
    await expect(userPage).toHaveURL(/\/crm\/contacts/);
    await openContactsActions(userPage);
    await expect(userPage.locator('[data-tour="contacts-export-action"]')).toHaveCount(0);
    await closeContactsActions(userPage);

    const grantResponse = await authenticatedAPIRequest(
      adminPage,
      'PUT',
      `/v1/settings/users/${userID}/permissions`,
      { permissions: { lead_export: true } },
    );
    const grantBody = await grantResponse.text();
    expect(grantResponse.ok(), grantBody).toBeTruthy();

    await expect.poll(async () => (await fetchTenantContext(userPage)).permissions)
      .toContain('lead_export');
    await reloadAndWaitForPermissions(userPage, true);
    await openContactsActions(userPage);
    await expect(userPage.locator('[data-tour="contacts-export-action"]')).toBeVisible();
    await closeContactsActions(userPage);

    const exportResponse = await authenticatedAPIRequest(userPage, 'GET', '/v1/contacts?mode=export&limit=1');
    const exportBody = await exportResponse.text();
    expect(exportResponse.ok(), exportBody).toBeTruthy();

    const resetResponse = await authenticatedAPIRequest(
      adminPage,
      'DELETE',
      `/v1/settings/users/${userID}/permissions`,
    );
    const resetBody = await resetResponse.text();
    expect(resetResponse.ok(), resetBody).toBeTruthy();
    permissionsReset = true;

    await expect.poll(async () => (await fetchTenantContext(userPage)).permissions)
      .not.toContain('lead_export');
    await reloadAndWaitForPermissions(userPage, false);
    await openContactsActions(userPage);
    await expect(userPage.locator('[data-tour="contacts-export-action"]')).toHaveCount(0);
  } finally {
    if (userID && !permissionsReset && !adminPage.isClosed()) {
      await authenticatedAPIRequest(
        adminPage,
        'DELETE',
        `/v1/settings/users/${userID}/permissions`,
      ).catch(() => undefined);
    }

    await userContext.close();
    await adminContext.close();
  }
});
