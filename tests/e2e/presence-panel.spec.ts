import { expect, test, type Page } from '@playwright/test';

import { authenticatedAPIRequest, fetchTenantContext, signInAs } from './support/auth';
import { E2E_USERS } from './support/e2e-env';

const PANEL_NAME = 'Presença da equipe';
const OPEN_LAUNCHER_NAME = 'Ver presença da equipe';
const CLOSE_LAUNCHER_NAME = 'Fechar presença da equipe';
const PRESENCE_LIST_NAME = 'Presença dos usuários visíveis';
const LONG_MEMBER_NAME =
  'Mariana Aparecida de Oliveira Albuquerque dos Santos';
const LIMITED_MEMBER_NAME = 'Mariana Aparecida de Olivei…';

const PRESENCE_LAYOUT_FIXTURE = {
  data: {
    users: [
      {
        user_id: '00000000-0000-4000-8000-000000000001',
        name: LONG_MEMBER_NAME,
        avatar_url: null,
        member_role: 'manager',
        is_team_leader: true,
        presence_status: 'online',
        idle_since_at: null,
        last_seen_at: '2026-09-10T12:00:00.000Z',
      },
      {
        user_id: '00000000-0000-4000-8000-000000000002',
        name: 'Pessoa ausente',
        avatar_url: null,
        member_role: 'user',
        is_team_leader: false,
        presence_status: 'idle',
        idle_since_at: '2026-09-10T11:52:00.000Z',
        last_seen_at: '2026-09-10T12:00:00.000Z',
      },
      {
        user_id: '00000000-0000-4000-8000-000000000003',
        name: 'Pessoa offline',
        avatar_url: null,
        member_role: 'admin',
        is_team_leader: false,
        presence_status: 'offline',
        idle_since_at: null,
        last_seen_at: '2026-09-10T09:00:00.000Z',
      },
      {
        user_id: '00000000-0000-4000-8000-000000000004',
        name: 'Pessoa ausente sem horário',
        avatar_url: null,
        member_role: 'user',
        is_team_leader: false,
        presence_status: 'idle',
        idle_since_at: null,
        last_seen_at: '2026-09-10T11:50:00.000Z',
      },
    ],
    counts: { total: 4, online: 1, idle: 2, offline: 1 },
    generated_at: '2026-09-10T12:00:00.000Z',
  },
};

function presenceList(page: Page) {
  return page.getByRole('list', { name: PRESENCE_LIST_NAME });
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

async function openDesktopPresencePanel(page: Page) {
  const launcher = page.getByRole('button', {
    name: OPEN_LAUNCHER_NAME,
    exact: true,
  });
  await expect(launcher).toBeVisible();
  await expect(launcher).toHaveClass(/hover:bg-primary/);
  await expect(launcher).toHaveClass(/hover:text-primary-foreground/);
  await launcher.click();

  const panel = page.locator('aside[aria-labelledby][id$="-panel"]');
  await expect(panel).toHaveAttribute('aria-hidden', 'false');
  await expect(panel.getByRole('heading', { name: PANEL_NAME })).toBeVisible();
  const closeLauncher = page.getByRole('button', {
    name: CLOSE_LAUNCHER_NAME,
    exact: true,
  });
  await expect(closeLauncher).toBeVisible();
  await expect(closeLauncher).toHaveAttribute('data-state', 'open');
  await expect(closeLauncher).toHaveClass(/bg-primary/);
  await expect(closeLauncher).toHaveClass(/text-primary-foreground/);
  return panel;
}

test.describe('Painel de presença da equipe', () => {
  test('administrador abre, busca e fecha com Escape sem perder foco ou criar overflow', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signInAs(page, 'admin');

    const tenantContext = await fetchTenantContext(page);
    expect(
      tenantContext.permissions.includes('*') ||
        tenantContext.permissions.includes('users_presence_view'),
    ).toBe(true);

    const panel = await openDesktopPresencePanel(page);
    const list = presenceList(page);
    await expect(list).toBeVisible();
    await expect(list.getByText(E2E_USERS.admin.name, { exact: true })).toBeVisible();
    await expect(list.getByText(E2E_USERS.leader.name, { exact: true })).toBeVisible();
    await expect(list.getByText(E2E_USERS.user.name, { exact: true })).toBeVisible();

    const search = panel.getByRole('searchbox', {
      name: 'Buscar usuário por nome ou função',
    });
    await search.fill('usuario');
    await expect(list.getByText(E2E_USERS.user.name, { exact: true })).toBeVisible();
    await expect(list.getByText(E2E_USERS.admin.name, { exact: true })).toHaveCount(0);
    await expect(list.getByText(E2E_USERS.leader.name, { exact: true })).toHaveCount(0);
    await expect(list.locator(':scope > li')).toHaveCount(1);

    await expectNoHorizontalOverflow(page);
    await search.press('Escape');

    const closedLauncher = page.getByRole('button', {
      name: OPEN_LAUNCHER_NAME,
      exact: true,
    });
    await expect(panel).toHaveAttribute('aria-hidden', 'true');
    await expect(closedLauncher).toBeFocused();
    await expectNoHorizontalOverflow(page);
  });

  test('líder vê apenas a própria equipe e nunca o administrador', async ({ page }) => {
    await signInAs(page, 'leader');

    const tenantContext = await fetchTenantContext(page);
    expect(tenantContext.isTeamLeader).toBe(true);
    expect(tenantContext.permissions).toContain('users_presence_view');

    await openDesktopPresencePanel(page);
    const list = presenceList(page);
    await expect(list).toBeVisible();
    await expect(list.getByText(E2E_USERS.leader.name, { exact: true })).toBeVisible();
    await expect(list.getByText(E2E_USERS.user.name, { exact: true })).toBeVisible();
    await expect(list.getByText(E2E_USERS.admin.name, { exact: true })).toHaveCount(0);
    await expect(list.locator(':scope > li')).toHaveCount(2);
  });

  test('usuário comum não recebe o launcher de presença', async ({ page }) => {
    await signInAs(page, 'user');

    const tenantContext = await fetchTenantContext(page);
    expect(tenantContext.isTeamLeader).toBe(false);
    expect(tenantContext.permissions).not.toContain('users_presence_view');

    const launcher = page.getByRole('button', {
      name: OPEN_LAUNCHER_NAME,
      exact: true,
    });
    await expect(launcher).toHaveCount(0);

    const response = await authenticatedAPIRequest(page, 'GET', '/v1/user-presence');
    expect(response.status(), await response.text()).toBe(403);
    await page.waitForTimeout(500);
    await expect(launcher).toHaveCount(0);
  });

  for (const viewport of [
    { width: 320, height: 640 },
    { width: 767, height: 900 },
  ]) {
    test(`mobile ${viewport.width}px mantém painel e busca dentro da viewport`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await signInAs(page, 'admin');
      await page.route('**/v1/user-presence**', async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue();
          return;
        }

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(PRESENCE_LAYOUT_FIXTURE),
        });
      });

      const launcher = page.getByRole('button', {
        name: OPEN_LAUNCHER_NAME,
        exact: true,
      });
      await expect(launcher).toBeVisible();
      await launcher.click();

      const panel = page.getByRole('dialog', { name: PANEL_NAME });
      const search = panel.getByRole('searchbox', {
        name: 'Buscar usuário por nome ou função',
      });
      await expect(panel).toBeVisible();
      await expect(search).toBeVisible();
      const list = presenceList(page);
      await expect(list).toBeVisible();

      const onlineSummary = panel.locator('[data-presence-summary="online"]');
      const idleSummary = panel.locator('[data-presence-summary="idle"]');
      const offlineSummary = panel.locator('[data-presence-summary="offline"]');
      await expect(onlineSummary).toContainText(/Online\s*1/);
      await expect(idleSummary).toContainText(/Ausentes\s*2/);
      await expect(offlineSummary).toContainText(/Offline\s*1/);
      await expect(
        onlineSummary.locator('[data-presence-summary-dot="online"]'),
      ).toHaveClass(/bg-success/);
      await expect(
        idleSummary.locator('[data-presence-summary-dot="idle"]'),
      ).toHaveClass(/bg-warning/);
      await expect(
        offlineSummary.locator('[data-presence-summary-dot="offline"]'),
      ).toHaveClass(/bg-destructive/);

      const onlineRow = list.locator('[data-presence-status="online"]');
      const idleRow = list
        .locator('[data-presence-status="idle"]')
        .filter({ hasText: 'Pessoa ausente' })
        .first();
      const idleWithoutTimeRow = list
        .locator('[data-presence-status="idle"]')
        .filter({ hasText: 'Pessoa ausente sem horário' });
      const offlineRow = list.locator('[data-presence-status="offline"]');
      await expect(onlineRow.locator('[data-presence-user-name]')).toHaveText(
        LIMITED_MEMBER_NAME,
      );
      await expect(onlineRow.locator('[data-presence-user-name]')).toHaveAttribute(
        'title',
        LONG_MEMBER_NAME,
      );
      await expect(onlineRow.locator('[data-presence-user-name]')).toHaveAttribute(
        'aria-label',
        LONG_MEMBER_NAME,
      );
      await expect(onlineRow.locator('[data-presence-member-badge]')).toHaveText(
        'GESTOR/LÍDER',
      );
      await expect(onlineRow.locator('[data-presence-member-badge]')).toHaveAttribute(
        'aria-label',
        'Gestor e líder de equipe',
      );
      await expect(onlineRow.locator('[data-presence-member-badge]')).toHaveCSS(
        'font-size',
        '8px',
      );
      await expect(onlineRow.locator('[data-presence-label]')).toHaveText('Online');
      await expect(onlineRow.locator('[data-presence-label]')).toHaveClass(
        /bg-emerald-700/,
      );
      await expect(onlineRow.locator('[data-presence-label]')).toHaveClass(/text-white/);
      await expect(onlineRow.locator('time')).toHaveCount(0);
      await expect(idleRow.locator('[data-presence-label]')).toHaveText('Ausente');
      await expect(idleRow.locator('[data-presence-label]')).toHaveClass(/bg-amber-700\/50/);
      await expect(idleRow.locator('[data-presence-label]')).toHaveClass(/text-white/);
      await expect(idleRow.locator('time')).toHaveAttribute(
        'datetime',
        PRESENCE_LAYOUT_FIXTURE.data.users[1].idle_since_at!,
      );
      await expect(idleRow.locator('time')).toContainText(/^Há /);
      await expect(idleWithoutTimeRow.locator('[data-presence-label]')).toHaveText(
        'Ausente',
      );
      await expect(idleWithoutTimeRow.locator('time')).toHaveCount(0);
      await expect(offlineRow.locator('[data-presence-label]')).toHaveText('Offline');
      await expect(offlineRow.locator('[data-presence-member-badge]')).toHaveText(
        'ADMIN',
      );
      await expect(offlineRow.locator('[data-presence-label]')).toHaveClass(/bg-red-700\/50/);
      await expect(offlineRow.locator('[data-presence-label]')).toHaveClass(/text-white/);
      await expect(list.locator('[data-presence-label] > *')).toHaveCount(0);
      await expect(offlineRow.locator('time')).toHaveAttribute(
        'datetime',
        PRESENCE_LAYOUT_FIXTURE.data.users[2].last_seen_at,
      );
      await expect(offlineRow.locator('time')).toContainText(/^Há /);
      await expect(panel).not.toContainText('horário indisponível');
      await expect(panel).not.toContainText('Última atividade');
      await expect(panel).not.toContainText('sem último acesso');
      for (const row of [onlineRow, idleRow, idleWithoutTimeRow, offlineRow]) {
        await expect(row.locator('[data-presence-label]')).not.toHaveClass(/shadow/);
      }

      const hoverSurface = idleRow.locator('[data-presence-row-surface]');
      const hoverBefore = await idleRow.evaluate((row) => {
        const surface = row.querySelector<HTMLElement>(
          '[data-presence-row-surface]',
        );
        const rowStyle = getComputedStyle(row);
        const surfaceStyle = surface ? getComputedStyle(surface) : null;

        return {
          rowBackground: rowStyle.backgroundColor,
          dividerColor: rowStyle.borderBottomColor,
          dividerWidth: rowStyle.borderBottomWidth,
          surfaceBackground: surfaceStyle?.backgroundColor,
        };
      });
      await idleRow.hover();
      await expect(hoverSurface).toHaveCSS('border-radius', '8px');
      await expect
        .poll(() =>
          hoverSurface.evaluate((surface) =>
            getComputedStyle(surface).backgroundColor,
          ),
        )
        .not.toBe(hoverBefore.surfaceBackground);
      const hoverAfter = await idleRow.evaluate((row) => {
        const rowStyle = getComputedStyle(row);
        return {
          rowBackground: rowStyle.backgroundColor,
          dividerColor: rowStyle.borderBottomColor,
          dividerWidth: rowStyle.borderBottomWidth,
        };
      });
      expect(hoverAfter.rowBackground).toBe(hoverBefore.rowBackground);
      expect(hoverAfter.dividerColor).toBe(hoverBefore.dividerColor);
      expect(hoverAfter.dividerWidth).toBe(hoverBefore.dividerWidth);

      const offlineDetailLayout = await offlineRow
        .locator('[data-presence-detail]')
        .evaluate((element) => {
          const label = element.querySelector<HTMLElement>('[data-presence-label]');
          const time = element.querySelector<HTMLElement>('time');
          const labelBox = label?.getBoundingClientRect();
          const timeBox = time?.getBoundingClientRect();

          return {
            flexWrap: getComputedStyle(element).flexWrap,
            aligned:
              Boolean(labelBox && timeBox) &&
              Math.abs(
                (labelBox!.top + labelBox!.bottom) / 2 -
                  (timeBox!.top + timeBox!.bottom) / 2,
              ) <= 1,
          };
        });
      expect(offlineDetailLayout.flexWrap).toBe('nowrap');
      expect(offlineDetailLayout.aligned).toBe(true);

      await search.fill('Santos');
      await expect(onlineRow).toBeVisible();
      await search.clear();
      await expect(list.locator('[data-presence-user-row]')).toHaveCount(4);

      const [panelBox, searchBox] = await Promise.all([
        panel.boundingBox(),
        search.boundingBox(),
      ]);
      expect(panelBox).not.toBeNull();
      expect(searchBox).not.toBeNull();
      expect(panelBox!.x).toBeGreaterThanOrEqual(-1);
      expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(panelBox!.width).toBeLessThanOrEqual(Math.min(360, viewport.width * 0.9) + 1);
      expect(panelBox!.height).toBeLessThanOrEqual(viewport.height + 1);
      expect(searchBox!.x).toBeGreaterThanOrEqual(panelBox!.x);
      expect(searchBox!.x + searchBox!.width).toBeLessThanOrEqual(
        panelBox!.x + panelBox!.width + 1,
      );

      const panelHasNoOverflow = await panel.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      );
      expect(panelHasNoOverflow).toBe(true);

      const layout = await list.evaluate((element) => {
        const scrollViewport = element.closest(
          '[data-radix-scroll-area-viewport]',
        ) as HTMLElement | null;
        const rows = Array.from(
          element.querySelectorAll<HTMLElement>('[data-presence-user-row]'),
        );

        return {
          viewportOverflow:
            !scrollViewport ||
            scrollViewport.scrollWidth > scrollViewport.clientWidth + 1,
          rows: rows.map((row) => {
            const name = row.querySelector<HTMLElement>(
              '[data-presence-user-name]',
            );
            const badge = row.querySelector<HTMLElement>(
              '[data-presence-member-badge]',
            );
            const detail = row.querySelector<HTMLElement>(
              '[data-presence-detail]',
            );
            const rowRect = row.getBoundingClientRect();
            const nameRect = name?.getBoundingClientRect();
            const badgeRect = badge?.getBoundingClientRect();
            const nameStyle = name ? getComputedStyle(name) : null;

            return {
              rowOverflow: row.scrollWidth > row.clientWidth + 1,
              nameOutside: Boolean(
                nameRect &&
                  (nameRect.left < rowRect.left - 1 ||
                    nameRect.right > rowRect.right + 1),
              ),
              nameOverflowVisible: Boolean(
                name &&
                  name.scrollWidth > name.clientWidth + 1 &&
                  nameStyle?.overflowX === 'visible',
              ),
              nameUsesEllipsis:
                nameStyle?.overflowX === 'hidden' &&
                nameStyle?.textOverflow === 'ellipsis',
              badgeOverflow: Boolean(
                badge &&
                  (badge.scrollWidth > badge.clientWidth + 1 ||
                    badge.scrollHeight > badge.clientHeight + 1),
              ),
              badgeOutside: Boolean(
                badgeRect && badgeRect.right > rowRect.right + 1,
              ),
              detailOverflow: Boolean(
                detail && detail.scrollWidth > detail.clientWidth + 1,
              ),
              dividerWidth: getComputedStyle(row).borderBottomWidth,
            };
          }),
        };
      });

      expect(layout.viewportOverflow).toBe(false);
      for (const [index, row] of layout.rows.entries()) {
        expect(row.rowOverflow).toBe(false);
        expect(row.nameOutside).toBe(false);
        expect(row.nameOverflowVisible).toBe(false);
        expect(row.nameUsesEllipsis).toBe(true);
        expect(row.badgeOverflow).toBe(false);
        expect(row.badgeOutside).toBe(false);
        expect(row.detailOverflow).toBe(false);
        expect(row.dividerWidth).toBe(
          index === layout.rows.length - 1 ? '0px' : '1px',
        );
      }
      await expectNoHorizontalOverflow(page);
    });
  }

  test('falha inicial oferece retry e recupera a lista real', async ({ page }) => {
    let failedRequests = 0;
    let allowSuccess = false;
    await page.route('**/v1/user-presence**', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }

      if (!allowSuccess) {
        failedRequests += 1;
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              code: 'presence_e2e_unavailable',
              message: 'Falha transitória controlada pelo teste.',
            },
          }),
        });
        return;
      }

      await route.continue();
    });

    await signInAs(page, 'admin');
    const panel = await openDesktopPresencePanel(page);

    const alert = panel.getByRole('alert');
    await expect(alert).toContainText('Não foi possível carregar a equipe');
    expect(failedRequests).toBeGreaterThanOrEqual(2);

    allowSuccess = true;
    await alert.getByRole('button', { name: 'Tentar novamente' }).click();
    const list = presenceList(page);
    await expect(list).toBeVisible();
    await expect(list.getByText(E2E_USERS.admin.name, { exact: true })).toBeVisible();
    await expect(alert).toHaveCount(0);
  });

  test('falha de refetch mantém os últimos dados visíveis e permite atualizar', async ({
    page,
  }) => {
    await signInAs(page, 'admin');
    const panel = await openDesktopPresencePanel(page);
    const list = presenceList(page);
    await expect(list.getByText(E2E_USERS.admin.name, { exact: true })).toBeVisible();

    let failedRequests = 0;
    let allowSuccess = false;
    await page.route('**/v1/user-presence**', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }

      if (!allowSuccess) {
        failedRequests += 1;
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              code: 'presence_e2e_refetch_unavailable',
              message: 'Falha de atualização controlada pelo teste.',
            },
          }),
        });
        return;
      }

      await route.continue();
    });

    await page.clock.setSystemTime(Date.now() + 20_000);
    await page.getByRole('button', { name: CLOSE_LAUNCHER_NAME, exact: true }).click();
    await expect(panel).toHaveAttribute('aria-hidden', 'true');
    await openDesktopPresencePanel(page);

    const staleDataNotice = panel.getByRole('status').filter({
      hasText: 'Não foi possível atualizar. Exibindo os últimos dados.',
    });
    await expect(staleDataNotice).toContainText(
      'Não foi possível atualizar. Exibindo os últimos dados.',
    );
    expect(failedRequests).toBeGreaterThanOrEqual(2);
    await expect(list.getByText(E2E_USERS.admin.name, { exact: true })).toBeVisible();
    await expect(panel.getByRole('alert')).toHaveCount(0);

    allowSuccess = true;
    await staleDataNotice.getByRole('button', { name: 'Atualizar' }).click();
    await expect(staleDataNotice).toHaveCount(0);
    await expect(list.getByText(E2E_USERS.admin.name, { exact: true })).toBeVisible();
  });
});
