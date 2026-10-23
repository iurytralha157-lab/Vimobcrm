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

// Actual hooks, QueryClient and capability policy; only auth/API are synthetic.
// No application server, database, account or external browser request is used.
const synthetic = `
import React, { createContext, useContext } from 'react';
export const Auth = createContext(null);
export const useAuth = () => useContext(Auth);
export class VimobAPIError extends Error {
  constructor(message, details = {}) { super(message); Object.assign(this, details); }
}
export const getVimobAPIAccessTokenUserId=()=>window.harness.activeActor;
export const getVimobAPIAccessTokenSessionId=()=>window.harness.sessionId;
export const toast = Object.fromEntries(['error','success','warning','info'].map(kind => [kind, message => window.harness.toasts.push({kind,message})]));
export const enforceClientActionRateLimit = () => {};
export const getClientRateLimitMessage = () => null;
export const stringifyErrorMessage = String;
export const invalidateLeadHistorySoon = () => {};
export const runLeadImportBatch = () => {};
export const notifyLeadRealtimeChange = event => window.harness.signals.push(event);
window.harness = { requests: [], pending: [], capability: true, toasts: [], signals: [], outcomes: {}, sessionId:'synthetic-session' };
export const leadsAPI = {
  getLead(id, organizationId, signal, options) {
    const harness = window.harness;
    const request = { id, organizationId, retry: options?.retry, aborted: false };
    const index = harness.requests.push(request) - 1;
    signal?.addEventListener('abort', () => { request.aborted = true; });
    return new Promise((resolve, reject) => {
      harness.pending[index] = {
        resolve(data) { resolve({ data: data ?? {
          id, organization_id: organizationId, name: 'Confirmed ' + id,
          assigned_user_id: 'owner', team_id: 'team', can_operate: harness.capability,
          stage_id: 'stage', deal_status: 'open', created_at: '2026-10-12T10:00:00Z',
        }, error: null }); },
        reject(status) { reject(new VimobAPIError('Synthetic failure', { status })); },
      };
    });
  },
  updateLead(id, body, organizationId, intent) {
    const h=window.harness,index=h.requests.push({kind:'patch',id,body,organizationId,intent})-1;
    return new Promise((resolve,reject)=>{h.pending[index]={
      resolve(data){resolve({data,error:null});},
      reject(status){reject(new VimobAPIError('Synthetic update failure',{status}));},
    };});
  },
};
`;

const fixture = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useSelectedPipelineLeadAccess } from '@/hooks/pipelines/use-selected-lead-access';
import { useLead, useUpdateLead } from '@/hooks/use-leads';
import { canOperateLeadFromFreshRead } from '@/lib/lead-operation-capability';
import { matchesVerifiedLeadReadScope } from '@/lib/lead-read-snapshot';
import { Auth } from './synthetic';
const client = new QueryClient({ defaultOptions: { queries: {
  retry: false, staleTime: 600000, gcTime: Infinity,
  refetchOnMount: false, refetchOnWindowFocus: false,
} } });
window.harness.writeAnyCache=(key,data)=>client.setQueryData(key,data);
window.harness.readAnyCache=key=>client.getQueryData(key);
window.harness.invalid=key=>client.getQueryState(key)?.isInvalidated;
function MutationCapture() {
  const update=useUpdateLead();
  React.useLayoutEffect(()=>{window.harness.mutationMounted=true;return()=>{window.harness.mutationMounted=false;};},[]);
  window.harness.update=variables=>update.mutateAsync(variables).then(data=>{
    window.harness.outcomes.update={success:true,data};
  },error=>{window.harness.outcomes.update={success:false,message:error.message};});
  return null;
}
function state(query) {
  return { data: query.data, success: query.isSuccess, error: query.isError,
    fetching: query.isFetching, fetchedAfterMount: query.isFetchedAfterMount,
    dataUpdatedAt: query.dataUpdatedAt };
}
function Reader({ id, verifiedRead }) {
  const query = useLead(id, { freshOnMount: true, verifiedRead });
  window.harness.detail = { ...state(query),
    canOperate: canOperateLeadFromFreshRead(true, query, verifiedRead) };
  window.harness.refetchDetail = () => query.refetch();
  return <output data-reader>{JSON.stringify(window.harness.detail)}</output>;
}
function Selection({ selection, outside }) {
  const access = useSelectedPipelineLeadAccess({
    organizationId: selection.organizationId, leadId: selection.id,
    selectionVersion: selection.version, visibilityScopeKey: selection.visibility,
    enabled: Boolean(selection.id) && !outside,
  });
  const queryClient = useQueryClient();
  const snapshot = access.isSuccess && !access.isError && matchesVerifiedLeadReadScope(access.data, {
    organizationId: selection.organizationId, leadId: selection.id,
    selectionVersion: selection.version, visibilityScopeKey: selection.visibility,
  }) ? access.data : undefined;
  window.harness.access = state(access);
  window.harness.refetchAccess = () => access.refetch();
  window.harness.readCache = (org, id) => queryClient.getQueryData(['lead', org, id]);
  window.harness.seed = (org, id, data, updatedAt) => queryClient.setQueryData(
    ['lead', org, id], data, updatedAt ? { updatedAt } : undefined,
  );
  window.harness.cache = queryClient.getQueryCache().getAll().map(query => ({
    key: query.queryKey, data: query.state.data,
  }));
  window.harness.detail = undefined;
  return outside
    ? <Reader key={'outside:' + selection.organizationId + ':' + selection.id} id={selection.id} verifiedRead={selection.verifiedRead} />
    : snapshot && selection.id
      ? <Reader key={selection.organizationId + ':' + selection.id + ':' + selection.version + ':' + selection.visibility}
          id={selection.id} verifiedRead={snapshot} />
      : <output data-loading>Waiting for access</output>;
}
function Fixture() {
  const [selection, setSelection] = useState({ organizationId: 'org-A', id: null,
    version: 0, visibility: 'visibility-A' });
  const [outside, setOutside] = useState(false);
  const [showMutation,setShowMutation]=useState(true);
  window.harness.unmountUpdate=()=>setShowMutation(false);
  window.harness.selection = selection;
  window.harness.select = patch => { setOutside(false); setSelection(current => ({
    ...current, version: current.version + 1, ...patch,
  })); };
  window.harness.close = () => { setOutside(false); setSelection(current => ({ ...current, id: null })); };
  window.harness.openOutside = patch => { setOutside(true); setSelection(current => ({ ...current, ...patch })); };
  window.harness.clear = () => client.clear();
  const actor=selection.actor||'actor';
  window.harness.activeActor=actor;
  const syntheticSession={access_token:'e30.'+btoa(JSON.stringify({sub:actor,session_id:window.harness.sessionId}))+'.synthetic',user:{id:actor}};
  return <Auth.Provider value={{ activeOrganization: { organizationId: selection.organizationId },
    user: { id: actor }, profile: { id: actor }, session:selection.missingSession?null:syntheticSession }}>
    <QueryClientProvider client={client}><Selection selection={selection} outside={outside} />{showMutation&&<MutationCapture/>}</QueryClientProvider>
  </Auth.Provider>;
}
createRoot(document.getElementById('app')).render(<Fixture />);
`;

before(async () => {
  temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'vimob-pipeline-opening-'));
  const stub = path.join(temporaryDirectory, 'synthetic.tsx');
  const entry = path.join(temporaryDirectory, 'fixture.tsx');
  const loader = path.join(temporaryDirectory, 'loader.cjs');
  await Promise.all([
    writeFile(stub, synthetic), writeFile(entry, fixture),
    writeFile(loader, `const ts = require(${JSON.stringify(path.join(root, 'node_modules/typescript'))}); module.exports = source => ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;`),
  ]);
  const aliases = Object.fromEntries([
    'contexts/AuthContext', 'lib/api/leads', 'lib/api/vimob-client',
    'lib/api/vimob-error', 'lib/client-action-rate-limit',
    'hooks/use-optimistic-lead-history', 'lib/lead-import-batch', 'contexts/LeadRealtimeBus',
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
  await page.route('**/*', route => route.request().url() === 'https://pipeline-opening.invalid/'
    ? route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }) : route.abort());
  await page.goto('https://pipeline-opening.invalid/');
  await page.addScriptTag({ content: await readFile(path.join(temporaryDirectory, 'bundle.js'), 'utf8') });
  await page.waitForFunction(() => Boolean(window.harness.select)&&window.harness.mutationMounted===true);
});
afterEach(async () => { await page?.close(); });
after(async () => {
  await browser?.close();
  if (temporaryDirectory) {
    const target = path.resolve(temporaryDirectory);
    assert.equal(path.dirname(target), path.resolve(tmpdir()));
    assert(path.basename(target).startsWith('vimob-pipeline-opening-'));
    await rm(target, { recursive: true, force: true });
  }
  assert.deepEqual(browserErrors, []);
});

async function select(patch = { id: 'lead-A' }, count = 1) {
  await page.evaluate(patch => window.harness.select(patch), patch);
  await page.waitForFunction(count => window.harness.requests.length >= count, count);
}
async function resolveRead(index, data) {
  await page.evaluate(({ index, data }) => window.harness.pending[index].resolve(data), { index, data });
}
async function confirmed() {
  await page.waitForFunction(() => window.harness.access.success && window.harness.detail?.success && !window.harness.detail.fetching);
  return page.evaluate(() => ({ access: window.harness.access, detail: window.harness.detail, requests: window.harness.requests }));
}

test('one fresh authorization GET also supplies the detail and its initial operation capability', async () => {
  await select();
  assert.equal(await page.evaluate(() => window.harness.detail), undefined);
  await resolveRead(0);
  const result = await confirmed();
  assert.equal(result.requests.length, 1);
  assert.equal(result.requests[0].retry, false);
  assert.equal(result.access.data.data.id, 'lead-A');
  assert.equal(result.detail.data.id, 'lead-A');
  assert.equal(result.detail.fetchedAfterMount, false);
  assert.equal(result.detail.canOperate, true);
});

test('a detail opened outside Pipeline still performs a fresh GET despite a warm cache', async () => {
  await page.evaluate(() => {
    window.harness.seed('org-A', 'lead-A', { id: 'lead-A', organization_id: 'org-A', name: 'Cached', can_operate: true });
    window.harness.openOutside({ id: 'lead-A' });
  });
  await page.waitForFunction(() => window.harness.requests.length === 1 && window.harness.detail?.fetching);
  assert.equal(await page.evaluate(() => window.harness.detail.canOperate), false);
  await resolveRead(0);
  await page.waitForFunction(() => window.harness.detail?.fetchedAfterMount && !window.harness.detail.fetching);
  assert.equal(await page.evaluate(() => window.harness.detail.data.name), 'Confirmed lead-A');
});

for (const status of [401, 403, 404, 503]) {
  test(`a warm cache cannot authorize the initial opening after HTTP ${status}`, async () => {
    await page.evaluate(() => window.harness.seed('org-A', 'lead-A', {
      id: 'lead-A', organization_id: 'org-A', name: 'Cached private lead', can_operate: true,
    }));
    await select();
    await page.evaluate(status => window.harness.pending[0].reject(status), status);
    await page.waitForFunction(() => window.harness.access.error);
    assert.equal(await page.evaluate(() => window.harness.detail), undefined);
    assert.equal(await page.locator('[data-reader]').count(), 0);
  });
}

for (const patch of [{ id: 'wrong-lead' }, { organization_id: 'wrong-org' }]) {
  test(`a response with mismatched ${Object.keys(patch)[0]} cannot seed the lead cache`, async () => {
    await select();
    await resolveRead(0, { id: 'lead-A', organization_id: 'org-A', can_operate: true, ...patch });
    await page.waitForFunction(() => window.harness.access.error);
    assert.equal(await page.evaluate(() => window.harness.readCache('org-A', 'lead-A')), undefined);
    assert.equal(await page.evaluate(() => window.harness.detail), undefined);
  });
}

test('closing or switching leads aborts the old read and its late response cannot populate cache', async () => {
  await select();
  await select({ id: 'lead-B' }, 2);
  await resolveRead(1);
  assert.equal((await confirmed()).detail.data.id, 'lead-B');
  await resolveRead(0);
  assert.equal(await page.evaluate(() => window.harness.requests[0].aborted), true);
  assert.equal(await page.evaluate(() => window.harness.readCache('org-A', 'lead-A')), undefined);
  assert.equal(await page.evaluate(() => window.harness.detail.data.id), 'lead-B');
  await page.evaluate(() => window.harness.close());
  await page.waitForFunction(() => window.harness.selection.id === null);
  await select({ id: 'lead-C' }, 3);
  await page.evaluate(() => window.harness.close());
  await page.waitForFunction(() => window.harness.requests[2].aborted);
  await resolveRead(2);
  assert.equal(await page.evaluate(() => window.harness.readCache('org-A', 'lead-C')), undefined);
});

test('closing and reopening the same lead requires a new selection authorization', async () => {
  await select(); await resolveRead(0); await confirmed();
  await page.evaluate(() => window.harness.close());
  await page.waitForFunction(() => window.harness.selection.id === null);
  await select({ id: 'lead-A' }, 2);
  assert.equal(await page.evaluate(() => window.harness.detail), undefined);
  await resolveRead(1);
  assert.equal((await confirmed()).requests.length, 2);
});

for (const [label, patch] of [
  ['organization', { organizationId: 'org-B' }],
  ['visibility', { visibility: 'visibility-B' }],
  ['selection version', { version: 8 }],
]) {
  test(`changing ${label} cannot reuse a previously authorized snapshot`, async () => {
    await select(); await resolveRead(0); await confirmed();
    await select(patch, 2);
    assert.equal(await page.evaluate(() => window.harness.detail), undefined);
    await resolveRead(1);
    const result = await confirmed();
    assert.equal(result.requests.length, 2);
    assert.equal(result.access.data.organizationId, patch.organizationId ?? 'org-A');
    assert.equal(result.access.data.visibilityScopeKey, patch.visibility ?? 'visibility-A');
  });
}

test('A to B to A cannot revive the old organization request', async () => {
  await select();
  await select({ organizationId: 'org-B' }, 2);
  await select({ organizationId: 'org-A' }, 3);
  await resolveRead(0); await resolveRead(1);
  assert.equal(await page.evaluate(() => window.harness.detail), undefined);
  assert.equal(await page.evaluate(() => window.harness.readCache('org-B', 'lead-A')), undefined);
  await resolveRead(2);
  const result = await confirmed();
  assert.equal(result.access.data.selectionVersion, 3);
  assert.equal(result.requests.length, 3);
});

test('an authoritative capability denial wins over the old operating-capable card', async () => {
  await page.evaluate(() => {
    window.harness.capability = false;
    window.harness.seed('org-A', 'lead-A', { id: 'lead-A', organization_id: 'org-A', can_operate: true, assigned_user_id: 'old-owner' });
  });
  await select(); await resolveRead(0);
  const result = await confirmed();
  assert.equal(result.requests.length, 1);
  assert.equal(result.detail.data.can_operate, false);
  assert.equal(result.detail.canOperate, false);
});

for (const [label, change] of [
  ['expired confirmation', 'expired'],
  ['owner change after confirmation', 'owner'],
  ['capability change after confirmation', 'capability'],
]) {
  test(`a handoff with ${label} requires another GET before operations`, async () => {
    await select(); await resolveRead(0); await confirmed();
    const snapshot = await page.evaluate(change => {
      const read = structuredClone(window.harness.access.data);
      const cached = { ...read.data };
      if (change === 'expired') read.confirmedAt = Date.now() - 31000;
      if (change === 'owner') cached.assigned_user_id = 'transferred-owner';
      if (change === 'capability') cached.can_operate = false;
      window.harness.close();
      window.harness.seed('org-A', 'lead-A', cached, read.confirmedAt);
      return read;
    }, change);
    await page.waitForFunction(() => window.harness.selection.id === null);
    await page.evaluate(verifiedRead => window.harness.openOutside({ id: 'lead-A', verifiedRead }), snapshot);
    await page.waitForFunction(() => window.harness.requests.length === 2 && window.harness.detail?.fetching);
    assert.equal(await page.evaluate(() => window.harness.detail.canOperate), false);
    await resolveRead(1);
    await page.waitForFunction(() => window.harness.detail?.fetchedAfterMount && !window.harness.detail.fetching);
    assert.equal(await page.evaluate(() => window.harness.detail.data.name), 'Confirmed lead-A');
  });
}

async function startUpdate() {
  await page.evaluate(()=>{const h=window.harness,row={id:'lead-A',organization_id:'org-A',name:'Before',
    assigned_user_id:'owner',team_id:'team',can_operate:true,stage_id:'stage',pipeline_id:'pipeline',deal_status:'open',
    valor_interesse:100,updated_at:'2026-10-12T10:00:00Z',assignee:{id:'owner',name:'Owner'},stage:{id:'stage',name:'Stage'},tags:[{id:'tag'}]};
    h.updateRow=row;h.updateKeys=[['lead','org-A','lead-A'],['leads','org-A'],['contacts-list','org-A'],['stages-with-leads','org-A','pipeline']];
    h.writeAnyCache(h.updateKeys[0],row);for(const key of h.updateKeys.slice(1,3))h.writeAnyCache(key,[row]);
    h.writeAnyCache(h.updateKeys[3],[{id:'stage',leads:[row],total_lead_count:1,total_value:100}]);
    h.update({id:'lead-A',feedback:'Synthetic feedback'});
  });
  await page.waitForFunction(()=>window.harness.requests.some(r=>r.kind==='patch')||window.harness.outcomes.update);
  const state=await page.evaluate(()=>({requests:window.harness.requests,outcome:window.harness.outcomes.update}));
  assert(state.requests.some(r=>r.kind==='patch'),JSON.stringify(state));
}
async function updateOutcome() {
  await page.waitForFunction(()=>window.harness.outcomes.update);
  return page.evaluate(()=>window.harness.outcomes.update);
}

test('feedback response older by one microsecond preserves realtime across scoped caches',async()=>{
  await startUpdate();
  const intent=await page.evaluate(()=>{const intent=window.harness.requests[0].intent;return {
    expectedUserId:intent.expectedUserId,expectedSessionId:intent.expectedSessionId,
    hasAbortSignal:intent.signal instanceof AbortSignal,aborted:intent.signal?.aborted,
  };});
  assert.deepEqual(intent,{expectedUserId:'actor',expectedSessionId:'synthetic-session',hasAbortSignal:true,aborted:false});
  await page.evaluate(()=>{const h=window.harness,next={...h.updateRow,name:'Realtime',updated_at:'2026-10-12T10:01:00.123457Z'};
    h.writeAnyCache(h.updateKeys[0],next);for(const key of h.updateKeys.slice(1,3))h.writeAnyCache(key,[next]);
    h.writeAnyCache(h.updateKeys[3],[{id:'stage',leads:[next],total_lead_count:1,total_value:100}]);
    h.pending[0].resolve({...h.updateRow,name:'Old response',updated_at:'2026-10-12T10:01:00.123456Z'});
  });await updateOutcome();
  const names=await page.evaluate(()=>{const h=window.harness;return h.updateKeys.map((key,i)=>{const data=h.readAnyCache(key);return i===0?data.name:i===3?data[0].leads[0].name:data[0].name;});});
  assert.deepEqual(names,['Realtime','Realtime','Realtime','Realtime']);
});

test('update preserves omitted read relations and corrects the board value aggregate',async()=>{
  await startUpdate();await page.evaluate(()=>{const h=window.harness;h.pending[0].resolve({...h.updateRow,updated_at:'2026-10-12T10:01:00Z',valor_interesse:200,assignee:undefined,stage:undefined,tags:undefined});});
  await updateOutcome();const result=await page.evaluate(()=>{const h=window.harness,detail=h.readAnyCache(h.updateKeys[0]),board=h.readAnyCache(h.updateKeys[3]);return {name:detail.assignee?.name,stage:detail.stage?.name,tags:detail.tags,value:board[0].total_value,boardOwner:board[0].leads[0].assignee?.name};});
  assert.deepEqual(result,{name:'Owner',stage:'Stage',tags:[{id:'tag'}],value:200,boardOwner:'Owner'});
});

for(const patch of [{organizationId:'org-B'},{actor:'other-actor'}]) test('late update completion cannot patch the next access scope: '+JSON.stringify(patch),async()=>{
  await startUpdate();await page.evaluate(patch=>window.harness.select({...patch,id:null}),patch);
  await page.waitForFunction(patch=>Object.entries(patch).every(([key,value])=>window.harness.selection[key]===value),patch);
  await page.evaluate(()=>{const h=window.harness;h.writeAnyCache(['lead','org-B','lead-A'],{name:'Other organization'});h.pending[0].resolve({...h.updateRow,name:'Old access response',updated_at:'2026-10-12T10:01:00Z'});});
  await updateOutcome();const result=await page.evaluate(()=>({old:window.harness.readAnyCache(['lead','org-A','lead-A']).name,next:window.harness.readAnyCache(['lead','org-B','lead-A']).name,signals:window.harness.signals}));
  assert.equal(result.old,'Before');assert.equal(result.next,'Other organization');assert.deepEqual(result.signals,[]);
});

test('accepted update after closing reconciles its scoped cache',async()=>{
  await startUpdate();await page.evaluate(()=>window.harness.unmountUpdate());
  await page.waitForFunction(()=>window.harness.mutationMounted===false);await page.evaluate(()=>{const h=window.harness;h.pending[0].resolve({...h.updateRow,name:'Accepted',updated_at:'2026-10-12T10:01:00Z'});});
  await updateOutcome();assert.equal(await page.evaluate(()=>window.harness.readAnyCache(['lead','org-A','lead-A']).name),'Accepted');
});

test('rejected update after closing invalidates its old cache without an obsolete toast',async()=>{
  await startUpdate();await page.evaluate(()=>window.harness.unmountUpdate());
  await page.waitForFunction(()=>window.harness.mutationMounted===false);await page.evaluate(()=>window.harness.pending[0].reject(409));
  assert.equal((await updateOutcome()).success,false);
  const result=await page.evaluate(()=>({invalid:window.harness.invalid(['lead','org-A','lead-A']),toasts:window.harness.toasts}));
  assert.equal(result.invalid,true);assert.deepEqual(result.toasts,[]);
});

test('update rejects a response belonging to a different organization',async()=>{
  await startUpdate();await page.evaluate(()=>{const h=window.harness;h.pending[0].resolve({...h.updateRow,organization_id:'org-B',name:'Wrong org'});});
  assert.equal((await updateOutcome()).success,false);
  assert.equal(await page.evaluate(()=>window.harness.readAnyCache(['lead','org-A','lead-A']).name),'Before');
});

test('missing session returns its rejection without transport or obsolete global feedback',async()=>{
  await page.evaluate(()=>window.harness.select({id:null,missingSession:true}));
  await page.waitForFunction(()=>window.harness.selection.missingSession===true);
  await page.evaluate(()=>window.harness.update({id:'lead-A',feedback:'Synthetic feedback'}));
  const result=await updateOutcome();assert.equal(result.success,false);assert.match(result.message,/sessão/);
  const state=await page.evaluate(()=>({requests:window.harness.requests,toasts:window.harness.toasts}));
  assert.deepEqual(state.requests,[]);assert.deepEqual(state.toasts,[]);
});
