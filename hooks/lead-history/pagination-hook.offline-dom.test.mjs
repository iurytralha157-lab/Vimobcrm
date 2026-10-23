import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from '@playwright/test';

// Actual useLeadHistory + React Query hooks in Chromium. API/Auth are synthetic;
// this validates observers and lifecycle, not SQL or the full production dialog.
const require = createRequire(import.meta.url);
const { webpack } = require('next/dist/compiled/webpack/webpack.js');
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let directory, browser, bundle;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vimob-history-pagination-'));
  const loader = join(directory, 'ts-loader.cjs');
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=function(source){return ts.transpileModule(source,{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText}`);
  const auth = join(directory, 'auth.js');
  await writeFile(auth, `export const useAuth=()=>window.h.scope;`);
  const formatters = join(directory, 'formatters.js');
  await writeFile(formatters, `export const formatPropertyCurrency=String,formatResponseTime=String,formatBRLCurrencyWithDefaultDecimals=String;`);
  const api = join(directory, 'api.js');
  await writeFile(api, `export const leadsAPI={getLeadHistoryRaw:(lead,org,{signal})=>window.h.request('legacy',lead,org,signal),getLeadHistoryPage:(lead,org,{signal,cursor})=>window.h.request('paged',lead,org,signal,cursor)};`);
  const entry = join(directory, 'entry.js');
  await writeFile(entry, `import React from'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{useLeadHistory}from'@/hooks/use-lead-history';
    const h=window.h={a:true,b:true,legacy:true,calls:[],scope:{activeOrganization:{organizationId:'org-a'},user:{id:'user-a'},tenantContext:{permissions:['lead_view']}}};const client=h.client=new QueryClient();
    h.raw=n=>({timelineEvents:[],activityEvents:[{id:'synthetic-'+n,type:'note',content:'Synthetic '+n,created_at:'2026-10-12T12:00:00Z'}],entryEvents:[],distributionLogs:[],assignmentLogs:[],auditLogs:[],users:[],lead:{id:'lead-a',created_at:'2026-10-01T00:00:00Z'},leadMeta:{},historyCoverage:{complete:false,canonicalPresence:{leadCreated:true,firstResponse:false,assignment:false}}});
    h.page=(n,cursor='next')=>({data:h.raw(n),pagination:{nextCursor:cursor,hasOlder:cursor!==null,snapshotAt:'2026-10-12T13:00:00Z'}});
    h.request=(mode,lead,org,signal,cursor)=>{h.calls.push({mode,lead,org,signal,cursor});if(cursor)return new Promise((resolve,reject)=>{h.resolveOlder=resolve;h.rejectOlder=reject});return Promise.resolve(mode==='legacy'?{...h.raw('legacy'),activityEvents:[...h.raw('legacy').activityEvents,...h.raw('legacy-extra').activityEvents]}:h.page(org));};
    function Consumer({name,paged}){const q=useLeadHistory('lead-a',{paginated:paged});return React.createElement('section',{'aria-label':name},React.createElement('output',null,name+':'+(q.data?.map(e=>e.content).join('|')??'pending')),React.createElement('span',{'data-complete':name},String(q.historyComplete)),q.olderHistoryError&&React.createElement('p',{role:'alert'},q.olderHistoryError.message),q.hasOlderHistory&&React.createElement('button',{disabled:q.isFetchingOlderHistory,onClick:()=>void q.fetchOlderHistory()},'Older '+name));}
    const root=createRoot(document.getElementById('root'));h.render=()=>root.render(React.createElement(QueryClientProvider,{client},React.createElement(React.Fragment,null,h.a&&React.createElement(Consumer,{key:'a',name:'A',paged:true}),h.b&&React.createElement(Consumer,{key:'b',name:'B',paged:true}),h.legacy&&React.createElement(Consumer,{key:'legacy',name:'Legacy',paged:false}))));h.render();`);
  await new Promise((done, reject) => {
    const compiler = webpack({ mode: 'development', target: 'web', entry,
      output: { path: directory, filename: 'fixture.js' },
      resolve: { extensions: ['.ts', '.tsx', '.js'], modules: [join(repository, 'node_modules'), 'node_modules'],
        alias: { '@/contexts/AuthContext$': auth, '@/lib/api/leads$': api,
          '@/hooks/use-lead-timeline$': formatters, '@/lib/property-display-utils$': formatters,
          '@/lib/utils/formatting$': formatters, '@': repository } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] } });
    compiler.run((error, stats) => compiler.close(() => error ? reject(error)
      : stats.hasErrors() ? reject(Error(stats.toString({ all: false, errors: true }))) : done()));
  });
  bundle = await readFile(join(directory, 'fixture.js'), 'utf8');
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  if (directory) {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(directory.startsWith(join(tmpdir(), 'vimob-history-pagination-')));
    await rm(directory, { recursive: true, force: true });
  }
});

async function fixture() {
  const page = await browser.newPage();
  await page.route('**/*', route => route.abort());
  await page.setContent('<main id="root"></main>');
  await page.addScriptTag({ content: bundle });
  await page.getByRole('button', { name: 'Older A' }).waitFor();
  await page.waitForFunction(() => document.querySelector('[aria-label="Legacy"] output')?.textContent.includes('legacy-extra'));
  return page;
}

test('hook real compartilha página em dois consumidores e mantém legado completo separado', async () => {
  const page = await fixture();
  try {
    assert.equal(await page.evaluate(() => window.h.calls.filter(c => c.mode === 'paged').length), 1);
    assert.equal(await page.evaluate(() => window.h.calls.filter(c => c.mode === 'legacy').length), 1);
    await page.getByRole('button', { name: 'Older A' }).click();
    await page.waitForFunction(() => window.h.calls.filter(c => c.cursor).length === 1);
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'Older B' && button.disabled), undefined, { timeout: 5_000 });
    assert.equal(await page.getByRole('button', { name: 'Older B' }).isDisabled(), true);
    await page.evaluate(() => window.h.resolveOlder(window.h.page('older', null)));
    await page.waitForFunction(() => document.querySelector('[aria-label="B"] output')?.textContent.includes('older'));
    assert.equal(await page.locator('[data-complete="A"]').textContent(), 'true');
    assert.equal(await page.locator('[data-complete="B"]').textContent(), 'true');
    assert.match(await page.locator('[aria-label="Legacy"] output').textContent(), /legacy-extra/);
    assert.equal(await page.getByRole('button', { name: 'Older A' }).count(), 0);
  } finally { await page.close(); }
});

test('erro anterior aparece em ambos observers, mantém incompleto e retry recupera', async () => {
  const page = await fixture();
  try {
    await page.getByRole('button', { name: 'Older A' }).click();
    await page.evaluate(() => window.h.rejectOlder(new Error('Synthetic older failure')));
    await page.getByRole('alert').first().waitFor();
    assert.equal(await page.getByRole('alert').count(), 2);
    assert.equal(await page.locator('[data-complete="B"]').textContent(), 'false');
    await page.getByRole('button', { name: 'Older B' }).click();
    await page.evaluate(() => window.h.resolveOlder(window.h.page('recovered', null)));
    await page.waitForFunction(() => document.querySelector('[aria-label="A"] output')?.textContent.includes('recovered'));
    assert.equal(await page.getByRole('alert').count(), 0);
  } finally { await page.close(); }
});

test('troca de tenant/permissão cancela página antiga e mantém nova projeção isolada', async () => {
  const page = await fixture();
  try {
    await page.getByRole('button', { name: 'Older A' }).click();
    await page.evaluate(() => {
      window.h.oldResolve = window.h.resolveOlder; window.h.legacy = false;
      window.h.scope = { activeOrganization: { organizationId: 'org-b' }, user: { id: 'user-b' }, tenantContext: { permissions: ['lead_view_owned'] } };
      window.h.render();
    });
    await page.waitForFunction(() => document.querySelector('[aria-label="A"] output')?.textContent.includes('org-b'));
    assert.equal(await page.evaluate(() => window.h.calls.find(c => c.cursor).signal.aborted), true);
    await page.evaluate(() => window.h.oldResolve(window.h.page('late-old', null)));
    assert.doesNotMatch(await page.locator('[aria-label="A"] output').textContent(), /late-old|org-a/);
    assert.equal(await page.locator('[data-complete="A"]').textContent(), 'false');
  } finally { await page.close(); }
});

test('uma instância pode fechar; somente último observer cancela a consulta paginada', async () => {
  const page = await fixture();
  try {
    await page.getByRole('button', { name: 'Older A' }).click();
    await page.evaluate(() => { window.h.a = false; window.h.render(); });
    await page.waitForFunction(() => !document.querySelector('[aria-label="A"]'));
    assert.equal(await page.evaluate(() => window.h.calls.find(c => c.cursor).signal.aborted), false);
    await page.evaluate(() => { window.h.b = false; window.h.render(); });
    await page.waitForFunction(() => window.h.calls.find(c => c.cursor).signal.aborted);
    await page.evaluate(() => window.h.resolveOlder(window.h.page('late-unmounted', null)));
    const legacy = await page.locator('[aria-label="Legacy"] output').textContent();
    assert.doesNotMatch(legacy, /late-unmounted/);
  } finally { await page.close(); }
});
