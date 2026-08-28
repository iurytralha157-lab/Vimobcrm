import { expect, test } from '@playwright/test';

import {
  getNotificationRoute,
  getPushNotificationRoute,
} from '../../lib/notification-routing';
import { type E2EUserKey } from './support/e2e-env';
import { authenticatedAPIRequest, signInAs } from './support/auth';

type NotificationPayload = {
  data: Array<{
    id: string;
    user_id: string;
    organization_id: string;
    title: string;
    type: string;
  }>;
  next_cursor?: string | null;
};

const PERSONAS: Array<{
  key: E2EUserKey;
  viewport: { width: number; height: number };
}> = [
  { key: 'admin', viewport: { width: 1366, height: 768 } },
  { key: 'leader', viewport: { width: 1024, height: 768 } },
  { key: 'user', viewport: { width: 390, height: 844 } },
];

test('roteamento de WhatsApp nunca usa a aba legada de configurações', () => {
  const notification = {
    title: 'WhatsApp desconectado',
    content: 'Reconecte a sessão.',
    type: 'whatsapp',
    lead_id: null,
    target_url: '/settings?tab=whatsapp',
    metadata: null,
  };

  expect(getNotificationRoute(notification, { canViewWhatsApp: false })).toBeNull();
  expect(getNotificationRoute(notification, { canViewWhatsApp: true })).toBe('/crm/conversas');
});

test('clique push aceita apenas destinos internos protegidos e respeita acesso ao WhatsApp', () => {
  expect(getPushNotificationRoute({ target_url: 'https://attacker.example/phishing' }))
    .toBe('/notifications');
  expect(getPushNotificationRoute({ target_url: '/login?redirectTo=/crm' }))
    .toBe('/notifications');
  expect(getPushNotificationRoute(
    { target_url: '/crm/conversas?conversation=session-1', type: 'whatsapp' },
    { canViewWhatsApp: false },
  )).toBe('/notifications');
  expect(getPushNotificationRoute(
    { target_url: '/crm/conversas?conversation=session-1', type: 'whatsapp' },
    { canViewWhatsApp: true },
  )).toBe('/crm/conversas?conversation=session-1');
  expect(getPushNotificationRoute({ lead_id: 'lead 1' }))
    .toBe('/crm/pipelines?lead=lead%201');
});

test.describe('central de notificações por perfil', () => {
  test.describe.configure({ timeout: 90_000 });

  for (const persona of PERSONAS) {
    test(`${persona.key} consulta e filtra notificações sem quebrar o layout`, async ({ page }) => {
      await page.setViewportSize(persona.viewport);
      await signInAs(page, persona.key);

      const documentResponse = await page.goto('/notifications');
      expect(documentResponse).not.toBeNull();
      expect(documentResponse?.status()).toBeLessThan(400);
      await expect(page.getByText('Acesso nao disponivel')).toHaveCount(0);

      const apiResponse = await authenticatedAPIRequest(page, 'GET', '/v1/notifications?limit=100');
      const apiBody = await apiResponse.text();
      expect(apiResponse.ok(), apiBody).toBeTruthy();
      const notifications = JSON.parse(apiBody) as NotificationPayload;
      expect(Array.isArray(notifications.data)).toBe(true);
      expect(new Set(notifications.data.map((item) => item.id)).size).toBe(notifications.data.length);

      const firstPageResponse = await authenticatedAPIRequest(page, 'GET', '/v1/notifications?limit=2');
      const firstPageBody = await firstPageResponse.text();
      expect(firstPageResponse.ok(), firstPageBody).toBeTruthy();
      const firstPage = JSON.parse(firstPageBody) as NotificationPayload;
      if (firstPage.next_cursor) {
        const secondPageResponse = await authenticatedAPIRequest(
          page,
          'GET',
          `/v1/notifications?limit=2&cursor=${encodeURIComponent(firstPage.next_cursor)}`,
        );
        const secondPageBody = await secondPageResponse.text();
        expect(secondPageResponse.ok(), secondPageBody).toBeTruthy();
        const secondPage = JSON.parse(secondPageBody) as NotificationPayload;
        const firstPageIds = new Set(firstPage.data.map((item) => item.id));
        expect(secondPage.data.every((item) => !firstPageIds.has(item.id))).toBe(true);
      }

      await expect(page.getByRole('tab', { name: 'Todas' })).toBeVisible();
      await expect(page.getByRole('tab', { name: /Não lidas/ })).toBeVisible();
      await page.getByRole('button', { name: 'Filtros', exact: true }).click();

      for (const category of ['Leads', 'WhatsApp', 'Sistema', 'Tarefas']) {
        await expect(page.getByRole('button', { name: category, exact: true })).toBeVisible();
      }

      const taskFilter = page.getByRole('button', { name: 'Tarefas', exact: true });
      await taskFilter.click();
      await expect(taskFilter).toHaveAttribute('aria-pressed', 'true');
      await page.keyboard.press('Escape');

      await page.getByRole('tab', { name: /Não lidas/ }).click();
      await expect(page.getByRole('tab', { name: /Não lidas/ })).toHaveAttribute('data-state', 'active');

      const loadMore = page.getByRole('button', { name: /Carregar mais notificações/ });
      if (await loadMore.count()) {
        await loadMore.click();
        await expect.poll(async () => (
          (await loadMore.count()) === 0 || await loadMore.isEnabled()
        )).toBe(true);
      }

      await expect.poll(
        () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      ).toBe(true);
    });
  }
});
