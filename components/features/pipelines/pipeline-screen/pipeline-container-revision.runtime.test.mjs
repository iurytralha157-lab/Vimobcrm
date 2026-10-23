import assert from 'node:assert/strict';
import { before, beforeEach, afterEach, after, test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// Actual PipelinesScreen handlers, mutation hooks, access helper, API and Zod.
// Synthetic auth/server only; all browser network requests are blocked.
const require = createRequire(import.meta.url), ts = require('typescript');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const id = '11111111-1111-4111-8111-111111111111', org = '33333333-3333-4333-8333-333333333333';
const actor = '44444444-4444-4444-8444-444444444444', otherOrg = '77777777-7777-4777-8777-777777777777';
const r1 = 'a'.repeat(64), r2 = 'b'.repeat(64), r3 = 'c'.repeat(64);
let directory, browser, page, bundle;
const errors = [];
before(async()=>{
  directory=await mkdtemp(path.join(tmpdir(),'vimob-pipeline-container-'));
  const source=ts.createSourceFile('PipelinesScreen.tsx',await readFile(path.join(root,'components/features/pipelines/PipelinesScreen.tsx'),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  function variable(name){let found;const visit=node=>{if(ts.isVariableDeclaration(node)&&(ts.isIdentifier(node.name)?node.name.text===name:ts.isArrayBindingPattern(node.name)&&node.name.elements.some(element=>ts.isBindingElement(element)&&element.name.getText(source)===name)))found=node;ts.forEachChild(node,visit)};visit(source);assert(found,name);return`const ${found.getText(source)};`}
  function attribute(name){let found;const visit=node=>{if(ts.isJsxAttribute(node)&&node.name.getText(source)===name)found=node.initializer.expression;ts.forEachChild(node,visit)};visit(source);assert(found,name);return found.getText(source)}
  const declarations=['pipelineToDelete','pipelineDeletionRef','deletePipelineBlocked','deletePipelineError','deletePipelineInFlightRef','pipelineNavigationRef','closePipelineDeletion','handleRequestDeletePipeline','handleDeletePipeline'].map(variable).join('\n');
  const stub=path.join(directory,'stub.tsx'),validation=path.join(directory,'validation.ts'),entry=path.join(directory,'entry.tsx'),loader=path.join(directory,'loader.cjs');
  await writeFile(stub,`import{createContext,useContext}from'react';export const Auth=createContext(null),useAuth=()=>useContext(Auth);export{VimobAPIError}from${JSON.stringify(path.join(root,'lib/api/vimob-error.ts'))};export const vimobAPIRequest=(url,options)=>window.h.request(url,options);export const toast=Object.fromEntries(['success','error'].map(kind=>[kind,message=>window.h.toasts.push({kind,message})]));`);
  await writeFile(validation,`export * from ${JSON.stringify(path.join(root,'lib/validation/common.ts'))};export * from ${JSON.stringify(path.join(root,'lib/validation/pipelines.ts'))};`);
  await writeFile(loader,`const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;`);
  await writeFile(entry,`import React,{useState,useRef,useLayoutEffect}from'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider,MutationCache,useQuery}from'@tanstack/react-query';
    import{usePipelineUpdateMutation,usePipelineDeleteMutation}from'@/hooks/pipelines/use-pipeline-mutations';import{pipelinesAPI}from'@/lib/api/pipelines';import{pipelineRevisionSchema}from'@/lib/validation';import{VimobAPIError,getStructuredErrorMessage as getPipelineErrorMessage}from'@/lib/api/vimob-error';import{toast,Auth}from'./stub';
    import{AlertDialog,AlertDialogContent,AlertDialogHeader,AlertDialogTitle,AlertDialogDescription,AlertDialogFooter,AlertDialogAction,AlertDialogCancel}from'@/components/ui/alert-dialog';
    const h=window.h={requests:[],reads:[],toasts:[],navigation:[],invalidations:[],revision:'${r1}',deleted:false};
    h.row=(patch={})=>({id:'${id}',organizationId:'${org}',name:'Synthetic pipeline',isDefault:false,isActive:true,position:0,createdAt:'2026-10-16T10:00:00Z',updatedAt:'2026-10-16T10:00:00Z',revision:h.revision,...patch});h.server=h.row();
    const client=h.client=new QueryClient({mutationCache:new MutationCache({onMutate:()=>h.globalGate?new Promise(resolve=>h.releaseGlobal=resolve):undefined}),defaultOptions:{queries:{retry:false,gcTime:Infinity,refetchOnMount:false},mutations:{retry:false}}});
    const invalidate=client.invalidateQueries.bind(client);client.invalidateQueries=(filters,options)=>{h.invalidations.push({refetchType:filters.refetchType,keys:client.getQueryCache().findAll(filters).map(query=>query.queryKey)});return invalidate(filters,options)};
    h.request=async(url,options={})=>{
      if(!options.method||options.method==='GET'){h.reads.push({url,org:options.organizationId});return{data:[...(h.deleted?[]:[h.server]),...(h.extraRows||[])].map(row=>({...row,organizationId:options.organizationId||row.organizationId}))}}
      if(options.expectedUserId!==h.scope.actor||options.expectedSessionId!==h.scope.sid||options.signal?.aborted)throw new VimobAPIError('Retired scope',{status:409,code:'pipeline_scope_changed'});
      h.requests.push({url,options});if(options.body.expectedRevision!==h.server.revision)throw new VimobAPIError('Changed',{status:409,code:'pipeline_changed'});
      if(h.failOnce){h.failOnce=false;throw new VimobAPIError('Unavailable',{status:503,code:'unavailable'})}
      if(options.method==='DELETE'){h.deleted=true;if(h.deferReply)return await new Promise(resolve=>h.releaseReply=()=>resolve(null));return null}
      h.server={...h.server,...options.body,revision:'${r3}'};if(h.deferReply)return await new Promise(resolve=>h.releaseReply=patch=>resolve({data:{...h.server,...patch}}));return{data:h.server};
    };
    function Content({scope}){const list=useQuery({queryKey:['pipelines',scope.org],queryFn:()=>pipelinesAPI.getPipelines(scope.org),staleTime:600000,refetchOnMount:true});const pipelines=list.data||[],[selectedPipelineId,setSelectedPipelineId]=useState('${id}');
      const deletePipeline=usePipelineDeleteMutation(),update=usePipelineUpdateMutation(),canEditPipeline=scope.allowed;
      ${declarations}
      useLayoutEffect(()=>{pipelineNavigationRef.current={selectedPipelineId,pipelines}},[selectedPipelineId,pipelines]);
      const handleSelectPipeline=id=>{h.navigation.push(id);setSelectedPipelineId(id)};
      h.navigate=handleSelectPipeline;
      const onOpenChange=${attribute('onPipelineToDeleteOpenChange')};
      h.query=list;h.selected=selectedPipelineId;h.target=pipelineToDelete;h.blocked=deletePipelineBlocked;h.error=deletePipelineError;h.handlers={request:handleRequestDeletePipeline,confirm:handleDeletePipeline,close:()=>closePipelineDeletion(pipelineToDelete)};
      h.prepare=input=>h.prepared=deletePipeline.capture(input);h.runDelete=input=>{try{return deletePipeline.mutateAsync(input||h.prepared).then(()=>h.outcome={ok:true},error=>h.outcome={ok:false,code:error.code})}catch(error){h.outcome={ok:false,code:error.code};return Promise.resolve()}};
      h.patch=input=>{try{return update.mutateAsync(input).then(value=>h.outcome={ok:true,value},error=>h.outcome={ok:false,code:error.code})}catch(error){h.outcome={ok:false,code:error.code};return Promise.resolve()}};
      h.refresh=async patch=>{h.server={...h.server,...patch};await list.refetch()};
      return <><button onClick={()=>handleRequestDeletePipeline(pipelines[0])} disabled={!pipelines[0]}>Request delete</button><pre data-testid='list'>{JSON.stringify(pipelines)}</pre>
      <AlertDialog open={Boolean(pipelineToDelete)} onOpenChange={onOpenChange}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Excluir pipeline?</AlertDialogTitle><AlertDialogDescription>{pipelineToDelete?.name}</AlertDialogDescription></AlertDialogHeader>{deletePipelineError&&<p role='alert'>{deletePipelineError}</p>}<AlertDialogFooter><AlertDialogCancel disabled={deletePipeline.isPending}>Cancelar</AlertDialogCancel><AlertDialogAction disabled={deletePipeline.isPending||deletePipelineBlocked} onClick={event=>{event.preventDefault();void handleDeletePipeline()}}>Excluir</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></>}
    function Fixture(){const[scope,setScope]=useState({org:'${org}',actor:'${actor}',sid:'sid-a',allowed:true}),[shown,setShown]=useState(true);h.scope=scope;h.switch=patch=>setScope(old=>({...old,...patch}));h.show=setShown;
      const auth={activeOrganization:{organizationId:scope.org},user:{id:scope.actor},session:{access_token:'header.'+btoa(JSON.stringify({sub:scope.actor,session_id:scope.sid,nonce:scope.nonce||0}))+'.synthetic'},tenantContext:{organizationId:scope.org,permissions:scope.allowed?['*']:[],enabledModules:['crm'],memberRole:'admin'}};
      return<Auth.Provider value={auth}><QueryClientProvider client={client}>{shown&&<Content scope={scope}/>}</QueryClientProvider></Auth.Provider>}
    const reactRoot=createRoot(document.getElementById('app'));h.mount=()=>reactRoot.render(<Fixture/>);`);
  const {webpack}=require('next/dist/compiled/webpack/webpack');
  await new Promise((resolve,reject)=>{const compiler=webpack({mode:'development',target:'web',devtool:false,entry,output:{path:directory,filename:'fixture.js'},plugins:[new webpack.NormalModuleReplacementPlugin(/(^|[/\\])vimob-client(\.ts)?$/,stub)],resolve:{extensions:['.tsx','.ts','.js'],modules:[path.join(root,'node_modules'),'node_modules'],alias:{'@/contexts/AuthContext$':stub,'@/lib/validation$':validation,'@':root}},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:loader}]}});compiler.run((error,stats)=>compiler.close(()=>error||stats.hasErrors()?reject(error||Error(stats.toString({all:false,errors:true}))):resolve()))});
  bundle=await readFile(path.join(directory,'fixture.js'),'utf8');browser=await chromium.launch({headless:true});
},{timeout:180000});
beforeEach(async()=>{page=await browser.newPage();page.setDefaultTimeout(5000);page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>route.request().url()==='https://pipeline-container.invalid/'?route.fulfill({contentType:'text/html',body:'<div id="app"></div>'}):route.abort());await page.goto('https://pipeline-container.invalid/');await page.addScriptTag({content:bundle})});
afterEach(async()=>page?.close());
after(async()=>{await browser?.close();if(directory){const target=path.resolve(directory);assert.equal(path.dirname(target),path.resolve(tmpdir()));assert(path.basename(target).startsWith('vimob-pipeline-container-'));await rm(target,{recursive:true,force:true})}assert.deepEqual(errors,[])});
async function mount(patch={}){await page.evaluate(patch=>{window.h.server={...window.h.server,...patch};window.h.mount()},patch);await page.getByRole('button',{name:'Request delete',exact:true}).waitFor();await page.waitForFunction(()=>window.h.query.data?.length>=1)}
async function openDelete(){await page.getByRole('button',{name:'Request delete',exact:true}).click();await page.getByRole('alertdialog').waitFor()}
async function requests(count){await page.waitForFunction(count=>window.h.requests.length>=count,count);return page.evaluate(()=>window.h.requests)}
async function scope(patch){await page.evaluate(patch=>window.h.switch(patch),patch);await page.waitForFunction(patch=>Object.entries(patch).every(([key,value])=>window.h.scope[key]===value),patch)}

test('DELETE freezes opening R1 across list refetch, blocks conflict, allows cancel and consciously reopens R2',async()=>{
  await mount();await openDelete();await page.evaluate(revision=>window.h.refresh({revision,name:'Changed remotely'}),r2);await page.getByRole('button',{name:'Excluir',exact:true}).click();
  const first=(await requests(1))[0];assert.equal(first.options.method,'DELETE');assert.deepEqual(first.options.body,{expectedRevision:r1});assert.equal(first.options.retry,false);
  await page.getByRole('alert').getByText(/Feche esta confirmação/).waitFor();assert.equal(await page.getByRole('button',{name:'Excluir',exact:true}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Cancelar',exact:true}).isDisabled(),false);
  assert.equal(await page.evaluate(()=>window.h.requests.length),1);await page.getByRole('button',{name:'Cancelar',exact:true}).click();await openDelete();await page.getByRole('button',{name:'Excluir',exact:true}).click();
  assert.deepEqual((await requests(2))[1].options.body,{expectedRevision:r2});await page.waitForFunction(()=>window.h.target===null);assert.deepEqual(await page.evaluate(()=>window.h.navigation),[null]);
});

test('legacy list remains readable while missing revision blocks UI and both API writes before transport',async()=>{
  await mount({revision:undefined});assert.equal(await page.evaluate(()=>window.h.query.data[0].name),'Synthetic pipeline');await page.getByRole('button',{name:'Request delete',exact:true}).click();
  assert.equal(await page.getByRole('alertdialog').count(),0);assert(await page.evaluate(()=>window.h.toasts.some(item=>item.message.includes('Não foi possível confirmar a versão'))));
  await page.evaluate(id=>{window.h.prepare({id,name:'Legacy'});void window.h.runDelete()},id);await page.waitForFunction(()=>window.h.outcome);assert.equal(await page.evaluate(()=>window.h.outcome.ok),false);
  await page.evaluate(id=>{window.h.outcome=null;void window.h.patch({id,name:'Rename'})},id);await page.waitForFunction(()=>window.h.outcome);assert.equal(await page.evaluate(()=>window.h.outcome.ok),false);assert.equal(await page.evaluate(()=>window.h.requests.length),0);
});

test('old confirm and close callbacks cannot remove a new confirmation after cancel and reopen',async()=>{
  await mount();await openDelete();await page.evaluate(()=>{window.h.savedConfirm=window.h.handlers.confirm;window.h.savedClose=window.h.handlers.close});await page.getByRole('button',{name:'Cancelar',exact:true}).click();
  await page.evaluate(revision=>window.h.refresh({revision}),r2);await openDelete();await page.evaluate(async()=>{await window.h.savedConfirm();window.h.savedClose()});assert.equal(await page.evaluate(()=>window.h.requests.length),0);assert.equal(await page.getByRole('alertdialog').count(),1);
  await page.getByRole('button',{name:'Excluir',exact:true}).click();assert.equal((await requests(1))[0].options.body.expectedRevision,r2);
});

test('an old confirm callback cannot retry a confirmation already blocked by a 409',async()=>{
  await mount();await openDelete();await page.evaluate(revision=>{window.h.savedConfirm=window.h.handlers.confirm;window.h.server={...window.h.server,revision}},r2);
  await page.getByRole('button',{name:'Excluir',exact:true}).click();await page.waitForFunction(()=>window.h.blocked===true);
  await page.evaluate(()=>window.h.savedConfirm());await page.waitForFunction(()=>window.h.client.isMutating()===0);
  assert.equal(await page.evaluate(()=>window.h.requests.length),1);assert.equal(await page.getByRole('button',{name:'Cancelar',exact:true}).isDisabled(),false);
});

test('PATCH captures fields and original revision before awaiting global onMutate',async()=>{
  await mount();await page.evaluate(({id,revision,next})=>{const h=window.h,input={id,name:'Captured rename',isDefault:true,expectedRevision:revision};h.globalGate=true;void h.patch(input);Object.assign(input,{name:'Changed later',isDefault:false,expectedRevision:next})},{id,revision:r1,next:r2});
  await page.waitForFunction(()=>window.h.releaseGlobal);await page.evaluate(()=>window.h.releaseGlobal());const request=(await requests(1))[0];assert.equal(request.options.method,'PATCH');assert.deepEqual(request.options.body,{name:'Captured rename',isDefault:true,expectedRevision:r1});assert.equal(request.options.retry,false);assert.equal(request.options.expectedUserId,actor);assert.equal(request.options.expectedSessionId,'sid-a');
  await page.waitForFunction(()=>window.h.outcome);assert.equal(await page.evaluate(()=>window.h.outcome.ok),true);
});

test('PATCH conflict is not retried or silently rebased',async()=>{
  await mount();await page.evaluate(({id,old,next})=>{window.h.server={...window.h.server,revision:next};void window.h.patch({id,name:'Old intent',expectedRevision:old})},{id,old:r1,next:r2});
  await page.waitForFunction(()=>window.h.outcome);assert.equal(await page.evaluate(()=>window.h.outcome.code),'pipeline_changed');assert.equal(await page.evaluate(()=>window.h.requests.length),1);assert.equal((await requests(1))[0].options.body.expectedRevision,r1);
});

for(const mutation of ['patch','delete']) for(const replacement of [{sid:'sid-b'},{org:otherOrg},{actor:'55555555-5555-4555-8555-555555555555'},{allowed:false}]) test(`${mutation} does not start after global wait and access replacement ${JSON.stringify(replacement)}`,async()=>{
  await mount();await page.evaluate(({mutation,id,revision})=>{const h=window.h;h.globalGate=true;if(mutation==='delete'){h.prepare({id,name:'Captured',expectedRevision:revision});void h.runDelete()}else void h.patch({id,name:'Captured rename',expectedRevision:revision})},{mutation,id,revision:r1});
  await page.waitForFunction(()=>window.h.releaseGlobal);await scope(replacement);await page.evaluate(()=>window.h.releaseGlobal());await page.waitForFunction(()=>window.h.outcome);
  assert.equal(await page.evaluate(()=>window.h.requests.length),0);assert.deepEqual(await page.evaluate(()=>window.h.toasts),[]);assert.deepEqual(await page.evaluate(()=>window.h.navigation),[]);
});

for(const mutation of ['patch','delete']) for(const [replacement,original] of [[{sid:'sid-b'},{sid:'sid-a'}],[{org:otherOrg},{org}],[{actor:'55555555-5555-4555-8555-555555555555'},{actor}],[{allowed:false},{allowed:true}]]) test(`${mutation} callback is not revived by A to B to A ${JSON.stringify(replacement)}`,async()=>{
  await mount();await page.evaluate(({mutation,id,revision})=>{const h=window.h;h.input={id,name:'Captured',expectedRevision:revision};if(mutation==='delete'){h.prepare(h.input);const captured=h.prepared,run=h.runDelete;h.old=()=>run(captured)}else{const patch=h.patch;h.old=()=>patch(h.input)}},{mutation,id,revision:r1});
  await scope(replacement);await scope(original);await page.evaluate(()=>window.h.old());await page.waitForFunction(()=>window.h.outcome);assert.equal(await page.evaluate(()=>window.h.requests.length),0);
});

for(const mutation of ['patch','delete']) test(`unmount during global wait retires ${mutation} before transport`,async()=>{
  await mount();await page.evaluate(({mutation,id,revision})=>{const h=window.h;h.globalGate=true;if(mutation==='delete'){h.prepare({id,name:'Captured',expectedRevision:revision});void h.runDelete()}else void h.patch({id,name:'Captured rename',expectedRevision:revision})},{mutation,id,revision:r1});await page.waitForFunction(()=>window.h.releaseGlobal);
  await page.evaluate(()=>window.h.show(false));await page.getByTestId('list').waitFor({state:'detached'});await page.evaluate(()=>window.h.releaseGlobal());await page.waitForFunction(()=>window.h.outcome);assert.equal(await page.evaluate(()=>window.h.requests.length),0);
});

test('late accepted DELETE after unmount cannot toast, navigate or refetch a replacement tenant cache',async()=>{
  await mount();await page.evaluate(()=>window.h.deferReply=true);await openDelete();await page.getByRole('button',{name:'Excluir',exact:true}).click();await requests(1);
  await page.evaluate(org=>{window.h.show(false);window.h.client.setQueryData(['pipelines',org],[{id:'replacement',name:'Keep'}])},otherOrg);await page.getByTestId('list').waitFor({state:'detached'});await page.evaluate(()=>window.h.releaseReply());await page.waitForFunction(()=>window.h.client.isMutating()===0);
  assert.deepEqual(await page.evaluate(()=>window.h.toasts),[]);assert.deepEqual(await page.evaluate(()=>window.h.navigation),[]);assert.deepEqual(await page.evaluate(org=>window.h.client.getQueryData(['pipelines',org]),otherOrg),[{id:'replacement',name:'Keep'}]);
  assert(await page.evaluate(()=>window.h.invalidations.every(item=>item.refetchType==='none')));await page.evaluate(()=>window.h.show(true));await page.getByTestId('list').waitFor();await page.waitForFunction(()=>window.h.query.data?.length===0);
});

test('late PATCH after scope replacement cannot reconcile over a newer tenant cache',async()=>{
  await mount();await page.evaluate(({id,revision})=>{window.h.deferReply=true;void window.h.patch({id,name:'Captured rename',expectedRevision:revision})},{id,revision:r1});await requests(1);await scope({org:otherOrg});
  await page.evaluate(org=>{window.h.client.setQueryData(['pipelines',org],[{id:'replacement',name:'Keep'}]);window.h.releaseReply({})},otherOrg);await page.waitForFunction(()=>window.h.outcome);
  assert.equal(await page.evaluate(()=>window.h.outcome.ok),false);assert.deepEqual(await page.evaluate(org=>window.h.client.getQueryData(['pipelines',org]),otherOrg),[{id:'replacement',name:'Keep'}]);assert.deepEqual(await page.evaluate(()=>window.h.navigation),[]);
});

test('same-SID token refresh preserves a PATCH captured before the global wait',async()=>{
  await mount();await page.evaluate(({id,revision})=>{window.h.globalGate=true;void window.h.patch({id,name:'Allowed refresh',expectedRevision:revision})},{id,revision:r1});await page.waitForFunction(()=>window.h.releaseGlobal);
  await scope({nonce:1});await page.evaluate(()=>window.h.releaseGlobal());await page.waitForFunction(()=>window.h.outcome);assert.equal(await page.evaluate(()=>window.h.outcome.ok),true);assert.equal((await requests(1))[0].options.expectedSessionId,'sid-a');
});

test('accepted deletion does not replace a newer user pipeline selection while its reply is pending',async()=>{
  const other='88888888-8888-4888-8888-888888888888';await page.evaluate(other=>window.h.extraRows=[window.h.row({id:other,name:'Other pipeline'})],other);await mount();await page.evaluate(()=>window.h.deferReply=true);await openDelete();await page.getByRole('button',{name:'Excluir',exact:true}).click();await requests(1);
  await page.evaluate(other=>window.h.navigate(other),other);await page.waitForFunction(other=>window.h.selected===other,other);await page.evaluate(()=>window.h.releaseReply());await page.waitForFunction(()=>window.h.target===null);
  assert.deepEqual(await page.evaluate(()=>window.h.navigation),[other]);
});
