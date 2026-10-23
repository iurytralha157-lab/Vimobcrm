import { expect, test, type Page } from "@playwright/test";
import { Pool } from "pg";

import {
  E2E_ORGANIZATION_ID,
  E2E_OUTSIDE_TEAM_ID,
  E2E_TEAM_ID,
  E2E_USERS,
  getE2EConfig,
} from "./support/e2e-env";
import { authenticatedAPIRequest, signInAs } from "./support/auth";

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
    revision: number;
    logo_url?: string | null;
    is_active?: boolean;
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

type TeamHistoryPayload = {
  data: Array<{ id: string; entity_type: string; created_at: string }>;
};

type TeamMutationPayload = {
  expected_revision?: number;
  expected_member_ids?: string[];
  name?: string;
  logo_url?: string | null;
  is_active?: boolean;
  preserveLeadership?: boolean;
  members?: Array<{
    userId: string;
    isLeader?: boolean;
    availability?: AvailabilityInput[];
  }>;
};

type TeamStateSnapshot = {
  team: {
    name: string;
    logo_url: string | null;
    is_active: boolean;
  };
  members: Array<{
    id: string;
    user_id: string;
    is_leader: boolean;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
  }>;
  availability: Array<{
    id: string;
    team_member_id: string;
    day_of_week: number;
    start_time: string | null;
    end_time: string | null;
    is_all_day: boolean;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
  }>;
};

function expectDefaultWeek(availability: AvailabilityInput[]) {
  expect(availability).toHaveLength(7);
  expect(availability.map((entry) => entry.day_of_week)).toEqual([
    0, 1, 2, 3, 4, 5, 6,
  ]);

  for (const day of availability) {
    const weekday = day.day_of_week >= 1 && day.day_of_week <= 5;
    expect(day.is_active, `active state for day ${day.day_of_week}`).toBe(
      weekday,
    );
    expect(day.is_all_day).toBe(false);
    expect(day.start_time).toBe("08:00:00");
    expect(day.end_time).toBe("18:00:00");
  }
}

async function parseJSON<T>(
  response: Awaited<ReturnType<typeof authenticatedAPIRequest>>,
) {
  const body = await response.text();
  expect(response.ok(), body).toBeTruthy();
  return JSON.parse(body) as T;
}

async function findTemporaryTeam(page: Page, name: string) {
  const response = await authenticatedAPIRequest(
    page,
    "GET",
    "/v1/teams?includeInactive=true",
  );
  const payload = await parseJSON<TeamListPayload>(response);
  return payload.data.find((team) => team.name === name)?.id ?? null;
}

async function cleanupTemporaryTeam(
  page: Page,
  teamId: string | null,
  name: string,
) {
  const resolvedTeamId =
    teamId || (await findTemporaryTeam(page, name).catch(() => null));
  if (!resolvedTeamId) return;

  const response = await authenticatedAPIRequest(
    page,
    "DELETE",
    `/v1/teams/${resolvedTeamId}`,
  );
  expect.soft(response.ok(), await response.text()).toBeTruthy();
}

type TeamWizardStep = "identity" | "members" | "schedule" | "review";

function teamEditorDialog(page: Page) {
  return page.getByRole("dialog", { name: /^(Nova|Editar) equipe$/ });
}

async function openTeamStep(page: Page, step: TeamWizardStep) {
  const dialog = teamEditorDialog(page);
  await expect(dialog).toBeVisible();
  const tab = dialog.locator('[data-step-id="' + step + '"]');
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  const panel = dialog.getByRole("tabpanel");
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute("aria-labelledby", await tab.getAttribute("id") as string);
}

async function openMemberSchedule(page: Page, memberName: string) {
  await openTeamStep(page, "members");
  await page.getByRole("button", { name: 'Ver escala de ' + memberName, exact: true }).click();
  await expect(teamEditorDialog(page).locator('[data-step-id="schedule"]')).toHaveAttribute("aria-selected", "true");
}

async function expectDesktopWizardLayout(page: Page) {
  const dialog = teamEditorDialog(page);
  const geometry = await dialog.evaluate((element) => {
    const nav = element.querySelector('[role="tablist"]');
    const content = element.querySelector("[data-form-wizard-content]");
    const aside = element.querySelector("aside");
    const wizard = element.querySelector("[data-form-wizard]");
    if (!nav || !content || !aside || !wizard) throw new Error("Missing wizard layout region.");
    const modalBox = element.getBoundingClientRect();
    const navBox = nav.getBoundingClientRect();
    const contentBox = content.getBoundingClientRect();
    const asideBox = aside.getBoundingClientRect();
    const footerBox = wizard.children[1].getBoundingClientRect();
    return {
      modalLeft: modalBox.left, modalTop: modalBox.top,
      modalRight: modalBox.right, modalBottom: modalBox.bottom,
      viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
      navWidth: navBox.width, contentWidth: contentBox.width, asideWidth: asideBox.width,
      navRight: navBox.right, contentLeft: contentBox.left,
      contentRight: contentBox.right, asideLeft: asideBox.left,
      contentBottom: contentBox.bottom, footerTop: footerBox.top,
      overflowX: element.scrollWidth - element.clientWidth,
      overflowY: element.scrollHeight - element.clientHeight,
    };
  });
  expect(geometry.modalLeft).toBeGreaterThanOrEqual(11);
  expect(geometry.modalTop).toBeGreaterThanOrEqual(11);
  expect(geometry.modalRight).toBeLessThanOrEqual(geometry.viewportWidth - 11);
  expect(geometry.modalBottom).toBeLessThanOrEqual(geometry.viewportHeight - 11);
  expect(geometry.contentWidth).toBeGreaterThan(geometry.asideWidth);
  expect(geometry.contentWidth).toBeGreaterThan(geometry.navWidth);
  expect(geometry.asideWidth).toBeGreaterThanOrEqual(260);
  expect(geometry.asideWidth).toBeLessThanOrEqual(310);
  expect(Math.abs(geometry.navRight - geometry.contentLeft)).toBeLessThanOrEqual(2);
  expect(Math.abs(geometry.contentRight - geometry.asideLeft)).toBeLessThanOrEqual(2);
  expect(geometry.contentBottom).toBeLessThanOrEqual(geometry.footerTop + 1);
  expect(geometry.overflowX).toBeLessThanOrEqual(1);
  expect(geometry.overflowY).toBeLessThanOrEqual(1);
  await expect(dialog.locator("[data-form-wizard-content]")).toHaveCSS("overflow-y", "auto");
  for (const step of ["members", "schedule"] as const) {
    await openTeamStep(page, step);
    await expect(dialog.locator('[data-team-panel="' + step + '"]')).toBeVisible();
    await expect(dialog.locator('[data-team-panel="history"]')).toBeVisible();
    await expect(dialog.locator('[data-team-panel="' + (step === "members" ? "schedule" : "members") + '"]')).toHaveCount(0);
    const insets = await dialog.locator('[data-team-panel="' + step + '"]').evaluate((panel, currentStep) => {
      const item = panel.querySelector(currentStep === "members" ? "[data-team-members-scroll] > div" : "[data-team-schedule-scroll] > div");
      if (!item) throw new Error('Missing ' + currentStep + ' panel content.');
      const panelBox = panel.getBoundingClientRect();
      const itemBox = item.getBoundingClientRect();
      return { left: Math.round(itemBox.left - panelBox.left), right: Math.round(panelBox.right - itemBox.right) };
    }, step);
    expect(Math.abs(insets.left - insets.right), step + " panel spacing").toBeLessThanOrEqual(2);
  }
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    )
    .toBe(true);
  const dialog = teamEditorDialog(page);
  if (await dialog.isVisible()) {
    const dimensions = await dialog.evaluate((element) => ({
      width: element.scrollWidth - element.clientWidth,
      left: element.getBoundingClientRect().left,
      right: element.getBoundingClientRect().right,
      viewportWidth: window.innerWidth,
    }));
    expect(dimensions.width).toBeLessThanOrEqual(1);
    expect(dimensions.left).toBeGreaterThanOrEqual(0);
    expect(dimensions.right).toBeLessThanOrEqual(dimensions.viewportWidth);
  }
}

async function readTeamStateSnapshot(
  teamId: string,
): Promise<TeamStateSnapshot> {
  const pool = new Pool({ connectionString: getE2EConfig().databaseURL });
  try {
    const [teamResult, membersResult, availabilityResult] = await Promise.all([
      pool.query<TeamStateSnapshot["team"]>(
        `
        select name, logo_url, coalesce(is_active, true) as is_active
        from public.teams
        where organization_id = $1::uuid and id = $2::uuid
      `,
        [E2E_ORGANIZATION_ID, teamId],
      ),
      pool.query<TeamStateSnapshot["members"][number]>(
        `
        select
          id::text,
          user_id::text,
          coalesce(is_leader, false) as is_leader,
          coalesce(is_active, true) as is_active,
          created_at,
          updated_at
        from public.team_members
        where organization_id = $1::uuid and team_id = $2::uuid
        order by id
      `,
        [E2E_ORGANIZATION_ID, teamId],
      ),
      pool.query<TeamStateSnapshot["availability"][number]>(
        `
        select
          availability.id::text,
          availability.team_member_id::text,
          availability.day_of_week,
          availability.start_time::text,
          availability.end_time::text,
          coalesce(availability.is_all_day, false) as is_all_day,
          coalesce(availability.is_active, true) as is_active,
          availability.created_at,
          availability.updated_at
        from public.member_availability availability
        join public.team_members member on member.id = availability.team_member_id
        where member.organization_id = $1::uuid and member.team_id = $2::uuid
        order by availability.team_member_id, availability.day_of_week
      `,
        [E2E_ORGANIZATION_ID, teamId],
      ),
    ]);

    expect(teamResult.rows).toHaveLength(1);
    return {
      team: teamResult.rows[0],
      members: membersResult.rows,
      availability: availabilityResult.rows,
    };
  } finally {
    await pool.end();
  }
}

async function restoreTeamState(teamId: string, snapshot: TeamStateSnapshot) {
  const pool = new Pool({ connectionString: getE2EConfig().databaseURL });
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `
      update public.teams
      set name = $3, logo_url = $4, is_active = $5
      where organization_id = $1::uuid and id = $2::uuid
    `,
      [
        E2E_ORGANIZATION_ID,
        teamId,
        snapshot.team.name,
        snapshot.team.logo_url,
        snapshot.team.is_active,
      ],
    );

    for (const member of snapshot.members) {
      await client.query(
        `
        insert into public.team_members (
          id, organization_id, team_id, user_id, is_leader, is_active, created_at, updated_at
        ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8)
        on conflict (team_id, user_id) do update set
          is_leader = excluded.is_leader,
          is_active = excluded.is_active,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `,
        [
          member.id,
          E2E_ORGANIZATION_ID,
          teamId,
          member.user_id,
          member.is_leader,
          member.is_active,
          member.created_at,
          member.updated_at,
        ],
      );
    }

    await client.query(
      `
      delete from public.member_availability
      where organization_id = $1::uuid
        and team_member_id in (
          select id
          from public.team_members
          where organization_id = $1::uuid and team_id = $2::uuid
        )
    `,
      [E2E_ORGANIZATION_ID, teamId],
    );

    for (const availability of snapshot.availability) {
      await client.query(
        `
        insert into public.member_availability (
          id, organization_id, team_member_id, day_of_week, start_time, end_time,
          is_all_day, is_active, created_at, updated_at
        ) values (
          $1::uuid, $2::uuid, $3::uuid, $4, $5::time, $6::time,
          $7, $8, $9, $10
        )
      `,
        [
          availability.id,
          E2E_ORGANIZATION_ID,
          availability.team_member_id,
          availability.day_of_week,
          availability.start_time,
          availability.end_time,
          availability.is_all_day,
          availability.is_active,
          availability.created_at,
          availability.updated_at,
        ],
      );
    }

    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

test.describe.serial("editor de equipes e horários por etapas", () => {
  test.describe.configure({ timeout: 120_000 });

  test("administrador cria, edita e remove uma equipe com semana completa", async ({
    page,
  }) => {
    const temporaryName = `Equipe Release E2E ${Date.now()}`;
    const editedName = `${temporaryName} Editada`;
    let teamId: string | null = null;

    await signInAs(page, "admin");

    try {
      await page.goto("/crm/management?tab=teams");
      await page.locator('[data-tour="management-team-new"]:visible').click();
      await expect(page).toHaveURL(/\/crm\/management\/teams\/new$/);
      await expect(
        page.getByText("Nova equipe", { exact: true }).first(),
      ).toBeVisible();
      await openTeamStep(page, "review");
      await expect(
        page.getByRole("button", { name: "Criar equipe" }),
      ).toBeDisabled();
      await openTeamStep(page, "identity");
      await expect(
        page.getByRole("region", { name: "Indicadores da equipe" }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("heading", { name: "Histórico de alterações" }),
      ).toHaveCount(0);

      await page.locator("#team-name").fill(temporaryName);
      await openTeamStep(page, "members");
      await page
        .getByRole("switch", { name: `Adicionar ${E2E_USERS.user.name}` })
        .click();
      await openTeamStep(page, "schedule");
      await expect(
        page.getByRole("heading", { name: "Escala de atendimento" }),
      ).toBeVisible();
      await expect(
        page.getByRole("combobox", { name: "Início de Segunda-feira" }),
      ).toContainText("08:00");
      await expect(
        page.getByRole("combobox", { name: "Fim de Segunda-feira" }),
      ).toContainText("18:00");
      await openTeamStep(page, "review");
      await expect(
        page.getByRole("button", { name: "Criar equipe" }),
      ).toBeEnabled();

      const createResponsePromise = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          url.pathname === "/v1/teams" && response.request().method() === "POST"
        );
      });
      await page.getByRole("button", { name: "Criar equipe" }).click();
      const createResponse = await createResponsePromise;
      const createBody = await createResponse.text();
      expect(createResponse.ok(), createBody).toBeTruthy();

      const createRequest = createResponse
        .request()
        .postDataJSON() as TeamMutationPayload;
      expect(createRequest.name).toBe(temporaryName);
      expect(createRequest.members).toHaveLength(1);
      expect(createRequest.members?.[0].userId).toBeTruthy();
      expectDefaultWeek(createRequest.members?.[0].availability ?? []);

      const created = JSON.parse(createBody) as TeamPayload;
      teamId = created.data.id;
      await expect(page).toHaveURL(/\/crm\/management\?tab=teams$/);
      await expect(teamEditorDialog(page)).toHaveCount(0);
      await page.goto(`/crm/management/teams/${teamId}/edit`);
      await expect(page).toHaveURL(
        new RegExp(`/crm/management/teams/${teamId}/edit$`),
      );
      await expect(
        page.getByText("Editar equipe", { exact: true }).first(),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Criar equipe" }),
      ).toHaveCount(0);
      await openTeamStep(page, "review");
      await expect(
        page.getByRole("button", { name: "Salvar alterações" }),
      ).toBeDisabled();
      await expect(
        page.getByRole("heading", { name: "Operação da equipe" }),
      ).toHaveCount(0);
      const indicators = page.getByRole("region", {
        name: "Indicadores da equipe",
      });
      await page.locator("summary").filter({ hasText: "Indicadores da equipe" }).click();
      await expect(indicators).toBeVisible();
      await expect(indicators.getByText(/^Membros$/i)).toBeVisible();
      await expect(indicators.getByText(/^Online agora$/i)).toBeVisible();
      await expect(indicators.getByText(/^Em horário$/i)).toBeVisible();
      await expect(indicators.getByText(/^Leads \(30 dias\)$/i)).toBeVisible();
      await expect(indicators.getByText(/^Distribuições$/i)).toBeVisible();
      await expect(indicators.locator(":scope > *")).toHaveCount(5);
      await expect(
        indicators.locator('[aria-label^="Distribuições:"]'),
      ).toHaveAttribute(
        "aria-label",
        /Distribuições: 0\. Histórico completo desta equipe\./,
      );
      await expect(
        page.getByRole("heading", { name: "Histórico de alterações" }),
      ).toBeVisible();
      await expect(
        page.getByText("Equipe criada", { exact: true }),
      ).toBeVisible();
      const initialHistoryItems = await page
        .locator("[data-team-history-scroll] ol > li")
        .allTextContents();
      const createdHistoryIndex = initialHistoryItems.findIndex((item) =>
        item.includes("Equipe criada"),
      );
      const memberHistoryIndex = initialHistoryItems.findIndex((item) =>
        item.includes(`${E2E_USERS.user.name} foi adicionado à equipe`),
      );
      const scheduleHistoryIndex = initialHistoryItems.findIndex((item) =>
        item.includes(`Escala de ${E2E_USERS.user.name} atualizada`),
      );
      expect(createdHistoryIndex).toBe(0);
      expect(memberHistoryIndex).toBeGreaterThan(createdHistoryIndex);
      expect(scheduleHistoryIndex).toBeGreaterThan(memberHistoryIndex);
      await expect(
        page.getByText("Equipe, membros e escalas", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByText("Clique em outro membro para trocar", { exact: true }),
      ).toHaveCount(0);
      await expectDesktopWizardLayout(page);
      await expect(page.locator("[data-team-history-scroll]")).toHaveCSS(
        "overflow-y",
        "auto",
      );
      await openTeamStep(page, "identity");
      await expect(page.locator("#team-name")).toHaveValue(temporaryName);

      await openMemberSchedule(page, E2E_USERS.admin.name);
      await expect(
        page.getByText(`${E2E_USERS.admin.name} está fora da equipe`),
      ).toBeVisible();
      await openMemberSchedule(page, E2E_USERS.user.name);
      await openTeamStep(page, "members");
      await expect(
        page.getByRole("button", {
          name: `Ver escala de ${E2E_USERS.user.name}`,
        }),
      ).toHaveAttribute("aria-pressed", "true");
      await openTeamStep(page, "schedule");
      await expect(
        page.getByRole("combobox", { name: "Início de Segunda-feira" }),
      ).toContainText("08:00");

      await openTeamStep(page, "identity");
      await page.locator("#team-name").fill(editedName);
      await openTeamStep(page, "schedule");
      await page
        .getByRole("combobox", { name: "Início de Segunda-feira" })
        .click();
      await page.getByRole("option", { name: "08:30", exact: true }).click();

      const updateResponsePromise = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          url.pathname === `/v1/teams/${teamId}` &&
          response.request().method() === "PATCH"
        );
      });
      const availabilityRefreshPromise = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          url.pathname === "/v1/member-availability" &&
          response.request().method() === "GET" &&
          response.ok()
        );
      });
      await openTeamStep(page, "review");
      await page.getByRole("button", { name: "Salvar alterações" }).click();
      const updateResponse = await updateResponsePromise;
      const updateBody = await updateResponse.text();
      expect(updateResponse.ok(), updateBody).toBeTruthy();
      await availabilityRefreshPromise;
      await expect(page).toHaveURL(
        new RegExp(`/crm/management/teams/${teamId}/edit$`),
      );
      await expect(
        page.getByRole("button", { name: "Salvar alterações" }),
      ).toBeDisabled();
      await expect(
        page.getByText("Nome da equipe alterado", { exact: true }),
      ).toBeVisible();

      const updateRequest = updateResponse
        .request()
        .postDataJSON() as TeamMutationPayload;
      expect(updateRequest.expected_revision).toBe(created.data.revision);
      expect(updateRequest.expected_member_ids).toEqual(
        created.data.members?.map((member) => member.id),
      );
      expect(updateRequest.name).toBe(editedName);
      const updatedWeek = updateRequest.members?.[0].availability ?? [];
      expect(updatedWeek).toHaveLength(7);
      expect(updatedWeek.find((day) => day.day_of_week === 1)?.start_time).toBe(
        "08:30:00",
      );
      expect(updatedWeek.find((day) => day.day_of_week === 6)?.is_active).toBe(
        false,
      );

      const team = await parseJSON<TeamPayload>(
        await authenticatedAPIRequest(page, "GET", `/v1/teams/${teamId}`),
      );
      expect(team.data.name).toBe(editedName);
      expect(team.data.members).toHaveLength(1);

      const memberId = team.data.members?.[0].id;
      expect(memberId).toBeTruthy();
      const availability = await parseJSON<AvailabilityPayload>(
        await authenticatedAPIRequest(
          page,
          "GET",
          `/v1/member-availability?teamMemberIds=${memberId}`,
        ),
      );
      expect(availability.data).toHaveLength(7);
      expect(
        availability.data.find((day) => day.day_of_week === 1)?.start_time,
      ).toMatch(/^08:30/);
      expect(
        availability.data.find((day) => day.day_of_week === 0)?.is_active,
      ).toBe(false);

      const historyBeforeNoOp = await parseJSON<TeamHistoryPayload>(
        await authenticatedAPIRequest(
          page,
          "GET",
          `/v1/teams/${teamId}/history`,
        ),
      );
      const noOpResponse = await authenticatedAPIRequest(
        page,
        "PATCH",
        `/v1/teams/${teamId}`,
        {
          ...updateRequest,
          expected_revision: (JSON.parse(updateBody) as TeamPayload).data.revision,
        },
      );
      expect(noOpResponse.ok(), await noOpResponse.text()).toBeTruthy();
      const noOpTeam = JSON.parse(await noOpResponse.text()) as TeamPayload;
      expect(noOpTeam.data.revision).toBe(
        (JSON.parse(updateBody) as TeamPayload).data.revision,
      );
      const historyAfterNoOp = await parseJSON<TeamHistoryPayload>(
        await authenticatedAPIRequest(
          page,
          "GET",
          `/v1/teams/${teamId}/history`,
        ),
      );
      expect(historyAfterNoOp.data.map((event) => event.id)).toEqual(
        historyBeforeNoOp.data.map((event) => event.id),
      );
    } finally {
      await cleanupTemporaryTeam(page, teamId, temporaryName);
      if (temporaryName !== editedName) {
        await cleanupTemporaryTeam(page, null, editedName);
      }
    }
  });

  test("duas sessões não sobrescrevem alterações feitas a partir da mesma revisão", async ({
    page,
    browser,
  }) => {
    const temporaryName = `Equipe Concorrencia E2E ${Date.now()}`;
    const firstName = `${temporaryName} Primeiro`;
    const secondName = `${temporaryName} Segundo`;
    let teamId: string | null = null;
    const otherContext = await browser.newContext();
    const otherPage = await otherContext.newPage();

    await signInAs(page, "admin");
    try {
      const created = await parseJSON<TeamPayload>(
        await authenticatedAPIRequest(page, "POST", "/v1/teams", {
          name: temporaryName,
          members: [],
        }),
      );
      teamId = created.data.id;
      await signInAs(otherPage, "admin");

      await Promise.all([
        page.goto(`/crm/management/teams/${teamId}/edit`),
        otherPage.goto(`/crm/management/teams/${teamId}/edit`),
      ]);
      await expect(page.locator("#team-name")).toHaveValue(temporaryName);
      await expect(otherPage.locator("#team-name")).toHaveValue(temporaryName);
      await page.locator("#team-name").fill(firstName);
      await otherPage.locator("#team-name").fill(secondName);

      const firstResponsePromise = page.waitForResponse((response) =>
        new URL(response.url()).pathname === `/v1/teams/${teamId}` &&
        response.request().method() === "PATCH",
      );
      await openTeamStep(page, "review");
      await page.getByRole("button", { name: "Salvar alterações" }).click();
      const firstResponse = await firstResponsePromise;
      expect(firstResponse.status(), await firstResponse.text()).toBe(200);
      const firstRequest = firstResponse.request().postDataJSON() as TeamMutationPayload;
      expect(firstRequest.expected_revision).toBe(created.data.revision);
      expect(firstRequest.expected_member_ids).toEqual([]);
      const firstSave = JSON.parse(await firstResponse.text()) as TeamPayload;
      expect(firstSave.data.revision).toBe(created.data.revision + 1);

      const secondResponsePromise = otherPage.waitForResponse((response) =>
        new URL(response.url()).pathname === `/v1/teams/${teamId}` &&
        response.request().method() === "PATCH",
      );
      await openTeamStep(otherPage, "review");
      await otherPage.getByRole("button", { name: "Salvar alterações" }).click();
      const secondResponse = await secondResponsePromise;
      expect(secondResponse.status()).toBe(409);
      const secondRequest = secondResponse.request().postDataJSON() as TeamMutationPayload;
      expect(secondRequest.expected_revision).toBe(created.data.revision);
      expect(secondRequest.expected_member_ids).toEqual([]);
      expect((await secondResponse.json()).error.code).toBe("team_revision_conflict");
      await expect(otherPage.getByRole("alert")).toContainText(
        "Esta equipe foi alterada em outra sessão. Suas alterações estão preservadas.",
      );
      await openTeamStep(otherPage, "identity");
      await expect(otherPage.locator("#team-name")).toHaveValue(secondName);
      await openTeamStep(otherPage, "review");
      await expect(
        otherPage.getByRole("button", { name: "Salvar alterações" }),
      ).toBeDisabled();

      const saved = await parseJSON<TeamPayload>(
        await authenticatedAPIRequest(page, "GET", `/v1/teams/${teamId}`),
      );
      expect(saved.data.name).toBe(firstName);
      expect(saved.data.revision).toBe(firstSave.data.revision);

      await otherPage
        .getByRole("button", { name: "Descartar alterações e carregar versão atual" })
        .click();
      await openTeamStep(otherPage, "identity");
      await expect(otherPage.locator("#team-name")).toHaveValue(firstName);
    } finally {
      await otherContext.close();
      await cleanupTemporaryTeam(page, teamId, temporaryName);
    }
  });

  test("falha ao criar preserva o formulário e exibe um único erro", async ({
    page,
  }) => {
    const temporaryName = `Equipe Erro E2E ${Date.now()}`;
    const backendMessage = "Falha controlada ao criar equipe.";
    const publicErrorMessage =
      "Não foi possível concluir esta ação agora. Tente novamente em instantes.";

    await signInAs(page, "admin");
    await page.route("**/v1/teams", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }

      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "team_operation_failed",
            message: backendMessage,
          },
        }),
      });
    });

    await page.goto("/crm/management/teams/new");
    await page.locator("#team-name").fill(temporaryName);
    await openTeamStep(page, "members");
    const memberSwitch = page.getByRole("switch", {
      name: new RegExp(E2E_USERS.user.name),
    });
    await memberSwitch.click();

    const failedResponsePromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/v1/teams" &&
        response.request().method() === "POST",
    );
    await openTeamStep(page, "review");
    await page.getByRole("button", { name: "Criar equipe" }).click();
    expect((await failedResponsePromise).status()).toBe(500);

    await expect(page).toHaveURL(/\/crm\/management\/teams\/new$/);
    await openTeamStep(page, "identity");
    await expect(page.locator("#team-name")).toHaveValue(temporaryName);
    await openTeamStep(page, "members");
    await expect(memberSwitch).toBeChecked();
    await openTeamStep(page, "review");
    await expect(
      page.getByRole("button", { name: "Criar equipe" }),
    ).toBeEnabled();
    await expect(
      page
        .locator("[data-sonner-toast]")
        .filter({ hasText: publicErrorMessage }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("heading", { name: "Histórico de alterações" }),
    ).toHaveCount(0);
  });

  test("erro ao listar equipes não é apresentado como lista vazia", async ({
    page,
  }) => {
    let allowSuccessfulList = false;

    await signInAs(page, "admin");
    await page.route("**/v1/teams?**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (
        request.method() !== "GET" ||
        url.pathname !== "/v1/teams" ||
        url.searchParams.get("includeInactive") !== "true" ||
        allowSuccessfulList
      ) {
        await route.continue();
        return;
      }

      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "team_operation_failed",
            message: "Falha controlada ao listar equipes.",
          },
        }),
      });
    });

    await page.goto("/crm/management?tab=teams");
    await expect(
      page.getByText("Crie sua primeira equipe", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("Não foi possível carregar as equipes", { exact: true }),
    ).toBeVisible();

    allowSuccessfulList = true;
    await page.getByRole("button", { name: "Tentar novamente" }).click();
    await expect(
      page.locator('[data-tour="management-team-list"]'),
    ).toBeVisible();
    await expect(
      page.locator('button[aria-label="Editar equipe Equipe E2E"]'),
    ).toBeVisible();
  });

  test("líder salva somente membros e escala da própria equipe e não cria outra", async ({
    page,
  }) => {
    const snapshot = await readTeamStateSnapshot(E2E_TEAM_ID);

    try {
      await signInAs(page, "leader");
      const initialTeam = await parseJSON<TeamPayload>(
        await authenticatedAPIRequest(page, "GET", `/v1/teams/${E2E_TEAM_ID}`),
      );
      const originalLeader = initialTeam.data.members?.find(
        (member) => member.is_leader,
      );
      expect(originalLeader).toBeTruthy();

      await page.goto("/crm/management?tab=teams");
      await page
        .locator('button[aria-label="Editar equipe Equipe E2E"]')
        .click();
      await expect(page).toHaveURL(
        new RegExp(`/crm/management/teams/${E2E_TEAM_ID}/edit$`),
      );
      await expect(
        page.getByText("Editar equipe", { exact: true }).first(),
      ).toBeVisible();
      await expect(page.locator("#team-name")).toBeDisabled();
      await openTeamStep(page, "schedule");
      await expect(
        page.getByRole("heading", { name: "Escala de atendimento" }),
      ).toBeVisible();

      for (const memberName of [E2E_USERS.leader.name, E2E_USERS.user.name]) {
        await openMemberSchedule(page, memberName);
        const warningConfirmation = page.getByRole("checkbox", {
          name: "Escala revisada",
        });
        if (await warningConfirmation.isVisible().catch(() => false)) {
          await warningConfirmation.check();
        }
      }

      await openMemberSchedule(page, E2E_USERS.leader.name);
      const mondayStart = page.getByRole("combobox", {
        name: "Início de Segunda-feira",
      });
      const originalMondayStart = (await mondayStart.innerText()).trim();
      const changedMondayStart = originalMondayStart.includes("08:30")
        ? "09:00"
        : "08:30";
      await mondayStart.click();
      await page
        .getByRole("option", { name: changedMondayStart, exact: true })
        .click();

      await openTeamStep(page, "review");
      const saveButton = page.getByRole("button", {
        name: "Salvar alterações",
      });
      await expect(saveButton).toBeEnabled();
      const updateResponsePromise = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === `/v1/teams/${E2E_TEAM_ID}` &&
          response.request().method() === "PATCH",
      );
      await saveButton.click();
      const updateResponse = await updateResponsePromise;
      expect(updateResponse.ok(), await updateResponse.text()).toBeTruthy();

      const updateRequest = updateResponse
        .request()
        .postDataJSON() as TeamMutationPayload;
      expect(updateRequest.expected_revision).toBe(initialTeam.data.revision);
      expect(updateRequest.expected_member_ids).toEqual(
        initialTeam.data.members?.map((member) => member.id),
      );
      expect(updateRequest).not.toHaveProperty("name");
      expect(updateRequest).not.toHaveProperty("logo_url");
      expect(updateRequest).not.toHaveProperty("is_active");
      expect(updateRequest.preserveLeadership).toBe(true);
      expect(updateRequest.members).toHaveLength(
        initialTeam.data.members?.length || 0,
      );
      expect(
        updateRequest.members?.find(
          (member) => member.userId === originalLeader?.user_id,
        )?.isLeader,
      ).toBe(true);

      await expect(page).toHaveURL(
        new RegExp(`/crm/management/teams/${E2E_TEAM_ID}/edit$`),
      );
      await expect(saveButton).toBeDisabled();

      const updatedTeam = await parseJSON<TeamPayload>(
        await authenticatedAPIRequest(page, "GET", `/v1/teams/${E2E_TEAM_ID}`),
      );
      expect(updatedTeam.data.name).toBe(snapshot.team.name);
      expect(updatedTeam.data.logo_url ?? null).toBe(snapshot.team.logo_url);
      expect(updatedTeam.data.is_active).toBe(snapshot.team.is_active);
      expect(
        updatedTeam.data.members?.find(
          (member) => member.user_id === originalLeader?.user_id,
        )?.is_leader,
      ).toBe(true);

      const updatedAvailability = await parseJSON<AvailabilityPayload>(
        await authenticatedAPIRequest(
          page,
          "GET",
          `/v1/member-availability?teamMemberIds=${originalLeader?.id}`,
        ),
      );
      expect(
        updatedAvailability.data.find((day) => day.day_of_week === 1)
          ?.start_time,
      ).toMatch(new RegExp(`^${changedMondayStart}`));

      await page.goto("/crm/management/teams/new");
      await expect(page.getByText("Acesso não disponível")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Criar equipe" }),
      ).toHaveCount(0);

      await page.goto(`/crm/management/teams/${E2E_OUTSIDE_TEAM_ID}/edit`);
      await expect(page.getByText("Acesso não disponível")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Salvar alterações" }),
      ).toHaveCount(0);

      const historyResponse = await authenticatedAPIRequest(
        page,
        "GET",
        `/v1/teams/${E2E_OUTSIDE_TEAM_ID}/history`,
      );
      expect(historyResponse.status(), await historyResponse.text()).toBe(403);
    } finally {
      await restoreTeamState(E2E_TEAM_ID, snapshot);
    }
  });

  test("usuário comum não abre criação nem edição de equipe", async ({
    page,
  }) => {
    await signInAs(page, "user");

    for (const route of [
      "/crm/management/teams/new",
      `/crm/management/teams/${E2E_TEAM_ID}/edit`,
    ]) {
      await page.goto(route);
      await expect(page.getByText("Acesso não disponível")).toBeVisible();
      await expect(
        page.getByRole("button", { name: /Criar equipe|Salvar alterações/ }),
      ).toHaveCount(0);
    }
  });

  test("criação por etapas continua utilizável no modal mobile sem overflow horizontal", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signInAs(page, "admin");
    await page.goto("/crm/management?tab=teams");
    for (const tabName of ["Equipes", "Distribuição", "Pipelines", "Tags"]) {
      await expect(page.getByRole("tab", { name: tabName })).toBeVisible();
    }
    await expectNoHorizontalOverflow(page);
    await page.locator('[data-tour="management-team-new"]:visible').click();
    await expect(page).toHaveURL(/\/crm\/management\/teams\/new$/);
    await expect(
      page.getByRole("region", { name: "Indicadores da equipe" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Histórico de alterações" }),
    ).toHaveCount(0);
    await expect(
      page.locator('button[aria-label^="Ver escala de"][aria-pressed="true"]'),
    ).toHaveCount(0);

    await expect(teamEditorDialog(page)).toBeVisible();
    await page.locator("#team-name").fill(`Equipe Mobile ${Date.now()}`);
    await openTeamStep(page, "members");
    await page
      .getByRole("switch", { name: `Adicionar ${E2E_USERS.user.name}` })
      .click();
    await expect(page.getByText("Carregando presença")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await openTeamStep(page, "schedule");
    await expect(
      page.getByRole("combobox", { name: "Início de Segunda-feira" }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await openTeamStep(page, "review");
    await expect(
      page.getByRole("button", { name: "Criar equipe" }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("edição por etapas mantém KPIs, escala, histórico e rodapé acessíveis no modal mobile", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signInAs(page, "admin");
    await page.goto(`/crm/management/teams/${E2E_TEAM_ID}/edit`);

    const indicators = page.getByRole("region", {
      name: "Indicadores da equipe",
    });
    await page.locator("summary").filter({ hasText: "Indicadores da equipe" }).click();
    await expect(indicators).toBeVisible();
    await expect(indicators.locator(":scope > *")).toHaveCount(5);
    await openMemberSchedule(page, E2E_USERS.user.name);
    await expect(
      page.getByRole("heading", { name: "Escala de atendimento" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Histórico de alterações" }),
    ).toBeVisible();

    await expectNoHorizontalOverflow(page);
    await openTeamStep(page, "review");
    const editorScroller = teamEditorDialog(page).locator("[data-form-wizard] > div").first();
    await expect(editorScroller).toHaveCSS("overflow-y", "auto");
    await editorScroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    const bottomScrollTop = await editorScroller.evaluate(
      (element) => element.scrollTop,
    );
    expect(bottomScrollTop).toBeGreaterThan(0);
    const saveButton = page.getByRole("button", { name: "Salvar alterações" });
    await expect(saveButton).toBeVisible();
    const historyPanel = page.locator('[data-team-panel="history"]');
    const [saveBox, historyBox, scrollerBox] = await Promise.all([
      saveButton.boundingBox(), historyPanel.boundingBox(), editorScroller.boundingBox(),
    ]);
    expect(saveBox).not.toBeNull();
    expect(historyBox).not.toBeNull();
    expect(scrollerBox).not.toBeNull();
    expect(historyBox!.y + historyBox!.height).toBeLessThanOrEqual(saveBox!.y);
    expect(saveBox!.y + saveBox!.height).toBeLessThanOrEqual(844);
    await page.mouse.move(scrollerBox!.x + scrollerBox!.width / 2, scrollerBox!.y + scrollerBox!.height / 2);
    await page.mouse.wheel(0, -650);
    await expect
      .poll(() => editorScroller.evaluate((element) => element.scrollTop))
      .toBeLessThan(bottomScrollTop);
    await expectNoHorizontalOverflow(page);
  });
});
