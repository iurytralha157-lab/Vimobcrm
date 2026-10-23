import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

// Real DateFilterPopover/Calendar/Radix and product CSS. No service or data API.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const proofDirectory = process.env.VIMOB_PERIOD_PROOF_DIR || null;
let directory;
let browser;
let page;
const errors = [];
const fixture = `
import React,{useState} from 'react';
import{createRoot}from'react-dom/client';
import{DateFilterPopover}from'@/components/ui/date-filter-popover';
function Fixture({scope}){
  const[preset,setPreset]=useState('custom');
  const[range,setRange]=useState({from:new Date(2026,9,5),to:new Date(2026,9,10,23,59,59,999)});
  window.periodState={preset,range};
  return <main className="app-shell" style={{padding:12}}><DateFilterPopover
    datePreset={preset} customDateRange={range} layerScope={scope}
    onDatePresetChange={value=>{window.periodEvents.push(['preset',value]);setPreset(value);}}
    onCustomDateRangeChange={value=>{window.periodEvents.push(['range',value]);setRange(value);}}/>
    <output>{preset||'all'}</output></main>;
}
const app=createRoot(document.getElementById('app'));
let generation=0;
window.showPeriod=scope=>{window.periodEvents=[];app.render(<Fixture key={++generation} scope={scope}/>);};
window.showPeriod();
`;

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'vimob-period-typography-'));
  const entry = path.join(directory, 'fixture.tsx');
  const loader = path.join(directory, 'loader.cjs');
  await writeFile(entry, fixture);
  await writeFile(loader, `const ts=require(${JSON.stringify(path.join(root, 'node_modules/typescript'))});module.exports=function(source){return ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;};`);
  const { webpack } = require('next/dist/compiled/webpack/webpack');
  await new Promise((resolve, reject) => {
    const compiler = webpack({ mode: 'development', target: 'web', devtool: false, entry,
      output: { path: directory, filename: 'fixture.js' },
      resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@': root }, modules: [path.join(root, 'node_modules'), 'node_modules'] },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] },
      optimization: { minimize: false },
    });
    compiler.run((error, stats) => compiler.close(() => error || stats?.hasErrors()
      ? reject(error || new Error(stats.toString({ all: false, errors: true }))) : resolve()));
  });
  const sourcePaths = ['components/ui/date-filter-popover.tsx', 'components/ui/calendar.tsx', 'components/ui/button.tsx', 'components/ui/popover.tsx', 'config/filter-ui.ts'];
  const productCss = (await readFile(path.join(root, 'app/globals.css'), 'utf8')).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);');
  const css = await require('postcss')([require('@tailwindcss/postcss')({ base: root })]).process(
    `${productCss}\n${sourcePaths.map(source => `@source "${path.join(root, source).replaceAll('\\', '/')}";`).join('\n')}`,
    { from: path.join(root, 'app/period-typography-fixture.css') },
  );
  const font = await readFile(path.join(root, 'node_modules/next/dist/next-devtools/server/font/geist-latin.woff2'));
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 390, height: 840 }, timezoneId: 'America/Sao_Paulo', reducedMotion: 'reduce' });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url() === 'http://period-fixture.local/'
    ? route.fulfill({ contentType: 'text/html', body: `<style>@font-face{font-family:Geist;src:url(data:font/woff2;base64,${font.toString('base64')})}:root{--font-geist-sans:Geist}${css.css}</style><div id="app"></div>` }) : route.abort());
  await page.goto('http://period-fixture.local/');
  await page.clock.setFixedTime(new Date('2026-10-17T15:00:00Z'));
  await page.addScriptTag({ content: await readFile(path.join(directory, 'fixture.js'), 'utf8') });
  await page.getByRole('button', { name: /^Período:/ }).waitFor();
});

after(async () => {
  await browser?.close();
  if (directory) {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
    assert.match(path.basename(resolved), /^vimob-period-typography-/);
    await rm(resolved, { recursive: true, force: true });
  }
});

async function show(width, theme = 'light', scope) {
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width, height: 840 });
  await page.evaluate(({ theme, scope }) => {
    document.documentElement.className = theme;
    window.showPeriod(scope);
  }, { theme, scope });
  await expect(page.getByRole('button', { name: /^Período:/ })).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', { name: /^Período:/ }).click();
  await expect(page.getByRole('grid')).toBeVisible();
}

async function capture(name, measurements) {
  if (!proofDirectory) return;
  await mkdir(proofDirectory, { recursive: true });
  await page.screenshot({ path: path.join(proofDirectory, `${name}.png`) });
  await writeFile(path.join(proofDirectory, `${name}.json`), JSON.stringify(measurements, null, 2));
}

for (const { width, theme } of [{ width: 390, theme: 'light' }, { width: 1024, theme: 'dark' }]) {
  test(`period day numbers are 12px, preserving targets and other typography at ${width}/${theme}`, async () => {
    await show(width, theme);
    await expect(page.getByRole('button', { name: /^Período:/ })).toHaveAttribute('data-filter-active', 'true');
    const measurements = await page.getByRole('grid').evaluate(grid => {
      const measure = element => {
        const style = getComputedStyle(element), rect = element.getBoundingClientRect();
        return { fontSize: style.fontSize, fontFamily: style.fontFamily, width: rect.width, height: rect.height };
      };
      const panel = grid.closest('.vimob-popover-content');
      return {
        days: [...grid.querySelectorAll('[data-day] button')].map(button => ({ day: button.parentElement.dataset.day, selected: button.parentElement.hasAttribute('data-selected'), outside: button.parentElement.hasAttribute('data-outside'), today: button.parentElement.hasAttribute('data-today'), ...measure(button) })),
        caption: measure(panel.querySelector('[role="status"]')),
        shortcut: measure([...panel.querySelectorAll('button')].find(button => button.textContent === 'Hoje')),
        weekday: measure(grid.querySelector('th')),
        layer: panel.getAttribute('data-filter-layer'),
      };
    });
    await capture(`period-${width}-${theme}`, measurements);
    assert.ok(measurements.days.length >= 28);
    for (const day of measurements.days) {
      assert.equal(day.fontSize, '12px', JSON.stringify(day));
      assert.equal(day.width, 36);
      assert.equal(day.height, 36);
      assert.match(day.fontFamily, /Geist/);
    }
    assert.ok(measurements.days.some(day => day.selected));
    assert.ok(measurements.days.some(day => day.outside));
    assert.ok(measurements.days.some(day => day.today));
    assert.equal(measurements.caption.fontSize, '14px');
    assert.equal(measurements.shortcut.fontSize, '12px');
    assert.equal(measurements.shortcut.height, 32);
    assert.equal(measurements.weekday.fontSize, '12.8px');
    assert.equal(measurements.layer, null, 'top-level calendars remain unscoped');
  });
}

for (const width of [320, 1440]) {
  test(`date selection, apply, clear and preset callbacks remain intact at ${width}`, async () => {
    await show(width);
    const panel = page.locator('.vimob-popover-content');
    await panel.getByRole('button', { name: 'Limpar período', exact: true }).click();
    await page.getByRole('button', { name: /^Período:/ }).click();
    await page.evaluate(() => { window.periodEvents = []; });
    await page.locator('[data-day="2026-10-12"] button').click();
    await page.locator('[data-day="2026-10-15"] button').click();
    assert.equal((await page.evaluate(() => window.periodEvents)).length, 0, 'draft does not apply early');
    await panel.getByRole('button', { name: 'Aplicar', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Período: 12/10/2026 - 15/10/2026', exact: true })).toHaveAttribute('aria-expanded', 'false');
    assert.deepEqual(await page.evaluate(() => ({ preset: window.periodState.preset, from: window.periodState.range.from.toISOString(), to: window.periodState.range.to.toISOString(), callbacks: window.periodEvents.map(event => event[0]) })), {
      preset: 'custom', from: '2026-10-12T03:00:00.000Z', to: '2026-10-16T02:59:59.999Z', callbacks: ['preset', 'range'],
    });
    await page.getByRole('button', { name: /^Período:/ }).click();
    await panel.getByRole('button', { name: 'Hoje', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => ({ preset: window.periodState.preset, range: window.periodState.range })), { preset: 'today', range: null });
    await page.getByRole('button', { name: /^Período:/ }).click();
    await panel.getByRole('button', { name: 'Limpar período', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.periodState), { preset: null, range: null });
    await expect(page.getByRole('button', { name: /^Período:/ })).toHaveAttribute('data-filter-active', 'false');
  });
}

test('optional layer identifies nested calendars on mobile and desktop without changing selection', async () => {
  for (const width of [390, 1024]) {
    await show(width, 'light', 'sidebar-test-period');
    const panel = page.locator('.vimob-popover-content');
    await expect(panel).toHaveAttribute('data-filter-layer', 'sidebar-test-period');
    await expect(panel).toHaveAttribute('data-filter-calendar', 'true');
    await page.locator('[data-day="2026-10-15"] button').click();
    await expect(panel).toBeVisible();
    assert.equal((await page.evaluate(() => window.periodEvents)).length, 0);
  }
  assert.deepEqual(errors, []);
});
