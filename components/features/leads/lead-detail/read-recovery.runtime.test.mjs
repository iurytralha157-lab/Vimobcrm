import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// Real useLead, QueryClient, recovery policy/notice, PipelineDialogs and final
// LeadDetailDialog mobile/desktop JSX. Private panels/overlays are probes; auth
// and GET responses are synthetic. Every external browser request is blocked.
const require = createRequire(import.meta.url), ts = require('typescript');
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const artifacts = process.env.LEAD_READ_RECOVERY_ARTIFACT_DIR;
let directory, browser, bundle, css;

function presentation(source) {
  const ast = ts.createSourceFile('LeadDetailDialog.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const detail = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'LeadDetailDialog');
  assert.ok(detail?.body);
  const declaration = name => {
    let value;
    const visit = node => { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) value = node; ts.forEachChild(node, visit); };
    visit(detail); assert.ok(value, name); return `const ${value.getText(ast)};`;
  };
  const guard = detail.body.statements.find(node => ts.isIfStatement(node) && node.expression.getText(ast).includes('!leadProp || !localLead || readAccessBlocked'));
  const mobile = detail.body.statements.find(node => ts.isIfStatement(node) && node.expression.getText(ast) === 'isMobile || isTablet');
  const desktop = detail.body.statements.filter(ts.isReturnStatement).at(-1);
  assert.ok(guard && mobile && desktop);
  const notice = name => {
    let body, element;
    const findBody = node => { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) body = node.initializer; ts.forEachChild(node, findBody); };
    findBody(detail);
    const findNotice = node => { if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'LeadDetailReadNotice') element = node.getText(ast); ts.forEachChild(node, findNotice); };
    if (body) findNotice(body);
    return element || 'null';
  };
  return { guard: guard.getText(ast), mobile: mobile.getText(ast), desktop: desktop.getText(ast),
    capability: declaration('canOperateLead'), mobileNotice: notice('MobileContentV2'), desktopNotice: notice('DesktopContentV2') };
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vimob-lead-read-recovery-'));
  if (artifacts) await mkdir(artifacts, { recursive: true });
  const source = await readFile(process.env.LEAD_DETAIL_RECOVERY_SOURCE || join(repository, 'components/features/leads/LeadDetailDialog.tsx'), 'utf8');
  const view = presentation(source), entry = join(directory, 'entry.tsx'), probe = join(directory, 'detail.tsx'), stub = join(directory, 'synthetic.tsx'), loader = join(directory, 'loader.cjs'), empty = join(directory, 'empty.tsx');
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;`);
  await writeFile(empty, 'export const StageSettingsDialog=()=>null;export const PipelineAttentionSettings=StageSettingsDialog,StagesEditorDialog=StageSettingsDialog,CreateLeadDialog=StageSettingsDialog;');
  await writeFile(stub, `import React,{createContext,useContext}from'react';export const Auth=createContext(null),useAuth=()=>useContext(Auth);export class VimobAPIError extends Error{constructor(message,details={}){super(message);Object.assign(this,details)}}
    export const getVimobAPIAccessTokenUserId=()=>window.h.ctx.actor,getVimobAPIAccessTokenSessionId=()=>window.h.ctx.sid;
    export const toast={error:()=>{},success:()=>{},warning:()=>{}},enforceClientActionRateLimit=()=>{},getClientRateLimitMessage=()=>null,stringifyErrorMessage=String,invalidateLeadHistorySoon=()=>{},runLeadImportBatch=()=>{},notifyLeadRealtimeChange=()=>{};
    export const leadsAPI={getLead(id,org,signal){const request={id,org,aborted:false};signal?.addEventListener('abort',()=>{request.aborted=true});const index=window.h.requests.push(request)-1;return new Promise((resolve,reject)=>{window.h.pending[index]={resolve(data){resolve({data,error:null})},reject(status){reject(new VimobAPIError('Synthetic read rejection',{status}))}})}};`);
  await writeFile(probe, `import React,{useState,useEffect}from'react';import{useLead}from'@/hooks/use-leads';import{useAuth}from'./synthetic';import{canOperateLeadFromFreshRead}from'@/lib/lead-operation-capability';
    import{getLeadDetailReadState}from'@/components/features/leads/lead-detail/read-recovery';import{LeadDetailReadNotice}from'@/components/features/leads/lead-detail/LeadDetailReadNotice';
    import{Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription}from'@/components/ui/dialog';import{Drawer,DrawerContent,DrawerTitle,DrawerDescription}from'@/components/ui/drawer';import{cn}from'@/lib/utils';
    export function LeadDetailDialog({lead:leadProp,onClose,variant='pipeline',verifiedRead,readAccessPending=false,readAccessBlocked=false}){
      const{activeOrganization}=useAuth(),leadId=leadProp?.id,localLead=leadProp,leadName=leadProp?.name;
      const fullLeadQuery=useLead(leadId,{freshOnMount:true,verifiedRead});const detailReadState=getLeadDetailReadState({leadId,organizationId:activeOrganization.organizationId,leadOrganizationId:leadProp?.organization_id,query:fullLeadQuery,verifiedRead});
      const retryLeadRead=()=>{if(detailReadState.canRetry)void fullLeadQuery.refetch({cancelRefetch:false})};
      const isMobile=innerWidth<768,isTablet=innerWidth>=768&&innerWidth<1024,pipelineDetailStyles={};
      const hasLeadOperatePermission=window.h.allowed,poolReadOnly=false,isUpdatingAssignee=false,updateLead={isPending:false},recordLeadFeedback={isPending:false},dealStatusChange={isPending:false},stageMovePending=false;
      ${view.capability}
      const[draft,setDraft]=useState(''),[overlayOpen,setOverlayOpen]=useState(false);useEffect(()=>{window.h.mounts++;return()=>{window.h.unmounts++}},[]);
      const handleCloseLeadDetail=onClose;window.h.query=fullLeadQuery;window.h.detail={state:detailReadState,canOperate:canOperateLead,draft};
      ${view.guard}
      const content=mobile=><div className='flex min-h-0 flex-1 flex-col'><DialogHeader className='sr-only'><DialogTitle>{leadName}</DialogTitle><DialogDescription>Dados sintéticos.</DialogDescription></DialogHeader>
        {mobile?${view.mobileNotice}:${view.desktopNotice}}<section data-private-panel className='p-3'><h2>{leadName}</h2><label>Rascunho<textarea aria-label='Rascunho do lead' value={draft} onChange={event=>setDraft(event.target.value)}/></label><button type='button' disabled={!canOperateLead} onClick={()=>setOverlayOpen(true)}>Abrir overlay de prova</button></section></div>;
      const MobileContentV2=()=>content(true),DesktopContentV2=()=>content(false);
      const overlays=<Dialog open={overlayOpen} onOpenChange={setOverlayOpen}><DialogContent><DialogTitle>Overlay privado {leadName}</DialogTitle><DialogDescription>Confirmação sintética.</DialogDescription><button disabled={!canOperateLead}>Salvar operação sintética</button></DialogContent></Dialog>;
      ${view.mobile}
      ${view.desktop}
    }`);
  await writeFile(entry, `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{PipelineDialogs}from'@/components/features/pipelines/pipeline-screen/PipelineDialogs';import{Auth}from'./synthetic';
    const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:600000,gcTime:Infinity,refetchOnMount:false,refetchOnWindowFocus:false,retryDelay:0}}}),root=createRoot(document.getElementById('root'));
    const h=window.h={requests:[],pending:[],closed:0,outerRetries:0,mounts:0,unmounts:0,allowed:true,ctx:{id:'lead-a',org:'org-a',actor:'actor-a',sid:'sid-a',version:1}};
    h.lead=(patch={})=>({id:h.ctx.id,organization_id:h.ctx.org,name:'PRIVATE SYNTHETIC '+h.ctx.id,assigned_user_id:'owner',team_id:'team',can_operate:true,updated_at:'2026-10-17T10:00:00Z',...patch});
    h.cache=()=>client.getQueryState(['lead',h.ctx.org,h.ctx.id]);h.seed=data=>client.setQueryData(['lead',h.ctx.org,h.ctx.id],data);h.read=(org,id)=>client.getQueryData(['lead',org,id]);
    function Fixture(){const[ctx,setContext]=useState(h.ctx),[opened,setOpened]=useState(true),[outer,setOuter]=useState(false),[tick,setTick]=useState(0);h.change=patch=>setContext(current=>{const next={...current,...patch,version:current.version+1};h.ctx=next;return next});h.outer=setOuter;h.allow=value=>{h.allowed=value;setTick(tick+1)};
      const token='e30.'+btoa(JSON.stringify({sub:ctx.actor,session_id:ctx.sid}))+'.synthetic',auth={activeOrganization:{organizationId:ctx.org},user:{id:ctx.actor},profile:{id:ctx.actor},session:{access_token:token}};
      return <Auth.Provider value={auth}><QueryClientProvider client={client}><PipelineDialogs key={ctx.org+':'+ctx.id+':'+ctx.actor+':'+ctx.sid+':'+ctx.version} selectedLead={opened?h.lead():null} selectedLeadLoading={outer} selectedLeadAccessBlocked={outer} selectedLeadAccessPending={false} onRetrySelectedLeadAccess={()=>{h.outerRetries++;setOuter(false)}} onCloseSelectedLead={()=>{h.closed++;setOpened(false)}} stages={[]} allTags={[]} users={[]} newPipelineName='' newStageName='' currentPipelineName='' newStageColor='' normalizedNewStageColor=''/></QueryClientProvider></Auth.Provider>;
    }root.render(<Fixture/>);`);
  const aliases = Object.fromEntries(['contexts/AuthContext','lib/api/leads','lib/api/vimob-client','lib/api/vimob-error','lib/client-action-rate-limit','hooks/use-optimistic-lead-history','lib/lead-import-batch','contexts/LeadRealtimeBus'].map(name => [`@/${name}$`, stub]));
  Object.assign(aliases, { '@/components/features/leads/LeadDetailDialog$': probe, 'sonner$': stub });
  for (const name of ['StageSettingsDialog','PipelineAttentionSettings','StagesEditorDialog']) aliases[`@/components/features/pipelines/${name}$`] = empty;
  aliases['@/components/features/leads/CreateLeadDialog$'] = empty;
  const { webpack } = require('next/dist/compiled/webpack/webpack');
  await new Promise((done, reject) => { const compiler = webpack({ mode:'development',target:'web',devtool:false,entry,output:{path:directory,filename:'fixture.js'},plugins:[new webpack.optimize.LimitChunkCountPlugin({maxChunks:1})],resolve:{extensions:['.tsx','.ts','.js'],alias:{...aliases,'@':repository},modules:[join(repository,'node_modules'),'node_modules']},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:loader}]}});compiler.run((error,stats)=>compiler.close(()=>error||stats.hasErrors()?reject(error||Error(stats.toString({all:false,errors:true}))):done())); });
  bundle = await readFile(join(directory,'fixture.js'),'utf8');
  const globals = (await readFile(join(repository,'app/globals.css'),'utf8')).replace('@import "tailwindcss";','@import "tailwindcss" source(none);');
  const sources=['components/features/leads/LeadDetailDialog.tsx','components/features/leads/lead-detail/LeadDetailReadNotice.tsx','components/features/pipelines/pipeline-screen/PipelineLeadLoadingDialog.tsx','components/ui'].map(file=>`@source "${join(repository,file).replaceAll('\\','/')}";`).join('\n');
  css=(await require('postcss')([require('@tailwindcss/postcss')({base:repository})]).process(`${globals}\n${sources}`,{from:join(repository,'app/globals.css')})).css;
  browser=await chromium.launch({headless:true});
}, {timeout:120_000});

after(async()=>{await browser?.close();if(directory){assert.equal(dirname(resolve(directory)),resolve(tmpdir()));assert.ok(directory.split(/[/\\]/).at(-1).startsWith('vimob-lead-read-recovery-'));await rm(directory,{recursive:true,force:true})}});

async function open(t,width=390,height=844){
  const page=await browser.newPage({viewport:{width,height}}),errors=[];page.setDefaultTimeout(5_000);page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>route.abort());
  t.after(async()=>{await page.close();assert.deepEqual(errors,[])});await page.setContent('<html class="light"><body><div id="root"></div></body></html>');await page.addStyleTag({content:css});await page.addScriptTag({content:bundle});await page.getByLabel('Rascunho do lead',{exact:true}).waitFor();await page.waitForFunction(()=>window.h.requests.length>0);return page;
}
async function resolveRead(page,index=0,patch={}){await page.evaluate(({index,patch})=>window.h.pending[index].resolve(window.h.lead(patch)),{index,patch});try{await page.waitForFunction(()=>window.h.detail?.state.kind==='ready')}catch(error){throw new Error(error.message+' '+JSON.stringify(await page.evaluate(()=>({detail:window.h.detail,requests:window.h.requests,cache:window.h.cache(),query:{status:window.h.query?.status,error:String(window.h.query?.error),data:window.h.query?.data,fetchStatus:window.h.query?.fetchStatus}}))))}}
async function fail(page,status,index=0){await page.evaluate(({status,index})=>window.h.pending[index].reject(status),{status,index});}
const notice=page=>page.locator('[data-lead-read-notice]');

for(const[width,height]of[[320,568],[768,1024],[1366,768]])test(`initial pending and stale read error are explained once and preserve the draft at ${width}`,async t=>{
  const page=await open(t,width,height);assert.equal(await notice(page).count(),1);assert.equal(await page.getByRole('button',{name:'Abrir overlay de prova'}).isDisabled(),true);
  await resolveRead(page);assert.equal(await notice(page).count(),0);await page.getByLabel('Rascunho do lead').fill('Rascunho não salvo');
  await page.evaluate(()=>void window.h.query.refetch({cancelRefetch:false}));await page.waitForFunction(()=>window.h.requests.length===2);assert.equal(await notice(page).count(),1);assert.equal(await page.getByRole('button',{name:'Abrir overlay de prova'}).isDisabled(),true);
  // useLead retries transient failures. Reject each attempt until Query reaches idle.
  for(let index=1;index<5;index++){await fail(page,503,index);if(index<4)await page.waitForFunction(count=>window.h.requests.length>=count,index+2)}
  await page.getByRole('button',{name:'Tentar novamente',exact:true}).waitFor();assert.equal(await notice(page).count(),1);assert.equal(await page.getByLabel('Rascunho do lead').inputValue(),'Rascunho não salvo');
  await page.getByRole('button',{name:'Tentar novamente',exact:true}).click();await page.waitForFunction(()=>window.h.requests.length===6);assert.equal(await page.getByRole('button',{name:'Atualizando…',exact:true}).isDisabled(),true);
  assert.equal(await page.getByRole('button',{name:'Abrir overlay de prova'}).isDisabled(),true);await resolveRead(page,5);assert.equal(await notice(page).count(),0);assert.equal(await page.getByRole('button',{name:'Abrir overlay de prova'}).isDisabled(),false);assert.equal(await page.getByLabel('Rascunho do lead').inputValue(),'Rascunho não salvo');
  if(artifacts)await page.screenshot({path:join(artifacts,`read-recovered-${width}.png`)});
});

for(const width of[390,1366])for(const status of[401,403,404])test(`HTTP ${status} hides detail, title and overlays at ${width}`,async t=>{
  const page=await open(t,width);await resolveRead(page);await page.getByRole('button',{name:'Abrir overlay de prova'}).click();await page.getByRole('dialog',{name:/Overlay privado/}).waitFor();
  await page.evaluate(()=>void window.h.query.refetch({cancelRefetch:false}));await page.waitForFunction(()=>window.h.requests.length===2);
  await fail(page,status,1);
  if(status===401){for(let index=2;index<5;index++){await page.waitForFunction(count=>window.h.requests.length>=count,index+1);await fail(page,status,index)}}
  await page.waitForFunction(()=>window.h.detail?.state.hideDetails&&!window.h.query.isFetching);
  assert.equal(await page.getByText(/PRIVATE SYNTHETIC/).count(),0);assert.equal(await page.locator('[data-private-panel]').count(),0);assert.equal(await page.getByRole('dialog',{name:/Overlay privado/}).count(),0);assert.equal(await notice(page).count(),1);
  await page.getByRole('button',{name:'Fechar',exact:true}).click();assert.equal(await page.evaluate(()=>window.h.closed),1);
});

test('a successful null hides private content and offers recovery',async t=>{
  const page=await open(t);await page.evaluate(()=>window.h.pending[0].resolve(null));await page.waitForFunction(()=>window.h.detail?.state.hideDetails);assert.equal(await page.locator('[data-private-panel]').count(),0);assert.equal(await notice(page).count(),1);await page.getByRole('button',{name:'Tentar novamente',exact:true}).waitFor();
});

test('wrong lead data inserted in the current cache cannot enable actions or display another identity',async t=>{
  const page=await open(t);await resolveRead(page);await page.evaluate(()=>window.h.seed(window.h.lead({id:'foreign-lead',name:'FOREIGN PRIVATE'})));await page.waitForFunction(()=>window.h.detail?.state.hideDetails);assert.equal(await page.getByText(/PRIVATE/).count(),0);assert.equal(await page.getByRole('button',{name:'Abrir overlay de prova'}).count(),0);assert.equal(await notice(page).count(),1);
});

test('a valid read-only result does not show a recovery error or expose write actions',async t=>{
  const page=await open(t);await resolveRead(page,0,{can_operate:false});assert.equal(await notice(page).count(),0);assert.equal(await page.getByRole('button',{name:'Abrir overlay de prova'}).isDisabled(),true);assert.equal(await page.locator('[data-private-panel]').count(),1);
});

test('the outer access failure owns the only recovery dialog while inner drafts remain mounted',async t=>{
  const page=await open(t);await resolveRead(page);await page.getByLabel('Rascunho do lead').fill('Preservar');await page.evaluate(()=>window.h.outer(true));await page.getByTestId('pipeline-lead-loading').waitFor();assert.equal(await notice(page).count(),0);assert.equal(await page.locator('[data-private-panel]').count(),0);assert.equal(await page.getByRole('button',{name:'Tentar novamente',exact:true}).count(),1);await page.getByRole('button',{name:'Tentar novamente',exact:true}).click();await page.getByLabel('Rascunho do lead').waitFor();assert.equal(await page.getByLabel('Rascunho do lead').inputValue(),'Preservar');assert.equal(await page.evaluate(()=>window.h.outerRetries),1);
});

for(const patch of[{id:'lead-b'},{org:'org-b'},{sid:'sid-b'}])test(`a late read cannot restore the previous dialog scope ${JSON.stringify(patch)}`,async t=>{
  const page=await open(t);await page.evaluate(patch=>window.h.change(patch),patch);await page.waitForFunction(()=>window.h.requests.length===2);await resolveRead(page,1);await page.evaluate(()=>window.h.pending[0].resolve({id:'lead-a',organization_id:'org-a',name:'OLD PRIVATE',can_operate:true}));await page.waitForFunction(()=>window.h.detail?.state.kind==='ready');assert.equal(await page.getByText('OLD PRIVATE',{exact:true}).count(),0);assert.equal(await page.evaluate(()=>window.h.detail.canOperate),true);assert.equal(await notice(page).count(),0);assert.equal(await page.locator('[data-private-panel]').count(),1);
});
