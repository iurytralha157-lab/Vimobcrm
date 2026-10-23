import assert from "node:assert/strict";
import { test } from "node:test";
import { expect } from "@playwright/test";
import { page, showFixture } from "./harness.mjs";

test("multiselect supports accent search, arrows, Enter, selection limits and Escape", async () => {
  await showFixture("tags");
  await page.getByRole("button", { name: /Selecionar tags/ }).click();
  const search = page.getByRole("combobox", { name: "Buscar tag" });
  await search.fill("acao");
  await search.press("ArrowDown");
  assert.equal(await page.getByRole("option", { name: "Ação" }).evaluate((element) => element === document.activeElement), true);
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("output").textContent(), "a");
  await search.fill("");
  await search.press("End");
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("output").textContent(), "a,c");
  assert.equal(await page.getByRole("option", { name: "Bêta" }).isDisabled(), true);
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("option", { name: "Ação" })).toBeFocused({ timeout: 1000 });
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("listbox").count(), 0);
  await expect(page.getByRole("button", { name: /2 tags selecionadas/ })).toBeFocused({ timeout: 1000 });
});

test("fifty selected tags allow removal and replacement while extra choices stay disabled", async () => {
  await page.setViewportSize({ width: 320, height: 480 });
  await showFixture("tags-full");
  await page.getByRole("button", { name: /50 tags selecionadas/ }).tap();
  const options = page.getByRole("option");
  assert.equal(await options.evaluateAll((items) => items.filter((item) => item.disabled).length), 10);
  await options.first().tap();
  assert.equal((await page.locator("output").textContent()).split(",").length, 49);
  await options.last().tap();
  assert.equal((await page.locator("output").textContent()).split(",").length, 50);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /50 tags selecionadas/ })).toBeFocused();
  await page.setViewportSize({ width: 768, height: 600 });
});

test("unavailable selected tags remain removable without creating tags", async () => {
  await showFixture("unavailable");
  await page.getByRole("button", { name: "Remover tag indisponível" }).click();
  assert.equal(await page.locator("output").textContent(), "");
  await page.getByRole("button", { name: /Selecionar tags/ }).click();
  await page.getByRole("combobox", { name: "Buscar tag" }).fill("Não cadastrada");
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("output").textContent(), "");
  assert.equal(await page.getByRole("button", { name: /Criar/ }).count(), 0);
});

test("duplicate labels retain distinct keyboard selections and all stays available", async () => {
  for (const fixtureName of ["select", "users"]) {
    await showFixture(fixtureName);
    await page.getByRole("combobox").click();
    const search = page.getByRole("combobox").last();
    await search.fill(fixtureName === "select" ? "acao" : "nome");
    await search.press("End");
    await search.press("Enter");
    assert.equal(await page.locator("output").textContent(), "second");
    await page.getByRole("combobox").click();
    await page.getByRole("combobox").last().fill("sem correspondência");
    await page.getByRole("option", { name: fixtureName === "select" ? "Todas pipelines" : "Todos os corretores" }).click();
    assert.equal(await page.locator("output").textContent(), "all");
  }
});

test("period labels include years and the single clear resets applied dates and the draft", async () => {
  await page.setViewportSize({ width: 768, height: 600 });
  await showFixture("date");
  const trigger = page.getByRole("button", { name: "Período: 01/12/2025 - 15/01/2026" });
  await trigger.click();
  const applied = await page.evaluate(() => window.fixtureDateState);
  await page.locator('[data-day="2025-12-20"] button').click();
  assert.equal(await page.locator("output").textContent(), "custom");
  assert.deepEqual(await page.evaluate(() => window.fixtureDateState), applied, "editing a draft never applies dates early");
  await expect(page.getByRole("button", { name: "Limpar seleção", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Limpar período", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Limpar período", exact: true }).click();
  assert.equal(await page.locator("output").textContent(), "all");
  assert.deepEqual(await page.evaluate(() => window.fixtureDateState), { preset: null, range: null });
  await page.getByRole("button", { name: "Período: Período", exact: true }).click();
  await expect(page.getByRole("grid").locator("[data-selected]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Aplicar", exact: true })).toBeDisabled();
});

test("shared filters preserve unavailable scope, expose chips and explicitly commit search", async () => {
  await showFixture("shared");
  await page.getByRole("button", { name: /Abrir filtros avançados, 2/ }).click();
  const search = page.getByRole("textbox", { name: "Buscar nos registros" });
  await search.fill("sintético");
  assert.equal(JSON.parse(await page.locator("output").textContent()).search, "");
  await search.press("Enter");
  assert.equal(JSON.parse(await page.locator("output").textContent()).search, "sintético");
  assert.equal(JSON.parse(await page.locator("output").textContent()).userId, "outside-scope");
  await page.getByRole("button", { name: "Remover filtro: Origem: Manual" }).click();
  assert.equal(JSON.parse(await page.locator("output").textContent()).source, null);
  const inputHeight = await search.evaluate((element) => element.getBoundingClientRect().height);
  assert.equal(inputHeight, 36);
  const filterIconSize = await page.getByRole("button", { name: /Fechar filtros avançados/ }).locator("svg").first().evaluate((element) => element.getBoundingClientRect().width);
  assert.equal(filterIconSize, 14);
  await page.getByRole("combobox", { name: /Filtrar por origem/ }).click();
  await page.getByRole("combobox", { name: /Buscar opções/ }).fill("manual");
  await page.getByRole("option", { name: "Manual", exact: true }).click();
  assert.equal(await search.isVisible(), true);
  await search.fill("aplicada ao fechar");
  await page.keyboard.press("Escape");
  assert.equal(JSON.parse(await page.locator("output").textContent()).search, "aplicada ao fechar");
});

test("authoritative empty general catalogs do not erase a persisted user selection", async () => {
  await showFixture("shared-general");
  assert.equal(JSON.parse(await page.locator("output").textContent()).userId, "outside-scope");
  await page.getByRole("button", { name: /Abrir filtros avançados/ }).click();
  await page.getByRole("button", { name: "Remover filtro: Corretor: indisponível" }).click();
  assert.equal(JSON.parse(await page.locator("output").textContent()).userId, null);
});

test("shared search accepts 180 Unicode code points and explains overflow without truncation", async () => {
  await showFixture("shared");
  await page.getByRole("button", { name: /Abrir filtros avançados/ }).click();
  const search = page.getByRole("textbox", { name: "Buscar nos registros" });
  const valid = "😀".repeat(180);
  await search.fill(valid);
  await search.press("Enter");
  assert.equal(JSON.parse(await page.locator("output").textContent()).search, valid);
  const invalid = `${valid}a`;
  await search.fill(invalid);
  await search.press("Enter");
  await expect(page.getByRole("alert")).toContainText("O texto não foi aplicado");
  assert.equal(await search.inputValue(), invalid);
  assert.equal(JSON.parse(await page.locator("output").textContent()).search, valid);
  await page.keyboard.press("Escape");
  await expect(search).toBeVisible();
  await search.fill("Busca válida");
  await search.press("Enter");
  await page.keyboard.press("Escape");
  assert.equal(JSON.parse(await page.locator("output").textContent()).search, "Busca válida");
});

test("closing panels without a search input preserves the caller's search", async () => {
  for (const fixtureName of ["shared-hidden-search", "shared-advanced-only"]) {
    await showFixture(fixtureName);
    await page.getByRole("button", { name: /Abrir filtros avançados/ }).click();
    assert.equal(await page.getByRole("textbox", { name: "Buscar nos registros" }).count(), 0);
    await page.keyboard.press("Escape");
    assert.equal(JSON.parse(await page.locator("output").textContent()).search, "Busca preservada");
  }
});

test("composition Enter and keyCode 229 preserve search drafts until explicit Enter", async () => {
  await showFixture("shared");
  await page.getByRole("button", { name: /Abrir filtros avançados/ }).click();
  const search = page.getByRole("textbox", { name: "Buscar nos registros" });
  await search.fill("Texto em composição");
  await search.evaluate((input) => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true })));
  assert.equal(JSON.parse(await page.locator("output").textContent()).search, "");
  await search.evaluate((input) => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 229, bubbles: true })));
  assert.equal(JSON.parse(await page.locator("output").textContent()).search, "");
  await search.press("Enter");
  assert.equal(JSON.parse(await page.locator("output").textContent()).search, "Texto em composição");
});

test("tag picker ignores composition Enter and keyCode 229 before an explicit selection", async () => {
  await showFixture("tags");
  await page.getByRole("button", { name: /Selecionar tags/ }).click();
  const search = page.getByRole("combobox");
  await search.fill("acao");
  for (const event of [{ isComposing: true }, { keyCode: 229 }]) {
    await search.evaluate((input, event) => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...event })), event);
    assert.equal(await page.locator("output").textContent(), "");
  }
  await search.press("Enter");
  assert.equal(await page.locator("output").textContent(), "a");
});
