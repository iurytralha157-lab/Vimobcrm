import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let temporaryDirectory;
let browser;
let page;
const browserErrors = [];

// Real update/Finance hooks, QueryClient and realtime bus. Only transport and
// authentication use synthetic data; no server, database or ledger is written.
const synthetic = `
import { createContext, useContext } from 'react';
export const Auth=createContext(null),useAuth=()=>useContext(Auth);
window.harness={requests:[],pending:[],financialReads:[],toasts:[],listReads:0};
export class VimobAPIError extends Error {
  constructor(message,details={}){super(message);Object.assign(this,details);}
}
export const getVimobAPIAccessTokenUserId=()=>window.harness.actor;
export const getVimobAPIAccessTokenSessionId=()=> 'synthetic-session';
export const stringifyErrorMessage=String;
export const enforceClientActionRateLimit=()=>{};
export const getClientRateLimitMessage=()=>null;
export const invalidateLeadHistorySoon=()=>{};
export const runLeadImportBatch=()=>{};
export const toast=Object.fromEntries(['error','success','warning','info'].map(kind=>[
  kind,message=>window.harness.toasts.push({kind,message})]));
export const useToast=()=>({toast:message=>window.harness.toasts.push(message)});
export const leadsAPI={updateLead(id,body,organizationId,intent){
  const h=window.harness,index=h.requests.push({id,body,organizationId,intent})-1;
  return new Promise((resolve,reject)=>{h.pending[index]={
    resolve:()=>resolve({data:{id,organization_id:organizationId,deal_status:'won',valor_interesse:200,
      updated_at:'2026-10-12T11:00:00Z'},error:null}),
    reject:()=>reject(new VimobAPIError('Synthetic timeout',{status:504,code:'api_timeout'})),
  };});
}};
export const financialAPI={dashboard(organizationId){
  const h=window.harness;h.financialReads.push({organizationId});
  return Promise.resolve({marker:'fresh-'+organizationId,totalLeadsValue:200});
}};
`;

const fixture = `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider,useQuery} from '@tanstack/react-query';
import {useUpdateLead} from '@/hooks/use-leads';
import {useFinancialDashboard} from '@/hooks/use-financial';
import {LeadRealtimeBus,notifyLeadRealtimeChange} from '@/contexts/LeadRealtimeBus';
import {Auth} from './synthetic';
const h=window.harness,clients=[0,1].map(()=>new QueryClient({defaultOptions:{queries:{
  retry:false,staleTime:600000,gcTime:Infinity,refetchOnMount:false,refetchOnWindowFocus:false,
}}}));
h.seed=(organizationId,index=0)=>clients[index].setQueryData(['financial-dashboard',organizationId],
  {marker:'cached-'+organizationId,totalLeadsValue:100});
h.inspect=(organizationId,index=0)=>({data:clients[index].getQueryData(['financial-dashboard',organizationId]),
  invalid:clients[index].getQueryState(['financial-dashboard',organizationId])?.isInvalidated});
function Update(){
  const update=useUpdateLead();
  React.useLayoutEffect(()=>{h.updateMounted=true;return()=>{h.updateMounted=false;};},[]);
  h.update=()=>update.mutateAsync({id:'lead-A',valor_interesse:200}).then(
    ()=>{h.outcome='success';},()=>{h.outcome='error';});
  return null;
}
function Finance(){
  const query=useFinancialDashboard();h.finance={data:query.data,fetching:query.isFetching};
  React.useLayoutEffect(()=>{h.financeMounted=true;return()=>{h.financeMounted=false;};},[]);
  return <output>{JSON.stringify(query.data)}</output>;
}
function Sentinel({org}){
  useQuery({queryKey:['leads',org],queryFn:()=>{h.listReads++;return [];}});
  return null;
}
function Fixture(){
  const [state,setState]=useState({org:'org-A',actor:'actor-A',client:0,finance:false,update:true,bus:false});
  h.configure=patch=>setState(current=>({...current,...patch}));h.state=state;h.actor=state.actor;
  h.emit=change=>notifyLeadRealtimeChange(change);
  const session={user:{id:state.actor},access_token:'e30.'+btoa(JSON.stringify({sub:state.actor,
    session_id:'synthetic-session'}))+'.synthetic'};
  return <Auth.Provider value={{user:{id:state.actor},profile:{id:state.actor},session,
    activeOrganization:{organizationId:state.org}}}><QueryClientProvider client={clients[state.client]}>
    {state.update&&<Update/>}{state.finance&&<Finance/>}
    {state.bus&&<><LeadRealtimeBus/><Sentinel org={state.org}/></>}
  </QueryClientProvider></Auth.Provider>;
}
createRoot(document.getElementById('app')).render(<Fixture/>);
`;

before(async () => {
  temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'vimob-pipeline-financial-'));
  const stub = path.join(temporaryDirectory, 'synthetic.tsx');
  const entry = path.join(temporaryDirectory, 'fixture.tsx');
  const loader = path.join(temporaryDirectory, 'loader.cjs');
  await Promise.all([
    writeFile(stub, synthetic), writeFile(entry, fixture),
    writeFile(loader, `const ts=require(${JSON.stringify(path.join(root, 'node_modules/typescript'))});module.exports=source=>ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;`),
  ]);
  const aliases = Object.fromEntries([
    'contexts/AuthContext', 'lib/api/leads', 'lib/api/financial', 'lib/api/vimob-client',
    'lib/api/vimob-error', 'lib/client-action-rate-limit', 'hooks/use-optimistic-lead-history',
    'lib/lead-import-batch', 'hooks/use-toast',
  ].map(name => [`@/${name}$`, stub]));
  const { webpack } = require('next/dist/compiled/webpack/webpack');
  await new Promise((resolve, reject) => {
    const compiler = webpack({
      mode: 'development', target: 'web', devtool: false, entry,
      output: { path: temporaryDirectory, filename: 'bundle.js' },
      resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { ...aliases, 'sonner$': stub, '@': root },
        modules: [path.join(root, 'node_modules'), 'node_modules'] },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] },
    });
    compiler.run((error, stats) => compiler.close(() => {
      if (error || stats.hasErrors()) reject(error ?? new Error(stats.toString({ all: false, errors: true })));
      else resolve();
    }));
  });
  browser = await chromium.launch({ headless: true });
});

beforeEach(async () => {
  page = await browser.newPage();
  page.on('pageerror', error => browserErrors.push(error.message));
  await page.route('**/*', route => route.request().url() === 'https://pipeline-financial.invalid/'
    ? route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }) : route.abort());
  await page.goto('https://pipeline-financial.invalid/');
  await page.addScriptTag({ content: await readFile(path.join(temporaryDirectory, 'bundle.js'), 'utf8') });
  await page.waitForFunction(() => window.harness.updateMounted === true);
});
afterEach(async () => { await page?.close(); });
after(async () => {
  await browser?.close();
  if (temporaryDirectory) {
    const target = path.resolve(temporaryDirectory);
    assert.equal(path.dirname(target), path.resolve(tmpdir()));
    assert(path.basename(target).startsWith('vimob-pipeline-financial-'));
    await rm(target, { recursive: true, force: true });
  }
  assert.deepEqual(browserErrors, []);
});

async function configure(patch) {
  await page.evaluate(patch => window.harness.configure(patch), patch);
  await page.waitForFunction(patch => Object.entries(patch).every(([key, value]) =>
    window.harness.state[key] === value), patch);
}
async function startUpdate() {
  await page.evaluate(() => {
    const h = window.harness;
    h.seed('org-A'); h.seed('org-B'); h.update();
  });
  await page.waitForFunction(() => window.harness.requests.length === 1);
}
async function finishUpdate(outcome) {
  await page.evaluate(outcome => window.harness.pending[0][outcome](), outcome);
  await page.waitForFunction(() => Boolean(window.harness.outcome));
}
async function cachedStates() {
  return page.evaluate(() => ['org-A', 'org-B'].map(org => window.harness.inspect(org)));
}

for (const outcome of ['resolve', 'reject']) {
  test(`${outcome === 'resolve' ? 'success' : 'uncertain timeout'} invalidates only the old organization summary`, async () => {
    await startUpdate();
    await configure({ org: 'org-B' });
    await finishUpdate(outcome);
    const [old, next] = await cachedStates();
    assert.equal(old.invalid, true);
    assert.equal(next.invalid, false);
    assert.equal(next.data.marker, 'cached-org-B');
    assert.deepEqual(await page.evaluate(() => window.harness.toasts), []);
    assert.deepEqual(await page.evaluate(() => window.harness.financialReads), []);
  });
}

test('a late timeout after changing QueryClient invalidates the captured client alone', async () => {
  await startUpdate();
  await page.evaluate(() => window.harness.seed('org-A', 1));
  await configure({ client: 1 });
  await finishUpdate('reject');
  const state = await page.evaluate(() => [0, 1].map(index => window.harness.inspect('org-A', index)));
  assert.equal(state[0].invalid, true);
  assert.equal(state[1].invalid, false);
});

test('a success after closing the card still invalidates its Finance summary', async () => {
  await startUpdate();
  await configure({ update: false });
  await page.waitForFunction(() => window.harness.updateMounted === false);
  await finishUpdate('resolve');
  assert.equal((await cachedStates())[0].invalid, true);
});

test('returning to Finance refreshes a summary invalidated while inactive despite the provider default', async () => {
  await startUpdate();
  await finishUpdate('resolve');
  assert.deepEqual(await page.evaluate(() => window.harness.financialReads), []);
  await configure({ finance: true });
  await page.waitForFunction(() => window.harness.finance?.data?.marker === 'fresh-org-A');
  assert.deepEqual(await page.evaluate(() => window.harness.financialReads), [{ organizationId: 'org-A' }]);
  assert.equal(await page.evaluate(() => window.harness.finance.data.totalLeadsValue), 200);
});

test('an accepted card edit refreshes an already mounted Finance summary', async () => {
  await startUpdate();
  await configure({ finance: true });
  await page.waitForFunction(() => window.harness.financeMounted === true);
  assert.deepEqual(await page.evaluate(() => window.harness.financialReads), []);
  await finishUpdate('resolve');
  await page.waitForFunction(() => window.harness.finance?.data?.marker === 'fresh-org-A');
  assert.deepEqual(await page.evaluate(() => window.harness.financialReads), [{ organizationId: 'org-A' }]);
});

test('a fresh financial cache avoids an unnecessary request on mount', async () => {
  await page.evaluate(() => window.harness.seed('org-A'));
  await configure({ finance: true });
  await page.waitForFunction(() => window.harness.financeMounted === true);
  assert.equal(await page.evaluate(() => window.harness.finance.data.marker), 'cached-org-A');
  assert.deepEqual(await page.evaluate(() => window.harness.financialReads), []);
});

test('a local realtime batch refreshes Finance once without invalidating another organization', async () => {
  await page.evaluate(() => { window.harness.seed('org-A'); window.harness.seed('org-B'); });
  await configure({ finance: true, bus: true });
  await page.waitForFunction(() => window.harness.listReads === 1 && window.harness.financeMounted);
  await page.evaluate(() => {
    // Deliver one local transport batch. notifyLeadRealtimeChange also sends a
    // BroadcastChannel copy that may arrive in a later, independent batch.
    const emit = detail => window.dispatchEvent(new CustomEvent('vimob:lead-realtime-change', { detail }));
    emit({ organizationId: 'org-B', leadId: 'lead-B', reason: 'lead.updated' });
    emit({ organizationId: 'org-A', leadId: 'lead-A', reason: 'lead.updated' });
    emit({ organizationId: 'org-A', leadId: 'lead-A', reason: 'lead.stage_moved' });
  });
  await page.waitForFunction(() => window.harness.listReads === 2 && window.harness.financialReads.length === 1);
  const [old, next] = await cachedStates();
  assert.equal(old.data.marker, 'fresh-org-A');
  assert.equal(next.invalid, false);
  assert.deepEqual(await page.evaluate(() => window.harness.financialReads), [{ organizationId: 'org-A' }]);
});

test('WhatsApp-only traffic preserves a fresh Finance summary while its list batch is processed', async () => {
  await page.evaluate(() => window.harness.seed('org-A'));
  await configure({ finance: true, bus: true });
  await page.waitForFunction(() => window.harness.listReads === 1 && window.harness.financeMounted);
  await page.evaluate(() => window.harness.emit({ organizationId: 'org-A', leadId: 'lead-A', reason: 'lead.whatsapp_activity' }));
  await page.waitForFunction(() => window.harness.listReads >= 2);
  assert.equal((await cachedStates())[0].invalid, false);
  assert.deepEqual(await page.evaluate(() => window.harness.financialReads), []);
});

test('a foreign organization update is ignored while a local WhatsApp batch still runs', async () => {
  await page.evaluate(() => { window.harness.seed('org-A'); window.harness.seed('org-B'); });
  await configure({ finance: true, bus: true });
  await page.waitForFunction(() => window.harness.listReads === 1 && window.harness.financeMounted);
  await page.evaluate(() => {
    window.harness.emit({ organizationId: 'org-B', leadId: 'lead-B', reason: 'lead.updated' });
    window.harness.emit({ organizationId: 'org-A', leadId: 'lead-A', reason: 'lead.whatsapp_activity' });
  });
  await page.waitForFunction(() => window.harness.listReads >= 2);
  assert.deepEqual(await page.evaluate(() => window.harness.financialReads), []);
  assert.deepEqual((await cachedStates()).map(state => state.invalid), [false, false]);
});
