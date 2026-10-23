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
const synthetic = `
import React, { createContext, useContext } from 'react';
export const Auth = createContext(null);
export const useAuth = () => useContext(Auth);
export const useUserPermissions = () => ({hasPermission:useContext(Auth).hasPermission});
export const getVimobAPIAccessTokenUserId = () => window.harness.scope?.actor ?? null;
export const getVimobAPIAccessTokenSessionId = () => window.harness.scope?.sid ?? null;
export class VimobAPIError extends Error {
  constructor(message, details = {}) { super(message); Object.assign(this, details); }
}
window.harness = { requests: [], pending: [], outcomes: {}, toasts: [], signals: [], actions: [] };
export const toast = Object.fromEntries(['error','success','warning','info'].map(kind => [kind, (message) => window.harness.toasts.push({kind,message})]));
export const notifyLeadRealtimeChange = event => window.harness.signals.push(event);
function request(kind, id, org, body) {
  const h = window.harness, index = h.requests.push({kind,id,org,body}) - 1;
  return new Promise((resolve,reject) => { h.pending[index] = {
    resolve: data => resolve(kind === 'rr' || kind === 'board' ? data : {data,error:null}),
    reject: status => reject(new VimobAPIError('Synthetic failure', {status,code:'synthetic'})),
  }; });
}
export const leadsAPI = {
  getLead: (id,org) => request('get',id,org),
  updateLead: (id,body,org) => request('patch',id,org,body),
  redistributeLeadRoundRobin: (id,org,body) => request('rr',id,org,body),
};
export const boardRequest = (org) => request('board',null,org);
export const relatedRequest = (kind,org) => request(kind,null,org);
`;
const fixture = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { useDealStatusChange } from '@/hooks/use-deal-status-change';
import { useAssignLeadRoundRobin } from '@/hooks/use-assign-lead-roundrobin';
import { useLeadDetailPipelineCache } from '@/components/features/leads/lead-detail/use-lead-detail-pipeline-cache';
import { useLeadDetailOperationScope } from '@/hooks/leads/use-lead-detail-operation-scope';
import { Auth, boardRequest, relatedRequest, leadsAPI } from './synthetic';
const h = window.harness;
const client = new QueryClient({ defaultOptions: { queries: {retry:false,staleTime:Infinity,gcTime:Infinity} } });
const revision = '2026-10-12T10:00:00Z';
function lead(id,org='org-A',value=id==='A'?100:300) { return {id,organization_id:org,name:id,stage_id:'stage',pipeline_id:'pipeline',
  assigned_user_id:'owner',team_id:'team',can_operate:true,deal_status:'open',valor_interesse:value,updated_at:revision,
  created_at:revision,won_at:null,lost_at:null,lost_reason:null,property_id:null,interest_property_id:null,commission_percentage:5,
  tags:[{id:'tag',name:'Existing',color:'#111111'}]}; }
function boardKey(org='org-A',status) { const key=['stages-with-leads',org,'pipeline']; key[7]=status; key[14]='origin'; return key; }
function board(leads) { return [{id:'stage',leads,total_lead_count:leads.length,total_value:leads.reduce((s,l)=>s+l.valor_interesse,0),has_more:false}]; }
h.client = client; h.lead=lead; h.board=board; h.boardKey=boardKey;
h.seed = (org='org-A',status) => {
  const a=lead('A',org),b=lead('B',org); client.setQueryData(boardKey(org,status),board([a,b]));
  client.setQueryData(['leads',org], [a,b]);
  for(const row of [a,b]) {client.setQueryData(['lead',org,row.id],row);client.setQueryData(['lead-history-v2',row.id],[]);}
};
h.read = key => client.getQueryData(key);
h.write = (key,data) => client.setQueryData(key,data);
h.fetchBoard = (org,status,data) => client.fetchQuery({queryKey:boardKey(org,status),staleTime:0,queryFn:()=>Promise.resolve(data)});
h.invalid = key => client.getQueryState(key)?.isInvalidated;
h.captureDetailScope = [];
h.seed();
function Capture({slot,scope,observe}) {
  const status=useDealStatusChange(),rr=useAssignLeadRoundRobin(),cache=useLeadDetailPipelineCache();
  const captureDetailScope=useLeadDetailOperationScope(scope.leadId??'A',scope.org,scope.actor,client,scope.permission);
  h.captureDetailScope[slot]=captureDetailScope;
  useQuery({queryKey:boardKey(scope.org),enabled:observe,queryFn:()=>boardRequest(scope.org)});
  useQuery({queryKey:['lead',scope.org,'A'],enabled:observe,queryFn:async()=>(await leadsAPI.getLead('A',scope.org)).data});
  h.actions[slot]=(id,newStatus,key,extra={})=>{
    const params={leadId:id,newStatus,organizationId:scope.org,userId:'owner',propertyId:null,valorInteresse:100,
      commissionPercentage:5,leadName:id,authorizedLead:lead(id,scope.org),...extra};
    status.mutateAsync(params).then(data=>{h.outcomes[key]={success:true,data};},error=>{h.outcomes[key]={success:false,name:error.name,message:error.message};});
  };
  h.assign=(id,key)=>{rr.mutateAsync(id).then(data=>{h.outcomes[key]={success:true,data};},error=>{h.outcomes[key]={success:false,message:error.message};});};
  h.cache=cache; h.statusPending=status.isPending;
  return null;
}
function Related({scope,enabled}) {
  const query = kind => ({queryKey:[kind,scope.org],enabled,queryFn:async()=>(await relatedRequest(kind,scope.org)).data});
  useQuery(query('dashboard-stats'));useQuery(query('commissions'));useQuery(query('financial-dashboard'));useQuery(query('notifications'));
  return null;
}
function Fixture() {
  const [scope,setScope]=useState({org:'org-A',actor:'actor',sid:'sid-actor',tokenVersion:1,permission:true});
  const [observe,setObserve]=useState(false);
  const [showFirst,setShowFirst]=useState(true);
  const [related,setRelated]=useState(false);
  h.scope=scope;h.changeScope=patch=>setScope(current=>({...current,...patch,
    ...(patch.actor&&patch.actor!==current.actor&&patch.sid===undefined?{sid:'sid-'+patch.actor}:{})}));h.observe=()=>setObserve(true);h.unmountFirst=()=>setShowFirst(false);
  h.observeRelated=()=>{for(const kind of ['dashboard-stats','commissions','financial-dashboard','notifications','properties','home'])client.setQueryData([kind,scope.org],{count:0});setRelated(true);};
  const session={access_token:'header.'+btoa(JSON.stringify({sub:scope.actor,session_id:scope.sid,version:scope.tokenVersion}))+'.synthetic'};
  return <Auth.Provider value={{activeOrganization:{organizationId:scope.org},user:{id:scope.actor},session,hasPermission:()=>scope.permission}}>
    <QueryClientProvider client={client}>{showFirst&&<Capture slot={0} scope={scope} observe={observe}/>}<Capture slot={1} scope={scope} observe={false}/><Related scope={scope} enabled={related}/></QueryClientProvider>
  </Auth.Provider>;
}
createRoot(document.getElementById('app')).render(<Fixture/>);
`;

before(async () => {
  temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'vimob-pipeline-status-'));
  const stub = path.join(temporaryDirectory, 'synthetic.tsx'), entry = path.join(temporaryDirectory, 'fixture.tsx');
  const loader = path.join(temporaryDirectory, 'loader.cjs');
  await Promise.all([writeFile(stub, synthetic), writeFile(entry, fixture),
    writeFile(loader, `const ts=require(${JSON.stringify(path.join(root,'node_modules/typescript'))});module.exports=source=>ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;`)]);
  const aliases = Object.fromEntries(['contexts/AuthContext','hooks/use-user-permissions','lib/api/leads','lib/api/vimob-client','contexts/LeadRealtimeBus'].map(name=>['@/'+name+'$',stub]));
  const {webpack} = require('next/dist/compiled/webpack/webpack');
  await new Promise((resolve,reject)=>{
    const compiler=webpack({mode:'development',target:'web',devtool:false,entry,output:{path:temporaryDirectory,filename:'bundle.js'},
      resolve:{extensions:['.tsx','.ts','.js'],alias:{...aliases,'sonner$':stub,'@':root},modules:[path.join(root,'node_modules'),'node_modules']},
      module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:loader}]}});
    compiler.run((error,stats)=>compiler.close(()=>error||stats.hasErrors()?reject(error??new Error(stats.toString({all:false,errors:true}))):resolve()));
  });
  browser=await chromium.launch({headless:true});
});
beforeEach(async()=>{
  page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>route.request().url()==='https://pipeline-status.invalid/'?
    route.fulfill({contentType:'text/html',body:'<div id="app"></div>'}):route.abort());
  await page.goto('https://pipeline-status.invalid/');
  await page.addScriptTag({content:await readFile(path.join(temporaryDirectory,'bundle.js'),'utf8')});
  await page.waitForFunction(()=>window.harness.actions[1]);
});
afterEach(async()=>{await page?.close();});
after(async()=>{
  await browser?.close();
  if(temporaryDirectory){const target=path.resolve(temporaryDirectory);assert.equal(path.dirname(target),path.resolve(tmpdir()));assert(path.basename(target).startsWith('vimob-pipeline-status-'));await rm(target,{recursive:true,force:true});}
  assert.deepEqual(errors,[]);
});
async function start(id='A',status='won',key='a',slot=0,extra={}) {
  await page.evaluate(({id,status,key,slot,extra})=>window.harness.actions[slot](id,status,key,extra),{id,status,key,slot,extra});
}
async function requests(count){await page.waitForFunction(count=>window.harness.requests.length>=count,count);return page.evaluate(()=>window.harness.requests);}
async function resolve(index,patch={}){await page.evaluate(({index,patch})=>{const h=window.harness,r=h.requests[index];h.pending[index].resolve({...h.lead(r.id,r.org),...r.body,updated_at:'2026-10-12T10:01:00Z',...patch});},{index,patch});}

for(const patch of [{org:'org-B'},{actor:'other-actor'},{leadId:'B'},{permission:false}]) test('detail completion cannot act on a different committed scope: '+JSON.stringify(patch),async()=>{
  assert.equal(await page.evaluate(()=>{const h=window.harness;h.heldDetailScope=h.captureDetailScope[0]();return h.heldDetailScope.isCurrent();}),true);
  await page.evaluate(patch=>window.harness.changeScope(patch),patch);
  await page.waitForFunction(()=>!window.harness.heldDetailScope.isCurrent());
  assert.equal(await page.evaluate(()=>window.harness.heldDetailScope.isCurrent()),false);
});

test('returning to the previous organization does not revive an old detail operation',async()=>{
  await page.evaluate(()=>{const h=window.harness;h.heldDetailScope=h.captureDetailScope[0]();h.changeScope({org:'org-B'});});
  await page.waitForFunction(()=>window.harness.scope.org==='org-B'&&!window.harness.heldDetailScope.isCurrent());
  await page.evaluate(()=>window.harness.changeScope({org:'org-A'}));
  await page.waitForFunction(()=>window.harness.scope.org==='org-A');
  assert.equal(await page.evaluate(()=>window.harness.heldDetailScope.isCurrent()),false);
});

test('detail completion after popup unmount cannot update local UI or show a stale confirmation',async()=>{
  await page.evaluate(()=>{const h=window.harness;h.heldDetailScope=h.captureDetailScope[0]();h.unmountFirst();});
  await page.waitForFunction(()=>!window.harness.heldDetailScope.isCurrent());
  assert.equal(await page.evaluate(()=>window.harness.heldDetailScope.isCurrent()),false);
});
async function reject(index,status=409){await page.evaluate(({index,status})=>window.harness.pending[index].reject(status),{index,status});}
async function outcome(key='a'){await page.waitForFunction(key=>window.harness.outcomes[key],key);return page.evaluate(key=>window.harness.outcomes[key],key);}
async function state(status){return page.evaluate(status=>{const h=window.harness;return {board:h.read(h.boardKey('org-A',status)),detail:h.read(['lead','org-A','A']),toasts:h.toasts,signals:h.signals};},status);}
async function closePopup() {
  await page.evaluate(()=>{const h=window.harness;h.closingScope=h.captureDetailScope[0]();h.unmountFirst();});
  await page.waitForFunction(()=>!window.harness.closingScope.isCurrent());
}
async function changeScope(patch) {
  await page.evaluate(patch=>window.harness.changeScope(patch),patch);
  await page.waitForFunction(patch=>Object.entries(patch).every(([key,value])=>window.harness.scope[key]===value),patch);
}

test('authorized snapshot supplies the original server revision without an extra GET or optimistic revision',async()=>{
  await start();const r=await requests(1);assert.equal(r[0].kind,'patch');assert.equal(r[0].body.expectedUpdatedAt,'2026-10-12T10:00:00Z');
  assert.equal((await state()).detail.updated_at,r[0].body.expectedUpdatedAt);await resolve(0);assert.equal((await outcome()).success,true);
});
test('A rejection preserves B success across real concurrent status hooks',async()=>{
  await start();await requests(1);await start('B','lost','b',1,{lostReason:'Sem interesse'});await requests(2);
  await resolve(1);await outcome('b');await reject(0);await outcome();const s=await state();
  assert.equal(s.board[0].leads.find(l=>l.id==='A').deal_status,'open');assert.equal(s.board[0].leads.find(l=>l.id==='B').deal_status,'lost');
});
test('a rejection after the initiating popup unmounts still rolls back only A and preserves B success',async()=>{
  await start();await requests(1);await page.evaluate(()=>window.harness.unmountFirst());
  await start('B','lost','b',1,{lostReason:'Sem interesse'});await requests(2);await resolve(1);await outcome('b');await reject(0);await outcome();
  const s=await state();assert.equal(s.board[0].leads.find(l=>l.id==='A').deal_status,'open');assert.equal(s.board[0].leads.find(l=>l.id==='B').deal_status,'lost');
});
test('success after popup unmount still reconciles canonical A without announcing an old success',async()=>{
  await start();await requests(1);await page.evaluate(()=>window.harness.unmountFirst());
  await start('B','lost','b',1,{lostReason:'Sem interesse'});await requests(2);await resolve(1);await outcome('b');
  await resolve(0,{deal_status:'lost',lost_reason:'Normalizado no servidor'});await outcome();const s=await state();
  assert.equal(s.board[0].leads.find(l=>l.id==='A').lost_reason,'Normalizado no servidor');assert.equal(s.board[0].leads.find(l=>l.id==='B').deal_status,'lost');
  assert.equal(s.toasts.length,1);assert.equal(s.toasts[0].kind,'info');
});
test('normal close applies canonical status/reason/value to detail, list and board while preserving filtered counters without a toast',async()=>{
  await page.evaluate(()=>window.harness.seed('org-A','open'));await start();await requests(1);await closePopup();
  await resolve(0,{deal_status:'lost',lost_reason:'Canonical close reason',valor_interesse:125,lost_at:'2026-10-12T10:01:00Z'});await outcome();
  const s=await state(),filtered=await state('open');
  assert.equal(s.detail.deal_status,'lost');assert.equal(s.detail.lost_reason,'Canonical close reason');assert.equal(s.detail.valor_interesse,125);
  assert.equal(s.board[0].leads.find(row=>row.id==='A').lost_reason,'Canonical close reason');
  assert.equal(s.board[0].total_lead_count,2);assert.equal(s.board[0].total_value,425);
  assert.deepEqual(filtered.board[0].leads.map(row=>row.id),['B']);assert.equal(filtered.board[0].total_lead_count,1);assert.equal(filtered.board[0].total_value,300);
  assert.equal(await page.evaluate(()=>window.harness.read(['leads','org-A']).find(row=>row.id==='A').deal_status),'lost');assert.deepEqual(s.toasts,[]);
});
for(const newer of ['2026-10-12T10:02:00Z','2026-10-12T10:01:00.123457Z']) test('closed popup never overwrites a newer server read, including microseconds: '+newer,async()=>{
  await start();await requests(1);await closePopup();
  await page.evaluate(updatedAt=>{const h=window.harness,next={...h.lead('A'),deal_status:'lost',lost_reason:'Newer after close',valor_interesse:150,updated_at:updatedAt};
    h.write(['lead','org-A','A'],next);h.write(['leads','org-A'],[next,h.lead('B')]);h.write(h.boardKey(),h.board([next,h.lead('B')]));},newer);
  await resolve(0,{updated_at:'2026-10-12T10:01:00.123456Z',valor_interesse:999});await outcome();const s=await state();
  assert.equal(s.detail.updated_at,newer);assert.equal(s.detail.deal_status,'lost');assert.equal(s.detail.lost_reason,'Newer after close');
  assert.equal(s.board[0].leads[0].updated_at,newer);assert.equal(s.board[0].total_value,450);assert.deepEqual(s.toasts,[]);
});
test('a newer board-only read after close keeps its revision and aggregate when the detail response is older',async()=>{
  await start();await requests(1);await closePopup();
  await page.evaluate(()=>{const h=window.harness,next={...h.lead('A'),deal_status:'lost',lost_reason:'Board newer',valor_interesse:175,updated_at:'2026-10-12T10:01:00.123457Z'};
    return h.fetchBoard('org-A',undefined,h.board([next,h.lead('B')]));});
  await resolve(0,{updated_at:'2026-10-12T10:01:00.123456Z',valor_interesse:999});await outcome();const s=await state();
  assert.equal(s.board[0].leads[0].updated_at,'2026-10-12T10:01:00.123457Z');assert.equal(s.board[0].leads[0].lost_reason,'Board newer');
  assert.equal(s.board[0].total_value,475);assert.equal(s.board[0].total_lead_count,2);assert.deepEqual(s.toasts,[]);
});
test('an authoritative filtered absence after close is not undone by an older successful response',async()=>{
  await page.evaluate(()=>window.harness.seed('org-A','open'));await start();await requests(1);await closePopup();
  await page.evaluate(()=>{const h=window.harness;return h.fetchBoard('org-A','open',h.board([h.lead('B')]));});
  await resolve(0,{deal_status:'open'});await outcome();const s=await state('open');
  assert.deepEqual(s.board[0].leads.map(row=>row.id),['B']);assert.equal(s.board[0].total_lead_count,1);assert.equal(s.board[0].total_value,300);assert.deepEqual(s.toasts,[]);
});
for(const replacement of [{org:'org-B'},{actor:'other-actor'},{sid:'sid-replacement'},{permission:false}]) test('an observed access replacement before close forbids late cache reconciliation: '+JSON.stringify(replacement),async()=>{
  await start();await requests(1);await changeScope(replacement);await closePopup();
  await page.evaluate(()=>{const h=window.harness,org=h.scope.org,next={...h.lead('A',org),name:'New access snapshot',updated_at:'2026-10-12T10:00:00.000001Z'};
    h.write(['lead',org,'A'],next);h.write(h.boardKey(org),h.board([next,h.lead('B',org)]));});
  const before=await page.evaluate(()=>{const h=window.harness,org=h.scope.org;return {detail:h.read(['lead',org,'A']),board:h.read(h.boardKey(org)),originalDetail:h.read(['lead','org-A','A']),originalBoard:h.read(h.boardKey())};});
  await resolve(0,{deal_status:'lost',lost_reason:'Retired access'});await outcome();
  const after=await page.evaluate(()=>{const h=window.harness,org=h.scope.org;return {detail:h.read(['lead',org,'A']),board:h.read(h.boardKey(org)),originalDetail:h.read(['lead','org-A','A']),originalBoard:h.read(h.boardKey())};});
  assert.deepEqual(after,before);assert.deepEqual((await state()).toasts,[]);assert.deepEqual((await state()).signals,[]);
});
for(const replacement of [{org:'org-B'},{actor:'other-actor'},{sid:'sid-replacement'},{permission:false}]) test('returning to access A before close cannot revive an old status result: '+JSON.stringify(replacement),async()=>{
  await start();await requests(1);await changeScope(replacement);await changeScope({org:'org-A',actor:'actor',sid:'sid-actor',permission:true});await closePopup();
  await page.evaluate(()=>{const h=window.harness,next={...h.lead('A'),name:'Second access visit',updated_at:'2026-10-12T10:00:00.000001Z'};
    h.write(['lead','org-A','A'],next);h.write(h.boardKey(),h.board([next,h.lead('B')]));});
  const before=await state();await resolve(0,{deal_status:'lost',lost_reason:'Old visit result'});await outcome();const after=await state();
  assert.deepEqual(after.detail,before.detail);assert.deepEqual(after.board,before.board);assert.deepEqual(after.toasts,[]);assert.deepEqual(after.signals,[]);
});
for(const replacement of [{actor:'other-actor'},{sid:'sid-replacement'}]) test('actor or SID replacement after a normal close still forbids late cache writes: '+JSON.stringify(replacement),async()=>{
  await start();await requests(1);await closePopup();await changeScope(replacement);
  await page.evaluate(()=>{const h=window.harness,next={...h.lead('A'),name:'New closed access',updated_at:'2026-10-12T10:00:00.000001Z'};
    h.write(['lead','org-A','A'],next);h.write(h.boardKey(),h.board([next,h.lead('B')]));});
  const before=await state();await resolve(0,{deal_status:'lost',lost_reason:'Old session result'});await outcome();const after=await state();
  assert.deepEqual(after.detail,before.detail);assert.deepEqual(after.board,before.board);assert.deepEqual(after.toasts,[]);assert.deepEqual(after.signals,[]);
});
test('a token refresh in the same SID allows normal-close reconciliation without an old toast',async()=>{
  await start();await requests(1);await closePopup();await changeScope({tokenVersion:2});
  await resolve(0,{deal_status:'lost',lost_reason:'Same SID refreshed'});await outcome();const s=await state();
  assert.equal(s.detail.lost_reason,'Same SID refreshed');assert.equal(s.board[0].leads[0].deal_status,'lost');assert.deepEqual(s.toasts,[]);
});
test('unmount during authorization preflight prevents starting a new write',async()=>{
  await start('A','won','a',0,{authorizedLead:null});await requests(1);await page.evaluate(()=>window.harness.unmountFirst());
  await resolve(0);await outcome();assert.equal((await requests(1)).length,1);assert.equal((await state()).detail.deal_status,'open');
});
test('filtered removal changes count/value and rollback restores only A after B succeeds',async()=>{
  await page.evaluate(()=>window.harness.seed('org-A','open'));await start();await requests(1);
  let s=await state('open');assert.equal(s.board[0].total_lead_count,1);assert.equal(s.board[0].total_value,300);
  await start('B','lost','b',1,{lostReason:'Sem interesse'});await requests(2);await resolve(1);await outcome('b');await reject(0);await outcome();
  s=await state('open');assert.deepEqual(s.board[0].leads.map(l=>l.id),['A']);assert.equal(s.board[0].total_lead_count,1);assert.equal(s.board[0].total_value,100);
});
test('same-lead realtime with a newer server revision survives rejection',async()=>{
  await start();await requests(1);await page.evaluate(()=>{const h=window.harness,next={...h.lead('A'),deal_status:'lost',lost_reason:'Outra sessão',updated_at:'2026-10-12T10:02:00Z'};
    h.write(['lead','org-A','A'],next);h.write(h.boardKey(),h.board([next,h.lead('B')]));});
  await reject(0);await outcome();const s=await state();assert.equal(s.detail.deal_status,'lost');assert.equal(s.board[0].leads[0].lost_reason,'Outra sessão');
});
test('authoritative refetch absence is preserved instead of reinserting a filtered optimistic removal',async()=>{
  await page.evaluate(()=>window.harness.seed('org-A','open'));await start();await requests(1);
  await page.evaluate(()=>{const h=window.harness;return h.fetchBoard('org-A','open',h.board([h.lead('B')]));});
  await reject(0);await outcome();assert.deepEqual((await state('open')).board[0].leads.map(l=>l.id),['B']);
});
test('duplicate mutation of the same org/lead is rejected while another hook is pending',async()=>{
  await start();await requests(1);await start('A','lost','duplicate',1,{lostReason:'Sem interesse'});
  assert.equal((await outcome('duplicate')).success,false);assert.equal((await requests(1)).length,1);await resolve(0);await outcome();
});
test('a successful older response also preserves the newer same-lead server state in its result',async()=>{
  await start();await requests(1);await page.evaluate(()=>{const h=window.harness,next={...h.lead('A'),deal_status:'lost',lost_reason:'Mais recente',updated_at:'2026-10-12T10:02:00Z'};
    h.write(['lead','org-A','A'],next);h.write(h.boardKey(),h.board([next,h.lead('B')]));});
  await resolve(0);const result=await outcome();assert.equal(result.data.newStatus,'lost');assert.equal((await state()).board[0].leads[0].lost_reason,'Mais recente');
});

test('an older success preserves a realtime revision only one microsecond newer',async()=>{
  await start();await requests(1);await page.evaluate(()=>{const h=window.harness,next={...h.lead('A'),deal_status:'lost',lost_reason:'Microssegundo mais recente',updated_at:'2026-10-12T10:01:00.123457Z'};
    h.write(['lead','org-A','A'],next);h.write(h.boardKey(),h.board([next,h.lead('B')]));});
  await resolve(0,{updated_at:'2026-10-12T10:01:00.123456Z'});const result=await outcome();
  assert.equal(result.data.newStatus,'lost');const s=await state();
  assert.equal(s.detail.updated_at,'2026-10-12T10:01:00.123457Z');
  assert.equal(s.board[0].leads[0].lost_reason,'Microssegundo mais recente');
});
test('success uses canonical status and clears canonical empty tags',async()=>{
  await start();await requests(1);await resolve(0,{deal_status:'lost',lost_reason:'Servidor',tags:[]});
  const result=await outcome();assert.equal(result.data.newStatus,'lost');const s=await state();assert.equal(s.detail.deal_status,'lost');assert.deepEqual(s.detail.tags,[]);
});
test('omitted legacy tags preserve the current cached collection after success',async()=>{
  await start();await requests(1);await page.evaluate(()=>{const h=window.harness,next={...h.lead('A'),deal_status:'won',updated_at:'2026-10-12T10:01:00Z'};delete next.tags;h.pending[0].resolve(next);});
  await outcome();assert.deepEqual((await state()).detail.tags.map(t=>t.id),['tag']);
});
for(const clear of [false,true]) test('canonical null assignee clears while an omitted relation is preserved: '+clear,async()=>{
  await page.evaluate(()=>{const h=window.harness,a={...h.lead('A'),assignee:{id:'owner',name:'Owner'}};
    h.write(['lead','org-A','A'],a);h.write(h.boardKey(),h.board([a,h.lead('B')]));});
  await start();await requests(1);await resolve(0,clear?{assignee:null}:{});await outcome();
  assert.equal((await state()).detail.assignee?.name,clear?undefined:'Owner');
});
test('transport uncertainty confirmed by a fresh read becomes success',async()=>{
  await start();await requests(1);await reject(0,0);assert.equal((await requests(2))[1].kind,'get');
  await resolve(1,{deal_status:'won'});assert.equal((await outcome()).success,true);assert.equal((await state()).toasts.some(t=>t.kind==='error'),false);
});
test('a status success refreshes active dashboard/financial/notification observers while inactive caches make no request',async()=>{
  await page.evaluate(()=>window.harness.observeRelated());await start();await requests(1);await resolve(0);await outcome();
  const r=await requests(5);assert.deepEqual(r.slice(1).map(item=>item.kind).sort(),['commissions','dashboard-stats','financial-dashboard','notifications']);
  await page.evaluate(()=>{const h=window.harness;for(let i=1;i<h.requests.length;i++)h.pending[i].resolve({count:1});});
  await page.waitForFunction(()=>window.harness.read(['commissions','org-A']).count===1);
  assert.equal(await page.evaluate(()=>window.harness.read(['properties','org-A']).count),0);assert.equal((await requests(5)).length,5);
});
test('transport uncertainty without a confirming read does not claim the write failed',async()=>{
  await start();await requests(1);await reject(0,0);await requests(2);await reject(1,503);
  assert.equal((await outcome()).name,'LeadStatusOutcomeUncertainError');const s=await state();assert.equal(s.toasts.some(t=>t.kind==='warning'),true);assert.equal(s.toasts.some(t=>t.kind==='error'),false);
});
test('late old-org completion cannot rewrite or announce success in the newly selected organization',async()=>{
  await page.evaluate(()=>window.harness.seed('org-B'));await start();await requests(1);
  await page.evaluate(()=>window.harness.changeScope({org:'org-B'}));await page.waitForFunction(()=>window.harness.scope.org==='org-B');
  await resolve(0);await outcome();assert.equal(await page.evaluate(()=>window.harness.read(['lead','org-B','A']).deal_status),'open');assert.deepEqual((await state()).signals,[]);
});
test('old-org parameters and unauthorized snapshots produce no PATCH',async()=>{
  await start('A','won','scope',0,{organizationId:'org-B'});assert.equal((await outcome('scope')).success,false);
  await start('A','won','denied',0,{authorizedLead:{id:'A',organization_id:'org-A',can_operate:false}});assert.equal((await outcome('denied')).success,false);
  assert.equal((await page.evaluate(()=>window.harness.requests)).length,0);
});

test('current lead permission denial rejects an authorized snapshot without a read or write',async()=>{
  await page.evaluate(()=>window.harness.changeScope({permission:false}));
  await page.waitForFunction(()=>window.harness.scope.permission===false);
  await start();assert.equal((await outcome()).success,false);
  assert.equal(await page.evaluate(()=>window.harness.requests.length),0);
  assert.equal((await state()).detail.deal_status,'open');
});

test('permission revoked during the authorization GET prevents the subsequent PATCH',async()=>{
  await start('A','won','a',0,{authorizedLead:null});await requests(1);
  await page.evaluate(()=>window.harness.changeScope({permission:false}));
  await page.waitForFunction(()=>window.harness.scope.permission===false);
  await resolve(0);assert.equal((await outcome()).success,false);
  assert.equal((await requests(1)).length,1);
  assert.equal((await state()).detail.deal_status,'open');
});
test('legacy consumer without a snapshot reads permission and server revision before PATCH',async()=>{
  await start('A','won','a',0,{authorizedLead:null});assert.equal((await requests(1))[0].kind,'get');await resolve(0,{updated_at:'2026-10-12T10:03:00Z'});
  const r=await requests(2);assert.equal(r[1].body.expectedUpdatedAt,'2026-10-12T10:03:00Z');await resolve(1,{updated_at:'2026-10-12T10:04:00Z'});await outcome();
});
test('wrong-org/id preflight response cannot authorize or cache a write',async()=>{
  await start('A','won','a',0,{authorizedLead:null});await requests(1);await resolve(0,{id:'other',organization_id:'org-B'});
  assert.equal((await outcome()).success,false);assert.equal((await requests(1)).length,1);assert.equal((await state()).detail.deal_status,'open');
});
test('scope changed during permission preflight prevents the subsequent PATCH',async()=>{
  await start('A','won','a',0,{authorizedLead:null});await requests(1);await page.evaluate(()=>window.harness.changeScope({org:'org-B'}));
  await page.waitForFunction(()=>window.harness.scope.org==='org-B');await resolve(0);await outcome();assert.equal((await requests(1)).length,1);
});
for(const patch of [{actor:'other-actor'},{permission:false}]) test('actor/permission changes during preflight prevent the PATCH: '+JSON.stringify(patch),async()=>{
  await start('A','won','a',0,{authorizedLead:null});await requests(1);await page.evaluate(patch=>window.harness.changeScope(patch),patch);
  await page.waitForFunction(patch=>Object.entries(patch).every(([key,value])=>window.harness.scope[key]===value),patch);
  await resolve(0);await outcome();assert.equal((await requests(1)).length,1);assert.deepEqual((await state()).signals,[]);
});
test('popup tag rollback preserves another lead and its server revision without inventing timestamps',async()=>{
  await page.evaluate(()=>{const h=window.harness;h.tagSnapshot=h.cache.updatePipelineLeadCache('A',{tags:[]});h.cache.updatePipelineLeadCache('B',{name:'Changed',updated_at:'2026-10-12T10:02:00Z'});
    h.cache.restorePipelineCache(h.tagSnapshot);});
  const s=await state();assert.deepEqual(s.board[0].leads[0].tags.map(t=>t.id),['tag']);assert.equal(s.board[0].leads[0].updated_at,'2026-10-12T10:00:00Z');assert.equal(s.board[0].leads[1].name,'Changed');
});
test('popup tag rollback preserves a newer same-lead realtime collection',async()=>{
  await page.evaluate(()=>{const h=window.harness,snapshot=h.cache.updatePipelineLeadCache('A',{tags:[]});h.cache.updatePipelineLeadCache('A',{tags:[{id:'new',name:'New',color:'#222222'}],updated_at:'2026-10-12T10:02:00Z'});h.cache.restorePipelineCache(snapshot);});
  assert.deepEqual((await state()).board[0].leads[0].tags.map(t=>t.id),['new']);
});
test('RR already_assigned refetches observed board and org-scoped detail and emits reconciliation',async()=>{
  await page.evaluate(()=>{window.harness.seed('org-B');window.harness.observe();});
  await page.evaluate(()=>window.harness.assign('A','rr'));await requests(1);
  await page.evaluate(()=>window.harness.pending[0].resolve({success:false,lead_id:'A',assigned_user_id:'assigned',error:'already_assigned'}));
  await outcome('rr');const r=await requests(3);assert.deepEqual(r.map(x=>x.kind).sort(),['board','get','rr']);assert(r.every(x=>x.org==='org-A'));
  assert.equal((await state()).signals[0].reason,'lead.assigned');assert.equal(await page.evaluate(()=>window.harness.invalid(['lead','org-B','A'])),false);
});
test('RR completion after organization switch does not invalidate or notify the new tenant',async()=>{
  await page.evaluate(()=>{window.harness.seed('org-B');window.harness.assign('A','rr');});await requests(1);
  await page.evaluate(()=>window.harness.changeScope({org:'org-B'}));await page.waitForFunction(()=>window.harness.scope.org==='org-B');
  await page.evaluate(()=>window.harness.pending[0].resolve({success:false,lead_id:'A',assigned_user_id:'assigned',error:'already_assigned'}));await outcome('rr');
  assert.deepEqual((await state()).signals,[]);assert.equal(await page.evaluate(()=>window.harness.invalid(['lead','org-B','A'])),false);
});
