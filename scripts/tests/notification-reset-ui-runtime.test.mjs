import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const organizationA = '10000000-0000-4000-8000-000000000001';
const organizationB = '10000000-0000-4000-8000-000000000002';
let directory, browser, page, bundle;
const browserErrors = [];

// Real reset component, hook, validation and Radix controls. Only auth and API
// data are synthetic; all browser network traffic is blocked, with no CRM server.
const synthetic = `
import React, { createContext, useContext, useState } from 'react';
const Context = createContext(null);
export function SyntheticAuth({children}) {
  const [access, setAccess] = useState({ organizationId: '${organizationA}', isSuperAdmin: true, sessionId: 'session-a' });
  window.fixtureSetAccess = patch => setAccess(current => ({ ...current, ...patch }));
  const token = 'header.' + btoa(JSON.stringify({session_id:access.sessionId})) + '.signature';
  return <Context.Provider value={{
    activeOrganization: {organizationId:access.organizationId},
    isSuperAdmin:access.isSuperAdmin, user:{id:'20000000-0000-4000-8000-000000000001'},
    session:{access_token:token}, organization:{id:access.organizationId,name:'Organização sintética'},
    userOrganizations:[],
  }}>{children}</Context.Provider>;
}
export const useAuth = () => useContext(Context);
window.fixtureRequests = [];
window.fixtureDeferred = false;
window.fixtureFailReset = false;
window.fixturePending = [];
window.fixtureResolve = () => window.fixturePending.splice(0).forEach(resolve => resolve());
export const adminAPI = {
  async previewWhatsAppNotificationReset(input, organizationId, intent) {
    window.fixtureRequests.push({kind:'preview',input,organizationId,userId:intent.expectedUserId,sessionId:intent.expectedSessionId});
    if(window.fixtureDeferred) await new Promise(resolve => window.fixturePending.push(resolve));
    return {...input,cutoffAt:'2026-10-15T15:00:00.123456Z',pendingCount:4,inFlightCount:2};
  },
  async resetWhatsAppNotifications(input, organizationId, intent) {
    window.fixtureRequests.push({kind:'reset',input,organizationId,userId:intent.expectedUserId,sessionId:intent.expectedSessionId});
    if(window.fixtureFailReset) throw new Error('A prévia expirou. Consulte a fila novamente.');
    return {cancelledCount:4,inFlightCount:2};
  },
};
`;

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'vimob-notification-reset-ui-'));
  const entry = path.join(directory, 'fixture.tsx');
  const stub = path.join(directory, 'synthetic.tsx');
  const loader = path.join(directory, 'loader.cjs');
  await Promise.all([
    writeFile(stub, synthetic),
    writeFile(loader, `const ts=require(${JSON.stringify(path.join(root, 'node_modules/typescript'))});module.exports=source=>ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;`),
    writeFile(entry, `import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {WhatsAppNotificationQueueReset} from '@/components/features/admin/WhatsAppNotificationQueueReset';import {SyntheticAuth} from './synthetic';const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});createRoot(document.getElementById('app')).render(<QueryClientProvider client={client}><SyntheticAuth><WhatsAppNotificationQueueReset/></SyntheticAuth></QueryClientProvider>);`),
  ]);
  const { webpack } = require('next/dist/compiled/webpack/webpack');
  await new Promise((resolve, reject) => {
    const compiler = webpack({
      mode: 'development', target: 'web', devtool: false, entry,
      output: { path: directory, filename: 'fixture.js' },
      resolve: { extensions: ['.tsx', '.ts', '.js'], modules: [path.join(root, 'node_modules'), 'node_modules'],
        alias: { '@/contexts/AuthContext$': stub, '@/lib/api/admin$': stub, '@': root } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] },
      optimization: { minimize: false, usedExports: true },
    });
    compiler.run((error, stats) => compiler.close(() => error || stats?.hasErrors()
      ? reject(error || new Error(stats.toString({ all: false, errors: true }))) : resolve()));
  });
  bundle = await readFile(path.join(directory, 'fixture.js'), 'utf8');
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Sao_Paulo' });
  page.on('pageerror', error => browserErrors.push(error.message));
  await page.route('**/*', route => route.request().url() === 'http://notification-reset-fixture.local/'
    ? route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }) : route.abort());
});

beforeEach(async () => {
  await page.goto('http://notification-reset-fixture.local/');
  await page.addScriptTag({ content: bundle });
  await page.getByRole('button', { name: 'Consultar fila para reset' }).waitFor();
});

after(async () => {
  await browser?.close();
  if (directory) {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
    assert.ok(path.basename(resolved).startsWith('vimob-notification-reset-ui-'));
    await rm(resolved, { recursive: true, force: true });
  }
  assert.deepEqual(browserErrors, [], 'synthetic reset UI must not raise browser errors');
});

const requests = () => page.evaluate(() => window.fixtureRequests);
const preview = () => page.getByRole('button', { name: 'Consultar fila para reset' }).click();
const confirm = () => page.getByRole('button', { name: 'Cancelar avisos pendentes' });

async function fillConfirmation() {
  await page.getByLabel('Motivo do reset').fill('Cancelar avisos antigos antes de conectar.');
  await page.getByLabel('Digite RESETAR para confirmar').fill('RESETAR');
}

test('does not query automatically and hides reset from non-superadmins', async () => {
  assert.deepEqual(await requests(), []);
  await page.evaluate(() => window.fixtureSetAccess({ isSuperAdmin: false }));
  await page.getByRole('button', { name: 'Consultar fila para reset' }).waitFor({ state: 'detached' });
  assert.deepEqual(await requests(), []);
});

test('requires reason and exact confirmation, preserves scope and supports closing without cancelling', async () => {
  await preview();
  await page.getByRole('dialog').waitFor();
  assert.equal(await confirm().isDisabled(), true);
  await page.getByLabel('Motivo do reset').fill('Motivo sintético.');
  await page.getByLabel('Digite RESETAR para confirmar').fill('resetar');
  assert.equal(await confirm().isDisabled(), true);
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  assert.equal((await requests()).filter(item => item.kind === 'reset').length, 0);
  await preview();
  await fillConfirmation();
  await confirm().click();
  await page.getByRole('status').waitFor();
  const calls = await requests();
  const reset = calls.find(item => item.kind === 'reset');
  assert.equal(reset.organizationId, organizationA);
  assert.equal(reset.sessionId, 'session-a');
  assert.deepEqual(reset.input, {
    scope: 'organization', organizationId: organizationA, cutoffAt: '2026-10-15T15:00:00.123456Z',
    reason: 'Cancelar avisos antigos antes de conectar.', confirmation: 'RESETAR',
  });
  assert.match(await page.getByRole('status').innerText(), /4.*canceladas.*2.*fora do reset/);
});

test('global reset requires an explicit scope selection and sends no target organization', async () => {
  await page.getByLabel('Escopo do reset').selectOption('all');
  await preview();
  await page.getByRole('dialog').waitFor();
  assert.match(await page.getByRole('dialog').innerText(), /Todas as organizações do Vimob/);
  await fillConfirmation();
  await confirm().click();
  await page.getByRole('status').waitFor();
  const reset = (await requests()).find(item => item.kind === 'reset');
  assert.equal(reset.input.scope, 'all');
  assert.equal(Object.hasOwn(reset.input, 'organizationId'), false);
  assert.equal(reset.organizationId, organizationA, 'middleware context remains pinned to the user gesture');
});

test('organization changes discard the open confirmation and require a fresh preview', async () => {
  await preview();
  await fillConfirmation();
  await page.evaluate(organizationId => window.fixtureSetAccess({ organizationId }), organizationB);
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  assert.equal((await requests()).filter(item => item.kind === 'reset').length, 0);
  await preview();
  await page.getByRole('dialog').waitFor();
  assert.equal(await confirm().isDisabled(), true);
  assert.equal((await requests()).at(-1).input.organizationId, organizationB);
});

test('a late preview from the prior session cannot reopen a confirmation', async () => {
  await page.evaluate(() => { window.fixtureDeferred = true; });
  await preview();
  await page.waitForFunction(() => window.fixtureRequests.length === 1);
  await page.evaluate(() => window.fixtureSetAccess({ sessionId: 'session-b' }));
  await page.waitForFunction(() => !document.querySelector('button[disabled]'));
  await page.evaluate(() => window.fixtureResolve());
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal((await requests()).filter(item => item.kind === 'reset').length, 0);
});

test('a failed reset removes the preview and blocks a blind retry', async () => {
  await preview();
  await fillConfirmation();
  await page.evaluate(() => { window.fixtureFailReset = true; });
  await confirm().click();
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(), /Consulte a fila novamente/);
  assert.equal(await confirm().isDisabled(), true);
  assert.equal((await requests()).filter(item => item.kind === 'reset').length, 1);
});
