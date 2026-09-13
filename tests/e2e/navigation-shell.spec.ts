import { expect, test } from "@playwright/test";

import { signInAs } from "./support/auth";

test.describe("navegacao principal", () => {
  test("desktop inicia recolhido e fecha novamente depois da navegacao", async ({
    page,
  }) => {
    await signInAs(page, "user");
    await page.goto("/crm/pipelines");

    const sidebar = page.locator("aside.app-sidebar");
    await expect(sidebar).toBeVisible();
    await expect(sidebar).toHaveCSS("width", "64px");
    await expect(sidebar.locator('a[href="/crm/contacts"]')).toHaveAttribute(
      "aria-label",
      "Contatos",
    );

    await page.getByRole("button", { name: "Expandir menu" }).click();
    await expect(sidebar).toHaveCSS("width", "224px");

    await page.evaluate(() =>
      window.history.pushState(null, "", "/crm/pipelines?search=maria"),
    );
    await expect(sidebar).toHaveCSS("width", "224px");

    const pipelinesLink = sidebar.locator('a[href="/crm/pipelines"]');
    const contactsLink = sidebar.locator('a[href="/crm/contacts"]');
    await contactsLink.click({ button: "right" });
    await expect(pipelinesLink).toHaveAttribute("aria-current", "page");
    await expect(contactsLink).not.toHaveAttribute("aria-current", "page");

    // Dismiss the browser context menu before exercising the normal left-click
    // navigation. Otherwise Chromium can consume the follow-up click under load.
    await page.keyboard.press("Escape");
    await contactsLink.click();
    await expect(page).toHaveURL(/\/crm\/contacts/);
    await expect(sidebar).toHaveCSS("width", "64px");
  });

  test("desktop conclui a transicao de Pipeline para Agenda", async ({
    page,
  }) => {
    await signInAs(page, "admin");
    await page.goto("/crm/pipelines");

    const pipelineHeading = page.getByRole("heading", {
      name: "Pipeline",
      exact: true,
    });
    await expect(pipelineHeading).toBeVisible();

    const agendaLink = page.locator('aside.app-sidebar a[href="/agenda"]');
    await expect(agendaLink).toBeVisible();
    await agendaLink.click();

    await expect(page).toHaveURL(/\/agenda$/);
    await expect(
      page.getByRole("heading", { name: "Agenda", exact: true }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(pipelineHeading).toBeHidden();
  });

  test("mobile fecha o menu Mais ao trocar de pagina", async ({ page }) => {
    await signInAs(page, "user");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/crm/pipelines");

    const bottomNav = page.locator("nav.app-mobile-bottom-nav");
    await expect(bottomNav).toBeVisible();
    await expect(
      bottomNav.getByRole("link", { name: "Pipelines" }),
    ).toBeVisible();
    await expect(
      bottomNav.getByRole("button", { name: "Novo lead" }),
    ).toBeVisible();

    await bottomNav.getByRole("button", { name: "Mais" }).click();
    const menu = page.getByRole("dialog", { name: "Menu principal" });
    await expect(menu).toBeVisible();

    await menu.getByRole("link", { name: "Contatos" }).click();
    await expect(page).toHaveURL(/\/crm\/contacts/);
    await expect(menu).toBeHidden();
  });

  test("mobile permite recolher o submenu da secao ativa", async ({ page }) => {
    await signInAs(page, "admin");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/properties");

    const bottomNav = page.locator("nav.app-mobile-bottom-nav");
    await bottomNav.getByRole("button", { name: "Mais" }).click();

    const menu = page.getByRole("dialog", { name: "Menu principal" });
    const propertiesGroup = menu.locator(
      'button[aria-current="page"][aria-expanded]',
    );
    const allPropertiesLink = menu.locator('a[href="/properties"]');
    await expect(propertiesGroup).toHaveAttribute("aria-expanded", "true");
    await expect(allPropertiesLink).toBeVisible();

    await propertiesGroup.click();
    await expect(propertiesGroup).toHaveAttribute("aria-expanded", "false");
    await expect(allPropertiesLink).toBeHidden();
  });

  test("acao mobile de novo usuario abre o convite", async ({ page }) => {
    await signInAs(page, "admin");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/settings?tab=team");

    const bottomNav = page.locator("nav.app-mobile-bottom-nav");
    await expect(bottomNav).toBeVisible();
    await expect(bottomNav).toHaveAttribute("aria-busy", "false");
    await expect(
      page.getByRole("heading", { name: "Gestão de usuário", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Gerencie os membros da sua equipe"),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Usuários da organização" }),
    ).toHaveCount(0);

    await bottomNav.getByRole("button", { name: "Novo usuário" }).click();
    const inviteDialog = page.getByRole("dialog", { name: "Convidar usuário" });
    await expect(inviteDialog).toBeVisible();
    await expect(inviteDialog.getByLabel("E-mail 1")).toBeVisible();

    await inviteDialog
      .getByRole("button", { name: "Adicionar outro usuário" })
      .click();
    await expect(inviteDialog.getByLabel(/^E-mail \d+$/)).toHaveCount(2);
    await expect(
      inviteDialog.getByRole("button", { name: "Enviar 2 convites" }),
    ).toBeDisabled();

    await inviteDialog
      .getByRole("button", { name: "Remover convite 2" })
      .click();
    await expect(inviteDialog.getByLabel(/^E-mail \d+$/)).toHaveCount(1);
    const cancelInvite = inviteDialog.getByRole("button", {
      name: "Cancelar",
      exact: true,
    });
    await expect(cancelInvite).toBeVisible();
    expect(
      await cancelInvite.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      ),
    ).not.toBe("rgba(0, 0, 0, 0)");
  });

  test("convite pendente usa o mesmo card, permite perfil e nao expoe acesso", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const pendingEmail = "convite-pendente-e2e@example.test";
    let pendingRole: "admin" | "manager" | "user" = "user";
    const pendingInvitation = () => ({
      id: "11111111-1111-4111-8111-111111111111",
      organization_id: "22222222-2222-4222-8222-222222222222",
      email: pendingEmail,
      role: pendingRole,
      created_by: null,
      expires_at: "2099-09-12T12:00:00.000Z",
      used_at: null,
      created_at: "2099-09-05T12:00:00.000Z",
      is_expired: false,
      email_sent: true,
      email_status: "sent",
    });

    await page.route("**/v1/invitations**", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: [pendingInvitation()] }),
        });
        return;
      }

      if (route.request().method() === "PATCH") {
        const body = route.request().postDataJSON() as {
          role?: typeof pendingRole;
        };
        if (body.role) pendingRole = body.role;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: pendingInvitation() }),
        });
        return;
      }

      await route.continue();
    });

    await signInAs(page, "admin");
    await page.goto("/settings?tab=team");

    const pendingCard = page
      .locator("article")
      .filter({ hasText: pendingEmail });
    const memberCard = page.locator("article").filter({ hasText: "Lider E2E" });
    await expect(pendingCard).toBeVisible();
    await expect(memberCard).toBeVisible();
    const userSearch = page.getByRole("searchbox", {
      name: "Pesquisar usuários e convites",
    });
    await expect(userSearch).toBeVisible();
    await userSearch.fill("convite-pendente-e2e");
    await expect(pendingCard).toBeVisible();
    await expect(memberCard).toBeHidden();
    await userSearch.clear();
    await expect(memberCard).toBeVisible();
    const gridColumns = await pendingCard
      .locator("..")
      .evaluate((element) =>
        getComputedStyle(element)
          .gridTemplateColumns.split(" ")
          .filter(Boolean),
      );
    expect(gridColumns).toHaveLength(4);
    await expect(
      pendingCard.getByText("Pendente", { exact: true }),
    ).toBeVisible();
    await expect(
      pendingCard.getByText("Aguardando aceite", { exact: true }),
    ).toBeVisible();
    await expect(pendingCard.getByRole("switch")).toHaveCount(0);
    await expect(
      pendingCard.getByRole("button", {
        name: `Reenviar convite para ${pendingEmail}`,
      }),
    ).toBeVisible();
    await expect(
      pendingCard.getByRole("button", {
        name: `Cancelar convite para ${pendingEmail}`,
      }),
    ).toBeVisible();
    await expect(page.getByText(/aceitos recentemente/)).toHaveCount(0);

    const roleSelect = pendingCard.getByRole("combobox", {
      name: `Perfil do convite para ${pendingEmail}`,
    });
    await expect(roleSelect).toContainText("Usuário");
    const updateResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        /\/v1\/invitations\//.test(response.url()),
    );
    await roleSelect.click();
    const adminOption = page.getByRole("option", {
      name: "Administrador",
      exact: true,
    });
    const managerOption = page.getByRole("option", {
      name: "Gestor",
      exact: true,
    });
    const [adminBox, managerBox] = await Promise.all([
      adminOption.boundingBox(),
      managerOption.boundingBox(),
    ]);
    expect(adminBox).not.toBeNull();
    expect(managerBox).not.toBeNull();
    expect(
      managerBox!.y - (adminBox!.y + adminBox!.height),
    ).toBeGreaterThanOrEqual(3);
    await managerOption.click();
    const response = await updateResponse;
    expect(response.request().postDataJSON()).toEqual({ role: "manager" });
    expect(response.ok()).toBe(true);
    await expect(roleSelect).toContainText("Gestor");
    await expect(
      pendingCard.getByText("Válido até 12/09/2099", { exact: true }),
    ).toBeVisible();

    await page.mouse.move(0, 0);
    await expect
      .poll(async () => {
        const [pendingBackground, memberBackground] = await Promise.all([
          pendingCard.evaluate(
            (element) => getComputedStyle(element).backgroundColor,
          ),
          memberCard.evaluate(
            (element) => getComputedStyle(element).backgroundColor,
          ),
        ]);
        return pendingBackground === memberBackground;
      })
      .toBe(true);

    const activeSwitch = memberCard.getByRole("switch", { name: /Desativar/ });
    await expect(activeSwitch).toBeChecked();
    await expect(activeSwitch).toHaveCSS(
      "background-color",
      "rgb(255, 69, 41)",
    );
  });

  test("acoes de permissoes permanecem visiveis durante a rolagem", async ({
    page,
  }) => {
    await signInAs(page, "admin");
    await page.goto("/settings?tab=team");

    await page
      .getByRole("link", { name: "Editar permissoes de Lider E2E" })
      .click();
    await expect(page).toHaveURL(/\/settings\/users\//);

    const scroller = page.getByTestId("user-permissions-scroller");
    const actions = page.getByTestId("user-permissions-actions");
    await expect(actions).toBeVisible();
    const scrollMetrics = await scroller.evaluate((element) => ({
      clientHeight: element.clientHeight,
      clientWidth: element.clientWidth,
      scrollHeight: element.scrollHeight,
      scrollWidth: element.scrollWidth,
    }));
    expect(scrollMetrics.scrollHeight).toBeGreaterThan(
      scrollMetrics.clientHeight,
    );
    expect(scrollMetrics.scrollWidth).toBeLessThanOrEqual(
      scrollMetrics.clientWidth + 1,
    );
    const initialBottom = await actions.evaluate(
      (element) => element.getBoundingClientRect().bottom,
    );

    await scroller.evaluate((element) => {
      element.scrollTop = Math.round(
        (element.scrollHeight - element.clientHeight) / 2,
      );
    });
    await expect(actions).toBeVisible();
    const middleBottom = await actions.evaluate(
      (element) => element.getBoundingClientRect().bottom,
    );
    expect(Math.abs(middleBottom - initialBottom)).toBeLessThan(3);

    await scroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(actions).toBeVisible();
  });
});
