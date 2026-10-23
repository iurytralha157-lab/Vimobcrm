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
let temporaryDirectory, browser, page;
const errors = [];
// Only external boundaries are synthetic. Provider, access leases, hooks,
// React Query execution contexts, Strict Mode and browser lifecycle are real.
const boundaries = `
import React,{createContext,useContext} from 'react';
export const Auth=createContext(null),useAuth=()=>useContext(Auth);
export const useWhatsAppQueryScope=()=>{const a=useAuth();return {organizationId:a.activeOrganization.organizationId,userId:a.user.id,accessScope:'synthetic'}};
window.harness={requests:[],pending:[],toasts:[],clients:[],effects:[],outcomes:{}};
const h=window.harness;
function request(kind,id,input,organizationId){
 const index=h.requests.push({kind,input,organizationId,id})-1;
 return new Promise((resolve,reject)=>h.pending[index]={resolve:()=>resolve(kind==='delete'?undefined:{id,organization_id:organizationId,is_active:input.is_active,revision:4}),reject:()=>reject(new Error('Synthetic request failure'))});
}
export const roundRobinsAPI={updateRoundRobin:(id,input,org)=>request('toggle',id,input,org),deleteRoundRobin:(id,org,revision)=>request('delete',id,{expectedRevision:revision},org)};
export const toast=Object.fromEntries(['success','error'].map(kind=>[kind,message=>h.toasts.push({kind,message,scope:h.visible})]));
`;
const fixture = `
import React,{StrictMode,useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {useQueryClient,onlineManager} from '@tanstack/react-query';
import {QueryProvider} from '@/components/providers/query-provider';
import {captureQueryClientAccess} from '@/lib/access/query-client-access';
import {useUpdateRoundRobin,useDeleteRoundRobin} from '@/hooks/use-round-robins';
import {Auth} from './boundaries';
const h=window.harness;
h.inputs={toggle:{id:'queue-existing',revision:3,is_active:false},delete:{id:'queue-existing',revision:3}};
function Sentinel({scope}){
 const client=useQueryClient();
 useEffect(()=>{
  if(!h.clients.includes(client)){
   const clientIndex=h.clients.push(client)-1;
   const write=client.setQueryData.bind(client),invalidate=client.invalidateQueries.bind(client),remove=client.removeQueries.bind(client);
   client.setQueryData=(key,...args)=>{h.effects.push({kind:'write',clientIndex,key});return write(key,...args)};
   client.invalidateQueries=(filters,...args)=>{h.effects.push({kind:'invalidate',clientIndex,key:filters?.queryKey});return invalidate(filters,...args)};
   // WhatsApp's provider cleanup uses a predicate, not a queue mutation key.
   client.removeQueries=(filters,...args)=>{if(filters?.queryKey)h.effects.push({kind:'remove',clientIndex,key:filters.queryKey});return remove(filters,...args)};
  }
  h.currentClient=client;h.currentAccess=captureQueryClientAccess(client);h.visible={...scope};
 },[client,scope]);
 return <span id="scope">{JSON.stringify(scope)}</span>;
}
function Probe(){
 const toggle=useUpdateRoundRobin(),remove=useDeleteRoundRobin();
 h.mutations={toggle,delete:remove};
 h.actions={toggle:input=>toggle.mutateAsync(input),delete:input=>remove.mutateAsync(input)};
 h.start=(kind,key='one')=>h.actions[kind](h.inputs[kind]).then(data=>{h.outcomes[key]={ok:true,data}},error=>{h.outcomes[key]={ok:false,message:error.message}});
 return null;
}
function App(){
 const [scope,setScope]=useState({org:'org-a',actor:'actor-a',sid:'sid-a',token:1,open:true,permission:true});
 h.change=patch=>setScope(current=>({...current,...patch}));h.online=value=>onlineManager.setOnline(value);
 const session={user:{id:scope.actor},access_token:'synthetic.'+btoa(JSON.stringify({sub:scope.actor,session_id:scope.sid,version:scope.token}))+'.synthetic'};
 const auth={user:{id:scope.actor},profile:{id:scope.actor},session,activeOrganization:{organizationId:scope.org},organization:{},tenantContext:{memberRole:'admin',permissions:scope.permission?['distribution_manage']:[],enabledModules:[]}};
 return <Auth.Provider value={auth}><QueryProvider><Sentinel scope={scope}/>{scope.open&&<Probe/>}</QueryProvider></Auth.Provider>;
}
createRoot(document.getElementById('app')).render(<StrictMode><App/></StrictMode>);
`;

before(async () => {
  temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'vimob-queue-list-mutation-'));
  const stub = path.join(temporaryDirectory, 'boundaries.tsx');
  const entry = path.join(temporaryDirectory, 'fixture.tsx');
  const loader = path.join(temporaryDirectory, 'loader.cjs');
  await Promise.all([
    writeFile(stub, boundaries), writeFile(entry, fixture),
    writeFile(loader, `const ts=require(${JSON.stringify(path.join(root, 'node_modules/typescript'))});module.exports=source=>ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;`),
  ]);
  const aliases = Object.fromEntries(['contexts/AuthContext', 'hooks/use-whatsapp-query-scope', 'lib/api/round-robins'].map(name => ['@/' + name + '$', stub]));
  const { webpack } = require('next/dist/compiled/webpack/webpack');
  await new Promise((resolve, reject) => {
    const compiler = webpack({ mode: 'development', target: 'web', devtool: false, entry,
      output: { path: temporaryDirectory, filename: 'fixture.js' },
      resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { ...aliases, 'sonner$': stub, '@': root }, modules: [path.join(root, 'node_modules'), 'node_modules'] },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] },
    });
    compiler.run((error, stats) => compiler.close(() => error || stats?.hasErrors()
      ? reject(error || new Error(stats.toString({ all: false, errors: true }))) : resolve()));
  });
  browser = await chromium.launch({ headless: true });
}, { timeout: 360_000 });
beforeEach(async () => {
  page = await browser.newPage();
  page.setDefaultTimeout(5_000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url() === 'https://queue-list-mutation.invalid/'
    ? route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }) : route.abort());
  await page.goto('https://queue-list-mutation.invalid/');
  await page.addScriptTag({ content: await readFile(path.join(temporaryDirectory, 'fixture.js'), 'utf8') });
  await page.waitForFunction(() => window.harness?.visible?.org === 'org-a' && window.harness.currentAccess());
});
afterEach(async () => { await page?.close(); });
after(async () => {
  await browser?.close();
  if (temporaryDirectory) {
    const target = path.resolve(temporaryDirectory);
    assert.equal(path.dirname(target), path.resolve(tmpdir()));
    assert.ok(path.basename(target).startsWith('vimob-queue-list-mutation-'));
    await rm(target, { recursive: true, force: true });
  }
  assert.deepEqual(errors, []);
});

async function start(kind, key = 'one') {
  await page.evaluate(({ kind, key }) => { void window.harness.start(kind, key); }, { kind, key });
}
async function requested(count) { await page.waitForFunction(count => window.harness.requests.length === count, count); }
async function change(patch) {
  await page.evaluate(patch => window.harness.change(patch), patch);
  await page.waitForFunction(patch => Object.entries(patch).every(([key, value]) => window.harness.visible[key] === value)
    && window.harness.currentAccess(), patch);
}
async function complete(index, failure, key = 'one') {
  await page.evaluate(({ index, failure }) => window.harness.pending[index][failure ? 'reject' : 'resolve'](), { index, failure });
  await page.waitForFunction(key => Boolean(window.harness.outcomes[key]), key);
}
async function observed() {
  return page.evaluate(() => ({ effects: window.harness.effects, toasts: window.harness.toasts,
    requests: window.harness.requests, outcomes: window.harness.outcomes }));
}
function assertCurrentEffects(result, kind, failure) {
  assert.equal(result.toasts.length, failure || kind === 'delete' ? 1 : 0);
  if (failure) {
    assert.equal(result.toasts[0].kind, 'error');
    assert.deepEqual(result.effects, []);
    return;
  }
  if (kind === 'delete') assert.equal(result.toasts[0].kind, 'success');
  assert.equal(result.effects.filter(effect => effect.kind === 'write').length, kind === 'toggle' ? 2 : 0);
  assert.equal(result.effects.filter(effect => effect.kind === 'remove').length, kind === 'delete' ? 2 : 0);
  assert.equal(result.effects.filter(effect => effect.kind === 'invalidate').length, kind === 'toggle' ? 3 : 2);
  assert.ok(result.effects.every(effect => effect.key[1] === 'org-a'));
  assert.ok(result.effects.some(effect => effect.key[0] === 'round-robin-history' && effect.key[2] === 'queue-existing'));
}

const disruptions = [
  ['organization', [{ org: 'org-b' }]],
  ['actor', [{ actor: 'actor-b', sid: 'sid-b' }]],
  ['SID', [{ sid: 'sid-b' }]],
  ['organization ABA', [{ org: 'org-b' }, { org: 'org-a' }]],
  ['SID ABA', [{ sid: 'sid-b' }, { sid: 'sid-a' }]],
  ['permission', [{ permission: false }]],
];
for (const kind of ['toggle', 'delete']) {
  for (const failure of [false, true]) {
    for (const [name, transitions] of disruptions) test(`${kind} ${failure ? 'error' : 'success'} cannot affect a retired ${name} visit`, async () => {
      await page.evaluate(() => { window.harness.oldAccess = window.harness.currentAccess; });
      await start(kind); await requested(1);
      for (const patch of transitions) await change(patch);
      assert.equal(await page.evaluate(() => window.harness.oldAccess()), false);
      await complete(0, failure);
      const result = await observed();
      assert.equal(result.requests[0].organizationId, 'org-a');
      assert.equal(result.requests[0].input.expectedRevision, 3);
      assert.deepEqual(result.toasts, []);
      assert.deepEqual(result.effects, []);
    });
    test(`${kind} current ${failure ? 'error' : 'success'} keeps its legitimate effects`, async () => {
      await start(kind); await requested(1); await complete(0, failure);
      assertCurrentEffects(await observed(), kind, failure);
    });
    test(`${kind} ${failure ? 'error' : 'success'} after popup close still belongs to the same provider`, async () => {
      await page.evaluate(() => { window.harness.oldAccess = window.harness.currentAccess; });
      await start(kind); await requested(1); await change({ open: false });
      assert.equal(await page.evaluate(() => window.harness.oldAccess()), true);
      await complete(0, failure);
      assertCurrentEffects(await observed(), kind, failure);
    });
  }
  for (const aba of [false, true]) test(`${kind} paused before send cannot adopt a replacement SID${aba ? ' after ABA' : ''}`, async () => {
    await page.evaluate(() => window.harness.online(false));
    await start(kind);
    await page.waitForFunction(kind => window.harness.mutations[kind].isPaused, kind);
    await change({ sid: 'sid-b' });
    if (aba) await change({ sid: 'sid-a' });
    await page.evaluate(() => window.harness.online(true));
    // Fail immediately on a forbidden dispatch instead of waiting for its
    // unresolved synthetic response. Both assertions remain mandatory.
    await page.waitForFunction(() => Boolean(window.harness.outcomes.one) || window.harness.requests.length > 0);
    const result = await observed();
    assert.deepEqual(result.requests, []);
    assert.equal(result.outcomes.one.ok, false);
    assert.deepEqual(result.toasts, []);
    assert.deepEqual(result.effects, []);
  });
  test(`${kind} same input object in two SID visits keeps per-mutation ownership`, async () => {
    await start(kind, 'old'); await requested(1);
    await change({ sid: 'sid-b' });
    await start(kind, 'new'); await requested(2);
    await complete(0, false, 'old');
    assert.deepEqual((await observed()).effects, []);
    assert.deepEqual((await observed()).toasts, []);
    await complete(1, false, 'new');
    assertCurrentEffects(await observed(), kind, false);
  });
  test(`${kind} token refresh within the same SID keeps its successful effects`, async () => {
    await start(kind); await requested(1); await change({ token: 2 });
    await complete(0, false);
    assertCurrentEffects(await observed(), kind, false);
  });
}
