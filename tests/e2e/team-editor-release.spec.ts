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

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    )
    .toBe(true);
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

test.describe.serial("editor dedicado de equipes e horários", () => {
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
      await expect(
        page.getByRole("button", { name: "Criar equipe" }),
      ).toBeDisabled();
      await expect(
        page.getByRole("region", { name: "Indicadores da equipe" }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("heading", { name: "Histórico de alterações" }),
      ).toHaveCount(0);

      await page.locator("#team-name").fill(temporaryName);
      await page
        .getByRole("switch", { name: `Adicionar ${E2E_USERS.user.name}` })
        .click();
      await expect(
        page.getByRole("heading", { name: "Escala de atendimento" }),
      ).toBeVisible();
      await expect(
        page.getByRole("combobox", { name: "Início de Segunda-feira" }),
      ).toContainText("08:00");
      await expect(
        page.getByRole("combobox", { name: "Fim de Segunda-feira" }),
      ).toContainText("18:00");
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
      await expect(page).toHaveURL(
        new RegExp(`/crm/management/teams/${teamId}/edit$`),
      );
      await expect(
        page.getByText("Editar equipe", { exact: true }).first(),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Criar equipe" }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Salvar alterações" }),
      ).toBeDisabled();
      await expect(
        page.getByRole("heading", { name: "Operação da equipe" }),
      ).toHaveCount(0);
      const indicators = page.getByRole("region", {
        name: "Indicadores da equipe",
      });
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
      const panelHeights = await page
        .locator("[data-team-panel]")
        .evaluateAll((panels) =>
          panels.map((panel) =>
            Math.round(panel.getBoundingClientRect().height),
          ),
        );
      expect(panelHeights).toHaveLength(3);
      expect(new Set(panelHeights).size).toBe(1);
      const panelTops = await page
        .locator("[data-team-panel]")
        .evaluateAll((panels) =>
          panels.map((panel) => Math.round(panel.getBoundingClientRect().top)),
        );
      expect(
        Math.max(...panelTops) - Math.min(...panelTops),
      ).toBeLessThanOrEqual(2);
      const panelHorizontalInsets = await page.evaluate(() => {
        const targets = [
          {
            name: "members",
            panel: '[data-team-panel="members"]',
            item: "[data-team-members-scroll] > div",
          },
          {
            name: "schedule",
            panel: '[data-team-panel="schedule"]',
            item: "[data-team-schedule-scroll] > div",
          },
          {
            name: "history",
            panel: '[data-team-panel="history"]',
            item: "[data-team-history-scroll] ol > li",
          },
        ];

        return targets.map((target) => {
          const panel = document.querySelector(target.panel);
          const item = document.querySelector(target.item);
          if (!panel || !item) {
            throw new Error(`Missing ${target.name} panel layout target.`);
          }

          const panelBox = panel.getBoundingClientRect();
          const itemBox = item.getBoundingClientRect();
          return {
            name: target.name,
            left: Math.round(itemBox.left - panelBox.left),
            right: Math.round(panelBox.right - itemBox.right),
          };
        });
      });
      expect(panelHorizontalInsets).toHaveLength(3);
      for (const inset of panelHorizontalInsets) {
        expect(
          Math.abs(inset.left - inset.right),
          `${inset.name} panel should have balanced horizontal spacing`,
        ).toBeLessThanOrEqual(2);
      }
      const desktopScrollMetrics = await page.evaluate(() => {
        const main = document.querySelector("main");
        const editor = document.querySelector(
          '[data-tour="management-team-editor"]',
        );
        return {
          mainOverflow: main ? main.scrollHeight - main.clientHeight : null,
          editorOverflow: editor
            ? editor.scrollHeight - editor.clientHeight
            : null,
        };
      });
      expect(desktopScrollMetrics.mainOverflow).not.toBeNull();
      expect(desktopScrollMetrics.editorOverflow).not.toBeNull();
      expect(desktopScrollMetrics.mainOverflow ?? 1).toBeLessThanOrEqual(1);
      expect(desktopScrollMetrics.editorOverflow ?? 1).toBeLessThanOrEqual(1);
      await expect(page.locator("[data-team-history-scroll]")).toHaveCSS(
        "overflow-y",
        "auto",
      );
      await expect(page.locator("#team-name")).toHaveValue(temporaryName);

      await page
        .getByRole("button", { name: `Ver escala de ${E2E_USERS.admin.name}` })
        .click();
      await expect(
        page.getByText(`${E2E_USERS.admin.name} está fora da equipe`),
      ).toBeVisible();
      await page
        .getByRole("button", { name: `Ver escala de ${E2E_USERS.user.name}` })
        .click();
      await expect(
        page.getByRole("button", {
          name: `Ver escala de ${E2E_USERS.user.name}`,
        }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(
        page.getByRole("combobox", { name: "Início de Segunda-feira" }),
      ).toContainText("08:00");

      await page.locator("#team-name").fill(editedName);
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
        updateRequest,
      );
      expect(noOpResponse.ok(), await noOpResponse.text()).toBeTruthy();
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
    const memberSwitch = page.getByRole("switch", {
      name: new RegExp(E2E_USERS.user.name),
    });
    await memberSwitch.click();

    const failedResponsePromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/v1/teams" &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Criar equipe" }).click();
    expect((await failedResponsePromise).status()).toBe(500);

    await expect(page).toHaveURL(/\/crm\/management\/teams\/new$/);
    await expect(page.locator("#team-name")).toHaveValue(temporaryName);
    await expect(memberSwitch).toBeChecked();
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
      await expect(
        page.getByRole("heading", { name: "Escala de atendimento" }),
      ).toBeVisible();

      for (const memberName of [E2E_USERS.leader.name, E2E_USERS.user.name]) {
        await page
          .getByRole("button", { name: `Ver escala de ${memberName}` })
          .click();
        const warningConfirmation = page.getByRole("checkbox", {
          name: "Escala revisada",
        });
        if (await warningConfirmation.isVisible().catch(() => false)) {
          await warningConfirmation.check();
        }
      }

      await page
        .getByRole("button", { name: `Ver escala de ${E2E_USERS.leader.name}` })
        .click();
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

  test("criação dedicada continua utilizável no mobile sem overflow horizontal", async ({
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

    await page.locator("#team-name").fill(`Equipe Mobile ${Date.now()}`);
    await page
      .getByRole("switch", { name: `Adicionar ${E2E_USERS.user.name}` })
      .click();
    await expect(page.getByText("Carregando presença")).toHaveCount(0);
    await expect(
      page.getByRole("combobox", { name: "Início de Segunda-feira" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Criar equipe" }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("edição dedicada reorganiza KPIs, membros, escala e histórico no mobile", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signInAs(page, "admin");
    await page.goto(`/crm/management/teams/${E2E_TEAM_ID}/edit`);

    const indicators = page.getByRole("region", {
      name: "Indicadores da equipe",
    });
    await expect(indicators).toBeVisible();
    await expect(indicators.locator(":scope > *")).toHaveCount(5);
    await page
      .getByRole("button", { name: `Ver escala de ${E2E_USERS.user.name}` })
      .click();
    await expect(
      page.getByRole("heading", { name: "Escala de atendimento" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Histórico de alterações" }),
    ).toBeVisible();

    const editorScroller = page.locator(
      '[data-tour="management-team-editor"]',
    );
    await editorScroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    const bottomScrollTop = await editorScroller.evaluate(
      (element) => element.scrollTop,
    );
    expect(bottomScrollTop).toBeGreaterThan(0);
    const saveButton = page.getByRole("button", { name: "Salvar alterações" });
    const presenceTrigger = page.getByRole("button", {
      name: "Ver presença da equipe",
    });
    const [saveBox, presenceBox] = await Promise.all([
      saveButton.boundingBox(),
      presenceTrigger.boundingBox(),
    ]);
    expect(saveBox).not.toBeNull();
    expect(presenceBox).not.toBeNull();
    expect(presenceBox!.y + presenceBox!.height).toBeLessThanOrEqual(
      saveBox!.y,
    );

    await page.mouse.move(
      saveBox!.x + saveBox!.width / 2,
      saveBox!.y + saveBox!.height / 2,
    );
    await page.mouse.wheel(0, -650);
    await expect
      .poll(() => editorScroller.evaluate((element) => element.scrollTop))
      .toBeLessThan(bottomScrollTop);
    await expectNoHorizontalOverflow(page);
  });
});
