import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(`${root}/package.json`),ts=require('typescript');
const {QueryClient,InfiniteQueryObserver}=require('@tanstack/react-query');
const modules=new Map();
function load(relative){
 if(modules.has(relative))return modules.get(relative).exports;
 const m={exports:{}};modules.set(relative,m);
 const src=ts.transpileModule(readFileSync(`${root}/${relative}`,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','module','exports',src)(name=>name.startsWith('@/')?load(name.slice(2)+'.ts'):require(name),m,m.exports);return m.exports;
}
const {createQueryDataTrustStore}=load('lib/query-data-trust.ts');
const denied=()=>Object.assign(Error('synthetic denied'),{status:403,code:'permission_denied'});
const unavailable=()=>Object.assign(Error('synthetic unavailable'),{status:503,code:'api_unavailable'});
function fixture(){
 const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}}),key=['synthetic','org-a'];
 const query=client.getQueryCache().build(client,{queryKey:key});
 const store=createQueryDataTrustStore(client,query,'actor-a:org-a');let dispose=store.subscribe(()=>{});
 const fetch=(fn,extra={})=>client.fetchQuery({queryKey:key,queryFn:fn,staleTime:0,...extra}).catch(()=>{});
 return{client,key,query,store,fetch,unsub(){dispose()},sub(){dispose=store.subscribe(()=>{})},close(){dispose();client.clear()}};
}
test('denial survives transient/manual data; genuine success restores',async()=>{
 const f=fixture();try{
  await f.fetch(async()=>({private:'A'}));assert.equal(f.store.getSnapshot(),'trusted');
  await f.fetch(async()=>{throw denied()});assert.equal(f.store.getSnapshot(),'blocked');
  await f.fetch(async()=>{throw unavailable()});assert.equal(f.store.getSnapshot(),'blocked');
  f.client.setQueryData(f.key,{private:'manual'});assert.equal(f.store.getSnapshot(),'blocked');
  await f.fetch(async()=>({private:'B'}));assert.equal(f.store.getSnapshot(),'trusted');
 }finally{f.close()}
});
test('first denial plus cancel while subscribed stays blocked',async()=>{
 const f=fixture();try{
  await f.fetch(async()=>({private:'A'}));let release;const seen=new Promise(r=>release=r);
  const off=f.client.getQueryCache().subscribe(e=>{if(e.type==='updated'&&e.action.type==='failed')release()});
  const work=f.fetch(async()=>{throw denied()},{retry:1,retryDelay:100});await seen;
  await f.client.cancelQueries({queryKey:f.key,exact:true});await work;off();
  assert.equal(f.query.state.status,'success');assert.equal(f.store.getSnapshot(),'blocked');
 }finally{f.close()}
});
test('unobserved denied attempt plus revert must not trust old data on remount',async()=>{
 const f=fixture();try{
  await f.fetch(async()=>({private:'A'}));f.unsub();let release;const seen=new Promise(r=>release=r);
  const off=f.client.getQueryCache().subscribe(e=>{if(e.type==='updated'&&e.action.type==='failed')release()});
  const work=f.fetch(async()=>{throw denied()},{retry:1,retryDelay:100});await seen;
  await f.client.cancelQueries({queryKey:f.key,exact:true});await work;off();f.sub();
  assert.equal(f.query.state.dataUpdateCount,1);assert.equal(f.query.state.errorUpdateCount,0);
  assert.equal(f.store.getSnapshot(),'blocked');
 }finally{f.close()}
});
test('infinite next-page success cannot authorize old pages',async()=>{
 const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}}),key=['pages','org-a'];
 let mode='ok',version=1;const observer=new InfiniteQueryObserver(client,{queryKey:key,enabled:false,initialPageParam:0,getNextPageParam:p=>p.next,queryFn:async({pageParam})=>{if(mode==='deny')throw denied();return{value:`${pageParam}-v${version}`,next:pageParam+1}}});
 const offObserver=observer.subscribe(()=>{}),q=client.getQueryCache().find({queryKey:key,exact:true}),store=createQueryDataTrustStore(client,q,'actor-a:org-a'),off=store.subscribe(()=>{});
 try{await observer.refetch();assert.equal(store.getSnapshot(),'trusted');mode='deny';await observer.refetch();assert.equal(store.getSnapshot(),'blocked');mode='ok';version=2;await observer.fetchNextPage();assert.equal(store.getSnapshot(),'blocked');await observer.refetch();assert.equal(store.getSnapshot(),'trusted');}
 finally{off();offObserver();client.clear()}
});
test('two organizations on one client keep trust independent',async()=>{
 const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});
 const keys=[['synthetic','org-a'],['synthetic','org-b']];
 const queries=keys.map(queryKey=>client.getQueryCache().build(client,{queryKey}));
 const stores=queries.map((q,i)=>createQueryDataTrustStore(client,q,`actor:org-${i}`));
 const offs=stores.map(s=>s.subscribe(()=>{}));
 try{
  for(let i=0;i<2;i++)await client.fetchQuery({queryKey:keys[i],queryFn:async()=>({org:i})});
  await client.fetchQuery({queryKey:keys[0],queryFn:async()=>{throw denied()},staleTime:0}).catch(()=>{});
  assert.equal(stores[0].getSnapshot(),'blocked');assert.equal(stores[1].getSnapshot(),'trusted');
 }finally{offs.forEach(off=>off());client.clear()}
});
test('scope A-B-A rejects an in-flight success captured before both transitions',async()=>{
 const f=fixture();let release;const gate=new Promise(r=>release=r);
 try{
  const work=f.fetch(async()=>{await gate;return {private:'old-A'}});
  f.unsub();const b=createQueryDataTrustStore(f.client,f.query,'actor-b:org-a'),offB=b.subscribe(()=>{});
  offB();const a=createQueryDataTrustStore(f.client,f.query,'actor-a:org-a'),offA=a.subscribe(()=>{});
  release();await work;assert.equal(a.getSnapshot(),'blocked');
  await f.fetch(async()=>({private:'new-A'}));assert.equal(a.getSnapshot(),'trusted');offA();
 }finally{release();f.client.clear()}
});
test('fresh tracked remount preserves trust without a new request',async()=>{
 const f=fixture();try{await f.fetch(async()=>({private:'A'}));const count=f.query.state.dataUpdateCount;f.unsub();f.sub();assert.equal(f.store.getSnapshot(),'trusted');assert.equal(f.query.state.dataUpdateCount,count);}finally{f.close()}
});
test('late opt-in after terminal denial and manual write requires authorized recovery',async()=>{
 const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}}),key=['late','org-a'];let off=()=>{};
 try{
  await client.fetchQuery({queryKey:key,queryFn:async()=>({private:'A'})});
  await client.fetchQuery({queryKey:key,queryFn:async()=>{throw denied()},staleTime:0}).catch(()=>{});
  client.setQueryData(key,{private:'manual'});const q=client.getQueryCache().find({queryKey:key,exact:true});assert.equal(q.state.status,'success');
  const store=createQueryDataTrustStore(client,q,'actor:org-a');off=store.subscribe(()=>{});assert.equal(store.getSnapshot(),'blocked');
  await client.fetchQuery({queryKey:key,queryFn:async()=>({private:'new'}),staleTime:0});assert.equal(store.getSnapshot(),'trusted');
 }finally{off();client.clear()}
});
test('batched notification delivery does not lose denial then transient error',async()=>{
 const f=fixture();try{
  await f.fetch(async()=>({private:'A'}));await f.fetch(async()=>{throw denied()});await f.fetch(async()=>{throw unavailable()});
  // No render/getSnapshot happened between these two error transitions.
  assert.equal(f.store.getSnapshot(),'blocked');
 }finally{f.close()}
});

test('removed query stays blocked while its independently fetched replacement can display',async()=>{
 const f=fixture();let off=()=>{};
 try{
  await f.fetch(async()=>({private:'A'}));f.client.removeQueries({queryKey:f.key,exact:true});
  assert.equal(f.store.getSnapshot(),'blocked');
  await f.fetch(async()=>({private:'authorized replacement'}));
  const replacement=f.client.getQueryCache().find({queryKey:f.key,exact:true});assert.notEqual(replacement,f.query);
  const next=createQueryDataTrustStore(f.client,replacement,'actor-a:org-a');off=next.subscribe(()=>{});
  assert.equal(next.getSnapshot(),'trusted');assert.equal(f.store.getSnapshot(),'blocked');
 }finally{off();f.close()}
});
for(const failure of [{status:401,code:'missing_session'},{status:503,code:'session_check_unavailable'}])test(`access denial ${failure.status}/${failure.code} survives ordinary 503`,async()=>{
 const f=fixture();try{await f.fetch(async()=>({private:'A'}));await f.fetch(async()=>{throw Object.assign(Error('synthetic'),failure)});await f.fetch(async()=>{throw unavailable()});assert.equal(f.store.getSnapshot(),'blocked');await f.fetch(async()=>({private:'B'}));assert.equal(f.store.getSnapshot(),'trusted');}finally{f.close()}
});
test('identical keys on separate clients cannot transfer trust or denial',async()=>{
 const a=fixture(),b=fixture();try{await a.fetch(async()=>({private:'A'}));await b.fetch(async()=>({private:'B'}));await a.fetch(async()=>{throw denied()});assert.equal(a.store.getSnapshot(),'blocked');assert.equal(b.store.getSnapshot(),'trusted');assert.equal(b.query.state.data.private,'B');}finally{a.close();b.close()}
});
test('scope B cannot accept completion of a fetch started by A',async()=>{
 const f=fixture();let release,offB=()=>{};const gate=new Promise(r=>release=r);
 try{const old=f.fetch(async()=>{await gate;return{private:'old-A'}});f.unsub();const b=createQueryDataTrustStore(f.client,f.query,'actor-b:org-a');offB=b.subscribe(()=>{});release();await old;assert.equal(b.getSnapshot(),'blocked');await f.fetch(async()=>({private:'new-B'}));assert.equal(b.getSnapshot(),'trusted');}finally{release();offB();f.client.clear()}
});
test('one retained cache listener is removed when tracked queries are cleared',async()=>{
 const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}}),cache=client.getQueryCache();
 const initial=cache.listeners.size,qs=[0,1,2].map(i=>cache.build(client,{queryKey:['cleanup',i]}));
 const stores=qs.map(q=>createQueryDataTrustStore(client,q,'same-scope')),offs=stores.map(s=>s.subscribe(()=>{}));
 assert.equal(cache.listeners.size,initial+1);offs.forEach(off=>off());assert.equal(cache.listeners.size,initial+1,'history remains while queries live');
 client.clear();assert.equal(cache.listeners.size,initial);stores.forEach(s=>assert.equal(s.getSnapshot(),'blocked'));
 const q=cache.build(client,{queryKey:['cleanup',0]}),s=createQueryDataTrustStore(client,q,'new-scope'),off=s.subscribe(()=>{});
 assert.equal(cache.listeners.size,initial+1);off();client.clear();assert.equal(cache.listeners.size,initial);
});


test('first opt-in preserves a fresh successful cache populated by another consumer',async()=>{
 const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}}),key=['catalog','org-a'];let calls=0;
 try{await client.fetchQuery({queryKey:key,queryFn:async()=>{calls++;return {name:'Authorized catalog'}}});
 const q=client.getQueryCache().find({queryKey:key,exact:true});const store=createQueryDataTrustStore(client,q,'actor:org-a');const off=store.subscribe(()=>{});
 assert.equal(store.getSnapshot(),'trusted');assert.equal(calls,1);off();}finally{client.clear()}
});
test('ordinary 503 preserves previously authorized data and the original error',async()=>{
 const f=fixture();try{await f.fetch(async()=>({private:'A'}));const error=unavailable();await f.fetch(async()=>{throw error});
 assert.equal(f.store.getSnapshot(),'trusted');assert.equal(f.query.state.error,error);assert.deepEqual(f.query.state.data,{private:'A'});}finally{f.close()}
});

test('first observed transient error without data is not an access denial',async()=>{
 const f=fixture();try{const error=unavailable();await f.fetch(async()=>{throw error});
 assert.equal(f.store.getSnapshot(),'pending');assert.equal(f.query.state.error,error);assert.equal(f.query.state.data,undefined);
 await f.fetch(async()=>{throw denied()});assert.equal(f.store.getSnapshot(),'blocked');
 await f.fetch(async()=>{throw unavailable()});assert.equal(f.store.getSnapshot(),'blocked');}finally{f.close()}
});
