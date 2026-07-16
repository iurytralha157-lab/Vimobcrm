import { expect, test, type Page } from '@playwright/test';

import { E2E_LEADS } from './support/e2e-env';
import { authenticatedAPIRequest, signInAs } from './support/auth';

type LeadListPayload = {
  data: Array<{ id: string; name: string }>;
};

async function visibleLeadIDs(page: Page) {
  const response = await authenticatedAPIRequest(page, 'GET', '/v1/leads?limit=200');
  const body = await response.text();
  expect(response.ok(), body).toBeTruthy();
  return (JSON.parse(body) as LeadListPayload).data.map((lead) => lead.id);
}

async function expectLeadStatus(page: Page, leadID: string, expectedStatus: number) {
  const response = await authenticatedAPIRequest(page, 'GET', `/v1/leads/${leadID}`);
  const body = await response.text();
  expect(response.status(), body).toBe(expectedStatus);
}

async function expectLeadUpdateStatus(page: Page, leadID: string, expectedStatus: number) {
  const response = await authenticatedAPIRequest(page, 'PATCH', `/v1/leads/${leadID}`, {
    message: `Permissao E2E ${Date.now()}`,
  });
  const body = await response.text();
  expect(response.status(), body).toBe(expectedStatus);
}

test.describe('visibilidade e operacao de leads por perfil', () => {
  test('administrador lista, abre e edita leads de qualquer equipe', async ({ page }) => {
    await signInAs(page, 'admin');

    const visible = await visibleLeadIDs(page);
    expect(visible).toEqual(expect.arrayContaining(Object.values(E2E_LEADS)));
    await expectLeadStatus(page, E2E_LEADS.outside, 200);
    await expectLeadUpdateStatus(page, E2E_LEADS.team, 200);
  });

  test('lider lista, abre e edita leads explicitamente vinculados a sua equipe', async ({ page }) => {
    await signInAs(page, 'leader');

    const visible = await visibleLeadIDs(page);
    expect(visible).toContain(E2E_LEADS.leaderOwn);
    expect(visible).toContain(E2E_LEADS.team);
    expect(visible).not.toContain(E2E_LEADS.outside);
    await expectLeadStatus(page, E2E_LEADS.team, 200);
    await expectLeadUpdateStatus(page, E2E_LEADS.team, 200);
    await expectLeadStatus(page, E2E_LEADS.outside, 404);
    await expectLeadUpdateStatus(page, E2E_LEADS.outside, 403);
  });

  test('usuario lista, abre e edita somente seus proprios leads', async ({ page }) => {
    await signInAs(page, 'user');

    const visible = await visibleLeadIDs(page);
    expect(visible).toContain(E2E_LEADS.team);
    expect(visible).toContain(E2E_LEADS.userOwn);
    expect(visible).not.toContain(E2E_LEADS.leaderOwn);
    expect(visible).not.toContain(E2E_LEADS.outside);
    await expectLeadStatus(page, E2E_LEADS.userOwn, 200);
    await expectLeadUpdateStatus(page, E2E_LEADS.userOwn, 200);
    await expectLeadStatus(page, E2E_LEADS.leaderOwn, 404);
    await expectLeadUpdateStatus(page, E2E_LEADS.leaderOwn, 403);
  });
});
