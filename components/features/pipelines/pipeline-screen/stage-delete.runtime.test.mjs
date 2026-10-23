import assert from 'node:assert/strict';
import { before, beforeEach, afterEach, after, test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// Actual editor, deletion hook declaration, access helper, transport adapter and
// Zod schemas. Synthetic auth/server only; no application service or database.
const require = createRequire(import.meta.url), ts = require('typescript');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const id = '11111111-1111-4111-8111-111111111111', pipeline = '22222222-2222-4222-8222-222222222222';
const r1 = '2026-10-16T10:00:00.123456Z', r2 = '2026-10-16T10:00:00.123457Z';
let directory, browser, page, bundle;
const errors = [];
before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'vimob-stage-delete-'));
  const stub = path.join(directory, 'synthetic.tsx'), entry = path.join(directory, 'entry.tsx');
  const hooks = path.join(directory, 'hooks.ts'), validation = path.join(directory, 'validation.ts'), loader = path.join(directory, 'loader.cjs');
  const source = ts.createSourceFile('use-stages.ts', await readFile(path.join(root, 'hooks/use-stages.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'useDeleteStage');
  assert(declaration);
  await writeFile(hooks, `import{useMutation}from'@tanstack/react-query';import{useStageDeleteIntent}from'@/hooks/pipelines/use-stage-delete-intent';import{pipelinesAPI}from'@/lib/api/pipelines';
    ${declaration.getText(source)}
    export const useReorderStages=()=>({isPending:false,mutateAsync:async()=>{throw Error('Unexpected reorder')}});
    export const useUpdateStage=()=>({isPending:false,mutateAsync:async()=>{throw Error('Unexpected update')}});`);
  await writeFile(validation, `export * from ${JSON.stringify(path.join(root, 'lib/validation/common.ts'))};export * from ${JSON.stringify(path.join(root, 'lib/validation/pipelines.ts'))};`);
  await writeFile(stub, `import React,{createContext,useContext}from'react';export const Auth=createContext(null),useAuth=()=>useContext(Auth);
    export{VimobAPIError}from${JSON.stringify(path.join(root, 'lib/api/vimob-error.ts'))};
    export const vimobAPIRequest=(url,options)=>window.h.request(url,options);
    export const toast=Object.fromEntries(['success','error','info'].map(kind=>[kind,message=>window.h.toasts.push({kind,message})]));`);
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;`);
  await writeFile(entry, `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider,MutationCache}from'@tanstack/react-query';
    import{StagesEditorDialog}from'@/components/features/pipelines/StagesEditorDialog';import{useDeleteStage}from'@/hooks/use-stages';import{Auth,VimobAPIError}from'./synthetic';
    const h=window.h={requests:[],toasts:[],serverRevision:'${r1}',stage:{id:'${id}',name:'Synthetic',color:'#123456',position:0,stage_key:'new',updated_at:'${r1}'}};
    const client=h.client=new QueryClient({mutationCache:new MutationCache({onMutate:()=>h.globalGate?new Promise(resolve=>h.releaseGlobal=resolve):undefined}),defaultOptions:{queries:{retry:false,gcTime:Infinity},mutations:{retry:false}}});
    h.request=async(url,options)=>{if(options.expectedUserId!==h.scope.actor||options.expectedSessionId!==h.scope.sid||options.signal?.aborted)throw new VimobAPIError('Retired',{status:409,code:'pipeline_delete_scope_changed'});
      h.requests.push({url,options});if(h.deferReply)return await new Promise(resolve=>h.releaseReply=()=>resolve(null));
      if(options.body.expectedUpdatedAt!==h.serverRevision)throw new VimobAPIError('Changed',{status:409,code:'pipeline_stages_changed'});
      if(h.failOnce){h.failOnce=false;throw new VimobAPIError('Synthetic unavailable',{status:503,code:'unavailable'})}return null};
    function Content({open,onOpenChange,currentPipeline}){const deletion=useDeleteStage(currentPipeline);
      h.prepare=input=>h.prepared=deletion.capture(input);h.delete=()=>deletion.mutateAsync(h.prepared).then(()=>h.outcome={ok:true},error=>h.outcome={ok:false,code:error.code});
      return <StagesEditorDialog open={open} onOpenChange={onOpenChange} pipelineId={currentPipeline} pipelineName='Synthetic pipeline' stages={[h.stage]}/>}
    function Fixture(){const[scope,setScope]=useState({org:'33333333-3333-4333-8333-333333333333',actor:'44444444-4444-4444-8444-444444444444',sid:'sid-a'}),[open,setOpen]=useState(true),[currentPipeline,setPipeline]=useState('${pipeline}'),[revision,setRevision]=useState(0);
      h.scope=scope;h.changeScope=patch=>setScope(old=>({...old,...patch}));h.setPipeline=setPipeline;h.setOpen=setOpen;h.refresh=patch=>{h.stage={...h.stage,...patch};h.serverRevision=h.stage.updated_at;setRevision(value=>value+1)};
      const auth={activeOrganization:{organizationId:scope.org},user:{id:scope.actor},session:{access_token:'header.'+btoa(JSON.stringify({sub:scope.actor,session_id:scope.sid}))+'.synthetic'},tenantContext:{organizationId:scope.org,permissions:['*'],enabledModules:['crm'],memberRole:'admin'}};
      return <Auth.Provider value={auth}><QueryClientProvider client={client}><Content open={open} onOpenChange={setOpen} currentPipeline={currentPipeline} revision={revision}/></QueryClientProvider></Auth.Provider>}
    const reactRoot=createRoot(document.getElementById('app'));h.mount=()=>reactRoot.render(<Fixture/>);`);
  const { webpack } = require('next/dist/compiled/webpack/webpack');
  await new Promise((resolve,reject)=>{
    const compiler=webpack({mode:'development',target:'web',devtool:false,entry,output:{path:directory,filename:'fixture.js'},
      plugins:[new webpack.NormalModuleReplacementPlugin(/(^|[/\\])vimob-client(\.ts)?$/,stub)],
      resolve:{extensions:['.tsx','.ts','.js'],modules:[path.join(root,'node_modules'),'node_modules'],alias:{'@/contexts/AuthContext$':stub,'@/hooks/use-stages$':hooks,'@/lib/validation$':validation,'sonner$':stub,'@':root}},
      module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:loader}]}});
    compiler.run((error,stats)=>compiler.close(()=>error||stats.hasErrors()?reject(error||Error(stats.toString({all:false,errors:true}))):resolve()));
  });
  bundle=await readFile(path.join(directory,'fixture.js'),'utf8');browser=await chromium.launch({headless:true});
}, {timeout:180_000});
beforeEach(async()=>{
  page=await browser.newPage();page.setDefaultTimeout(5_000);page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>route.request().url()==='https://stage-delete.invalid/'?route.fulfill({contentType:'text/html',body:'<div id="app"></div>'}):route.abort());
  await page.goto('https://stage-delete.invalid/');await page.addScriptTag({content:'window.process={env:{NODE_ENV:"test"}};'});await page.addScriptTag({content:bundle});
});
afterEach(async()=>page?.close());
after(async()=>{await browser?.close();if(directory){const target=path.resolve(directory);assert.equal(path.dirname(target),path.resolve(tmpdir()));assert(path.basename(target).startsWith('vimob-stage-delete-'));await rm(target,{recursive:true,force:true})}assert.deepEqual(errors,[])});
async function mount(patch={}) {await page.evaluate(patch=>{Object.assign(window.h.stage,patch);window.h.serverRevision=window.h.stage.updated_at;window.h.mount()},patch);await page.getByRole('dialog').waitFor()}
async function openDelete(){await page.getByRole('button',{name:'Excluir coluna Synthetic',exact:true}).click();await page.getByRole('alertdialog').waitFor()}
async function requests(count){await page.waitForFunction(count=>window.h.requests.length>=count,count);return page.evaluate(()=>window.h.requests)}
async function scope(patch){await page.evaluate(patch=>window.h.changeScope(patch),patch);await page.waitForFunction(patch=>Object.entries(patch).every(([key,value])=>window.h.scope[key]===value),patch)}

test('column deletion preserves exact opening revision through a refetch and blocks retry after conflict',async()=>{
  await mount();await openDelete();await page.evaluate(revision=>window.h.refresh({updated_at:revision,name:'Changed remotely'}),r2);
  await page.getByRole('button',{name:'Excluir',exact:true}).click();const first=(await requests(1))[0];assert.equal(first.options.method,'DELETE');assert.deepEqual(first.options.body,{expectedUpdatedAt:r1});assert.equal(first.options.retry,false);
  await page.getByRole('alertdialog').getByText(/Feche esta confirmação/).waitFor();assert.equal(await page.getByRole('button',{name:'Excluir',exact:true}).isDisabled(),true);
  assert.equal(await page.evaluate(()=>window.h.requests.length),1);await page.getByRole('button',{name:'Cancelar',exact:true}).click();
  await page.getByRole('button',{name:'Excluir coluna Changed remotely',exact:true}).click();await page.getByRole('button',{name:'Excluir',exact:true}).click();
  assert.deepEqual((await requests(2))[1].options.body,{expectedUpdatedAt:r2});
});

test('persisted column without revision fails closed in confirmation and API validation',async()=>{
  await mount({updated_at:null});await openDelete();await page.getByRole('alertdialog').getByText(/Não foi possível confirmar a versão desta coluna/).waitFor();
  assert.equal(await page.getByRole('button',{name:'Excluir',exact:true}).isDisabled(),true);
  await page.evaluate(id=>{window.h.prepare({id});void window.h.delete()},id);await page.waitForFunction(()=>window.h.outcome);
  assert.equal(await page.evaluate(()=>window.h.outcome.ok),false);assert.equal(await page.evaluate(()=>window.h.requests.length),0);
});

test('new local draft can be removed without a persisted revision or DELETE request',async()=>{
  await mount();await page.getByRole('button',{name:'Nova Coluna',exact:true}).click();await page.getByPlaceholder('Nome da coluna...').fill('Local draft');
  await page.getByRole('button',{name:'Adicionar nova coluna ao rascunho',exact:true}).click();await page.getByRole('button',{name:'Excluir coluna Local draft',exact:true}).click();
  await page.getByRole('button',{name:'Excluir',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Excluir coluna Local draft',exact:true}).count(),0);
  assert.equal(await page.evaluate(()=>window.h.requests.length),0);
});

test('transient delete failure preserves its original revision for an explicit retry',async()=>{
  await mount();await page.evaluate(()=>window.h.failOnce=true);await openDelete();await page.getByRole('button',{name:'Excluir',exact:true}).click();
  await page.getByRole('alertdialog').getByText('Erro ao excluir: Não foi possível concluir esta ação agora. Tente novamente em instantes.',{exact:true}).waitFor();await page.getByRole('button',{name:'Excluir',exact:true}).click();
  assert.equal((await requests(2))[1].options.body.expectedUpdatedAt,r1);
});

for(const replacement of [{sid:'sid-b'},{org:'77777777-7777-4777-8777-777777777777'},{actor:'55555555-5555-4555-8555-555555555555'}]) test('prepared column deletion retires during global wait: '+JSON.stringify(replacement),async()=>{
  await mount();await page.evaluate(({id,revision})=>{const h=window.h;h.prepare({id,expectedUpdatedAt:revision});h.globalGate=true;void h.delete()},{id,revision:r1});
  await page.waitForFunction(()=>window.h.releaseGlobal);await scope(replacement);await page.evaluate(()=>window.h.releaseGlobal());await page.waitForFunction(()=>window.h.outcome);
  assert.equal(await page.evaluate(()=>window.h.requests.length),0);assert.deepEqual(await page.evaluate(()=>window.h.toasts),[]);
});

test('old prepared deletion is not revived by SID A to B to A',async()=>{
  await mount();await page.evaluate(({id,revision})=>{window.h.prepare({id,expectedUpdatedAt:revision});window.h.oldDelete=window.h.delete},{id,revision:r1});
  await scope({sid:'sid-b'});await scope({sid:'sid-a'});await page.evaluate(()=>void window.h.oldDelete());await page.waitForFunction(()=>window.h.outcome);
  assert.equal(await page.evaluate(()=>window.h.requests.length),0);
});

test('late success after scope retirement does not toast or update the new confirmation',async()=>{
  await mount();await page.evaluate(()=>window.h.deferReply=true);await openDelete();await page.getByRole('button',{name:'Excluir',exact:true}).click();await requests(1);
  await scope({sid:'sid-b'});await page.evaluate(()=>window.h.releaseReply());await page.waitForFunction(()=>window.h.client.isMutating()===0);
  assert.deepEqual(await page.evaluate(()=>window.h.toasts),[]);
});

test('an old confirm callback cannot remove a newly reopened column confirmation',async()=>{
  await mount();await openDelete();await page.getByRole('button',{name:'Excluir',exact:true}).evaluate(button=>{const props=Object.keys(button).find(key=>key.startsWith('__reactProps'));window.h.oldConfirm=button[props].onClick});
  await page.getByRole('button',{name:'Cancelar',exact:true}).click();await page.evaluate(revision=>window.h.refresh({updated_at:revision}),r2);await openDelete();
  await page.evaluate(()=>window.h.oldConfirm(new MouseEvent('click',{cancelable:true})));assert.equal(await page.evaluate(()=>window.h.requests.length),0);assert.equal(await page.getByRole('alertdialog').count(),1);
  await page.getByRole('button',{name:'Excluir',exact:true}).click();assert.equal((await requests(1))[0].options.body.expectedUpdatedAt,r2);
});
