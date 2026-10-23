import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const { webpack } = require('next/dist/compiled/webpack/webpack.js');
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const artifactRoot = resolve(process.env.DASHBOARD_TEAM_SELECTION_TEST_DIR || tmpdir());
const syntheticUrl = 'http://dashboard-team.test/';
const legacyKey = 'vimob:dashboard:teams:selected:org-a:user-a';
let directory, bundle, browser;

before(async () => {
  await mkdir(artifactRoot, { recursive: true });
  directory = await mkdtemp(join(artifactRoot, 'vimob-dashboard-team-selection-'));
  const source = await readFile(join(repository, 'components/features/dashboard/LeadDistributionSection.tsx'), 'utf8');
  const ast = ts.createSourceFile('LeadDistributionSection.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = ast.statements.filter((node) =>
    (ts.isFunctionDeclaration(node) && ['readTeamSelection', 'usePinnedTeamIds'].includes(node.name?.text))
    || (ts.isTypeAliasDeclaration(node) && node.name.text === 'AvailableTeam')
    || (ts.isVariableStatement(node) && node.declarationList.declarations.some((item) => item.name.getText(ast) === 'TEAM_SELECTION_STORAGE_PREFIX')));
  assert.ok(declarations.some((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'usePinnedTeamIds'));
  const actualHook = declarations.map((node) => node.getText(ast)).join('\n');
  const entry = join(directory, 'entry.tsx');
  const loader = join(directory, 'loader.cjs');
  await writeFile(entry, `
    import React, { act, useEffect, useMemo, useState } from 'react';
    import { createRoot } from 'react-dom/client';
    ${actualHook}
    window.IS_REACT_ACT_ENVIRONMENT = true;
    const h = window.h = {
      organizationId: 'org-a', currentUserId: 'user-a',
      teams: [{ id: 'team-a', name: 'Equipe A' }, { id: 'team-b', name: 'Equipe B' }, { id: 'team-c', name: 'Equipe C' }],
      renders: [],
    };
    function Harness() {
      const selection = usePinnedTeamIds(h.organizationId, h.currentUserId, h.teams);
      h.current = selection;
      h.renders.push({ organizationId: h.organizationId, currentUserId: h.currentUserId, selection: selection.activeSelection });
      return React.createElement('pre', { id: 'selection' }, JSON.stringify(selection.activeSelection));
    }
    let root = createRoot(document.getElementById('root'));
    h.render = async (patch = {}) => { Object.assign(h, patch); await act(async () => root.render(React.createElement(Harness))); };
    h.apply = async (ids) => { await act(async () => h.current.saveSelection(ids)); };
    h.remount = async () => { await act(async () => root.unmount()); root = createRoot(document.getElementById('root')); await h.render(); };
    h.ready = h.render();
  `);
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;`);
  await new Promise((done, reject) => {
    const compiler = webpack({ mode: 'development', target: 'web', entry,
      output: { path: directory, filename: 'selection.js' },
      resolve: { extensions: ['.tsx', '.ts', '.js'], modules: [join(repository, 'node_modules')] },
      module: { rules: [{ test: /\.tsx?$/, use: loader }] },
    });
    compiler.run((error, stats) => compiler.close(() => error ? reject(error) : stats.hasErrors()
      ? reject(new Error(stats.toString({ all: false, errors: true }))) : done()));
  });
  bundle = await readFile(join(directory, 'selection.js'), 'utf8');
  browser = await chromium.launch({ headless: true });
}, { timeout: 60_000 });

after(async () => {
  await browser?.close();
  if (directory) {
    const withinRoot = relative(artifactRoot, resolve(directory));
    assert.ok(withinRoot && !withinRoot.startsWith('..') && basename(directory).startsWith('vimob-dashboard-team-selection-'));
    await rm(directory, { recursive: true, force: true });
  }
});

async function withPage(run, seed = {}) {
  const context = await browser.newContext();
  const errors = [];
  const unexpectedRequests = [];
  await context.addInitScript(({ seed }) => {
    const get = Storage.prototype.getItem;
    const set = Storage.prototype.setItem;
    const remove = Storage.prototype.removeItem;
    const clear = Storage.prototype.clear;
    for (const [key, value] of Object.entries(seed)) set.call(localStorage, key, value);
    window.storageCalls = { get: 0, set: 0, remove: 0, clear: 0 };
    window.peekStorage = (key) => get.call(localStorage, key);
    Storage.prototype.getItem = function (...args) { window.storageCalls.get++; return get.apply(this, args); };
    Storage.prototype.setItem = function (...args) { window.storageCalls.set++; return set.apply(this, args); };
    Storage.prototype.removeItem = function (...args) { window.storageCalls.remove++; return remove.apply(this, args); };
    Storage.prototype.clear = function (...args) { window.storageCalls.clear++; return clear.apply(this, args); };
  }, { seed });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) => {
    if (route.request().url() === syntheticUrl) return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
    unexpectedRequests.push(route.request().url());
    return route.abort();
  });
  const load = async (reload = false) => {
    if (reload) await page.reload(); else await page.goto(syntheticUrl);
    await page.addScriptTag({ content: bundle });
    await page.evaluate(() => window.h.ready);
  };
  try {
    await load();
    await run(page, load);
    assert.deepEqual(errors, []);
    assert.deepEqual(unexpectedRequests, []);
  } finally { await context.close(); }
}

const selected = (page) => page.evaluate(() => window.h.current.activeSelection);
const apply = (page, ids) => page.evaluate((values) => window.h.apply(values), ids);
const render = (page, patch) => page.evaluate((values) => window.h.render(values), patch);

test('legacy stored subsets are ignored without reading or cleaning storage', async () => {
  await withPage(async (page) => {
    assert.equal(await selected(page), null);
    assert.deepEqual(await page.evaluate(() => window.storageCalls), { get: 0, set: 0, remove: 0, clear: 0 });
    assert.equal(await page.evaluate((key) => window.peekStorage(key), legacyKey), '["team-b"]');
  }, { [legacyKey]: '["team-b"]' });
});

test('applying a subset remains usable in the visit and never writes storage', async () => {
  await withPage(async (page) => {
    await apply(page, ['team-b']);
    await render(page, {});
    assert.deepEqual(await selected(page), ['team-b']);
    assert.deepEqual(await page.evaluate(() => window.storageCalls), { get: 0, set: 0, remove: 0, clear: 0 });
    assert.equal(await page.evaluate((key) => window.peekStorage(key), legacyKey), null);
  });
});

test('leaving and returning mounts a fresh selection instead of the previous subset', async () => {
  await withPage(async (page) => {
    await apply(page, ['team-b']);
    await page.evaluate(() => window.h.remount());
    assert.equal(await selected(page), null);
  });
});

test('reload defaults to all teams after a temporary selection', async () => {
  await withPage(async (page, load) => {
    await apply(page, ['team-c']);
    await load(true);
    assert.equal(await selected(page), null);
  });
});

for (const field of ['organizationId', 'currentUserId']) {
  test(`${field} switches reset selection immediately and returning does not restore it`, async () => {
    await withPage(async (page) => {
      await apply(page, ['team-b']);
      await page.evaluate(() => { window.h.renders = []; });
      await render(page, { [field]: field === 'organizationId' ? 'org-b' : 'user-b' });
      assert.equal(await selected(page), null);
      assert.ok((await page.evaluate(() => window.h.renders)).every((item) => item.selection === null));
      await apply(page, ['team-c']);
      await render(page, { [field]: field === 'organizationId' ? 'org-a' : 'user-a' });
      assert.equal(await selected(page), null);
    });
  });
}

test('logout or unresolved scope drops the subset before the same actor returns', async () => {
  await withPage(async (page) => {
    await apply(page, ['team-a']);
    await render(page, { organizationId: null, currentUserId: null });
    assert.equal(await selected(page), null);
    await render(page, { organizationId: 'org-a', currentUserId: 'user-a' });
    assert.equal(await selected(page), null);
  });
});

test('selection only accepts available distinct IDs and all IDs means the default', async () => {
  await withPage(async (page) => {
    await apply(page, ['team-b', 'team-b', 'outside-scope']);
    assert.deepEqual(await selected(page), ['team-b']);
    await apply(page, []);
    await render(page, {});
    assert.deepEqual(await selected(page), []);
    await render(page, { teams: [{ id: 'team-c', name: 'Equipe C' }, { id: 'team-a', name: 'Equipe A' }, { id: 'team-b', name: 'Equipe B' }] });
    assert.deepEqual(await selected(page), []);
    assert.deepEqual(await page.evaluate(() => window.storageCalls), { get: 0, set: 0, remove: 0, clear: 0 });
    await apply(page, ['team-c', 'team-a', 'team-b']);
    assert.equal(await selected(page), null);
  });
});

test('removed teams are pruned and cannot return as a previously selected subset', async () => {
  await withPage(async (page) => {
    await apply(page, ['team-a', 'team-b']);
    await render(page, { teams: [{ id: 'team-a', name: 'Equipe A' }, { id: 'team-c', name: 'Equipe C' }] });
    assert.deepEqual(await selected(page), ['team-a']);
    await render(page, { teams: [{ id: 'team-a', name: 'Equipe A' }, { id: 'team-b', name: 'Equipe B' }, { id: 'team-c', name: 'Equipe C' }] });
    assert.deepEqual(await selected(page), ['team-a']);
    await render(page, { teams: [{ id: 'team-c', name: 'Equipe C' }] });
    assert.equal(await selected(page), null);
  });
});

test('a temporarily unavailable catalog preserves the current in-memory selection', async () => {
  await withPage(async (page) => {
    await apply(page, ['team-b']);
    await page.evaluate(() => window.h.render({ teams: undefined }));
    assert.deepEqual(await selected(page), ['team-b']);
    await render(page, { teams: [{ id: 'team-b', name: 'Equipe B' }, { id: 'team-c', name: 'Equipe C' }] });
    assert.deepEqual(await selected(page), ['team-b']);
  });
});

test('reordering or refreshing available teams preserves the chosen valid IDs', async () => {
  await withPage(async (page) => {
    await apply(page, ['team-b']);
    await render(page, { teams: [{ id: 'team-c', name: 'Equipe C atualizada' }, { id: 'team-b', name: 'Equipe B atualizada' }, { id: 'team-a', name: 'Equipe A' }] });
    assert.deepEqual(await selected(page), ['team-b']);
  });
});
