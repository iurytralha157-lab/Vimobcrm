import {createRequire} from 'node:module';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../../',import.meta.url));
const require=createRequire(path.join(root,'package.json'));

/** Real distribution Screen/Editor/Radix with controlled auth, query, mutation and catalog boundaries. */
export async function createDistributionEditorHarness(){
 const prefix=path.join(tmpdir(),'vimob-distribution-editor-');
 const dir=await mkdtemp(prefix);
 if(!path.resolve(dir).startsWith(path.resolve(prefix)))throw new Error('Unexpected temporary fixture path');
 try{
const stubs=path.join(dir,'boundaries.tsx'),entry=path.join(dir,'fixture.tsx'),loader=path.join(dir,'loader.cjs');
await writeFile(loader,`const ts=require(${JSON.stringify(path.join(root,'node_modules/typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;`);
await writeFile(stubs,`import React from 'react';
const uid=(n)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const listeners=new Set();let version=0;const sub=f=>{listeners.add(f);return()=>listeners.delete(f)};const snap=()=>version;
export const state={kind:'create',status:'ready',referenceStatus:'ready',historyStatus:'ready',count:60,closeCalls:0,saves:[],toasts:[]};
export const setState=patch=>{Object.assign(state,patch);version++;listeners.forEach(f=>f())};
export const useAuditState=()=>{useStateSignal();return state};
const useStateSignal=()=>React.useSyncExternalStore(sub,snap);
export const users=Array.from({length:1200},(_,i)=>({id:uid(100+i),name:'Corretor Sintético '+String(i+1).padStart(4,'0')+' Nome Longo de Teste',email:'pessoa'+i+'@example.invalid',is_active:true}));
export const teams=Array.from({length:80},(_,i)=>({id:uid(2000+i),name:'Equipe Sintética '+(i+1)+' Nome Longo de Teste',is_active:true,members:users.slice(i*5,i*5+5).map(u=>({user_id:u.id}))}));
export const pipelines=Array.from({length:28},(_,i)=>({id:uid(3000+i),name:'Pipeline Sintético '+(i+1)+' Nome extenso para testar quebra e truncamento'}));
export const stages=Array.from({length:8},(_,i)=>({id:uid(4000+i),name:'Estágio Sintético '+(i+1),color:'#ef8844'}));
export const tags=Array.from({length:80},(_,i)=>({id:uid(5000+i),name:'Tag Sintética '+(i+1)+' nome comprido',color:'#ef8844'}));
export const metaForms=Array.from({length:60},(_,i)=>({config_id:uid(6000+i),form_id:'form-'+i,form_name:'Formulário Meta Sintético '+i+' nome extenso',page_id:'page-'+i,page_name:'Página Sintética',is_active:true,round_robin_id:null}));
export const queue={id:uid(7000),revision:3,name:'Fila Sintética de Teste',strategy:'weighted',is_active:true,organization_id:'org-a',created_by:'viewer',created_at:'2026-10-21T12:00:00Z',updated_at:'2026-10-21T12:00:00Z',leads_distributed:0,target_pipeline_id:pipelines[0].id,target_stage_id:stages[0].id,rules:[{id:uid(7100),match_type:'source',match_value:'facebook',is_active:true}],members:users.slice(0,3).map((u,i)=>({id:uid(7200+i),user_id:u.id,is_active:true,weight:1,position:i,user:u})),settings:{enable_redistribution:false,reentry_behavior:'redistribute'}};
const result=data=>{useStateSignal();return {data:state.referenceStatus==='loading'?[]:data,isPending:state.referenceStatus==='loading',isLoading:state.referenceStatus==='loading',isFetching:false,isError:state.referenceStatus==='error',refetch:async()=>({data,isError:false})}};
export const usePipelines=()=>result(pipelines);export const useStages=id=>result(id?stages:[]);export const useTeams=()=>result(teams);export const useOrganizationUsers=()=>result(users.slice(0,state.count));export const useTags=()=>result(tags);export const useProperties=()=>result([]);export const useWebhooks=()=>result([{id:uid(8000),name:'Webhook Sintético',type:'incoming',is_active:true}]);
export const useRoundRobinMetaForms=()=>result(metaForms);export const useRoundRobinWhatsAppSessions=()=>result([{id:uid(8100),display_name:'Conexão de teste',instance_name:'synthetic',status:'connected',is_active:true}]);
export const useOrganizationModules=()=>({hasModule:()=>false});
export const useAuth=()=>{const actor=state.actor||'viewer',sid=state.sid||'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';return {activeOrganization:{organizationId:'org-a'},profile:{id:actor},user:{id:actor},session:{access_token:'synthetic.'+btoa(JSON.stringify({sub:actor,session_id:sid}))+'.synthetic'}}};
export const useUserPermissions=()=>{useStateSignal();return {isLoading:false,hasPermission:()=>state.status!=='denied'}};
export const useUserAccessScope=()=>({isAdmin:true,isTeamLeader:false,ledTeamIds:[],ledUserIds:[],ledPipelineIds:[],isLoading:false});
export class VimobAPIError extends Error{constructor(message,opts={}){super(message);Object.assign(this,opts)}};
export const useRoundRobin=()=>{useStateSignal();return {data:state.status==='ready'?{...queue,...(state.queuePatch||{})}:undefined,isLoading:state.status==='loading',isError:state.status==='error'||state.status==='missing',error:state.status==='missing'?new VimobAPIError('missing',{status:404}):state.status==='error'?new Error('synthetic load failure'):null,refetch:async()=>{state.retryCalls=(state.retryCalls||0)+1;if(state.reloadStatus==='defer')await new Promise((resolve,reject)=>{state.resolveReload=resolve;state.rejectReload=reject});return state.reloadStatus==='error-with-cache'?{data:queue,error:new Error(state.reloadErrorMessage||'Synthetic refetch failed'),isError:true}:{data:queue}}}};
const save=async data=>{state.saves.push(data);if(state.saveStatus==='error')throw new Error(state.saveErrorMessage||'Falha sintética de salvamento');if(state.saveStatus==='defer')await new Promise((resolve,reject)=>{state.resolveSave=resolve;state.rejectSave=reject});return {...queue,...data,revision:4,members:data.members.map((m,i)=>({id:m.id||uid(9000+i),user_id:m.type==='user'?m.entityId:null,team_id:m.type==='team'?m.entityId:m.teamId||null,is_active:m.isActive!==false,weight:m.weight,position:i,user:users.find(u=>u.id===m.entityId)}))}};
export const useCreateQueueAdvanced=()=>({mutateAsync:save});export const useUpdateQueueAdvanced=()=>({mutateAsync:save});
export const useRoundRobinHistory=()=>{useStateSignal();return {data:{pages:state.historyPages||[]},isPending:state.historyStatus==='loading',isLoading:state.historyStatus==='loading',isError:state.historyStatus==='error',isFetchNextPageError:state.historyStatus==='error'&&state.historyIsNextPageError,isFetching:state.historyStatus==='fetching',isFetchingNextPage:state.historyStatus==='fetching',hasNextPage:state.historyHasNextPage||false,refetch:async()=>{state.historyRetries=(state.historyRetries||0)+1;setState({historyStatus:'ready',historyIsNextPageError:false})},fetchNextPage:async()=>{state.historyMoreCalls=(state.historyMoreCalls||0)+1;if(state.historyNextFail){setState({historyStatus:'error',historyIsNextPageError:true});return}setState({historyPages:[...(state.historyPages||[]),...(state.historyNextPage?[state.historyNextPage]:[])],historyStatus:'ready',historyHasNextPage:false,historyIsNextPageError:false})}}};
export const useCreateTag=()=>({isPending:false,mutateAsync:async()=>{throw new Error('Not enabled in audit')}});
export const toast={success:message=>state.toasts.push(message),error:message=>state.toasts.push(message),info:message=>state.toasts.push(message)};
export const AppLayout=({children})=><main data-synthetic-layout>{children}</main>;
export const useRouter=()=>({push:href=>{state.closeCalls++;state.destination=href},replace:href=>{state.destination=href}});
export const ProductUpdatesDialog=()=>null;
export const PropertyPickerDialog=()=>null;
export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}
`);
await writeFile(entry,`import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import Screen from '@/components/features/round-robin/DistributionQueueEditorScreen';import {state,setState,useAuditState} from './boundaries';const client=new QueryClient();window.fixture={state,setState};function App(){useAuditState();return <QueryClientProvider client={client}><Screen key={state.kind} mode={state.kind} {...(state.kind==='edit'?{queueId:'00000000-0000-4000-8000-000000007000'}:{})}/></QueryClientProvider>}createRoot(document.getElementById('app')).render(<App/>);`);
const boundaries=['contexts/AuthContext','hooks/use-stages','hooks/use-teams','hooks/use-users','hooks/use-tags','hooks/use-properties','hooks/use-organization-modules','hooks/use-webhooks','hooks/use-round-robins','hooks/use-user-access-scope','hooks/use-user-permissions','hooks/use-create-queue-advanced','lib/api/vimob-client','components/shared/layout/AppLayout','components/features/news','components/features/properties/PropertyPickerDialog'];
const aliases=Object.fromEntries(boundaries.map(n=>['@/'+n+'$',stubs]));
const {webpack}=require('next/dist/compiled/webpack/webpack');
await new Promise((resolve,reject)=>{const compiler=webpack({mode:'development',target:'web',devtool:false,entry,output:{path:dir,filename:'fixture.js'},resolve:{extensions:['.tsx','.ts','.js'],alias:{...aliases,'sonner$':stubs,'next/link$':stubs,'next/navigation$':stubs,'@':root},modules:[path.join(root,'node_modules'),'node_modules']},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:loader}]},optimization:{minimize:false,usedExports:true}});compiler.run((err,stats)=>compiler.close(()=>err||stats?.hasErrors()?reject(err||new Error(stats.toString({all:false,errors:true}))):resolve()))});
const source=(await readFile(path.join(root,'app/globals.css'),'utf8')).replace('@import "tailwindcss";','@import "tailwindcss" source(none);');
const cssSources=['components/features/round-robin','components/ui','components/shared/forms','components/shared/SearchableTagPicker.tsx','config/form-wizard.ts','config/filter-ui.ts'];
const css=await require('postcss')([require('@tailwindcss/postcss')({base:root})]).process(source+'\n'+cssSources.map(s=>'@source "'+root.replaceAll('\\','/')+'/'+s+'";').join('\n'),{from:path.join(root,'app/distribution-audit-fixture.css')});
await writeFile(path.join(dir,'fixture.css'),css.css);

 const {chromium}=require('@playwright/test');
 const browser=await chromium.launch({headless:true});
 async function openFixture(browser,{width=1440,height=900,kind='create',...state}={}){
  const page=await browser.newPage({viewport:{width,height}});page.setDefaultTimeout(6000);
  const errors=[],network=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{const url=route.request().url();network.push(url);return url==='http://distribution-fixture.local/'?route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>'+css+'</style></head><body><div id="app"></div></body></html>'}):route.abort()});
  const css=await readFile(path.join(dir,'fixture.css'),'utf8');
  await page.goto('http://distribution-fixture.local/');
  await page.addScriptTag({content:await readFile(path.join(dir,'fixture.js'),'utf8')});
  await page.waitForFunction(()=>Boolean(window.fixture));
  await page.evaluate(patch=>{window.sessionStorage.clear();window.fixture.setState(patch)}, {kind,...state});
  await page.getByRole('dialog').waitFor();
  await page.waitForTimeout(80);
  return {page,errors,network};
}

 return {open:options=>openFixture(browser,options),async close(){await browser.close();await rm(dir,{recursive:true,force:true})}};
 }catch(error){await rm(dir,{recursive:true,force:true});throw error}
}
