import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname, basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const wrapper = await mkdtemp(join(tmpdir(), 'vimob-dashboard-secondary-focus-'));
const artifacts = resolve(process.env.DASHBOARD_VISUAL_ARTIFACT_DIR || join(wrapper, 'artifacts'));
await mkdir(artifacts, { recursive: true });

// Share the maintained full Dashboard/Radix/Tailwind fixture, without its cases.
// API/auth/shell are synthetic; production components and focus hook are real.
const source = await readFile(join(repository, 'components/features/dashboard/dashboard-dialogs.runtime.test.mjs'), 'utf8');
const boundary = source.indexOf('\nfor (const width of [390, 1280])');
assert.ok(boundary > 0, 'integrated dialog fixture boundary must remain explicit');
const fixture = source.slice(0, boundary)
  .replace("const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');", `const root = ${JSON.stringify(repository)};`)
  .replace("await page.route('**/*',route=>{requests.push(route.request().url());return route.abort();});", "await page.route('**/*',route=>{if(route.request().url()==='http://dashboard-secondary-focus.test/')return route.fulfill({contentType:'text/html',body:'<html><body><div id=\"root\"></div></body></html>'});requests.push(route.request().url());return route.abort();});")
  .replace("await page.setContent('<html><body><div id=\"root\"></div></body></html>');", "await page.goto('http://dashboard-secondary-focus.test/');")
  + '\nexport { pageAt };\n';
await writeFile(join(wrapper, 'fixture.mjs'), fixture);
const { pageAt } = await import(pathToFileURL(join(wrapper, 'fixture.mjs')).href);

after(async () => {
  assert.equal(dirname(resolve(wrapper)), resolve(tmpdir()));
  assert.match(basename(wrapper), /^vimob-dashboard-secondary-focus-/);
  await rm(wrapper, { recursive: true, force: true });
});

async function withPage(width, run) {
  const { page, errors, requests } = await pageAt(width);
  try {
    await run(page);
    assert.deepEqual(errors, [], 'browser runtime errors');
    assert.deepEqual(requests, [], 'external requests forbidden');
  } finally { await page.close(); }
}

async function launcher(page, kind, width) {
  if (kind !== 'teams' && width < 1024) await page.getByRole('tab', { name: 'Origem', exact: true }).click();
  const trigger = kind === 'teams'
    ? page.getByRole('button', { name: 'Escolher equipes exibidas', exact: true })
    : page.getByRole('button', { name: 'Ver 547 origens', exact: true });
  await trigger.scrollIntoViewIfNeeded();
  return trigger;
}

async function open(page, trigger, method = 'Enter') {
  if (method === 'click') await trigger.click();
  else { await trigger.focus(); await page.keyboard.press(method); }
  await page.getByRole('dialog').waitFor();
}

async function close(page, method) {
  const dialog = page.getByRole('dialog');
  if (method === 'Escape') await page.keyboard.press('Escape');
  else await dialog.getByRole('button', { name: /Close|Fechar/i }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.waitForTimeout(250);
}

for (const width of [390, 1280]) for (const kind of ['teams', 'all-sources']) {
  test(`${kind} returns focus after Escape, X and selection at ${width}px`, async () => {
    await withPage(width, async (page) => {
      const observations = [];
      for (const [closing, opening] of [['Escape', 'Enter'], ['X', 'click'], ['selection', 'Space']]) {
        const trigger = await launcher(page, kind, width);
        await open(page, trigger, opening);
        if (closing === 'selection') {
          const dialog = page.getByRole('dialog');
          if (kind === 'teams') {
            await dialog.getByRole('checkbox', { name: 'Equipe 0', exact: true }).uncheck();
            await dialog.getByRole('button', { name: 'Aplicar', exact: true }).click();
          } else {
            await dialog.getByRole('button', { name: /^Origem importada 546 / }).click();
          }
          await dialog.waitFor({ state: 'hidden' }); await page.waitForTimeout(250);
          if (kind === 'teams') assert.equal(await trigger.textContent(), '3 grupos');
          else assert.equal(await page.evaluate(() => window.h.source), 'raw:546');
        } else await close(page, closing);
        const restored = await trigger.evaluate(element => document.activeElement === element);
        observations.push({ closing, opening, restored });
      }
      await writeFile(join(artifacts, `${kind}-focus-${width}.json`), JSON.stringify(observations, null, 2));
      assert.deepEqual(observations.filter(item => !item.restored), []);
    });
  });
}

test('canceling a team draft restores focus without applying it', async () => {
  await withPage(390, async (page) => {
    const trigger = await launcher(page, 'teams', 390);
    await open(page, trigger);
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('checkbox', { name: 'Equipe 0', exact: true }).uncheck();
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' }); await page.waitForTimeout(250);
    assert.equal(await trigger.textContent(), '4 grupos');
    assert.equal(await trigger.evaluate(element => document.activeElement === element), true);
  });
});

for (const width of [390, 1280]) test(`the Outras origens slice returns focus to the Ver origens button at ${width}px`, async () => {
  await withPage(width, async (page) => {
    const trigger = await launcher(page, 'other-sources', width);
    await page.locator('[data-tour="dashboard-sources"] path.recharts-sector').last().dispatchEvent('click');
    await page.getByRole('dialog').waitFor(); await close(page, 'Escape');
    assert.equal(await trigger.evaluate(element => document.activeElement === element), true);
  });
});

for (const kind of ['teams', 'all-sources']) for (const scenario of ['access', 'logout', 'hidden', 'removed', 'route', 'other-layer']) {
  test(`${kind} does not steal focus after ${scenario}`, async () => {
    await withPage(390, async (page) => {
      const trigger = await launcher(page, kind, 390);
      await trigger.evaluate(element => {
        window.h.originalTrigger = element;
        window.h.restoreCalls = 0;
        element.addEventListener('focus', () => { window.h.restoreCalls++; });
      });
      await open(page, trigger, 'click');
      await page.evaluate(scenario => {
        window.h.restoreCalls = 0;
        if (scenario === 'hidden') window.h.originalTrigger.style.display = 'none';
        if (scenario === 'removed') window.h.originalTrigger.remove();
        if (scenario === 'access') { window.h.accessSignature = 'another-actor-access'; window.h.render(); }
        if (scenario === 'logout') { window.h.scopeReady = false; window.h.render(); }
        if (scenario === 'route') history.pushState(null, '', '/another-route');
        if (scenario === 'other-layer') {
          const layer = document.createElement('div');
          layer.id = 'other-layer'; layer.setAttribute('role', 'dialog'); layer.textContent = 'Other owner';
          document.body.appendChild(layer);
        }
      }, scenario);
      await page.waitForTimeout(50);
      // The synthetic second layer is deliberately not a Radix scope; close the
      // actual modal while the production hook can detect the visible new owner.
      await page.keyboard.press('Escape');
      await page.locator('[role="dialog"]:not(#other-layer)').waitFor({ state: 'hidden' });
      await page.waitForTimeout(250);
      assert.equal(await page.evaluate(() => window.h.restoreCalls), 0);
      assert.equal(await page.evaluate(() => document.activeElement === window.h.originalTrigger), false);
    });
  });
}
