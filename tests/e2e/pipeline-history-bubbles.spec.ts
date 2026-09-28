import { expect, test } from '@playwright/test';

import { whatsAppHistoryResponseSchema } from '@/lib/validation/whatsapp';

import { E2E_LEADS, E2E_PASSWORD, E2E_USERS, getE2EConfig } from './support/e2e-env';

const incomingText = 'Mensagem recebida QA de contraste';
const conversationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa0';

const historyPayload = whatsAppHistoryResponseSchema.parse({
  data: {
    messages: [
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
        conversation_id: conversationId,
        session_id: null,
        message_id: 'qa-history-incoming',
        from_me: false,
        content: incomingText,
        message_type: 'text',
        media_url: null,
        media_mime_type: null,
        status: 'received',
        sent_at: '2026-09-27T12:00:00.000Z',
        delivered_at: null,
        read_at: null,
        sender_jid: null,
        sender_name: null,
      },
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
        conversation_id: conversationId,
        session_id: null,
        message_id: 'qa-history-outgoing-empty',
        from_me: true,
        content: '',
        message_type: 'text',
        media_url: null,
        media_mime_type: null,
        status: 'sent',
        sent_at: '2026-09-27T12:05:00.000Z',
        delivered_at: null,
        read_at: null,
        sender_jid: null,
        sender_name: 'Equipe QA',
      },
    ],
    nextCursor: null,
  },
});

type ComputedColor = { channels: [number, number, number]; alpha: number };

function parseComputedColor(color: string): ComputedColor {
  expect(color).toMatch(/^rgba?\(/);
  const values = color.match(/\d+(?:\.\d+)?/g)?.map(Number);
  expect(values?.length, `Cor RGB calculada: ${color}`).toBeGreaterThanOrEqual(3);
  return {
    channels: [values![0], values![1], values![2]],
    alpha: values?.[3] ?? 1,
  };
}

function compositeOver(foreground: ComputedColor, background: ComputedColor): ComputedColor {
  return {
    channels: foreground.channels.map((channel, index) =>
      channel * foreground.alpha + background.channels[index] * (1 - foreground.alpha),
    ) as [number, number, number],
    alpha: 1,
  };
}

function relativeLuminance({ channels: [red, green, blue] }: ComputedColor) {
  const linear = [red, green, blue].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrastRatio(first: ComputedColor, second: ComputedColor) {
  const brighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (brighter + 0.05) / (darker + 0.05);
}

test('Pipeline exibe bolhas e horários legíveis no histórico mobile claro da QA isolada', async ({ page }) => {
  test.setTimeout(420_000);
  if (!process.env.E2E_SUPABASE_WORKDIR) {
    throw new Error('Este teste exige a stack Supabase QA isolada.');
  }
  const config = getE2EConfig();
  if (
    new URL(config.supabaseURL).port !== '56421' ||
    new URL(config.databaseURL).port !== '56422' ||
    new URL(config.baseURL).port !== '3100' ||
    new URL(config.apiURL).port !== '8181'
  ) {
    throw new Error('Este teste só pode usar a stack QA 56421/56422 com frontend 3100 e API 8181.');
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'light' });
  let interceptedHistoryRequests = 0;
  await page.route('**/v1/whatsapp/history**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== 'GET' || url.searchParams.get('leadId') !== E2E_LEADS.team) {
      await route.continue();
      return;
    }
    interceptedHistoryRequests += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(historyPayload) });
  });

  // Go straight to Pipeline after the UI login. The first local compilation of
  // /inicio can exceed the login form's 15-second post-login routing timeout.
  await page.goto('/login');
  await page.evaluate(() => window.localStorage.clear());
  await page.locator('input[name="email"]').fill(E2E_USERS.admin.email);
  await page.locator('input[name="password"]').fill(E2E_PASSWORD);
  const tokenResponsePromise = page.waitForResponse((response) =>
    response.url().includes('/auth/v1/token') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: /^Acessar o CRM$/ }).click();
  const tokenResponse = await tokenResponsePromise;
  expect(tokenResponse.ok(), await tokenResponse.text()).toBeTruthy();
  await expect.poll(async () => (await page.context().cookies()).some((cookie) => cookie.name.startsWith('sb-')))
    .toBe(true);
  await page.goto('/crm/pipelines', { waitUntil: 'domcontentloaded', timeout: 240_000 });
  const openCard = page.getByRole('button', { name: 'Abrir detalhes do lead Lead da Equipe E2E' });
  await expect(openCard).toBeVisible({ timeout: 180_000 });
  // Keep the screenshot in the light theme shown in the reported mobile UI.
  // This changes browser styling only, without updating the seeded profile.
  await page.evaluate(() => {
    document.documentElement.classList.remove('dark');
    document.documentElement.classList.add('light');
    document.documentElement.style.colorScheme = 'light';
  });
  await expect(page.locator('html')).toHaveClass(/light/);
  await openCard.click();

  const drawer = page.locator('.lead-mobile-drawer');
  await expect(drawer).toBeVisible();
  await drawer.getByRole('tab', { name: 'Histórico' }).click();
  const thread = drawer.locator('.lead-thread-scroll');
  await expect(thread.getByText(incomingText, { exact: true })).toBeVisible();
  await expect(thread.getByText('Conteúdo indisponível', { exact: true })).toBeVisible();
  expect(interceptedHistoryRequests).toBeGreaterThan(0);

  const incomingBubble = thread.getByText(incomingText, { exact: true })
    .locator('xpath=ancestor::div[contains(@class, "overflow-visible")][1]');
  const outgoingBubble = thread.getByText('Conteúdo indisponível', { exact: true })
    .locator('xpath=ancestor::div[contains(@class, "overflow-visible")][1]');
  const incomingColor = await incomingBubble.evaluate((element) => getComputedStyle(element).backgroundColor);
  const outgoingColor = await outgoingBubble.evaluate((element) => getComputedStyle(element).backgroundColor);
  const panelColor = await thread.evaluate((element) => getComputedStyle(element.parentElement!).backgroundColor);
  const drawerColor = await drawer.evaluate((element) => getComputedStyle(element.querySelector('.lead-detail-dialog') || element).backgroundColor);
  const incoming = parseComputedColor(incomingColor);
  const outgoing = parseComputedColor(outgoingColor);
  const panel = parseComputedColor(panelColor);
  const drawerBackground = parseComputedColor(drawerColor);
  expect(incoming.alpha).toBe(1);
  expect(panel.alpha).toBeGreaterThan(0);
  const incomingPanelContrast = contrastRatio(incoming, compositeOver(panel, drawerBackground));
  expect(incomingPanelContrast, `${incomingColor} sobre ${panelColor} composto em ${drawerColor}`).toBeGreaterThan(1.08);
  expect(contrastRatio(incoming, outgoing), `${incomingColor} contra ${outgoingColor}`).toBeGreaterThan(1.3);

  const incomingTime = incomingBubble.locator('[data-message-timestamp-position="bottom-right"]');
  const outgoingTime = outgoingBubble.locator('[data-message-timestamp-position="bottom-left"]');
  await expect(incomingTime).toBeVisible();
  await expect(outgoingTime).toBeVisible();
  await expect(incomingTime).toContainText(/^\d{2}:\d{2}$/);
  await expect(outgoingTime).toContainText(/^\d{2}:\d{2}$/);

  const creationEvent = thread.getByText(/Lead (?:foi )?criado/i).first();
  await expect(creationEvent).toBeVisible();

  console.info(`Contraste da bolha recebida sobre o painel: ${incomingPanelContrast.toFixed(2)}:1`);
  await drawer.screenshot({ path: '.codex-tmp/pipeline-history-bubbles-light.png' });
});
