import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname, basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const wrapper = await mkdtemp(join(tmpdir(), 'vimob-dashboard-dialog-tests-'));
const artifacts = resolve(process.env.DASHBOARD_VISUAL_ARTIFACT_DIR || join(wrapper, 'artifacts'));
await mkdir(artifacts, { recursive: true });

// Reuse the maintained real Dashboard/Radix/Recharts/Tailwind fixture, excluding
// its cases. Auth, API values, outer shell and SharedFilters remain synthetic.
// One build serves focus restoration and source containment. No HTTP or CRM service.
let fixture = await readFile(join(root, 'components/features/dashboard/dashboard-responsive.runtime.test.mjs'), 'utf8');
const firstCase = fixture.indexOf('\nfor (const [width, height]');
assert.ok(firstCase > 0, 'responsive fixture boundary must remain explicit');
fixture = fixture.slice(0, firstCase)
  .replace("import { chromium } from '@playwright/test';", `const {chromium}=createRequire(${JSON.stringify(join(root, 'package.json'))})('@playwright/test');`)
  .replace('createRequire(import.meta.url)', `createRequire(${JSON.stringify(join(root, 'package.json'))})`)
  .replace("resolve(dirname(fileURLToPath(import.meta.url)), '../../..')", JSON.stringify(root))
  .replace("resolve(process.env.DASHBOARD_VISUAL_ARTIFACT_DIR || 'D:/Vimob/tmp/dashboard-responsive-hardening-20261012')", JSON.stringify(artifacts))
  .replace('const aliases = {};', () => `const aliases = {};if(process.env.DASHBOARD_DIALOGS_TEST_BASELINE_DIR)for(const name of ['KPICards','DashboardLeadEntriesDialog','DashboardVisitsDialog','FirstContactDialog'])aliases['@/components/features/dashboard/'+name+'$']=join(process.env.DASHBOARD_DIALOGS_TEST_BASELINE_DIR,'components/features/dashboard',name+'.tsx');`)
  .replace("export const useRouter=()=>({push:()=>{}});", 'export const useRouter=()=>({push:path=>window.h.routes.push(path)});')
  .replace("export default function Link(p){return React.createElement('a',p)}", "export default function Link({onNavigate,onClick,...p}){return React.createElement('a',{...p,onClick:e=>{onClick?.(e);if(!e.defaultPrevented&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&!e.altKey&&e.button===0){onNavigate?.(e);if(!e.defaultPrevented)window.h.routes.push(p.href)}e.preventDefault()}})}")
  .replace("const result=data=>({data,isLoading:false,isPending:false,isError:false,isFetching:false,refetch:async()=>{},error:null});", 'const result=data=>({data,isSuccess:true,isLoading:false,isPending:false,isError:false,isFetching:false,refetch:async()=>{},error:null});')
  .replace("accessSignature:'synthetic-access'", "accessSignature:window.h.accessSignature??'synthetic-access'")
  .replace('useDashboardLeadEntries=()=>({...result({pages:[]}),hasNextPage:false})', 'useDashboardLeadEntries=()=>({...result(window.h.entries??{pages:[]}),hasNextPage:false})')
  .replace('useDashboardVisits=()=>result(undefined)', 'useDashboardVisits=()=>result(window.h.visits)')
  .replace('const h=window.h={source:null,metrics:[]', 'const h=window.h={source:null,routes:[],metrics:[]')
  .replace("join(repository, 'components/features/dashboard/DashboardScreen.tsx')", "(process.env.DASHBOARD_DIALOGS_TEST_SCREEN_SOURCE || join(repository, 'components/features/dashboard/DashboardScreen.tsx'))");
fixture += `
export async function pageAt(width,height=844){
 const page=await browser.newPage({viewport:{width,height},timezoneId:'America/Sao_Paulo'});page.setDefaultTimeout(8000);
 const errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));
 page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 await page.route('**/*',route=>{requests.push(route.request().url());return route.abort();});
 await page.setContent('<html><body><div id="root"></div></body></html>');
 await page.addStyleTag({content:css});await page.addScriptTag({content:bundle});
 await page.locator('[data-tour="dashboard-kpi-leads"]').waitFor();
 if(errors.length)throw Error(errors.join('; '));
 return {page,errors,requests};
}
`;
await writeFile(join(wrapper, 'fixture.mjs'), fixture);
const { pageAt } = await import(pathToFileURL(join(wrapper, 'fixture.mjs')).href);
after(async () => {
  assert.equal(dirname(resolve(wrapper)), resolve(tmpdir())); assert.match(basename(wrapper), /^vimob-dashboard-dialog-tests-/);
  await rm(wrapper, { recursive: true, force: true });
});

for (const width of [390, 1280]) test(`Space opens all five KPI dialogs and preserves focus at ${width}px`, async () => {
  const { page, errors, requests } = await pageAt(width);
  try {
    for (const kind of kinds) {
      const trigger = page.locator(`[data-tour="dashboard-kpi-${kind}"]`);
      await trigger.focus(); await page.keyboard.press('Space'); await page.getByRole('dialog').waitFor();
      await closeDialog(page, 'Escape'); assert.equal(await trigger.evaluate(element => element === document.activeElement), true, kind);
    }
    assert.deepEqual(errors, []); assert.deepEqual(requests, []);
  } finally { await page.close(); }
});

for (const scenario of ['hidden', 'removed', 'resize', 'access']) test(`closing respects the original KPI after ${scenario}`, async () => {
  const { page, errors, requests } = await pageAt(390);
  try {
    const trigger = page.locator('[data-tour="dashboard-kpi-won"]');
    await trigger.evaluate(element => { window.h.originalTrigger = element; window.h.restoreCalls = 0; element.addEventListener('focus', () => window.h.restoreCalls++); });
    await trigger.click(); await page.getByRole('dialog').waitFor();
    await page.evaluate(scenario => {
      window.h.restoreCalls = 0;
      if (scenario === 'hidden') window.h.originalTrigger.style.display = 'none';
      if (scenario === 'removed') window.h.originalTrigger.remove();
      if (scenario === 'access') { window.h.accessSignature = 'another-access'; window.h.render(); }
    }, scenario);
    if (scenario === 'resize') {
      await page.setViewportSize({ width: 1280, height: 844 });
      await page.waitForFunction(() => !window.h.originalTrigger.isConnected);
    }
    await page.waitForTimeout(100); await closeDialog(page, 'Escape');
    assert.equal(await page.evaluate(() => window.h.restoreCalls), 0);
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-tour') === 'dashboard-kpi-won'), false);
    assert.deepEqual(errors, []); assert.deepEqual(requests, []);
  } finally { await page.close(); }
});

test('Visualizar navigates without returning focus to the closing Won/Lost KPI', async () => {
  const { page, errors, requests } = await pageAt(1280);
  try {
    for (const kind of ['won', 'lost']) {
      const trigger = page.locator(`[data-tour="dashboard-kpi-${kind}"]`); await trigger.click();
      const dialog = page.getByRole('dialog'); await dialog.waitFor();
      await dialog.getByRole('button', { name: /^Visualizar / }).click();
      await dialog.waitFor({ state: 'hidden' }); await page.waitForTimeout(250);
      assert.equal(await trigger.evaluate(element => document.activeElement === element), false);
      assert.equal(await page.evaluate(() => window.h.routes.at(-1)), `/crm/pipelines?lead=${kind}`);
    }
    assert.deepEqual(errors, []); assert.deepEqual(requests, []);
  } finally { await page.close(); }
});

test('entry and visit links skip focus return only for same-tab SPA navigation', async () => {
  const { page, errors, requests } = await pageAt(390);
  try {
    await page.evaluate(() => {
      window.h.entries = { pages: [{ total: 1, items: [{ entryId: 'entry', name: 'Entry Person', entryType: 'initial', occurredAt: '2026-10-01T12:00:00Z', source: 'Source', leadUrl: '/crm/pipelines?lead=entry' }] }] };
      window.h.visits = { total: 1, upcoming: 1, overdue: 0, reportTimezone: 'America/Sao_Paulo', creators: [], sources: [], upcomingVisits: [], overdueVisits: [], visits: [{ id: 'visit', lead_id: 'visit-lead', lead_name: 'Visit Person', event_type: 'visit', source: 'Source', status: 'scheduled', start_time: '2026-10-22T12:00:00Z', created_at: '2026-10-01T12:00:00Z', created_by_name: 'Author', owner_name: 'Owner' }] };
      window.h.render();
    });
    for (const kind of ['leads', 'visits']) for (const modified of [false, true]) {
      const trigger = page.locator(`[data-tour="dashboard-kpi-${kind}"]`); await trigger.click();
      const dialog = page.getByRole('dialog'); await dialog.waitFor();
      const before = await page.evaluate(() => window.h.routes.length);
      await dialog.getByRole('link', { name: /^Ver card / }).click({ modifiers: modified ? ['Control'] : [] });
      // The mocked router records navigation without unmounting the page. Close the
      // visit dialog to exercise its real cleanup callback after onNavigate.
      if (kind === 'visits') await closeDialog(page, 'Escape');
      else { await dialog.waitFor({ state: 'hidden' }); await page.waitForTimeout(250); }
      assert.equal(await trigger.evaluate(element => document.activeElement === element), modified, `${kind}/${modified}`);
      assert.equal(await page.evaluate(() => window.h.routes.length), before + (modified ? 0 : 1));
    }
    assert.deepEqual(errors, []); assert.deepEqual(requests, []);
  } finally { await page.close(); }
});

const kinds = ['leads', 'lost', 'won', 'visits', 'first-contact'];
const sourceText = 'Origem' + 'X'.repeat(4090);
async function closeDialog(page, method) {
  const dialog = page.getByRole('dialog');
  if (method === 'Escape') await page.keyboard.press('Escape');
  else await dialog.getByRole('button', { name: /Close|Fechar/i }).click();
  await dialog.waitFor({ state: 'hidden' }); await page.waitForTimeout(250);
}
for (const width of [320, 390, 1280]) test(`KPI dialogs return focus after Escape/X at ${width}px`, async () => {
  const { page, errors, requests } = await pageAt(width), observations = [];
  try {
    for (const kind of kinds) for (const method of ['Escape', 'X']) {
      const trigger = page.locator(`[data-tour="dashboard-kpi-${kind}"]`);
      if (method === 'Escape') { await trigger.focus(); await page.keyboard.press('Enter'); } else await trigger.click();
      await page.getByRole('dialog').waitFor(); await closeDialog(page, method);
      const restored = await trigger.evaluate(element => element === document.activeElement);
      await page.keyboard.press('Tab');
      const tabContinues = await page.evaluate(() => document.activeElement !== document.body && document.activeElement?.tagName !== 'HTML');
      observations.push({ kind, method, restored, tabContinues });
    }
    await writeFile(join(artifacts, `focus-${width}.json`), JSON.stringify(observations, null, 2));
    assert.deepEqual(errors, []); assert.deepEqual(requests, []);
    assert.deepEqual(observations.filter(item => !item.restored || !item.tabContinues), []);
  } finally { await page.close(); }
});

for (const width of [320, 390, 1280]) for (const kind of ['won', 'lost']) test(`${kind} keeps all 4096 source characters inside its row at ${width}px`, async () => {
  const { page, errors, requests } = await pageAt(width);
  const leadName = kind === 'won' ? 'Private Synthetic Won' : 'Private Synthetic Lost';
  try {
    const trigger = page.locator(`[data-tour="dashboard-kpi-${kind}"]`); await trigger.click();
    const dialog = page.getByRole('dialog'); await dialog.waitFor(); await page.waitForTimeout(250);
    const shortBounds = await dialog.boundingBox(); await closeDialog(page, 'Escape');
    await page.evaluate(({ kind, source }) => { window.h.stats[kind === 'won' ? 'wonDeals' : 'lostDeals'][0].source = source; window.h.render(); }, { kind, source: sourceText });
    await trigger.click(); await dialog.waitFor(); await page.waitForTimeout(250);
    const row = dialog.locator('.dashboard-dialog-list-row').filter({ hasText: leadName });
    const source = row.locator('p').filter({ hasText: /^OrigemX/ }); await source.scrollIntoViewIfNeeded();
    const geometry = await source.evaluate(element => {
      const column = element.parentElement.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(element);
      const fragments = [...range.getClientRects()].map(rect => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }));
      const row = element.closest('.dashboard-dialog-list-row');
      const others = [...row.querySelectorAll('p,button')].filter(node => node !== element && !element.parentElement.contains(node)).map(node => {
        const r = node.getBoundingClientRect(); return { text: node.textContent, left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      });
      return { text: element.textContent, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
        wordBreak: getComputedStyle(element).wordBreak, column: { left: column.left, right: column.right }, fragments,
        intersections: fragments.flatMap(a => others.filter(b => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1).map(b => b.text)) };
    });
    const longBounds = await dialog.boundingBox();
    await writeFile(join(artifacts, `${kind}-source-${width}.json`), JSON.stringify({ shortBounds, longBounds, ...geometry }, null, 2));
    await row.screenshot({ path: join(artifacts, `${kind}-source-${width}.png`) });
    assert.equal(geometry.text, sourceText); assert.ok(geometry.scrollWidth <= geometry.clientWidth + 1);
    assert.ok(geometry.fragments.every(rect => rect.left >= geometry.column.left - 1 && rect.right <= geometry.column.right + 1));
    assert.deepEqual(geometry.intersections, []);
    for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(shortBounds[key] - longBounds[key]) < 1, `modal ${key} changed`);
    for (const label of ['Entrada', kind === 'won' ? 'Ganho' : 'Perda']) {
      const field = row.getByText(label, { exact: true }).locator('..'); await field.scrollIntoViewIfNeeded();
      assert.match(await field.textContent(), /\d{2}\/\d{2}\/\d{2}/);
      const bounds = await field.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
    }
    const action = row.getByRole('button', { name: `Visualizar ${leadName}` });
    await dialog.getByRole('button', { name: /Close|Fechar/i }).focus();
    for (let i = 0; i < 30 && !await action.evaluate(element => element === document.activeElement); i++) await page.keyboard.press('Tab');
    assert.equal(await action.evaluate(element => element === document.activeElement), true, 'action is reachable by Tab');
    const actionBounds = await action.boundingBox(); assert.ok(actionBounds.y >= 0 && actionBounds.y + actionBounds.height <= 845, 'focused action stays in viewport');
    await page.keyboard.press('Enter'); assert.equal(await page.evaluate(() => window.h.routes.at(-1)), `/crm/pipelines?lead=${kind}`);
    assert.deepEqual(errors, []); assert.deepEqual(requests, []);
  } finally { await page.close(); }
});
