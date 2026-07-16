import { expect, type APIResponse, type Page } from '@playwright/test';

import {
  E2E_ORGANIZATION_ID,
  E2E_PASSWORD,
  E2E_USERS,
  type E2EUserKey,
  getE2EConfig,
} from './e2e-env';

type TenantContext = {
  userId: string;
  organizationId?: string;
  memberRole?: string;
  permissions: string[];
  enabledModules: string[];
  isTeamLeader: boolean;
  isSuperAdmin: boolean;
};

const accessTokens = new WeakMap<Page, string>();

export async function signInAs(page: Page, userKey: E2EUserKey) {
  const user = E2E_USERS[userKey];

  await page.goto('/login');
  await page.evaluate(() => window.localStorage.clear());
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(E2E_PASSWORD);
  const tokenResponsePromise = page.waitForResponse((response) =>
    response.url().includes('/auth/v1/token') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: /^Entrar$/ }).click();

  const tokenResponse = await tokenResponsePromise;
  const tokenResponseBody = await tokenResponse.text();
  const tokenPayload = JSON.parse(tokenResponseBody) as { access_token?: string };
  expect(tokenResponse.ok(), tokenResponseBody).toBeTruthy();
  expect(tokenPayload.access_token, 'Supabase should return an access token after login').toBeTruthy();
  accessTokens.set(page, tokenPayload.access_token!);

  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  await expect(page.locator('aside.app-sidebar')).toBeVisible({ timeout: 30_000 });
}

export async function fetchTenantContext(page: Page): Promise<TenantContext> {
  const response = await authenticatedAPIRequest(page, 'GET', '/v1/me');
  const body = await response.text();

  expect(response.ok(), body).toBeTruthy();

  const payload = JSON.parse(body) as { context: TenantContext };
  return payload.context;
}

export async function authenticatedAPIRequest(
  page: Page,
  method: string,
  path: string,
  data?: unknown,
): Promise<APIResponse> {
  const accessToken = accessTokens.get(page);
  expect(accessToken, 'Supabase access token should be present after login').toBeTruthy();

  const config = getE2EConfig();
  return page.request.fetch(`${config.apiURL}${path}`, {
    method,
    data,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'X-Organization-ID': E2E_ORGANIZATION_ID,
    },
  });
}
