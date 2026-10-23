import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

import {
  E2E_ORGANIZATION_ID,
  E2E_PASSWORD,
  E2E_USERS,
  getE2EConfig,
  requireE2ESupabaseConfig,
} from './support/e2e-env';
import { getAuthenticatedAccessToken, signInAs } from './support/auth';

test('sair do CRM revoga também a sessão aberta em outro dispositivo', async ({ page }) => {
  const config = getE2EConfig();
  const otherDevice = createClient(config.supabaseURL, config.supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: otherSession, error: otherSignInError } = await otherDevice.auth.signInWithPassword({
    email: E2E_USERS.user.email,
    password: E2E_PASSWORD,
  });
  expect(otherSignInError).toBeNull();
  expect(otherSession.session?.refresh_token).toBeTruthy();

  try {
    await signInAs(page, 'user');
    const revokedAccessToken = getAuthenticatedAccessToken(page);
    const { error: preLogoutRefreshError } = await otherDevice.auth.refreshSession();
    expect(preLogoutRefreshError, 'the second device must be active before logout').toBeNull();
    await page.getByRole('button', { name: 'Abrir menu do usuário' }).click();
    await page.getByRole('menuitem', { name: 'Sair' }).click();
    await expect(page).toHaveURL(/\/login(?:\?|$)/);

    // Global sign-out removes refresh sessions. An issued access JWT may still
    // pass signature validation until expiry.
    const { error: refreshError } = await otherDevice.auth.refreshSession();
    expect(refreshError).not.toBeNull();

    const sensitiveResponse = await page.request.post(`${config.apiURL}/v1/me/switch-organization`, {
      headers: {
        Authorization: `Bearer ${revokedAccessToken}`,
        'X-Organization-ID': E2E_ORGANIZATION_ID,
      },
      data: { organizationId: E2E_ORGANIZATION_ID },
    });
    expect(sensitiveResponse.status()).toBe(401);
    expect(await sensitiveResponse.json()).toMatchObject({ error: { code: 'session_revoked' } });

    for (const path of ['/v1/user-organizations', '/v1/me/account-status']) {
      const response = await page.request.get(`${config.apiURL}${path}`, {
        headers: { Authorization: `Bearer ${revokedAccessToken}` },
      });
      expect(response.status(), path).toBe(401);
      expect(await response.json()).toMatchObject({ error: { code: 'session_revoked' } });
    }

    const invitationResponse = await page.request.post(
      `${config.apiURL}/v1/invitations/${'a'.repeat(64)}/accept`,
      { headers: { Authorization: `Bearer ${revokedAccessToken}` }, data: {} },
    );
    expect(invitationResponse.status()).toBe(401);
    expect(await invitationResponse.json()).toMatchObject({ error: { code: 'session_revoked' } });
  } finally {
    await otherDevice.auth.signOut({ scope: 'global' });
  }
});

test('link real de recuperação não abre o CRM como sessão normal', async ({ page }) => {
  const config = getE2EConfig();
  const admin = createClient(config.supabaseURL, config.supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email: E2E_USERS.user.email,
    options: { redirectTo: `${config.baseURL}/reset-password` },
  });
  expect(error).toBeNull();
  const actionLink = data?.properties?.action_link;
  expect(actionLink).toBeTruthy();
  expect(new URL(actionLink!).origin).toBe(new URL(config.supabaseURL).origin);

  await page.goto(actionLink!);
  await expect(page).toHaveURL(/\/reset-password(?:[?#]|$)/);
  await expect(page.getByRole('heading', { name: 'Defina sua nova senha' })).toBeVisible({
    timeout: 30_000,
  });

  await page.goto('/inicio');
  await expect(page).toHaveURL(/\/reset-password(?:[?#]|$)/);
  await expect(page.getByRole('heading', { name: 'Defina sua nova senha' })).toBeVisible();
  await page.getByRole('button', { name: 'Voltar para o login' }).click();
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
});

test('recuperar senha conclui a troca e revoga outra sessão', async ({ page, request }) => {
  test.skip(!process.env.E2E_SUPABASE_WORKDIR, 'Exige projeto Supabase local descartável.');
  const config = requireE2ESupabaseConfig();
  const nextPassword = 'VimobE2e!Nova2026';
  const admin = createClient(config.supabaseURL, config.supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const otherDevice = createClient(config.supabaseURL, config.supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: otherSession, error: signInError } = await otherDevice.auth.signInWithPassword({
    email: E2E_USERS.user.email,
    password: E2E_PASSWORD,
  });
  expect(signInError).toBeNull();
  expect(otherSession.session?.access_token).toBeTruthy();
  const userID = otherSession.user!.id;
  const oldAccessToken = otherSession.session!.access_token;

  try {
    const { error: activeRefreshError } = await otherDevice.auth.refreshSession();
    expect(activeRefreshError).toBeNull();

    const { data: recovery, error: linkError } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email: E2E_USERS.user.email,
      options: { redirectTo: `${config.baseURL}/reset-password` },
    });
    expect(linkError).toBeNull();
    expect(recovery?.properties?.action_link).toBeTruthy();

    await page.goto(recovery!.properties!.action_link!);
    await expect(page.getByRole('heading', { name: 'Defina sua nova senha' })).toBeVisible();
    await page.getByLabel('Nova senha', { exact: true }).fill(nextPassword);
    await page.getByLabel('Confirmar nova senha').fill(nextPassword);
    await page.getByRole('button', { name: 'Alterar senha' }).click();
    await expect(page).toHaveURL(/\/login\?passwordReset=success/, { timeout: 30_000 });

    const { error: revokedRefreshError } = await otherDevice.auth.refreshSession();
    expect(revokedRefreshError).not.toBeNull();
    const revokedStatus = await request.get(`${config.apiURL}/v1/settings/password/status`, {
      headers: {
        Authorization: `Bearer ${oldAccessToken}`,
        'X-Organization-ID': E2E_ORGANIZATION_ID,
      },
    });
    expect(revokedStatus.status()).toBe(401);
    expect(await revokedStatus.json()).toMatchObject({ error: { code: 'session_revoked' } });

    const verificationClient = createClient(config.supabaseURL, config.supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const oldPasswordLogin = await verificationClient.auth.signInWithPassword({
      email: E2E_USERS.user.email,
      password: E2E_PASSWORD,
    });
    expect(oldPasswordLogin.error).not.toBeNull();
    const newPasswordLogin = await verificationClient.auth.signInWithPassword({
      email: E2E_USERS.user.email,
      password: nextPassword,
    });
    expect(newPasswordLogin.error).toBeNull();
    expect(newPasswordLogin.data.session?.access_token).toBeTruthy();
    const newPasswordStatus = await request.get(`${config.apiURL}/v1/settings/password/status`, {
      headers: {
        Authorization: `Bearer ${newPasswordLogin.data.session!.access_token}`,
        'X-Organization-ID': E2E_ORGANIZATION_ID,
      },
    });
    expect(newPasswordStatus.status()).toBe(200);
    expect(await newPasswordStatus.json()).toMatchObject({
      data: { lastChange: { source: 'recovery' } },
    });
    await verificationClient.auth.signOut({ scope: 'global' });
  } finally {
    const restore = await admin.auth.admin.updateUserById(userID, { password: E2E_PASSWORD });
    expect(restore.error, 'synthetic E2E account password must be restored').toBeNull();
  }
});
