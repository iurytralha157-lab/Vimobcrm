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
    await expect(page.getByText('Link inválido ou expirado')).toBeVisible();
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
});
