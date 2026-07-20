import { expect, test, type APIResponse, type Page } from '@playwright/test';

import { E2E_USERS } from './support/e2e-env';
import { authenticatedAPIRequest, fetchTenantContext, signInAs } from './support/auth';

type Automation = {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  trigger_type: string;
};

type AutomationEnvelope<T> = { data: T };
type UserListPayload = { data: Array<{ id: string; email: string }> };

const safeFlow = {
  nodes: [
    {
      id: 'trigger-manual',
      type: 'trigger',
      position: { x: 0, y: 0 },
      config: { trigger_type: 'manual' },
    },
    {
      id: 'delay-terminal',
      type: 'delay',
      position: { x: 240, y: 0 },
      config: { delay_type: 'minutes', delay_value: 1, stop_on_reply: false },
    },
  ],
  connections: [{ source: 'trigger-manual', target: 'delay-terminal' }],
  settings: {},
};

async function parseJSON<T>(response: APIResponse) {
  const body = await response.text();
  expect(response.ok(), body).toBeTruthy();
  return JSON.parse(body) as T;
}

async function expectStatus(response: APIResponse, status: number) {
  const body = await response.text();
  expect(response.status(), body).toBe(status);
}

async function findUserID(adminPage: Page, email: string) {
  const response = await authenticatedAPIRequest(adminPage, 'GET', '/v1/users');
  const payload = await parseJSON<UserListPayload>(response);
  const user = payload.data.find((candidate) => candidate.email.toLowerCase() === email.toLowerCase());
  expect(user, `Expected ${email} in the organization user list`).toBeTruthy();
  return user!.id;
}

async function setPermissions(adminPage: Page, userID: string, permissions: Record<string, boolean>) {
  const response = await authenticatedAPIRequest(
    adminPage,
    'PUT',
    `/v1/settings/users/${userID}/permissions`,
    { permissions },
  );
  await parseJSON(response);
}

async function resetPermissions(adminPage: Page, userID: string) {
  const response = await authenticatedAPIRequest(
    adminPage,
    'DELETE',
    `/v1/settings/users/${userID}/permissions`,
  );
  const body = await response.text();
  expect(response.ok(), body).toBeTruthy();
}

test.describe.serial('automacoes: ciclo de vida e permissoes', () => {
  test('administrador cria, publica versao, edita, duplica e exclui sem executar efeitos', async ({ page }) => {
    test.setTimeout(120_000);
    await signInAs(page, 'admin');
    const createdIDs: string[] = [];

    try {
      const invalidActiveDraft = await authenticatedAPIRequest(page, 'POST', '/v1/automations', {
        name: 'E2E rascunho ativo invalido',
        trigger_type: 'manual',
        is_active: true,
      });
      await expectStatus(invalidActiveDraft, 400);

      const uniqueName = `Automacao E2E ${Date.now()}`;
      const createResponse = await authenticatedAPIRequest(page, 'POST', '/v1/automations', {
        name: uniqueName,
        description: 'Fluxo inativo e sem efeitos externos',
        trigger_type: 'manual',
        trigger_config: { trigger_type: 'manual' },
        flow_definition: safeFlow,
        is_active: false,
      });
      const created = (await parseJSON<AutomationEnvelope<Automation>>(createResponse)).data;
      createdIDs.push(created.id);
      expect(created).toMatchObject({ name: uniqueName, is_active: false, trigger_type: 'manual' });

      const showResponse = await authenticatedAPIRequest(page, 'GET', `/v1/automations/${created.id}`);
      const shown = (await parseJSON<AutomationEnvelope<Automation & {
        nodes: unknown[];
        connections: unknown[];
      }>>(showResponse)).data;
      expect(shown.nodes).toHaveLength(2);
      expect(shown.connections).toHaveLength(1);

      const updatedName = `${uniqueName} revisada`;
      const saveResponse = await authenticatedAPIRequest(page, 'PUT', `/v1/automations/${created.id}/flow`, {
        flowDefinition: safeFlow,
        name: updatedName,
        description: 'Nova versao atomica do fluxo',
        isActive: false,
      });
      const saved = await parseJSON<AutomationEnvelope<{ nodes: unknown[] }>>(saveResponse);
      expect(saved.data.nodes).toHaveLength(2);

      const updateResponse = await authenticatedAPIRequest(page, 'PATCH', `/v1/automations/${created.id}`, {
        description: 'Metadados atualizados separadamente',
      });
      const updated = (await parseJSON<AutomationEnvelope<Automation>>(updateResponse)).data;
      expect(updated).toMatchObject({ name: updatedName, description: 'Metadados atualizados separadamente' });

      const duplicateResponse = await authenticatedAPIRequest(page, 'POST', `/v1/automations/${created.id}/duplicate`);
      const duplicate = (await parseJSON<AutomationEnvelope<Automation>>(duplicateResponse)).data;
      createdIDs.push(duplicate.id);
      expect(duplicate.id).not.toBe(created.id);
      expect(duplicate.is_active).toBe(false);

      const listResponse = await authenticatedAPIRequest(page, 'GET', '/v1/automations');
      const list = (await parseJSON<AutomationEnvelope<Automation[]>>(listResponse)).data;
      expect(list.map((automation) => automation.id)).toEqual(expect.arrayContaining(createdIDs));

      await page.goto('/automations');
      await expect(page.getByRole('tab').filter({ hasText: /^Automa/ }).first()).toBeVisible();
      await expect(page.locator('[data-tour="automations-new"]')).toBeVisible();
      await expect(page.getByText(updatedName, { exact: true })).toBeVisible();
    } finally {
      for (const automationID of createdIDs.reverse()) {
        await authenticatedAPIRequest(page, 'DELETE', `/v1/automations/${automationID}`).catch(() => undefined);
      }
    }
  });

  test('permissao de visualizacao nao libera escrita e permissao de gestao libera ambas', async ({ browser }) => {
    test.setTimeout(120_000);
    const adminContext = await browser.newContext();
    const leaderContext = await browser.newContext();
    const userContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const leaderPage = await leaderContext.newPage();
    const userPage = await userContext.newPage();
    let leaderID = '';
    let resetDone = false;

    try {
      await signInAs(adminPage, 'admin');
      leaderID = await findUserID(adminPage, E2E_USERS.leader.email);
      await signInAs(leaderPage, 'leader');
      await signInAs(userPage, 'user');

      await expectStatus(await authenticatedAPIRequest(userPage, 'GET', '/v1/automations'), 403);
      await userPage.goto('/automations');
      await expect(userPage.getByText('Acesso nao disponivel')).toBeVisible();

      await setPermissions(adminPage, leaderID, { automations_view: true });
      await expect.poll(async () => (await fetchTenantContext(leaderPage)).permissions)
        .toContain('automations_view');

      const readResponse = await authenticatedAPIRequest(leaderPage, 'GET', '/v1/automations');
      await parseJSON<AutomationEnvelope<Automation[]>>(readResponse);
      await expectStatus(await authenticatedAPIRequest(leaderPage, 'POST', '/v1/automations', {
        name: 'E2E proibida em leitura',
        trigger_type: 'manual',
      }), 403);

      await leaderPage.goto('/automations');
      await expect(leaderPage.getByRole('tab').filter({ hasText: /^Automa/ }).first()).toBeVisible();
      await expect(leaderPage.locator('[data-tour="automations-new"]')).toHaveCount(0);

      await setPermissions(adminPage, leaderID, { automations_manage: true });
      await expect.poll(async () => (await fetchTenantContext(leaderPage)).permissions)
        .toEqual(expect.arrayContaining(['automations_view', 'automations_manage']));

      const managedResponse = await authenticatedAPIRequest(leaderPage, 'POST', '/v1/automations', {
        name: `Automacao gerenciada E2E ${Date.now()}`,
        trigger_type: 'manual',
        flow_definition: safeFlow,
        is_active: false,
      });
      const managed = (await parseJSON<AutomationEnvelope<Automation>>(managedResponse)).data;

      await leaderPage.reload();
      await expect(leaderPage.locator('[data-tour="automations-new"]')).toBeVisible();

      const deleteResponse = await authenticatedAPIRequest(leaderPage, 'DELETE', `/v1/automations/${managed.id}`);
      await expectStatus(deleteResponse, 204);

      await resetPermissions(adminPage, leaderID);
      resetDone = true;
      await expect.poll(async () => (await fetchTenantContext(leaderPage)).permissions)
        .not.toContain('automations_view');
    } finally {
      if (leaderID && !resetDone && !adminPage.isClosed()) {
        await resetPermissions(adminPage, leaderID).catch(() => undefined);
      }
      await userContext.close();
      await leaderContext.close();
      await adminContext.close();
    }
  });
});
