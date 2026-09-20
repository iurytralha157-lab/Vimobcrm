import { expect, test } from '@playwright/test';

import coverageManifest from '@/tests/e2e/coverage/auth-public-release.claims.json';
import {
  type RouteViewportClaim,
  verifyRouteViewportClaim,
} from '@/tests/e2e/support/e2e-claims';

const publicRoutesPilot = coverageManifest.tests[0];

test.describe('contratos públicos de autenticação e onboarding', () => {
  test('rotas públicas críticas renderizam sem sessão e sem overflow horizontal', async ({ page }, testInfo) => {
    for (const manifestClaim of publicRoutesPilot.claims) {
      await verifyRouteViewportClaim({
        page,
        testInfo,
        caseId: publicRoutesPilot.caseId,
        claim: manifestClaim as RouteViewportClaim,
      });
    }

    await page.goto('/confirmar-email');
    await expect(page.getByText('Este link é inválido, foi alterado ou expirou.')).toBeVisible();

    await page.goto('/reset-password');
    await expect(page.getByRole('heading', { name: 'Link inválido ou expirado' })).toBeVisible();
  });

  test('payloads inválidos retornam 400 e no-store', async ({ request }, testInfo) => {
    const routes = [
      '/api/onboarding/validate-step',
      '/api/onboarding/signup',
      '/api/onboarding/signup/recovery',
      '/api/onboarding/email-confirmation/resend',
      '/api/onboarding/checkout-plan',
    ];
    const forwardedFor = `198.51.${testInfo.retry}.10`;

    for (const route of routes) {
      const response = await request.post(route, {
        data: {},
        headers: { 'x-forwarded-for': forwardedFor },
      });
      expect(response.status(), route).toBe(400);
      expect(response.headers()['cache-control'], route).toContain('no-store');
    }
  });

  test('corpos acima do limite retornam 413 e no-store', async ({ request }, testInfo) => {
    const limits = [
      ['/api/onboarding/validate-step', 4 * 1024],
      ['/api/onboarding/signup', 16 * 1024],
      ['/api/onboarding/signup/recovery', 8 * 1024],
      ['/api/onboarding/email-confirmation/resend', 2 * 1024],
      ['/api/onboarding/checkout-plan', 2 * 1024],
    ] as const;
    const forwardedFor = `203.0.${testInfo.retry}.20`;

    for (const [route, limit] of limits) {
      const response = await request.post(route, {
        data: `"${'x'.repeat(limit + 1)}"`,
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': forwardedFor,
        },
      });
      expect(response.status(), route).toBe(413);
      expect(response.headers()['cache-control'], route).toContain('no-store');
    }
  });

  test('destino externo no login não causa navegação', async ({ page }) => {
    await page.goto('/login?redirectTo=https%3A%2F%2Fevil.example%2Fcapture');
    await expect(page).toHaveURL(/\/login\?/);
    await expect(page.getByRole('heading', { name: /Entrar no Vimob crm/i })).toBeVisible();
  });

  test('login inválido e recuperação usam respostas Auth mockadas', async ({ page }) => {
    let loginRequests = 0;
    let recoveryRequests = 0;
    let recoveryRedirectTo: string | null = null;

    await page.route('**/auth/v1/token**', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }

      loginRequests += 1;
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'invalid_credentials',
          message: 'Invalid login credentials',
          msg: 'Invalid login credentials',
        }),
      });
    });

    await page.route('**/auth/v1/recover**', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }

      recoveryRequests += 1;
      recoveryRedirectTo = new URL(route.request().url()).searchParams.get('redirect_to');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{}',
      });
    });

    await page.goto('/login');
    await page.getByLabel('Seu e-mail').fill('nao-existe@vimob.test');
    await page.getByLabel('Sua senha').fill('SenhaInvalida!2026');
    await page.getByRole('button', { name: 'Acessar o CRM', exact: true }).click();

    await expect(
      page.getByText('E-mail ou senha inválidos. Confira os dados e tente novamente.'),
    ).toBeVisible();
    expect(loginRequests).toBe(1);

    await page.getByRole('button', { name: 'Esqueceu sua senha?' }).click();
    await expect(page.getByRole('button', { name: 'Voltar para o login' })).toBeVisible();
    await page.getByLabel('Seu e-mail').fill('recuperacao@vimob.test');
    await page.getByRole('button', { name: 'Enviar link de recuperação' }).click();

    await expect(
      page.getByText('Se existir uma conta com esse e-mail, você receberá um link de recuperação.'),
    ).toBeVisible();
    expect(recoveryRequests).toBe(1);
    expect(recoveryRedirectTo).toBe(`${new URL(page.url()).origin}/reset-password`);
  });

  test('cadastro e reset bloqueiam avanço inválido sem mutação remota', async ({ page }) => {
    const mutationRequests: string[] = [];
    page.on('request', (request) => {
      const method = request.method();
      const pathname = new URL(request.url()).pathname;
      if (
        method !== 'GET' &&
        method !== 'HEAD' &&
        (pathname.startsWith('/api/onboarding/') || pathname.startsWith('/auth/v1/'))
      ) {
        mutationRequests.push(`${method} ${pathname}`);
      }
    });

    await page.goto('/cadastro');
    await expect(page.getByRole('progressbar', { name: 'Progresso do cadastro' })).toHaveAttribute(
      'aria-valuetext',
      'Etapa 1 de 3',
    );
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();

    await expect(page.locator('#documentNumber')).toBeFocused();
    await expect(page.locator('#documentNumber')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#companyName')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#brokersCount')).toHaveAttribute('aria-invalid', 'true');
    expect(mutationRequests).toEqual([]);

    await page.goto('/reset-password');
    await expect(page.getByRole('heading', { name: 'Link inválido ou expirado' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Voltar para o login' })).toBeVisible();
    expect(mutationRequests).toEqual([]);
  });

  test('cadastro percorre as três etapas com validação mockada sem criar conta', async ({ page }) => {
    const validationPayloads: unknown[] = [];
    let signupRequests = 0;

    await page.route('**/api/onboarding/validate-step', async (route) => {
      validationPayloads.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, valid: true }),
      });
    });
    await page.route('**/api/onboarding/plans', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [{
            id: '10000000-0000-4000-8000-000000000001',
            slug: 'profissional',
            name: 'Vimob Profissional',
            price: 199,
            billing_cycle: 'monthly',
            description: 'Plano de validação local',
            trial_enabled: true,
            trial_days: 7,
            max_users: 10,
            max_whatsapp_sessions: 2,
            display_order: 1,
            modules: ['crm'],
            display_features: ['CRM completo'],
          }],
        }),
      });
    });
    await page.route('**/api/onboarding/signup', async (route) => {
      signupRequests += 1;
      await route.abort('blockedbyclient');
    });

    await page.goto('/cadastro');
    await page.getByLabel('CPF/CNPJ').fill('04.252.011/0001-10');
    await page.getByLabel('Nome da imobiliária').fill('Imobiliária Teste Vimob');
    await page.getByLabel('Quantidade de corretores').fill('3');
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();

    const progress = page.getByRole('progressbar', { name: 'Progresso do cadastro' });
    await expect(progress).toHaveAttribute('aria-valuetext', 'Etapa 2 de 3');
    await expect(page.getByLabel('CPF do gestor')).toBeVisible();

    await page.getByLabel('Nome completo do gestor').fill('Gestor Teste');
    await page.getByLabel('CPF do gestor').fill('529.982.247-25');
    await page.getByLabel('WhatsApp').fill('(11) 99999-9999');
    await page.getByLabel('E-mail de acesso').fill('GESTOR@VIMOB.TEST');
    await page.getByLabel('Crie sua senha').fill('Senha@2026');
    await page.locator('#legal-consent').check();
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();

    await expect(progress).toHaveAttribute('aria-valuetext', 'Etapa 3 de 3');
    await expect(page.getByRole('region', { name: 'Planos do Vimob crm' })).toBeVisible();
    await page.getByRole('button', { name: 'Escolher plano' }).click();
    await expect(page.getByRole('button', { name: 'Plano selecionado' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Iniciar teste Profissional' })).toBeEnabled();

    expect(validationPayloads).toEqual([
      {
        step: 'organization',
        companyName: 'Imobiliária Teste Vimob',
        documentNumber: '04252011000110',
      },
      { step: 'access', email: 'gestor@vimob.test' },
    ]);
    expect(signupRequests).toBe(0);
  });

  test('login, recuperação, cadastro e reset não criam overflow no mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    const assertMobileLayout = async () => {
      const layout = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(layout.clientWidth).toBe(390);
      expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
    };

    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Entrar no Vimob crm' })).toBeVisible();
    await assertMobileLayout();

    await page.getByRole('button', { name: 'Esqueceu sua senha?' }).click();
    await expect(page.getByRole('heading', { name: 'Recuperar senha' })).toBeVisible();
    await assertMobileLayout();

    await page.goto('/cadastro');
    await expect(page.getByRole('heading', { name: 'Criar conta no Vimob CRM' })).toBeVisible();
    await assertMobileLayout();

    await page.goto('/reset-password');
    await expect(page.getByRole('heading', { name: 'Link inválido ou expirado' })).toBeVisible();
    await assertMobileLayout();
  });
});
