import assert from "node:assert/strict";
import { test } from "node:test";
import { expect } from "@playwright/test";
import { page, browserErrors, showFixture } from "./harness.mjs";


test("human pipeline filter events publish shared state and the panel has no favorite or sharing actions", async () => {
  await page.setViewportSize({ width: 768, height: 600 });
  await showFixture("shared-general");
  await page.getByRole("button", { name: /Abrir filtros avançados/ }).click();
  assert.equal(await page.getByRole("textbox", { name: "Nome do filtro para salvar" }).count(), 0);
  assert.equal(await page.getByRole("button", { name: /Salvar filtro atual|Copiar link dos filtros atuais|Excluir filtro salvo/ }).count(), 0);
  assert.equal(await page.getByRole("combobox", { name: /Aplicar filtro salvo:/ }).count(), 0);
  await page.getByRole("combobox", { name: /Filtrar por pipeline:/ }).click();
  await page.getByRole("option", { name: "Pipeline sintética", exact: true }).click();
  const pipelineId = "30000000-0000-4000-8000-000000000001";
  assert.equal(await page.evaluate(() => window.fixtureFilters.pipelineId), pipelineId);
  await page.getByRole("button", { name: "Remover filtro: Pipeline: Pipeline sintética" }).click();
  assert.equal(await page.evaluate(() => window.fixtureFilters.pipelineId), null);
});

test("actual WhatsApp filters resume paused lead criteria when choosing a lead source or lead period", async () => {
  await page.evaluate(() => { window.fixtureFilters.clearFilters(); window.fixtureFilters.setSource("manual"); });
  await showFixture("conversations");
  await page.getByRole("button", { name: /Abrir filtros avançados, 1 filtros aplicados/ }).click();
  await expect(page.locator('[aria-label="Filtros de lead preservados e pausados"]')).toContainText("Pausado: Origem: manual");
  await page.getByRole("button", { name: "Remover filtro: Origem: manual" }).click();
  assert.equal(JSON.parse(await page.locator("output").textContent()).withoutLead, true);
  await page.getByRole("combobox", { name: /Filtrar por origem:/ }).click();
  await page.getByRole("option", { name: "manual", exact: true }).click();
  await expect(page.locator("output")).toContainText('"withoutLead":false');
  assert.equal(JSON.parse(await page.locator("output").textContent()).source, "manual");
  await page.getByRole("checkbox", { name: "Sem lead", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Criação do lead \(pausado\):/ }).click();
  await page.getByRole("button", { name: "Hoje", exact: true }).click();
  await expect(page.locator("output")).toContainText('"withoutLead":false');
  assert.equal(JSON.parse(await page.locator("output").textContent()).datePreset, "today");
});

test("WhatsApp lead creation dates and nested account selections keep their independent controls", async () => {
  for (const width of [320, 390, 1024]) {
    await page.setViewportSize({ width, height: 480 });
    await showFixture("context");
    await page.evaluate(() => window.fixtureFilters.clearFilters());
    await showFixture("conversations");
    await page.getByRole("button", { name: /^Criação do lead/ }).tap();
    await page.getByRole("button", { name: "Hoje", exact: true }).tap();
    assert.equal(JSON.parse(await page.locator("output").textContent()).datePreset, "today");
    await page.getByRole("button", { name: "Criação do lead: Hoje", exact: true }).tap();
    const days = page.getByRole("grid").locator("button");
    await days.nth(15).tap();
    await expect(page.getByRole("grid")).toBeVisible();
    await days.nth(16).tap();
    await page.getByRole("button", { name: "Aplicar", exact: true }).tap();
    assert.equal(JSON.parse(await page.locator("output").textContent()).datePreset, "custom");
    await page.getByRole("button", { name: /Abrir filtros avançados/ }).tap();
    const parent = page.locator('[data-tour="conversations-advanced-filters"]');
    const sidebar = page.getByRole("dialog", { name: "Filtros avançados", exact: true });
    await expect(sidebar.getByRole("button", { name: /^Período:/ })).toHaveCount(0);
    await expect(sidebar.getByRole("textbox", { name: "Buscar opções de filtro nas conversas", exact: true })).toHaveCount(0);
    for (const [account, value] of [["Conta sintética A", "whatsapp-session-a"], ["Conta sintética B", "whatsapp-session-b"], ["Todas as contas", "whatsapp-all"]]) {
      await page.getByRole("combobox", { name: "Filtrar por conta WhatsApp", exact: true }).tap();
      await page.getByRole("option", { name: account, exact: true }).tap();
      await expect(parent).toHaveAttribute("aria-expanded", "true");
      await expect(sidebar).toBeVisible();
      assert.equal(JSON.parse(await page.locator("output").textContent()).channelValue, value);
    }
  }
  await page.setViewportSize({ width: 768, height: 600 });
});


test("full campaign and tag capacity stays in memory and is discarded when the organization changes", async () => {
  await showFixture("context");
  const snapshot = await page.evaluate(() => ({ ...window.fixtureFilters.getFilterSnapshot(),
    datePreset: null, customDateRange: null, pageId: "1".repeat(255),
    campaignId: null, campaignIds: Array.from({ length: 50 }, (_, index) => String(index + 10).padEnd(255, "7")), adSetId: null, adId: null,
    tagIds: Array.from({ length: 50 }, (_, index) => "60000000-0000-4000-8000-" + String(index + 1).padStart(12, "0")), source: "manual", searchQuery: "",
  }));
  assert.equal(await page.evaluate(value => window.fixtureFilters.restoreFilterSnapshot(value), snapshot), true);
  assert.deepEqual(await page.evaluate(() => window.fixtureFilters.getFilterSnapshot()), snapshot);
  await page.evaluate(() => window.setFixtureOrganization("10000000-0000-4000-8000-000000000002"));
  await expect(page.locator("[data-context]")).toContainText('"campaignIds":[]');
  await page.evaluate(() => window.setFixtureOrganization("10000000-0000-4000-8000-000000000001"));
  await expect(page.locator("[data-context]")).toContainText('"pageId":null');
  assert.equal(await page.evaluate(() => window.fixtureFilters.campaignIds.length), 0);
});

test("Unicode attribution is preserved in memory without saving criteria", async () => {
  await showFixture("context");
  const text = "😀".repeat(128);
  const snapshot = await page.evaluate(value => ({ ...window.fixtureFilters.getFilterSnapshot(), pageId: value, campaignId: value, campaignIds: [value] }), text);
  assert.equal(await page.evaluate(value => window.fixtureFilters.restoreFilterSnapshot(value), snapshot), true);
  await expect(page.locator("[data-context]")).toContainText(text);
  assert.deepEqual(await page.evaluate(() => window.fixtureFilters.getFilterSnapshot()), snapshot);
  await page.evaluate(() => window.setFixtureOrganization("10000000-0000-4000-8000-000000000002"));
  await expect(page.locator("[data-context]")).toContainText('"campaignIds":[]');
  await page.evaluate(() => window.setFixtureOrganization("10000000-0000-4000-8000-000000000001"));
  await expect(page.locator("[data-context]")).toContainText('"pageId":null');
  assert.equal(await page.evaluate(() => window.fixtureFilters.campaignIds.length), 0);
});

test("actual filter context restores hierarchies atomically and pauses unlinked inbox criteria", async () => {
  await showFixture("context");
  await expect(page.locator("[data-context]")).toContainText('"hydrated":true');
  const snapshot = {
    version: 2, datePreset: null, customDateRange: null,
    pipelineId: "30000000-0000-4000-8000-000000000001", teamId: "40000000-0000-4000-8000-000000000001", userId: "50000000-0000-4000-8000-000000000001",
    source: "manual", pageId: "1234567890123456", campaignId: "1234567890123457", campaignIds: ["1234567890123457"],
    adSetId: "1234567890123458", adId: "1234567890123459", tagIds: ["60000000-0000-4000-8000-000000000001"], dealStatus: "open", searchQuery: "Busca sintética",
  };
  assert.equal(await page.evaluate((value) => window.fixtureFilters.restoreFilterSnapshot(value), snapshot), true);
  await expect(page.locator("[data-context]")).toContainText(snapshot.adId);
  await page.waitForTimeout(50);
  assert.deepEqual(await page.evaluate(() => window.fixtureFilters.getFilterSnapshot()), snapshot);
  assert.deepEqual(await page.evaluate(() => window.fixtureConversationScope(true)), {});
  assert.deepEqual(await page.evaluate(() => window.fixtureFilters.getFilterSnapshot()), snapshot);
  assert.equal(await page.evaluate(() => window.fixtureConversationScope(false).userId), snapshot.userId);
  assert.equal(await page.evaluate((value) => window.fixtureFilters.restoreFilterSnapshot({ ...value, searchQuery: "x".repeat(181) }), snapshot), false);
  assert.deepEqual(await page.evaluate(() => window.fixtureFilters.getFilterSnapshot()), snapshot);
  await page.evaluate(() => window.fixtureFilters.setPageId("1234567890123499"));
  await expect(page.locator("[data-context]")).toContainText('"campaignIds":[]');
  assert.equal(await page.evaluate(() => window.fixtureFilters.adSetId), null);
  assert.equal(await page.evaluate(() => window.fixtureFilters.adId), null);
  await page.evaluate((value) => window.fixtureFilters.restoreFilterSnapshot(value), snapshot);
  await expect(page.locator("[data-context]")).toContainText(snapshot.adId);
  await page.evaluate(() => window.setFixtureOrganization("10000000-0000-4000-8000-000000000002"));
  await expect(page.locator("[data-context]")).toContainText('"userId":null');
  assert.equal(await page.evaluate(() => window.fixtureFilters.pageId), null);
  await page.evaluate(() => window.setFixtureOrganization("10000000-0000-4000-8000-000000000001"));
  await expect(page.locator("[data-context]")).toContainText('"userId":null');
  assert.equal(await page.evaluate(() => window.fixtureFilters.source), null);
});

test("today follows the civil-day boundary in the actual filter context", async () => {
  await showFixture("context");
  await page.clock.install({ time: new Date("2026-10-13T02:59:00.000Z") });
  await page.evaluate(() => window.fixtureFilters.setDatePreset("today"));
  await expect(page.locator("[data-context]")).toContainText('"from":"2026-10-12T03:00:00.000Z"');
  await showFixture("bound");
  await page.getByRole("button",{name:"Período: Hoje",exact:true}).click();
  await expect(page.getByRole("grid")).toHaveCount(1);
  await page.clock.fastForward(62500);
  await expect(page.getByRole("grid")).toHaveCount(0);
  await showFixture("context");
  await expect(page.locator("[data-context]")).toContainText('"from":"2026-10-13T03:00:00.000Z"');
  assert.deepEqual(browserErrors, []);
});
