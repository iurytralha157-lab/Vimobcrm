import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const require = createRequire(import.meta.url);
const { webpack } = require('next/dist/compiled/webpack/webpack.js');
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const artifactRoot = resolve(process.env.DASHBOARD_FOCUS_TEST_DIR || tmpdir());
const syntheticUrl = 'http://dashboard-focus.test/';
let directory, bundle, browser;

before(async () => {
  await mkdir(artifactRoot, { recursive: true });
  directory = await mkdtemp(join(artifactRoot, 'vimob-dashboard-focus-'));
  const entry = join(directory, 'entry.tsx');
  const loader = join(directory, 'loader.cjs');
  await writeFile(entry, `
    import React, { act } from 'react';
    import { createRoot } from 'react-dom/client';
    import { useDashboardDialogFocus } from ${JSON.stringify(join(repository, 'hooks/dashboard/use-dashboard-dialog-focus.ts'))};
    window.IS_REACT_ACT_ENVIRONMENT = true;
    const h = window.h = { scope: 'org-a:user-a:allowed', mounted: true };
    function Harness() { h.current = useDashboardDialogFocus(h.scope); return null; }
    const root = createRoot(document.getElementById('root'));
    h.render = async (patch = {}) => { Object.assign(h, patch); await act(async () => root.render(h.mounted ? React.createElement(Harness) : null)); };
    h.capture = async (id = 'origin') => { await act(async () => h.current.captureTrigger(document.getElementById(id))); };
    h.close = (callback = h.current.onCloseAutoFocus) => {
      const layer = document.getElementById('layer');
      const event = new Event('closeAutoFocus', { cancelable: true });
      layer.addEventListener('closeAutoFocus', callback, { once: true });
      layer.dispatchEvent(event);
      return { prevented: event.defaultPrevented, active: document.activeElement?.id };
    };
    h.ready = h.render();
  `);
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;`);
  await new Promise((done, reject) => {
    const compiler = webpack({ mode: 'development', target: 'web', entry,
      output: { path: directory, filename: 'focus.js' },
      resolve: { extensions: ['.tsx', '.ts', '.js'], modules: [join(repository, 'node_modules')] },
      module: { rules: [{ test: /\.tsx?$/, use: loader }] },
    });
    compiler.run((error, stats) => compiler.close(() => error ? reject(error) : stats.hasErrors()
      ? reject(new Error(stats.toString({ all: false, errors: true }))) : done()));
  });
  bundle = await readFile(join(directory, 'focus.js'), 'utf8');
  browser = await chromium.launch({ headless: true });
}, { timeout: 60_000 });

after(async () => {
  await browser?.close();
  if (directory) {
    const withinRoot = relative(artifactRoot, resolve(directory));
    assert.ok(withinRoot && !withinRoot.startsWith('..') && basename(directory).startsWith('vimob-dashboard-focus-'));
    await rm(directory, { recursive: true, force: true });
  }
});

async function withPage(run) {
  const context = await browser.newContext();
  const errors = [];
  const requests = [];
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) => {
    if (route.request().url() === syntheticUrl) return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><button id="origin">KPI A</button><button id="next">KPI B</button><button id="unrelated">Other action</button><div id="layer" role="dialog"><button id="close">Close</button></div>' });
    requests.push(route.request().url());
    return route.abort();
  });
  try {
    await page.goto(syntheticUrl);
    await page.addScriptTag({ content: bundle });
    await page.evaluate(() => window.h.ready);
    await run(page);
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
  } finally { await context.close(); }
}

const capture = (page, id = 'origin') => page.evaluate((value) => window.h.capture(value), id);
const close = (page) => page.evaluate(() => window.h.close());
const render = (page, patch) => page.evaluate((value) => window.h.render(value), patch);

test('restores the explicit KPI from a closing layer and prevents Radix fallback', async () => {
  await withPage(async (page) => {
    await capture(page);
    await page.locator('#close').focus();
    assert.deepEqual(await close(page), { prevented: true, active: 'origin' });
  });
});

test('a consumed close callback is idempotent', async () => {
  await withPage(async (page) => {
    await capture(page);
    assert.equal((await close(page)).active, 'origin');
    await page.locator('#close').focus();
    assert.deepEqual(await close(page), { prevented: true, active: 'close' });
  });
});

test('explicit same-tab navigation suppression leaves focus in its new owner', async () => {
  await withPage(async (page) => {
    await capture(page);
    await page.evaluate(() => window.h.current.skipRestore());
    assert.deepEqual(await close(page), { prevented: true, active: '' });
  });
});

for (const scopes of [[null], ['org-b:user-b:allowed'], ['org-b:user-b:allowed', 'org-a:user-a:allowed']]) {
  test(`an old close callback cannot restore after access sequence ${JSON.stringify(scopes)}`, async () => {
    await withPage(async (page) => {
      await capture(page);
      await page.evaluate(() => { window.h.oldClose = window.h.current.onCloseAutoFocus; });
      for (const scope of scopes) await render(page, { scope });
      assert.deepEqual(await page.evaluate(() => window.h.close(window.h.oldClose)), { prevented: true, active: '' });
    });
  });
}

test('capturing with no current access cannot schedule focus restoration', async () => {
  await withPage(async (page) => {
    await render(page, { scope: null });
    await capture(page);
    assert.deepEqual(await close(page), { prevented: true, active: '' });
  });
});

test('a delayed previous close cannot consume the next opening', async () => {
  await withPage(async (page) => {
    await capture(page);
    await page.evaluate(() => { window.h.oldClose = window.h.current.onCloseAutoFocus; });
    await capture(page, 'next');
    assert.deepEqual(await page.evaluate(() => window.h.close(window.h.oldClose)), { prevented: true, active: '' });
    assert.deepEqual(await close(page), { prevented: true, active: 'next' });
  });
});

for (const invalid of ['removed', 'hidden', 'inert', 'aria-hidden', 'display-none', 'visibility-hidden', 'not-focusable', 'disabled', 'aria-disabled']) {
  test(`does not restore to an origin that is ${invalid}`, async () => {
    await withPage(async (page) => {
      await capture(page);
      await page.evaluate((kind) => {
        const element = document.getElementById('origin');
        if (kind === 'removed') element.remove();
        if (kind === 'hidden') element.hidden = true;
        if (kind === 'inert') element.inert = true;
        if (kind === 'aria-hidden') element.setAttribute('aria-hidden', 'true');
        if (kind === 'display-none') element.style.display = 'none';
        if (kind === 'visibility-hidden') element.style.visibility = 'hidden';
        if (kind === 'not-focusable') element.tabIndex = -1;
        if (kind === 'disabled') element.disabled = true;
        if (kind === 'aria-disabled') element.setAttribute('aria-disabled', 'true');
      }, invalid);
      assert.deepEqual(await close(page), { prevented: true, active: '' });
    });
  });
}

test('route change before delayed cleanup cancels restoration', async () => {
  await withPage(async (page) => {
    await capture(page);
    await page.evaluate(() => history.pushState(null, '', '/crm/pipelines?lead=synthetic'));
    assert.deepEqual(await close(page), { prevented: true, active: '' });
  });
});

test('unmount cancels even when the old origin remains connected', async () => {
  await withPage(async (page) => {
    await capture(page);
    await render(page, { mounted: false });
    assert.deepEqual(await close(page), { prevented: true, active: '' });
  });
});

for (const role of ['dialog', 'alertdialog', 'menu', 'listbox']) {
  test(`another visible ${role} keeps focus ownership`, async () => {
    await withPage(async (page) => {
      await capture(page);
      await page.evaluate((kind) => {
        const layer = document.createElement('div');
        layer.setAttribute('role', kind);
        layer.textContent = 'New layer';
        document.body.appendChild(layer);
      }, role);
      assert.deepEqual(await close(page), { prevented: true, active: '' });
    });
  });
}

test('a hidden unrelated layer does not block a valid return', async () => {
  await withPage(async (page) => {
    await capture(page);
    await page.evaluate(() => {
      const layer = document.createElement('div');
      layer.setAttribute('role', 'dialog');
      layer.hidden = true;
      document.body.appendChild(layer);
    });
    assert.deepEqual(await close(page), { prevented: true, active: 'origin' });
  });
});

test('an independently focused control keeps focus', async () => {
  await withPage(async (page) => {
    await capture(page);
    await page.locator('#unrelated').focus();
    assert.deepEqual(await close(page), { prevented: true, active: 'unrelated' });
  });
});
