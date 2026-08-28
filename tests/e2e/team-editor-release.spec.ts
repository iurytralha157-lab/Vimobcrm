import { expect, test, type Page } from '@playwright/test';

import {
  E2E_TEAM_ID,
  E2E_USERS,
} from './support/e2e-env';
import { authenticatedAPIRequest, signInAs } from './support/auth';

type AvailabilityInput = {
  day_of_week: number;
  start_time: string | null;
  end_time: string | null;
  is_all_day: boolean;
  is_active: boolean;
};

type TeamPayload = {
  data: {
    id: string;
    name: string;
    members?: Array<{
      id: string;
      user_id: string;
      is_leader?: boolean;
    }>;
  };
};

type TeamListPayload = {
  data: Array<{ id: string; name: string }>;
};

type AvailabilityPayload = {
  data: Array<AvailabilityInput & { team_member_id: string }>;
};

type TeamMutationPayload = {
  name?: string;
  members?: Array<{
    userId: string;
    isLeader?: boolean;
    availability?: AvailabilityInput[];
  }>;
};

function expectDefaultWeek(availability: AvailabilityInput[]) {
  expect(availability).toHaveLength(7);
  expect(availability.map((entry) => entry.day_of_week)).toEqual([0, 1, 2, 3, 4, 5, 6]);

  for (const day of availability) {
    const weekday = day.day_of_week >= 1 && day.day_of_week <= 5;
    expect(day.is_active, `active state for day ${day.day_of_week}`).toBe(weekday);
    expect(day.is_all_day).toBe(false);
    expect(day.start_time).toBe('08:00:00');
    expect(day.end_time).toBe('18:00:00');
  }
}

async function parseJSON<T>(response: Awaited<ReturnType<typeof authenticatedAPIRequest>>) {
  const body = await response.text();
  expect(response.ok(), body).toBeTruthy();
  return JSON.parse(body) as T;
}

async function findTemporaryTeam(page: Page, name: string) {
  const response = await authenticatedAPIRequest(page, 'GET', '/v1/teams?includeInactive=true');
  const payload = await parseJSON<TeamListPayload>(response);
  return payload.data.find((team) => team.name === name)?.id ?? null;
}

async function cleanupTemporaryTeam(page: Page, teamId: string | null, name: string) {
  const resolvedTeamId = teamId || await findTemporaryTeam(page, name).catch(() => null);
  if (!resolvedTeamId) return;

  const response = await authenticatedAPIRequest(page, 'DELETE', `/v1/teams/${resolvedTeamId}`);
  expect.soft(response.ok(), await response.text()).toBeTruthy();
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(
    () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
}

test.describe.serial('editor dedicado de equipes e horários', () => {
  test.describe.configure({ timeout: 120_000 });

  test('administrador cria, edita e remove uma equipe com semana completa', async ({ page }) => {
    const temporaryName = `Equipe Release E2E ${Date.now()}`;
    const editedName = `${temporaryName} Editada`;
    let teamId: string | null = null;

    await signInAs(page, 'admin');

    try {
      await page.goto('/crm/management?tab=teams');
      await page.getByRole('button', { name: 'Nova equipe', exact: true }).click();
      await expect(page).toHaveURL(/\/crm\/management\/teams\/new$/);
      await expect(page.getByText('Nova equipe', { exact: true }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'Criar equipe' })).toBeDisabled();

      await page.locator('#team-name').fill(temporaryName);
      await page.getByRole('switch', { name: `Adicionar ${E2E_USERS.user.name}` }).click();

      await expect(page.getByRole('heading', { name: 'Escala de atendimento' })).toBeVisible();
      await expect(page.getByText('Não recebe leads neste dia')).toHaveCount(2);
      await expect(page.getByRole('combobox', { name: 'Início de Segunda-feira' })).toContainText('08:00');
      await expect(page.getByRole('combobox', { name: 'Fim de Segunda-feira' })).toContainText('18:00');
      await expect(page.getByRole('button', { name: 'Criar equipe' })).toBeEnabled();

      const createResponsePromise = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.pathname === '/v1/teams' && response.request().method() === 'POST';
      });
      await page.getByRole('button', { name: 'Criar equipe' }).click();
      const createResponse = await createResponsePromise;
      const createBody = await createResponse.text();
      expect(createResponse.ok(), createBody).toBeTruthy();

      const createRequest = createResponse.request().postDataJSON() as TeamMutationPayload;
      expect(createRequest.name).toBe(temporaryName);
      expect(createRequest.members).toHaveLength(1);
      expect(createRequest.members?.[0].userId).toBeTruthy();
      expectDefaultWeek(createRequest.members?.[0].availability ?? []);

      const created = JSON.parse(createBody) as TeamPayload;
      teamId = created.data.id;
      await expect(page).toHaveURL(/\/crm\/management\?tab=teams$/);

      await page.getByRole('button', { name: `Editar equipe ${temporaryName}` }).click();
      await expect(page).toHaveURL(new RegExp(`/crm/management/teams/${teamId}/edit$`));
      await expect(page.getByText('Editar equipe', { exact: true }).first()).toBeVisible();
      await expect(page.locator('#team-name')).toHaveValue(temporaryName);
      await expect(page.getByRole('combobox', { name: 'Início de Segunda-feira' })).toContainText('08:00');

      await page.locator('#team-name').fill(editedName);
      await page.getByRole('combobox', { name: 'Início de Segunda-feira' }).click();
      await page.getByRole('option', { name: '08:30', exact: true }).click();

      const updateResponsePromise = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.pathname === `/v1/teams/${teamId}` && response.request().method() === 'PATCH';
      });
      await page.getByRole('button', { name: 'Salvar alterações' }).click();
      const updateResponse = await updateResponsePromise;
      const updateBody = await updateResponse.text();
      expect(updateResponse.ok(), updateBody).toBeTruthy();

      const updateRequest = updateResponse.request().postDataJSON() as TeamMutationPayload;
      expect(updateRequest.name).toBe(editedName);
      const updatedWeek = updateRequest.members?.[0].availability ?? [];
      expect(updatedWeek).toHaveLength(7);
      expect(updatedWeek.find((day) => day.day_of_week === 1)?.start_time).toBe('08:30:00');
      expect(updatedWeek.find((day) => day.day_of_week === 6)?.is_active).toBe(false);

      const team = await parseJSON<TeamPayload>(
        await authenticatedAPIRequest(page, 'GET', `/v1/teams/${teamId}`),
      );
      expect(team.data.name).toBe(editedName);
      expect(team.data.members).toHaveLength(1);

      const memberId = team.data.members?.[0].id;
      expect(memberId).toBeTruthy();
      const availability = await parseJSON<AvailabilityPayload>(
        await authenticatedAPIRequest(
          page,
          'GET',
          `/v1/member-availability?teamMemberIds=${memberId}`,
        ),
      );
      expect(availability.data).toHaveLength(7);
      expect(availability.data.find((day) => day.day_of_week === 1)?.start_time).toMatch(/^08:30/);
      expect(availability.data.find((day) => day.day_of_week === 0)?.is_active).toBe(false);
    } finally {
      await cleanupTemporaryTeam(page, teamId, temporaryName);
      if (temporaryName !== editedName) {
        await cleanupTemporaryTeam(page, null, editedName);
      }
    }
  });

  test('líder edita somente a própria equipe e não cria outra', async ({ page }) => {
    await signInAs(page, 'leader');

    await page.goto('/crm/management?tab=teams');
    await page.getByRole('button', { name: 'Editar equipe Equipe E2E' }).click();
    await expect(page).toHaveURL(new RegExp(`/crm/management/teams/${E2E_TEAM_ID}/edit$`));
    await expect(page.getByText('Editar equipe', { exact: true }).first()).toBeVisible();
    await expect(page.locator('#team-name')).toBeDisabled();
    await expect(page.getByRole('heading', { name: 'Escala de atendimento' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Salvar alterações' })).toBeVisible();

    await page.goto('/crm/management/teams/new');
    await expect(page.getByText('Acesso não disponível')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Criar equipe' })).toHaveCount(0);
  });

  test('usuário comum não abre criação nem edição de equipe', async ({ page }) => {
    await signInAs(page, 'user');

    for (const route of [
      '/crm/management/teams/new',
      `/crm/management/teams/${E2E_TEAM_ID}/edit`,
    ]) {
      await page.goto(route);
      await expect(page.getByText('Acesso não disponível')).toBeVisible();
      await expect(page.getByRole('button', { name: /Criar equipe|Salvar alterações/ })).toHaveCount(0);
    }
  });

  test('editor mantém a escala utilizável no mobile sem overflow horizontal', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signInAs(page, 'admin');
    await page.goto('/crm/management/teams/new');

    await page.locator('#team-name').fill(`Equipe Mobile ${Date.now()}`);
    await page.getByRole('switch', { name: `Adicionar ${E2E_USERS.user.name}` }).click();
    await expect(page.getByRole('combobox', { name: 'Início de Segunda-feira' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Criar equipe' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
