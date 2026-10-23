import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from '@playwright/test';

// Actual API, Zod schemas, React/QueryClient and hooks. Only auth + HTTP transport
// are synthetic; all external network attempts fail and are counted.
const repository=process.cwd(), require=createRequire(import.meta.url);
const {webpack}=require('next/dist/compiled/webpack/webpack.js');
let directory,browser,bundle;
const item=(n=1,shortcut='visita',content='  Linha um\nLinha dois  ')=>(
  {id:`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,shortcut,content,created_at:'2026-10-14T10:00:00Z',updated_at:'2026-10-14T10:00:00Z'});
before(async()=>{
  directory=await mkdtemp(join(tmpdir(),'vimob-wa-personal-replies-'));
  const aliases={};
  const mock=async(name,code)=>{const file=join(directory,`mock-${Object.keys(aliases).length}.js`);await writeFile(file,code);aliases[name]=file;};
  await mock('@/contexts/AuthContext','export const useAuth=()=>({session:window.h.session});');
  await mock('@/hooks/use-whatsapp-query-scope','export const useWhatsAppQueryScope=()=>window.h.scope;');
  await mock('@/lib/auth/global-sign-out','export const getGlobalSignOutSessionId=session=>session?.sid??null;');
  await mock('@/lib/api/vimob-client',`export const getVimobAPIAccessTokenUserId=()=>window.h.token.user;
    export const getVimobAPIAccessTokenSessionId=()=>window.h.token.sid;
    export const vimobAPIRequest=(path,options)=>window.h.request(path,options);`);
  const loader=join(directory,'loader.cjs'),entry=join(directory,'entry.js');
  await writeFile(loader,`const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;`);
  await writeFile(entry,`import React from'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
    import{QueryClient,QueryClientProvider}from'@tanstack/react-query';
    import{useWhatsAppQuickReplies,useCreateWhatsAppQuickReply,useUpdateWhatsAppQuickReply,useDeleteWhatsAppQuickReply,useWhatsAppQuickReplyScope}from'@/hooks/whatsapp/use-whatsapp-quick-replies';
    import{whatsappQuickRepliesAPI}from'@/lib/api/whatsapp-quick-replies';
    import{whatsAppQuickReplyInputSchema}from'@/lib/validation/whatsapp-quick-replies';
    const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity},mutations:{retry:false}}});
    const root=createRoot(document.getElementById('root'));
    const h=window.h={client,api:whatsappQuickRepliesAPI,schema:whatsAppQuickReplyInputSchema,requests:[],outcomes:{},callbacks:[],views:[],enabled:false,
      scope:{organizationId:'org-A',userId:'owner-A',accessScope:'own+sid-A'},session:{sid:'sid-A'},token:{user:'owner-A',sid:'sid-A'},ignoreAbort:false,
      request(path,options){return new Promise((resolve,reject)=>{const r={path,...options,aborted:false,resolve,reject};h.requests.push(r);
        const abort=()=>{r.aborted=true;if(!h.ignoreAbort)reject(new DOMException('Aborted','AbortError'));};if(options.signal?.aborted)abort();else options.signal?.addEventListener('abort',abort,{once:true});});},
      render(patch={}){Object.assign(h,patch);flushSync(()=>root.render(React.createElement(QueryClientProvider,{client},React.createElement(h.strict?React.StrictMode:React.Fragment,null,React.createElement(View)))));},
      run(kind,input,key='op',callbacks=true){const options=callbacks?{onSuccess:()=>h.callbacks.push(key+'success'),onError:()=>h.callbacks.push(key+'error'),onSettled:()=>h.callbacks.push(key+'settled')}:undefined;
        h.actions[kind].mutateAsync(input,options).then(data=>h.outcomes[key]={ok:true,data},error=>h.outcomes[key]={ok:false,name:error.name,status:error.status,code:error.code,message:error.message});},
      read(){return h.client.getQueryCache().getAll().map(q=>({key:q.queryKey,data:q.state.data,invalid:q.state.isInvalidated}));},
      unmount(){flushSync(()=>root.render(null));},
    };
    function View(){const list=useWhatsAppQuickReplies(h.enabled),create=useCreateWhatsAppQuickReply(),update=useUpdateWhatsAppQuickReply(),remove=useDeleteWhatsAppQuickReply(),scope=useWhatsAppQuickReplyScope();
      React.useLayoutEffect(()=>{h.actions={create,update,remove};h.views={data:list.data,error:list.error&&{message:list.error.message,status:list.error.status},status:list.status,scope,
        create:{data:create.data,error:create.error?.message,failure:create.failureReason?.message,isPending:create.isPending,status:create.status}};});return React.createElement('div',null,'Personal replies');}
    h.render();`);
  await new Promise((done,reject)=>{const compiler=webpack({mode:'development',target:'web',entry,output:{path:directory,filename:'fixture.js',publicPath:''},
    resolve:{extensions:['.ts','.tsx','.js'],modules:[join(repository,'node_modules'),'node_modules'],alias:{...aliases,'@':repository}},
    module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:loader}]}});compiler.run((error,stats)=>compiler.close(()=>error?reject(error):stats.hasErrors()?reject(new Error(stats.toString({all:false,errors:true}))):done()));});
  bundle=await readFile(join(directory,'fixture.js'),'utf8');browser=await chromium.launch({headless:true});
},{timeout:90_000});
after(async()=>{await browser?.close();if(directory){const target=resolve(directory);assert.ok(target.startsWith(resolve(tmpdir())+sep));assert.match(basename(target),/^vimob-wa-personal-replies-/);await rm(target,{recursive:true,force:true});}});
async function open(t){const page=await browser.newPage();page.setDefaultTimeout(4000);const errors=[],network=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>{network.push(r.request().url());return r.abort();});t.after(async()=>{await page.close();assert.deepEqual(errors,[]);assert.deepEqual(network,[]);});
  await page.setContent('<div id="root"></div>');await page.evaluate(()=>window.process={env:{NODE_ENV:'development'}});await page.addScriptTag({content:bundle});return page;}
const render=(page,patch)=>page.evaluate(p=>h.render(p),patch);
const waitRequests=(page,n)=>page.waitForFunction(n=>h.requests.length===n,n);
const resolveRequest=(page,index,data)=>page.evaluate(({index,data})=>h.requests[index].resolve({data}),{index,data});
const run=(page,kind,input,key)=>page.evaluate(({kind,input,key})=>h.run(kind,input,key),{kind,input,key});
const waitOutcome=(page,key='op')=>page.waitForFunction(key=>!!h.outcomes[key],key);
const switchOwner=async(page,owner='B',org='org-A',sid='sid-B')=>render(page,{scope:{organizationId:org,userId:'owner-'+owner,accessScope:'own+'+sid},session:{sid},token:{user:'owner-'+owner,sid}});

test('strict inputs normalize ASCII shortcut only and preserve all content bytes with a Unicode rune limit',async t=>{
  const page=await open(t),content=' \n Olá 😀 \n ';
  const result=await page.evaluate(content=>({normalized:h.schema.parse({shortcut:' /VISITA-1_2 ',content}),
    emoji4000:h.schema.safeParse({shortcut:'ok',content:'😀'.repeat(4000)}).success,emoji4001:h.schema.safeParse({shortcut:'ok',content:'😀'.repeat(4001)}).success,
    invalid:['','//bad','_bad','bad word','çasa','Kasa','a'.repeat(41)].map(shortcut=>h.schema.safeParse({shortcut,content:'ok'}).success),
    invalidText:['antes\u0000depois','isolado\uD800','isolado\uDC00'].map(content=>h.schema.safeParse({shortcut:'ok',content}).success),
    blank:h.schema.safeParse({shortcut:'ok',content:' \n\t '}).success,owner:h.schema.safeParse({shortcut:'ok',content:'ok',owner_user_id:'other'}).success}),content);
  assert.deepEqual(result,{normalized:{shortcut:'visita-1_2',content},emoji4000:true,emoji4001:false,invalid:Array(7).fill(false),invalidText:[false,false,false],blank:false,owner:false});
});

test('actual API CRUD validates envelopes and sends only shortcut/content with captured org actor SID signal',async t=>{
  const page=await open(t),first=item();
  await page.evaluate(()=>{h.intent={expectedUserId:'owner-A',expectedSessionId:'sid-A',signal:new AbortController().signal};h.api.list('org-A',h.intent).then(data=>h.direct=data);});
  await waitRequests(page,1);await resolveRequest(page,0,[first]);await page.waitForFunction(()=>h.direct?.length===1);
  await page.evaluate(()=>{h.api.create({shortcut:' /VISITA ',content:'  Olá\n '},'org-A',h.intent).then(data=>h.direct=data);});
  await waitRequests(page,2);await resolveRequest(page,1,first);
  await page.evaluate(id=>{h.api.update(id,{shortcut:'novo',content:'X'},'org-A',h.intent).then(data=>h.direct=data);},first.id);
  await waitRequests(page,3);await resolveRequest(page,2,{...first,shortcut:'novo',content:'X'});
  await page.evaluate(id=>{h.api.remove(id,'org-A',h.intent).then(()=>h.removed=true);},first.id);await waitRequests(page,4);
  await page.evaluate(()=>h.requests[3].resolve(null));await page.waitForFunction(()=>h.removed);
  assert.deepEqual(await page.evaluate(()=>h.requests.map(r=>({path:r.path,method:r.method||'GET',body:r.body,org:r.organizationId,actor:r.expectedUserId,sid:r.expectedSessionId,signal:r.signal instanceof AbortSignal,retry:r.retry}))),[
    {path:'/v1/whatsapp/quick-replies',method:'GET',body:undefined,org:'org-A',actor:'owner-A',sid:'sid-A',signal:true,retry:false},
    {path:'/v1/whatsapp/quick-replies',method:'POST',body:{shortcut:'visita',content:'  Olá\n '},org:'org-A',actor:'owner-A',sid:'sid-A',signal:true,retry:false},
    {path:'/v1/whatsapp/quick-replies/'+first.id,method:'PATCH',body:{shortcut:'novo',content:'X'},org:'org-A',actor:'owner-A',sid:'sid-A',signal:true,retry:false},
    {path:'/v1/whatsapp/quick-replies/'+first.id,method:'DELETE',body:undefined,org:'org-A',actor:'owner-A',sid:'sid-A',signal:true,retry:false}]);
});

test('list endpoint absent or malformed never pretends a successful empty/local list',async t=>{
  const page=await open(t);await render(page,{enabled:true});await waitRequests(page,1);
  await page.evaluate(()=>h.requests[0].reject(Object.assign(new Error('Respostas rápidas indisponíveis'),{status:404})));
  await page.waitForFunction(()=>h.views.status==='error');assert.equal(await page.evaluate(()=>h.views.error.status),404);assert.equal(await page.evaluate(()=>h.views.data),undefined);
  await page.evaluate(()=>{void h.client.invalidateQueries({queryKey:['whatsapp-quick-replies']});});await waitRequests(page,2);
  await resolveRequest(page,1,Array.from({length:201},(_,i)=>item(i+1,'atalho'+i)));
  await page.waitForFunction(()=>h.views.status==='error'&&h.views.error.message.includes('Contrato invalido'));
  assert.equal(await page.evaluate(()=>h.views.data),undefined);
});

test('same organization two personal owners and another organization cannot share cached replies',async t=>{
  const page=await open(t);await render(page,{enabled:true});await waitRequests(page,1);await resolveRequest(page,0,[item(1,'owner-a')]);await page.waitForFunction(()=>h.views.data?.[0].shortcut==='owner-a');
  await switchOwner(page);await waitRequests(page,2);assert.equal(await page.evaluate(()=>h.views.data),undefined);await resolveRequest(page,1,[item(2,'owner-b')]);await page.waitForFunction(()=>h.views.data?.[0].shortcut==='owner-b');
  await switchOwner(page,'B','org-B');await waitRequests(page,3);assert.equal(await page.evaluate(()=>h.views.data),undefined);await resolveRequest(page,2,[item(3,'other-org')]);await page.waitForFunction(()=>h.views.data?.[0].shortcut==='other-org');
  const cache=await page.evaluate(()=>h.read());assert.equal(cache.filter(q=>q.data).length,3);assert.ok(cache.find(q=>q.data&&q.key[1]==='org-A'&&q.key[2]==='owner-A').data[0].shortcut==='owner-a');
});

test('noncancelable list ABA response cannot resurrect the retired personal query',async t=>{
  const page=await open(t);await render(page,{enabled:true,ignoreAbort:true});await waitRequests(page,1);
  await switchOwner(page);await waitRequests(page,2);await switchOwner(page,'A','org-A','sid-A');await waitRequests(page,3);
  await resolveRequest(page,0,[item(1,'retired-a')]);await resolveRequest(page,1,[item(2,'retired-b')]);await page.waitForTimeout(40);assert.equal(await page.evaluate(()=>h.views.data),undefined);
  assert.equal(await page.evaluate(()=>h.requests[0].aborted&&h.requests[1].aborted),true);await resolveRequest(page,2,[item(3,'current-a')]);await page.waitForFunction(()=>h.views.data?.[0].shortcut==='current-a');
});

test('access permissions and auth SID partition the same personal owner cache',async t=>{
  const page=await open(t);await render(page,{enabled:true});await waitRequests(page,1);await resolveRequest(page,0,[item(1,'original')]);await page.waitForFunction(()=>h.views.data?.length===1);
  await page.evaluate(()=>h.render({scope:{...h.scope,accessScope:'reduced+sid-A'}}));await waitRequests(page,2);assert.equal(await page.evaluate(()=>h.views.data),undefined);
  await resolveRequest(page,1,[item(2,'reduced')]);await page.waitForFunction(()=>h.views.data?.[0].shortcut==='reduced');
  await switchOwner(page,'A','org-A','sid-new');await waitRequests(page,3);assert.equal(await page.evaluate(()=>h.views.data),undefined);
  await page.evaluate(()=>h.token={user:'owner-A',sid:'replaced-before-render'});await resolveRequest(page,2,[item(3,'retired-session')]);
  await page.waitForFunction(()=>h.views.status==='error');assert.equal(await page.evaluate(()=>h.views.data),undefined);
});

test('mutation create update delete refresh only the exact personal query and report ordinary errors',async t=>{
  const page=await open(t);await render(page,{enabled:true});await waitRequests(page,1);await resolveRequest(page,0,[item()]);await page.waitForFunction(()=>h.views.data?.length===1);
  await run(page,'create',{shortcut:'novoa',content:'A'},'create');await waitRequests(page,2);await resolveRequest(page,1,item(2,'novoa','A'));await waitRequests(page,3);await resolveRequest(page,2,[item(),item(2,'novoa','A')]);await waitOutcome(page,'create');
  await run(page,'update',{id:item(2).id,shortcut:'novob',content:'B'},'update');await waitRequests(page,4);await resolveRequest(page,3,item(2,'novob','B'));await waitRequests(page,5);await resolveRequest(page,4,[item(),item(2,'novob','B')]);await waitOutcome(page,'update');
  await run(page,'remove',item(2).id,'remove');await waitRequests(page,6);await page.evaluate(()=>h.requests[5].resolve(null));await waitRequests(page,7);await resolveRequest(page,6,[item()]);await waitOutcome(page,'remove');
  assert.deepEqual(await page.evaluate(()=>h.callbacks),['createsuccess','createsettled','updatesuccess','updatesettled','removesuccess','removesettled']);
  assert.deepEqual(await page.evaluate(()=>h.requests.map(r=>r.method||'GET')),['GET','POST','GET','PATCH','GET','DELETE','GET']);
});

for(const late of ['resolve','reject'])test('retired mutation '+late+' cannot publish data or callbacks across actor/org/SID ABA',async t=>{
  const page=await open(t);await render(page,{ignoreAbort:true});await run(page,'create',{shortcut:'salvar',content:'Rascunho permanece'},'old');await waitRequests(page,1);
  await switchOwner(page,'B','org-B','sid-B');assert.equal(await page.evaluate(()=>h.views.create.data),undefined);assert.equal(await page.evaluate(()=>h.views.create.isPending),false);
  await switchOwner(page,'A','org-A','sid-A');await page.evaluate(({late,data})=>{const r=h.requests[0];if(late==='resolve')r.resolve({data});else r.reject(Object.assign(new Error('segredo do contexto antigo'),{status:503}));},{late,data:item()});await waitOutcome(page,'old');
  assert.deepEqual(await page.evaluate(()=>({ok:h.outcomes.old.ok,name:h.outcomes.old.name,callbacks:h.callbacks,cache:h.read().filter(q=>q.data).length,aborted:h.requests[0].aborted})),{ok:false,name:'AbortError',callbacks:[],cache:0,aborted:true});
  assert.equal(await page.evaluate(()=>h.views.create.data),undefined);assert.equal(await page.evaluate(()=>h.views.create.error),undefined);
});

test('same actor new SID or changed token before rerender retires mutation authority',async t=>{
  const page=await open(t);await render(page,{ignoreAbort:true});await run(page,'create',{shortcut:'novo',content:'A'},'sid-old');await waitRequests(page,1);
  await switchOwner(page,'A','org-A','sid-new');await resolveRequest(page,0,item());await waitOutcome(page,'sid-old');assert.equal(await page.evaluate(()=>h.outcomes['sid-old'].name),'AbortError');
  await page.evaluate(()=>{h.token={user:'owner-B',sid:'sid-B'};h.run('create',{shortcut:'denied',content:'B'},'denied');});await waitOutcome(page,'denied');assert.equal(await page.evaluate(()=>h.requests.length),1);assert.equal(await page.evaluate(()=>h.outcomes.denied.name),'AbortError');
});

test('closing the editor retires callbacks but lets a dispatched write reach its terminal result',async t=>{
  const page=await open(t);await render(page,{ignoreAbort:true});await run(page,'create',{shortcut:'novo',content:'Guardado só pelo servidor'},'closed');await waitRequests(page,1);
  await page.evaluate(()=>h.unmount());assert.equal(await page.evaluate(()=>h.requests[0].aborted),false);await resolveRequest(page,0,item());await waitOutcome(page,'closed');
  assert.deepEqual(await page.evaluate(()=>({ok:h.outcomes.closed.ok,name:h.outcomes.closed.name,callbacks:h.callbacks})),{ok:false,name:'AbortError',callbacks:[]});
});

for(const status of [403,404,409,503])test('current mutation HTTP '+status+' preserves failure and draft without optimistic success or retry',async t=>{
  const page=await open(t),draft=' \nTexto ainda no editor\n ';
  await run(page,'create',{shortcut:'visita',content:draft});await waitRequests(page,1);await page.evaluate(status=>h.requests[0].reject(Object.assign(new Error('Não foi possível salvar'),{status})),status);await waitOutcome(page);
  assert.deepEqual(await page.evaluate(()=>({outcome:h.outcomes.op,callbacks:h.callbacks,body:h.requests[0].body,count:h.requests.length,hasCache:h.read().some(q=>q.data)})),
    {outcome:{ok:false,name:'Error',status,code:undefined,message:'Não foi possível salvar'},callbacks:['operror','opsettled'],body:{shortcut:'visita',content:draft},count:1,hasCache:false});
  await switchOwner(page);assert.deepEqual(await page.evaluate(()=>({data:h.views.create.data,error:h.views.create.error,failure:h.views.create.failure,isPending:h.views.create.isPending})),{data:undefined,error:undefined,failure:undefined,isPending:false});
});

test('disabled/logout list cannot expose old data and strict-effect replay does not permanently abort mutations',async t=>{
  const page=await open(t);await render(page,{enabled:true});await waitRequests(page,1);await resolveRequest(page,0,[item()]);await page.waitForFunction(()=>h.views.data?.length===1);
  await render(page,{enabled:false});assert.equal(await page.evaluate(()=>h.views.data),undefined);
  await render(page,{strict:true});await run(page,'create',{shortcut:'strict',content:'Works'});await waitRequests(page,2);await resolveRequest(page,1,item(2,'strict','Works'));await waitOutcome(page);assert.equal(await page.evaluate(()=>h.outcomes.op.ok),true);
  await render(page,{enabled:true,session:null,token:{user:null,sid:null}});assert.equal(await page.evaluate(()=>h.views.data),undefined);assert.equal(await page.evaluate(()=>h.views.scope.enabled),false);
});
