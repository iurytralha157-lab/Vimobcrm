import assert from "node:assert/strict";
import { test } from "node:test";
import { expect } from "@playwright/test";
import { page, browserErrors, showFixture, clearContextFilters } from "./harness.mjs";

async function openDraftCalendar() {
  await page.setViewportSize({width:1024,height:600});
  await showFixture("context");
  await page.evaluate(()=>{window.fixtureFilters.clearFilters();window.fixtureFilters.setCustomDateRange({from:new Date(2025,11,1),to:new Date(2026,0,15,23,59,59,999)});});
  await showFixture("bound");
  await page.getByRole("button",{name:"Período: 01/12/2025 - 15/01/2026",exact:true}).click();
  const applied = await page.evaluate(()=>window.fixtureFilters.getFilterSnapshot().customDateRange);
  // Clicking a complete range's end again starts a new draft at that date.
  // This edits through the actual calendar without resetting applied filters.
  await page.locator('[data-day="2025-12-20"] button').click();
  await page.locator('[data-day="2025-12-20"] button').click();
  await page.locator('[data-day="2025-12-22"] button').click();
  await expect(page.locator('[data-day="2025-12-20"]')).toHaveAttribute('data-selected','true');
  await expect(page.locator('[data-day="2025-12-01"]')).not.toHaveAttribute('data-selected','true');
  assert.deepEqual(await page.evaluate(()=>window.fixtureFilters.getFilterSnapshot().customDateRange),applied);
  await expect(page.getByRole("button",{name:"Aplicar",exact:true})).toBeEnabled();
}

test("historical periods open at their selected month on mobile and desktop", async () => {
  for (const width of [360, 1024]) {
    await page.setViewportSize({ width, height: 600 });
    await showFixture("date");
    await page.getByRole("button", { name: "Período: 01/12/2025 - 15/01/2026" }).click();
    await expect(page.getByRole("grid")).toHaveAttribute("aria-label", "dezembro 2025");
  }
  await page.setViewportSize({ width: 768, height: 600 });
});

test("agenda historical periods open at their selected month on mobile and desktop", async () => {
  for (const width of [390,1024]) {
    await page.setViewportSize({width,height:600});
    await showFixture("agenda");
    await page.getByRole("button",{name:"Período da agenda: 01/12/2025 - 15/01/2026",exact:true}).click();
    await expect(page.getByRole("grid").first()).toHaveAttribute("aria-label","dezembro 2025");
  }
});

test("catalog refresh recovers tag keyboard focus without stealing focus elsewhere", async () => {
  await showFixture("tags-refresh");
  await page.getByRole("button",{name:/Selecionar tags/}).click();
  const search=page.getByRole("combobox",{name:"Buscar tag",exact:true});
  await search.press("ArrowDown");
  await expect(page.getByRole("option",{name:"Tag sintética 0",exact:true})).toBeFocused();
  await page.evaluate(()=>window.fixtureSetTagCatalog([{id:'tag-1',name:'Tag sintética 1'},{id:'tag-2',name:'Tag sintética 2'}]));
  await expect(search).toBeFocused();
  await search.press("ArrowDown");
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("output").textContent(),"tag-1");
  await page.evaluate(()=>window.fixtureSetTagCatalog([]));
  await expect(search).toBeFocused();
  assert.equal(await page.locator("output").textContent(),"tag-1");
  await expect(page.getByRole("button",{name:"Remover tag indisponível",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Outra região",exact:true}).focus();
  await page.evaluate(()=>window.fixtureSetTagCatalog([{id:'tag-3',name:'Tag sintética 3'}]));
  await expect(page.getByRole("button",{name:"Outra região",exact:true})).toBeFocused();
});

test("calendar full applications discard stale drafts including identical snapshot periods", async () => {
  for (const mode of ["changed-period","identical-snapshot"]) {
    await openDraftCalendar();
    const snapshot=await page.evaluate(()=>window.fixtureFilters.getFilterSnapshot());
    await page.evaluate(mode=>{
      const snapshot=window.fixtureFilters.getFilterSnapshot();
      if(mode==='changed-period'){snapshot.datePreset='today';snapshot.customDateRange=null;window.fixtureFilters.restoreFilterSnapshot(snapshot);}
      else window.fixtureFilters.restoreFilterSnapshot(snapshot);
    },mode);
    await expect(page.getByRole("grid")).toHaveCount(0);
    const applied=await page.evaluate(()=>window.fixtureFilters.getFilterSnapshot());
    assert.equal(applied.datePreset,mode==='changed-period'?'today':'custom');
    assert.deepEqual(applied.customDateRange,mode==='changed-period'?null:snapshot.customDateRange);
    await page.evaluate(()=>history.replaceState(null,'','/'));
  }
});

test("calendar direct value changes never resurrect closed drafts on return", async () => {
  await openDraftCalendar();
  const snapshot=await page.evaluate(()=>window.fixtureFilters.getFilterSnapshot());
  await page.evaluate(()=>window.fixtureFilters.setDatePreset('today'));
  await expect(page.getByRole("grid")).toHaveCount(0);
  await page.evaluate(range=>window.fixtureFilters.setCustomDateRange({from:new Date(range.from),to:new Date(range.to)}),snapshot.customDateRange);
  await expect(page.getByRole("button",{name:"Período: 01/12/2025 - 15/01/2026",exact:true})).toBeVisible();
  await expect(page.getByRole("grid")).toHaveCount(0);
  await page.getByRole("button",{name:"Período: 01/12/2025 - 15/01/2026",exact:true}).click();
  await page.getByRole("button",{name:"Aplicar",exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>window.fixtureFilters.getFilterSnapshot().customDateRange),snapshot.customDateRange);
});

test("calendar drafts survive ordinary rerenders with equal date values", async () => {
  await openDraftCalendar();
  await page.evaluate(()=>{const range=window.fixtureFilters.customDateRange;window.fixtureFilters.setCustomDateRange({from:new Date(range.from),to:new Date(range.to)});});
  await expect(page.getByRole("grid")).toHaveCount(1);
  await page.getByRole("button",{name:"Aplicar",exact:true}).click();
  const range=await page.evaluate(()=>window.fixtureFilters.customDateRange);
  assert.equal(new Date(range.from).getDate(),20);
  assert.equal(new Date(range.to).getDate(),22);
});

test("lead creation period and main search remain while deleted conversation criteria are absent", async () => {
  for(const width of [390,1024]) {
    await page.setViewportSize({width,height:600});
    await showFixture("context");
    await clearContextFilters();
    await showFixture("conversations");
    await page.getByRole("button",{name:/^Criação do lead/}).click();
    await page.getByRole("button",{name:"Hoje",exact:true}).click();
    assert.equal(JSON.parse(await page.locator("output").textContent()).datePreset,"today");
    const search=page.getByRole("textbox",{name:"Buscar conversas",exact:true});await search.fill("Ana sintética");
    assert.equal(await page.evaluate(()=>window.fixtureFilters.searchQuery),"Ana sintética");
    await page.getByRole("button",{name:/Abrir filtros avançados/}).click();
    await expect(page.getByRole("dialog",{name:"Filtros avançados",exact:true})).toBeVisible();
    await expect(page.getByRole("textbox",{name:"Buscar opções de filtro nas conversas",exact:true})).toHaveCount(0);
    await expect(page.getByText("Última mensagem",{exact:true})).toHaveCount(0);
    await expect(page.getByRole("button",{name:/^Período:/})).toHaveCount(0);
  }
});

test("bounded reports explain inherited long periods without truncating them and allow explicit clearing", async () => {
  for (const width of [360, 1024]) {
    await page.setViewportSize({ width, height: 600 });
    await showFixture("context");
    await showFixture("date-limited");
    const before = await page.evaluate(() => window.fixtureDateState);
    const trigger = page.getByRole("button", { name: "Período: 01/01/2010 - 15/01/2026" });
    await expect(trigger).toHaveAttribute("aria-invalid", "true");
    await trigger.click();
    await expect(page.getByRole("alert")).toContainText("até cinco anos");
    await expect(page.getByRole("button", { name: "Aplicar", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");
    assert.deepEqual(await page.evaluate(() => window.fixtureDateState), before);
    await trigger.click();
    await page.getByRole("button", { name: "Limpar período", exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.fixtureDateState), { preset: null, range: null });
  }
  await page.setViewportSize({ width: 768, height: 600 });
});

test("controls without a report bound still allow a long shared period", async () => {
  await showFixture("date-unlimited");
  const trigger = page.getByRole("button", { name: "Período: 01/01/2010 - 15/01/2026" });
  await expect(trigger).toHaveAttribute("aria-invalid", "false");
  await trigger.click();
  await expect(page.getByRole("button", { name: "Aplicar", exact: true })).toBeEnabled();
  assert.equal(await page.getByRole("alert").count(), 0);
});

test("clear and full snapshot applications reset stale drafts even when search is unchanged", async () => {
  await showFixture("context");
  await page.evaluate(() => { window.fixtureFilters.clearFilters(); window.fixtureFilters.setSource("manual"); });
  const snapshot = await page.evaluate(() => window.fixtureFilters.getFilterSnapshot());
  await showFixture("bound");
  await page.getByRole("button", { name: /Abrir filtros avançados/ }).click();
  await clearContextFilters();
  const search = page.getByRole("textbox", { name: "Buscar nos registros" });
  await search.fill("x".repeat(181));
  await search.press("Enter");
  await expect(search).toHaveAttribute("aria-invalid", "true");
  assert.equal(await page.evaluate(snapshot => window.fixtureFilters.restoreFilterSnapshot(snapshot), snapshot), true);
  await expect(search).toHaveValue("");
  await expect(search).toHaveAttribute("aria-invalid", "false");
  await page.keyboard.press("Escape");
  assert.equal(await page.evaluate(() => window.fixtureFilters.searchQuery), "");
  await page.getByRole("button", { name: /Abrir filtros avançados/ }).click();
  await search.fill("Rascunho para limpar");
  await page.evaluate(() => window.fixtureFilters.clearFilters());
  await expect(search).toHaveValue("");
  for (const draft of ["Primeiro rascunho", "Segundo rascunho"]) {
    await search.fill(draft);
    await page.evaluate(() => window.fixtureFilters.restoreFilterSnapshot(window.fixtureFilters.getFilterSnapshot()));
    await expect(search).toHaveValue("");
  }
});

test("paused lead criteria remain visible while only active conversation controls are counted", async () => {
  await showFixture("shared-paused");
  await page.getByRole("button", { name: /Abrir filtros avançados, 2 filtros aplicados/ }).click();
  await expect(page.locator('[aria-label="Filtros de lead preservados e pausados"]')).toContainText("Pausado: Origem: Manual");
  assert.equal(JSON.parse(await page.locator("output").textContent()).source, "manual");
  assert.equal(JSON.parse(await page.locator("output").textContent()).userId, "outside-scope");
});

test("calendar and advanced panels stay within mobile, tablet and desktop viewports", async () => {
  const viewports = [320, 360, 390, 768, 1024, 1280, 1440].flatMap((width) => [480, 600, 900].map((height) => ({ width, height })));
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const fixtureName of ["date", "shared"]) {
      await showFixture(fixtureName);
      await page.getByRole("button", { name: fixtureName === "date" ? /Período: 01\/12/ : /Abrir filtros avançados/ }).click();
      const panel = fixtureName === "date"
        ? page.locator(".vimob-popover-content").first()
        : page.getByRole("dialog", { name: "Filtros avançados", exact: true });
      const bounds = await panel.boundingBox();
      assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= viewport.width + 1);
      assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= viewport.height + 1);
      assert.equal(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), true);
    }
  }
  assert.deepEqual(browserErrors, []);
});
