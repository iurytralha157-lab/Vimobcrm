import { expect, test, type Page } from '@playwright/test';

const APP_ORIGIN = 'http://127.0.0.1:3100';
const API_ORIGIN = 'http://127.0.0.1:3198';
const SUPABASE_ORIGIN = 'http://127.0.0.1:3199';

type InvitationFixture = {
  id: string;
  email: string;
  role: 'admin' | 'manager' | 'user';
  organization_id: string;
  organization_name: string;
  expires_at: string;
  existing_account: boolean;
};

type InvitationMock = {
  acceptRequests: string[];
  lookupRequests: string[];
  blockedRequests: string[];
};

async function mockLoggedOutInvitation(
  page: Page,
  token: string,
  invitation: InvitationFixture,
): Promise<InvitationMock> {
  const acceptRequests: string[] = [];
  const lookupRequests: string[] = [];
  const blockedRequests: string[] = [];
  const invitationPath = `/v1/public/invitations/${token}`;
  const corsHeaders = {
    'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-origin': APP_ORIGIN,
    'cache-control': 'no-store',
  };

  await page.addInitScript(() => {
    window.localStorage.setItem('theme', 'light');
  });

  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.origin === APP_ORIGIN) {
      await route.continue();
      return;
    }

    if (url.origin === API_ORIGIN) {
      if (request.method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: corsHeaders });
        return;
      }

      if (request.method() === 'GET' && url.pathname === invitationPath) {
        lookupRequests.push(request.url());
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: corsHeaders,
          body: JSON.stringify({ data: invitation }),
        });
        return;
      }

      if (request.method() === 'POST' && url.pathname === `${invitationPath}/accept`) {
        acceptRequests.push(request.url());
        await route.fulfill({
          status: 422,
          contentType: 'application/json',
          headers: corsHeaders,
          body: JSON.stringify({
            error: {
              code: 'unexpected_test_mutation',
              message: 'O teste não deveria enviar um aceite inválido.',
            },
          }),
        });
        return;
      }

      blockedRequests.push(`${request.method()} ${request.url()}`);
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({ error: { code: 'not_mocked', message: 'Rota local não mockada.' } }),
      });
      return;
    }

    if (url.origin === SUPABASE_ORIGIN) {
      if (request.method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: corsHeaders });
        return;
      }

      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({
          code: 'session_not_found',
          message: 'No local session is available in this test.',
        }),
      });
      return;
    }

    blockedRequests.push(`${request.method()} ${request.url()}`);
    await route.abort('blockedbyclient');
  });

  return { acceptRequests, lookupRequests, blockedRequests };
}

function invitationFixture(existingAccount: boolean): InvitationFixture {
  return {
    id: '10000000-0000-4000-8000-000000000001',
    email: existingAccount ? 'existente@vimob.test' : 'novo@vimob.test',
    role: 'user',
    organization_id: '20000000-0000-4000-8000-000000000002',
    organization_name: 'Imobiliária Teste Vimob',
    expires_at: '2099-12-31T23:59:59.000Z',
    existing_account: existingAccount,
  };
}

test.describe('convite público no layout atual', () => {
  test('convite novo renderiza o AuthSplitLayout claro e bloqueia POST inválido', async ({ page }) => {
    const token = 'a'.repeat(64);
    const mocked = await mockLoggedOutInvitation(page, token, invitationFixture(false));

    await page.goto(`/convite/${token}`, { waitUntil: 'domcontentloaded' });

    const main = page.locator('main.auth-page.auth-login-page');
    const invitationRegion = page.getByRole('region', {
      name: 'Aceite de convite do Vimob CRM',
    });
    const hero = page.getByRole('complementary', {
      name: 'Vimob crm para sua imobiliária',
    });

    await expect(main).toBeVisible();
    await expect(invitationRegion).toBeVisible();
    await expect(hero).toBeVisible();
    await expect(hero.locator('video')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('html')).toHaveClass(/\blight\b/);
    await expect(main).toHaveCSS('background-color', 'rgb(247, 248, 246)');

    await expect(page.getByRole('heading', { name: 'Aceitar convite' })).toBeVisible();
    await expect(page.getByText('Convite para Imobiliária Teste Vimob')).toBeVisible();
    await expect(page.getByText('novo@vimob.test')).toBeVisible();
    await expect(page.getByLabel('Nome completo')).toBeVisible();
    await expect(page.getByLabel('WhatsApp')).toBeVisible();
    await expect(page.getByLabel('Senha', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Confirmar')).toBeVisible();
    await expect(page.getByLabel('Nome completo')).toHaveCSS('background-color', 'rgb(255, 255, 255)');

    const acceptButton = page.getByRole('button', { name: 'Aceitar convite', exact: true });
    await expect(acceptButton).toHaveClass(/\bauth-primary-action\b/);
    await page.locator('#invitation-terms').check();
    await page.locator('#invitation-privacy').check();
    await expect(acceptButton).toBeEnabled();
    await acceptButton.click();

    await expect(page.getByLabel('Nome completo')).toBeFocused();
    await expect(page.getByLabel('Nome completo')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#invitation-form-message')).toHaveText(
      'Informe seu nome para continuar.',
    );
    expect(mocked.lookupRequests).toHaveLength(1);
    expect(mocked.acceptRequests).toEqual([]);
    expect(mocked.blockedRequests).toEqual([]);
  });

  test('convite novo não cria overflow horizontal no viewport mobile', async ({ page }) => {
    const token = 'b'.repeat(64);
    const mocked = await mockLoggedOutInvitation(page, token, invitationFixture(false));
    await page.setViewportSize({ width: 390, height: 844 });

    await page.goto(`/convite/${token}`, { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'Aceitar convite' })).toBeVisible();
    await expect(page.getByRole('complementary', {
      name: 'Vimob crm para sua imobiliária',
    })).toBeHidden();

    const viewport = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
    }));
    expect(viewport.clientWidth).toBe(390);
    expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth);
    expect(viewport.bodyScrollWidth).toBeLessThanOrEqual(viewport.clientWidth);
    expect(mocked.acceptRequests).toEqual([]);
    expect(mocked.blockedRequests).toEqual([]);
  });

  test('conta existente sem sessão mostra a ação de login', async ({ page }) => {
    const token = 'c'.repeat(64);
    const mocked = await mockLoggedOutInvitation(page, token, invitationFixture(true));

    await page.goto(`/convite/${token}`, { waitUntil: 'domcontentloaded' });

    await expect(page.getByText(
      'Este e-mail já possui uma conta Vimob. Entre com seu acesso atual para aceitar o convite.',
    )).toBeVisible();
    await expect(page.getByRole('button', { name: 'Entrar para aceitar' })).toBeEnabled();
    await expect(page.getByLabel('Nome completo')).toHaveCount(0);
    expect(mocked.lookupRequests).toHaveLength(1);
    expect(mocked.acceptRequests).toEqual([]);
    expect(mocked.blockedRequests).toEqual([]);
  });
});
