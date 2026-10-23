import { expect, test } from '@playwright/test';

import { signInAs } from './support/auth';
import { E2E_ORGANIZATION_ID } from './support/e2e-env';

test('gestão exibe estados do convite e confirma a troca de link antes de reenviar', async ({ page }) => {
  await signInAs(page, 'admin');

  const now = Date.now();
  const pendingId = '10000000-0000-4000-8000-000000000011';
  const expiredId = '10000000-0000-4000-8000-000000000012';
  const acceptedId = '10000000-0000-4000-8000-000000000013';
  const invitations = [
    {
      id: pendingId,
      organization_id: E2E_ORGANIZATION_ID,
      email: 'pendente@vimob.test',
      role: 'user',
      created_by: null,
      expires_at: new Date(now + 7 * 86_400_000).toISOString(),
      used_at: null,
      created_at: new Date(now).toISOString(),
      is_expired: false,
      email_status: 'accepted',
    },
    {
      id: expiredId,
      organization_id: E2E_ORGANIZATION_ID,
      email: 'expirado@vimob.test',
      role: 'user',
      created_by: null,
      expires_at: new Date(now - 86_400_000).toISOString(),
      used_at: null,
      created_at: new Date(now - 8 * 86_400_000).toISOString(),
      is_expired: true,
      email_status: 'delivery_unknown',
    },
    {
      id: acceptedId,
      organization_id: E2E_ORGANIZATION_ID,
      email: 'aceito@vimob.test',
      role: 'user',
      created_by: null,
      expires_at: new Date(now + 6 * 86_400_000).toISOString(),
      used_at: new Date(now - 86_400_000).toISOString(),
      created_at: new Date(now - 2 * 86_400_000).toISOString(),
      is_expired: false,
      email_status: 'delivered',
      email_delivered_at: new Date(now - 86_400_000).toISOString(),
    },
  ];
  let listRequests = 0;
  let resendRequests = 0;

  await page.route('**/v1/invitations**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = {
      'access-control-allow-origin': new URL(page.url()).origin,
      'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, x-organization-id',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'cache-control': 'no-store',
    };
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
    } else if (request.method() === 'GET' && url.pathname === '/v1/invitations') {
      listRequests += 1;
      await route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ data: invitations }) });
    } else if (request.method() === 'POST' && url.pathname === `/v1/invitations/${expiredId}/resend`) {
      resendRequests += 1;
      const renewed = { ...invitations[1], expires_at: new Date(now + 7 * 86_400_000).toISOString(), is_expired: false, email_status: 'accepted', email_sent: true };
      invitations[1] = renewed;
      await route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ data: renewed }) });
    } else {
      await route.fulfill({ status: 404, headers });
    }
  });

  await page.goto('/settings?tab=team');
  const list = page.getByRole('region', { name: 'Usuários e convites da organização' });
  const pending = list.locator('article').filter({ hasText: 'pendente@vimob.test' });
  const expired = list.locator('article').filter({ hasText: 'expirado@vimob.test' });
  const accepted = list.locator('article').filter({ hasText: 'aceito@vimob.test' });

  await expect(pending).toContainText('Pendente');
  await expect(pending).toContainText('Aceito pelo provedor; entrega não confirmada');
  await expect(expired).toContainText('Expirado');
  await expect(expired).toContainText('Resultado do envio desconhecido');
  await expect(accepted).toContainText('Aceito');
  await expect(accepted).toContainText('Entrega confirmada pelo provedor');
  await expect(accepted.getByRole('button', { name: /Reenviar|Renovar/ })).toHaveCount(0);

  const beforeRefresh = listRequests;
  await page.getByRole('button', { name: 'Atualizar convites' }).click();
  await expect.poll(() => listRequests).toBeGreaterThan(beforeRefresh);

  await expired.getByRole('button', { name: 'Renovar convite para expirado@vimob.test' }).click();
  const confirmation = page.getByRole('alertdialog', { name: 'Gerar novo link de convite?' });
  await expect(confirmation).toContainText('O link anterior deixará de funcionar');
  await expect(confirmation).toContainText('resultado desconhecido');
  expect(resendRequests).toBe(0);
  await confirmation.getByRole('button', { name: 'Voltar' }).click();
  expect(resendRequests).toBe(0);

  await expired.getByRole('button', { name: 'Renovar convite para expirado@vimob.test' }).click();
  await confirmation.getByRole('button', { name: 'Gerar novo link' }).click();
  await expect.poll(() => resendRequests).toBe(1);
  await expect(expired).toContainText('Pendente');
});
