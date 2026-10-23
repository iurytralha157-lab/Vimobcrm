import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// Real forms, list, hooks, React Query and API/Zod. Only Auth/transport/users and
// the independent inactivity mutation are synthetic; all network is blocked.
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
let directory, browser, page, bundle;
const errors = [];
const revision1 = '2026-10-16T10:00:00.123456Z', revision2 = '2026-10-16T10:00:00.123457Z';
const id = '11111111-1111-4111-8111-111111111111';
const stageId = '22222222-2222-4222-8222-222222222222';
const userB = '55555555-5555-4555-8555-555555555555';

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'vimob-automation-revision-'));
  const stub = path.join(directory, 'synthetic.tsx'), entry = path.join(directory, 'fixture.tsx'), loader = path.join(directory, 'loader.cjs');
  const validation = path.join(directory, 'validation.ts');
  // Select the actual API's schemas without eagerly initializing unrelated SDKs
  // exported by the application's broad validation barrel.
  await writeFile(validation, `export * from ${JSON.stringify(path.join(root, 'lib/validation/auxiliary.ts'))};export * from ${JSON.stringify(path.join(root, 'lib/validation/common.ts'))};export * from ${JSON.stringify(path.join(root, 'lib/validation/stage-automation-revision.ts'))};`);
  await writeFile(stub, `import React,{createContext,useContext}from'react';
    import{VimobAPIError}from${JSON.stringify(path.join(root, 'lib/api/vimob-error.ts'))};export{VimobAPIError};
    export const Auth=createContext(null),useAuth=()=>useContext(Auth);
    export const useOrganizationUsers=()=>({data:[{id:'44444444-4444-4444-8444-444444444444',name:'Corretor A'},{id:'55555555-5555-4555-8555-555555555555',name:'Corretor B'}],isPending:false,isError:false});
    export const toast=Object.fromEntries(['success','error','warning','info'].map(kind=>[kind,message=>window.h.toasts.push({kind,message})]));
    export const vimobAPIRequest=async(path,options={})=>window.h.request(path,options);
    export const useStageInactivityAutomation=stage=>{const auth=useAuth();return{scopeKey:JSON.stringify([stage,auth.activeOrganization.organizationId,auth.user.id,auth.session.access_token]),isPending:false,mutateAsync:async payload=>{window.h.inactivity.push(payload);return window.h.server}}};
  `);
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;`);
  await writeFile(entry, `import React,{useState}from'react';import{createRoot}from'react-dom/client';
    import{QueryClient,QueryClientProvider,MutationCache}from'@tanstack/react-query';
    import{AutomationForm}from'@/components/features/automations/AutomationForm';import{AutomationsList}from'@/components/features/automations/AutomationsList';
    import{useStageAutomations,useUpdateStageAutomation,useToggleStageAutomation,useDeleteStageAutomation}from'@/hooks/use-stage-automations';import{Auth,VimobAPIError}from'./synthetic';
    const h=window.h={requests:[],reads:[],toasts:[],inactivity:[],successes:0,mode:'edit',kind:'change_deal_status_on_enter',stage:'${stageId}',id:'${id}',org:'33333333-3333-4333-8333-333333333333'};
    h.row=(patch={})=>({id:h.id,organization_id:h.org,stage_id:h.stage,trigger_type:h.kind,config:{automation_type:h.kind,action_type:h.kind,action_config:h.kind==='change_assignee_on_enter'?{target_user_id:'44444444-4444-4444-8444-444444444444'}:{deal_status:'won'}},is_active:true,created_at:'${revision1}',updated_at:'${revision1}',...patch});h.server=h.row();
    const client=h.client=new QueryClient({mutationCache:new MutationCache({onMutate:()=>h.globalGate?new Promise(resolve=>{h.releaseGlobal=resolve}):undefined}),defaultOptions:{queries:{retry:false,gcTime:Infinity},mutations:{retry:false}}});
    h.request=async(url,options)=>{
      if(!options.method||options.method==='GET'){h.reads.push({url,options});if(h.refetchGate)return await new Promise(resolve=>{h.releaseRefetch=()=>resolve({data:[h.server]})});return{data:h.deleted?[]:[h.server]}}
      if(options.expectedUserId&&(options.expectedUserId!==h.scope.actor||options.expectedSessionId!==h.scope.sid||options.signal?.aborted))throw new VimobAPIError('Scope changed',{status:409,code:'stage_automation_scope_changed'});
      h.requests.push({url,options});
      if(h.deferReply)return await new Promise(resolve=>{h.releaseReply=patch=>resolve({data:{...h.server,...patch}})});
      if(['PATCH','DELETE'].includes(options.method)&&options.body.expected_updated_at!==h.server.updated_at)throw new VimobAPIError('Changed automation',{status:409,code:'stage_automation_changed'});
      if(options.method==='DELETE'){if(h.failDelete){h.failDelete=false;throw new VimobAPIError('Synthetic failure',{status:503,code:'unavailable'})}h.deleted=true;return null}
      const body=options.body;h.server={...h.server,updated_at:'2026-10-16T10:01:00.000001Z',...(url.endsWith('/status')?{is_active:body.is_active}:{config:{...h.server.config,automation_type:body.automation_type,action_type:body.automation_type,action_config:body.automation_type==='change_assignee_on_enter'?{target_user_id:body.target_user_id}:{deal_status:body.deal_status}}})};
      return{data:h.server};
    };
    h.refresh=async patch=>{h.server={...h.server,...patch};await client.invalidateQueries({queryKey:['stage-automations']})};
    function Content(){const query=useStageAutomations(h.stage),update=useUpdateStageAutomation(),toggle=useToggleStageAutomation(),deletion=useDeleteStageAutomation();
      h.update=variables=>update.mutateAsync(variables).then(value=>h.outcome={ok:true,value},error=>h.outcome={ok:false,code:error.code});
      h.toggle=variables=>toggle.mutateAsync(variables).then(value=>h.outcome={ok:true,value},error=>h.outcome={ok:false,code:error.code});
      h.prepareDelete=variables=>h.prepared=deletion.capture(variables);h.delete=()=>deletion.mutateAsync(h.prepared).then(value=>h.outcome={ok:true,value},error=>h.outcome={ok:false,code:error.code});
      if(!query.data)return null;return h.mode==='list'?<AutomationsList stageId={h.stage} canEdit/>:<AutomationForm stageId={h.stage} pipelineId='66666666-6666-4666-8666-666666666666' automation={h.mode==='create'?undefined:query.data[0]} onSuccess={()=>h.successes++}/>}
    function Fixture(){const[scope,setScope]=useState({org:h.org,actor:'44444444-4444-4444-8444-444444444444',sid:'sid-a'}),[shown,setShown]=useState(true);h.scope=scope;h.changeScope=patch=>setScope(old=>({...old,...patch}));h.close=()=>setShown(false);
      const auth={activeOrganization:{organizationId:scope.org},user:{id:scope.actor},session:{access_token:'header.'+btoa(JSON.stringify({sub:scope.actor,session_id:scope.sid}))+'.synthetic'},tenantContext:{organizationId:scope.org,permissions:['*'],enabledModules:['automations'],isSuperAdmin:false,memberRole:'admin'}};
      return <Auth.Provider value={auth}><QueryClientProvider client={client}>{shown&&<Content/>}</QueryClientProvider></Auth.Provider>}
    const reactRoot=createRoot(document.getElementById('app'));h.mount=()=>reactRoot.render(<Fixture/>);
  `);
  const aliases = Object.fromEntries(['contexts/AuthContext','hooks/use-users','lib/api/vimob-client','hooks/use-stage-inactivity-automation'].map(name=>['@/'+name+'$',stub]));
  const { webpack } = require('next/dist/compiled/webpack/webpack');
  await new Promise((resolve,reject)=>{
    const compiler=webpack({mode:'development',target:'web',devtool:false,entry,output:{path:directory,filename:'fixture.js'},
      plugins:[new webpack.NormalModuleReplacementPlugin(/(^|[/\\])vimob-client(\.ts)?$/,stub)],
      resolve:{extensions:['.tsx','.ts','.js'],alias:{...aliases,'@/lib/validation$':validation,'sonner$':stub,'@':root},modules:[path.join(root,'node_modules'),'node_modules']},
      module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:loader}]}});
    compiler.run((error,stats)=>compiler.close(()=>error||stats.hasErrors()?reject(error||new Error(stats.toString({all:false,errors:true}))):resolve()));
  });
  bundle=await readFile(path.join(directory,'fixture.js'),'utf8');browser=await chromium.launch({headless:true});
}, { timeout: 180_000 });
beforeEach(async()=>{
  page=await browser.newPage();page.on('pageerror',error=>errors.push(error.stack || error.message));page.setDefaultTimeout(5_000);
  await page.route('**/*',route=>route.request().url()==='https://automation-revision.invalid/'
    ?route.fulfill({contentType:'text/html',body:'<div id="app"></div>'}):route.abort());await page.goto('https://automation-revision.invalid/');
  await page.addScriptTag({content:'window.process={env:{NODE_ENV:"test"}};'});await page.addScriptTag({content:bundle});
});
afterEach(async()=>{await page?.close()});
after(async()=>{
  await browser?.close();if(directory){const target=path.resolve(directory);assert.equal(path.dirname(target),path.resolve(tmpdir()));assert(path.basename(target).startsWith('vimob-automation-revision-'));await rm(target,{recursive:true,force:true})}assert.deepEqual(errors,[]);
});
async function mount(mode='edit',kind='change_deal_status_on_enter',patch={}) {
  await page.evaluate(({mode,kind,patch})=>{const h=window.h;h.mode=mode;h.kind=kind;h.server=h.row(patch);h.mount()}, {mode,kind,patch});
  await page.getByRole(mode==='list'?'switch':'button',{name:mode==='list'?undefined:mode==='create'?'Criar Automação':'Salvar',exact:mode!=='list'}).waitFor();
}
async function select(label,option) {await page.getByLabel(label,{exact:true}).click();await page.getByRole('option',{name:option,exact:true}).click()}
async function requests(count) {await page.waitForFunction(count=>window.h.requests.length>=count,count);return page.evaluate(()=>window.h.requests)}
async function refresh(patch) {await page.evaluate(patch=>window.h.refresh(patch),patch)}
async function scope(patch) {await page.evaluate(patch=>window.h.changeScope(patch),patch);await page.waitForFunction(patch=>Object.entries(patch).every(([key,value])=>window.h.scope[key]===value),patch)}

for(const kind of ['change_deal_status_on_enter','change_assignee_on_enter']) test('editor freezes the original revision through refetch and preserves draft on conflict: '+kind,async()=>{
  await mount('edit',kind);
  const label=kind==='change_assignee_on_enter'?'Novo Responsável':'Novo Status do Deal',draft=kind==='change_assignee_on_enter'?'Corretor B':'Perdido';
  await select(label,draft);await refresh({updated_at:revision2,is_active:false});
  await page.getByRole('button',{name:'Salvar',exact:true}).click();const first=(await requests(1))[0];
  assert.equal(first.options.body.expected_updated_at,revision1);assert.equal(first.options.retry,false);assert.equal(first.options.expectedSessionId,'sid-a');
  await page.getByText(/Seu rascunho foi preservado/).first().waitFor();assert.equal(await page.getByLabel(label,{exact:true}).innerText(),draft);
  assert.equal(await page.getByRole('button',{name:'Salvar',exact:true}).isDisabled(),true);assert.equal(await page.evaluate(()=>window.h.requests.length),1);
  await page.getByRole('button',{name:'Carregar versão atual e revisar rascunho'}).click();await page.getByText(/Versão atual carregada:/).waitFor();
  assert.equal(await page.getByLabel(label,{exact:true}).innerText(),draft);await page.getByRole('button',{name:'Salvar',exact:true}).click();
  const second=(await requests(2))[1];assert.equal(second.options.body.expected_updated_at,revision2);
  assert.equal(kind==='change_assignee_on_enter'?second.options.body.target_user_id:second.options.body.deal_status,kind==='change_assignee_on_enter'?userB:'lost');
  await page.waitForFunction(()=>window.h.successes===1);
});

test('missing editor revision fails closed without a transport call',async()=>{
  await mount('edit','change_deal_status_on_enter',{updated_at:null});await page.getByRole('button',{name:'Salvar',exact:true}).click();
  await page.getByText(/Não foi possível confirmar a versão desta regra/).waitFor();assert.equal(await page.evaluate(()=>window.h.requests.length),0);
});

test('toggle sends the clicked revision, stops after conflict and requires an explicit current-list read',async()=>{
  await mount('list');await page.evaluate(revision=>{window.h.server={...window.h.server,updated_at:revision,is_active:false}},revision2);
  await page.getByRole('switch').click();assert.equal((await requests(1))[0].options.body.expected_updated_at,revision1);
  await page.getByRole('button',{name:'Atualizar automações antes de continuar'}).waitFor();assert.equal(await page.getByRole('switch').isDisabled(),true);
  assert.equal(await page.evaluate(()=>window.h.requests.length),1);await page.getByRole('button',{name:'Atualizar automações antes de continuar'}).click();
  await page.getByRole('switch').click();const second=(await requests(2))[1];assert.equal(second.options.body.expected_updated_at,revision2);assert.equal(second.options.body.is_active,true);
});

test('missing toggle revision fails closed before transport',async()=>{
  await mount('list','change_deal_status_on_enter',{updated_at:null});await page.getByRole('switch').click();
  await page.getByText(/Não foi possível confirmar a versão desta regra/).waitFor();assert.equal(await page.evaluate(()=>window.h.requests.length),0);
});

test('creation remains revision-free',async()=>{
  await mount('create');await select('Tipo de Automação','Alterar status (Ganho/Perdido)');await page.getByRole('button',{name:'Criar Automação',exact:true}).click();
  const request=(await requests(1))[0];assert.equal(request.options.method,'POST');assert.equal(Object.hasOwn(request.options.body,'expected_updated_at'),false);
});

test('inactivity edit retains its independent policy revision and original timestamp',async()=>{
  const policy={revision:7,is_enabled:false,clock:'last_interaction',start_mode:'activation',activated_at:null,interaction_coverage_from:null,effective_enabled:false,runtime_available:false};await mount('edit','alert_on_inactivity',{config:{automation_type:'alert_on_inactivity',trigger_days:7,alert_message:'Synthetic'},inactivity_policy:policy});
  await refresh({updated_at:revision2,inactivity_policy:{...policy,revision:8}});await page.getByRole('button',{name:'Salvar',exact:true}).click();
  await page.waitForFunction(()=>window.h.inactivity.length===1);const input=await page.evaluate(()=>window.h.inactivity[0].input);
  assert.equal(input.expected_updated_at,revision1);assert.equal(input.expected_policy_revision,7);assert.equal(await page.evaluate(()=>window.h.requests.length),0);
});

for(const mutation of ['update','toggle']) test('direct '+mutation+' without revision is rejected by real API validation before transport',async()=>{
  await mount();await page.evaluate(({mutation,id})=>{void window.h[mutation]({id,deal_status:'lost',is_active:true})},{mutation,id});
  await page.waitForFunction(()=>window.h.outcome);assert.equal(await page.evaluate(()=>window.h.outcome.ok),false);assert.equal(await page.evaluate(()=>window.h.requests.length),0);
});

for(const replacement of [{sid:'sid-b'},{org:'77777777-7777-4777-8777-777777777777'},{actor:userB}]) test('old mutation cannot start after a global onMutate wait and access replacement: '+JSON.stringify(replacement),async()=>{
  await mount();await page.evaluate(({id,revision})=>{const h=window.h;h.globalGate=true;void h.update({id,deal_status:'lost',expected_updated_at:revision})},{id,revision:revision1});
  await page.waitForFunction(()=>window.h.releaseGlobal);await scope(replacement);await page.evaluate(()=>window.h.releaseGlobal());
  await page.waitForFunction(()=>window.h.outcome);assert.equal(await page.evaluate(()=>window.h.requests.length),0);assert.deepEqual(await page.evaluate(()=>window.h.toasts),[]);
});

test('A to B to A does not revive a gesture deferred before transport',async()=>{
  await mount();await page.evaluate(({id,revision})=>{const h=window.h;h.globalGate=true;void h.toggle({id,is_active:false,expected_updated_at:revision})},{id,revision:revision1});
  await page.waitForFunction(()=>window.h.releaseGlobal);await scope({sid:'sid-b'});await scope({sid:'sid-a'});await page.evaluate(()=>window.h.releaseGlobal());
  await page.waitForFunction(()=>window.h.outcome);assert.equal(await page.evaluate(()=>window.h.requests.length),0);assert.deepEqual(await page.evaluate(()=>window.h.toasts),[]);
});

test('a late response from a retired scope cannot announce success or overwrite the new editor',async()=>{
  await mount();await page.evaluate(({id,revision})=>{window.h.deferReply=true;void window.h.update({id,deal_status:'lost',expected_updated_at:revision})},{id,revision:revision1});
  await requests(1);await scope({sid:'sid-b'});await page.evaluate(()=>window.h.releaseReply({updated_at:'2026-10-16T10:01:00Z'}));
  await page.waitForFunction(()=>window.h.outcome);assert.equal(await page.evaluate(()=>window.h.outcome.ok),false);assert.deepEqual(await page.evaluate(()=>window.h.toasts),[]);
});

test('delete confirmation keeps its opening revision after query refetch and requires a new gesture after conflict',async()=>{
  await mount('list');await page.getByRole('button',{name:'Excluir automação',exact:true}).click();
  await refresh({updated_at:revision2,is_active:false});await page.getByRole('button',{name:'Excluir',exact:true}).click();
  const first=(await requests(1))[0];assert.equal(first.options.method,'DELETE');assert.deepEqual(first.options.body,{expected_updated_at:revision1});assert.equal(first.options.retry,false);
  await page.getByRole('alertdialog').getByText(/Feche esta confirmação/).waitFor();assert.equal(await page.getByRole('button',{name:'Excluir',exact:true}).isDisabled(),true);
  assert.equal(await page.evaluate(()=>window.h.requests.length),1);await page.getByRole('button',{name:'Cancelar',exact:true}).click();
  await page.getByRole('button',{name:'Atualizar automações antes de continuar'}).click();await page.getByRole('button',{name:'Excluir automação',exact:true}).click();
  await page.getByRole('button',{name:'Excluir',exact:true}).click();assert.deepEqual((await requests(2))[1].options.body,{expected_updated_at:revision2});
  await page.getByText('Nenhuma automação configurada',{exact:true}).waitFor();
});

test('delete without revision is blocked both at list gesture and by the actual API schema',async()=>{
  await mount('list','change_deal_status_on_enter',{updated_at:null});await page.getByRole('button',{name:'Excluir automação',exact:true}).click();
  await page.getByText(/Não foi possível confirmar a versão desta regra/).waitFor();assert.equal(await page.getByRole('alertdialog').count(),0);
  await page.evaluate(id=>{window.h.prepareDelete({id});void window.h.delete()},id);await page.waitForFunction(()=>window.h.outcome);
  assert.equal(await page.evaluate(()=>window.h.outcome.ok),false);assert.equal(await page.evaluate(()=>window.h.requests.length),0);
});

test('network failure keeps the original delete confirmation available for an explicit retry',async()=>{
  await mount('list');await page.evaluate(()=>window.h.failDelete=true);await page.getByRole('button',{name:'Excluir automação',exact:true}).click();
  await page.getByRole('button',{name:'Excluir',exact:true}).click();await page.getByRole('alertdialog').getByText('Não foi possível concluir esta ação agora. Tente novamente em instantes.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Excluir',exact:true}).click();assert.equal((await requests(2))[1].options.body.expected_updated_at,revision1);
});

for(const replacement of [{sid:'sid-b'},{org:'77777777-7777-4777-8777-777777777777'},{actor:userB}]) test('prepared deletion retires across access replacement and global wait: '+JSON.stringify(replacement),async()=>{
  await mount();await page.evaluate(({id,revision})=>{const h=window.h;h.prepareDelete({id,expected_updated_at:revision});h.globalGate=true;void h.delete()},{id,revision:revision1});
  await page.waitForFunction(()=>window.h.releaseGlobal);await scope(replacement);await page.evaluate(()=>window.h.releaseGlobal());
  await page.waitForFunction(()=>window.h.outcome);assert.equal(await page.evaluate(()=>window.h.requests.length),0);assert.deepEqual(await page.evaluate(()=>window.h.toasts),[]);
});

test('prepared delete callback cannot revive after SID A to B to A',async()=>{
  await mount();await page.evaluate(({id,revision})=>{const h=window.h;h.prepareDelete({id,expected_updated_at:revision});h.oldDelete=h.delete},{id,revision:revision1});
  await scope({sid:'sid-b'});await scope({sid:'sid-a'});await page.evaluate(()=>void window.h.oldDelete());await page.waitForFunction(()=>window.h.outcome);
  assert.equal(await page.evaluate(()=>window.h.requests.length),0);assert.deepEqual(await page.evaluate(()=>window.h.toasts),[]);
});

test('an old confirm callback cannot delete a newly reopened automation confirmation',async()=>{
  await mount('list');await page.getByRole('button',{name:'Excluir automação',exact:true}).click();
  await page.getByRole('button',{name:'Excluir',exact:true}).evaluate(button=>{const props=Object.keys(button).find(key=>key.startsWith('__reactProps'));window.h.oldConfirm=button[props].onClick});
  await page.getByRole('button',{name:'Cancelar',exact:true}).click();await refresh({updated_at:revision2});await page.getByRole('button',{name:'Excluir automação',exact:true}).click();
  await page.evaluate(()=>window.h.oldConfirm(new MouseEvent('click',{cancelable:true})));assert.equal(await page.evaluate(()=>window.h.requests.length),0);assert.equal(await page.getByRole('alertdialog').count(),1);
  await page.getByRole('button',{name:'Excluir',exact:true}).click();assert.equal((await requests(1))[0].options.body.expected_updated_at,revision2);
});
