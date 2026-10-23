import assert from 'node:assert/strict';
import {before, after, test} from 'node:test';
import {mkdtemp, readFile, writeFile, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve, isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {chromium} from '@playwright/test';
import ts from 'typescript';

// Real cadence panel, overlays, outcome dialog, draft/scope hooks and handlers.
// Only transport/chat and unrelated overlays are synthetic; every network aborts.
const require=createRequire(import.meta.url),{webpack}=require('next/dist/compiled/webpack/webpack.js');
const repository=resolve(dirname(fileURLToPath(import.meta.url)),'../../../..');
const relativeDetail='components/features/leads/LeadDetailDialog.tsx';
const artifacts=process.env.CADENCE_MESSAGE_OUTCOME_ARTIFACT_DIR;
const sourceRoot=process.env.CADENCE_MESSAGE_OUTCOME_SOURCE_ROOT||repository;
assert.ok(isAbsolute(sourceRoot),'Handler source root must be an explicit absolute path');
process.env.RAYON_NUM_THREADS||='1';
let directory,browser,bundle,css,sourceHash;
const results=[],runtimeErrors=[],requests=[];

async function productionHandlers(){
  const source=await readFile(join(sourceRoot,relativeDetail),'utf8');
  sourceHash=createHash('sha256').update(source).digest('hex');
  const ast=ts.createSourceFile(relativeDetail,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  return ['openLeadWhatsApp','handleToggleCadenceTask','handleOutcomeConfirm','handleCadenceTaskClick','handleRoteiroAction'].map(name=>{
    let declaration;const visit=node=>{if(ts.isVariableDeclaration(node)&&node.name.getText(ast)===name)declaration=node.getText(ast);ts.forEachChild(node,visit)};
    visit(ast);assert.ok(declaration,`Production handler missing: ${name}`);return `const ${declaration};`;
  }).join('\n');
}

async function productionOverlayAttribute(name){
  const source=await readFile(join(repository,relativeDetail),'utf8');
  const ast=ts.createSourceFile(relativeDetail,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let expression;
  const visit=node=>{if(ts.isJsxSelfClosingElement(node)&&node.tagName.getText(ast)==='LeadDetailOverlays')for(const attribute of node.attributes.properties)if(ts.isJsxAttribute(attribute)&&attribute.name.getText(ast)===name&&ts.isJsxExpression(attribute.initializer))expression=attribute.initializer.expression.getText(ast);ts.forEachChild(node,visit)};
  visit(ast);assert.ok(expression,`Production overlay attribute missing: ${name}`);return expression;
}

before(async()=>{
  directory=await mkdtemp(join(tmpdir(),'vimob-cadence-message-outcome-'));
  if(artifacts)await mkdir(artifacts,{recursive:true});
  const loader=join(directory,'loader.cjs'),empty=join(directory,'unrelated.js'),entry=join(directory,'entry.tsx');
  await writeFile(loader,`const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=function(source){return ts.transpileModule(source,{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;}`);
  await writeFile(empty,'export const EventSheet=()=>null,LeadAttachmentViewer=()=>null,LostReasonDialog=()=>null;');
  await writeFile(entry,`
import React,{useRef,useState}from'react';import{createRoot}from'react-dom/client';
import{QueryClient,QueryClientProvider,useQueryClient}from'@tanstack/react-query';
import{LeadCadencePanel}from'@/components/features/leads/LeadCadencePanel';
import{LeadDetailOverlays}from'@/components/features/leads/lead-detail/LeadDetailOverlays';
import{useLeadOutcomeDraft}from'@/hooks/leads/use-lead-outcome-draft';
import{useLeadDetailOperationScope}from'@/hooks/leads/use-lead-detail-operation-scope';
import{getCadenceTaskType,OUTCOME_CADENCE_TASK_TYPES}from'@/components/features/leads/lead-detail/utils';
const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
const h=window.h={instance:0,visible:true,overlaysVisible:true,allowed:true,access:true,accessEpoch:0,status:'open',requests:[],history:[],genericActivities:0,firstResponses:0,prepared:[],notices:[],closed:0,ledger:new Map()};
const lead={id:'10000000-0000-4000-8000-000000000001',organization_id:'20000000-0000-4000-8000-000000000001',name:'Lead sintético',empresa:'Empresa sintética',email:'lead@example.invalid',phone:'+5511999999999',deal_status:'open'};
h.configure=({observation,required,phone=true})=>{h.task={id:'30000000-0000-4000-8000-000000000001',template_task_id:'40000000-0000-4000-8000-000000000001',type:'message',title:'Mensagem sintética de cadência',status:'pending',is_done:false,is_required:true,outcome_required:required,position:0,due_at:null,observation:observation?'Roteiro sintético: confirme a necessidade do cliente.':null,recommended_message:'Olá {nome}, aqui é {empresa}. Confirme seu e-mail: {email}.'};lead.phone=phone?'+5511999999999':null;h.render()};
const toast=Object.fromEntries(['warning','error','success','info'].map(kind=>[kind,message=>h.notices.push({kind,message})]));
const noop=()=>{};
function Fixture(){
  const queryClient=useQueryClient(),canOperateLead=h.allowed,poolReadOnly=false,canOperateLeadWhatsApp=true,canViewLeadWhatsApp=true,localLead=lead;
  const activeOrganization={organizationId:lead.organization_id},profile={id:'actor-a'},canManageLeadSchedule=false,hasAgendaModule=false;
  const leadCadenceState={lead_id:lead.id,deal_status:h.status,stage_name:'Atendimento',time_zone:'America/Sao_Paulo',cadence_enabled:true,enrollment:{id:'enrollment-a',started_at:'2026-10-19T12:00:00Z'},tasks:h.task?[h.task]:[],summary:{total:1,completed:h.task?.is_done?1:0,pending:h.task?.is_done?0:1,overdue:0,next_task_id:h.task?.id}};
  const[selectedTask,setSelectedTask]=useState(null),[taskInspectOnly,setTaskInspectOnly]=useState(false),[roteiroDialogOpen,setRoteiroDialogOpen]=useState(false);
  const[taskForOutcome,setTaskForOutcome]=useState(null),[outcomeDialogOpen,setOutcomeDialogOpen]=useState(false),[cadenceActionPending,setCadenceActionPending]=useState(false);
  const cadenceActionPendingRef=useRef(false),cadenceOrganizationId=lead.organization_id;
  const outcomeDraft=useLeadOutcomeDraft('org-a:lead-a:actor-a:sid-a:cadence:'+(taskForOutcome?.id||''));
  const captureCadenceFeedbackOperation=useLeadDetailOperationScope(lead.id,lead.organization_id,'actor-a',queryClient,canOperateLead,'sid-a');
  // Synthetic access transport survives normal popup close, but not revoked access.
  const requestScope={capture:()=>{const epoch=h.accessEpoch;return{canReconcileCapturedAccess:()=>h.access&&h.accessEpoch===epoch}}};
  const completeCadenceTask={isPending:false,mutateAsync:body=>new Promise((resolve,reject)=>h.requests.push({body:{...body},resolve,reject}))};
  const recordFirstResponse=async()=>{h.firstResponses++};
  const createActivityMutation={mutate:()=>{h.genericActivities++;throw Error('Generic activity is forbidden in cadence completion')},mutateAsync:async()=>{h.genericActivities++;throw Error('Generic activity is forbidden in cadence completion')}};
  const setEditingScheduleEvent=noop,setScheduleDefaultType=noop,setScheduleFormOpen=noop;
  const handleCloseLeadDetail=()=>{h.closed++;h.visible=false;setRoteiroDialogOpen(false);setSelectedTask(null);h.render()};
  const openNewChatWithMessage=(phone,message,leadId,leadName)=>{h.prepared.push({phone,message,leadId,leadName})};
  const openNewChat=()=>{throw Error('Expected prepared message, not empty chat')};
  ${await productionHandlers()}
  h.currentDraft=outcomeDraft.draft;h.busy=cadenceActionPending;h.handlers={handleCadenceTaskClick,handleRoteiroAction,handleOutcomeConfirm};
  if(!h.visible||!h.task)return null;
  return <main className='mx-auto flex h-[calc(100dvh-24px)] w-[calc(100vw-24px)] max-w-3xl flex-col p-3'>
    <LeadCadencePanel state={leadCadenceState} isLoading={false} canOperate={canOperateLead} isCompleting={cadenceActionPending} appearance='pipeline' variant={innerWidth<600?'mobile':'full'} onTaskClick={handleCadenceTaskClick} onTaskInspect={task=>{setTaskInspectOnly(true);setSelectedTask(task);setRoteiroDialogOpen(true)}}/>
    {h.overlaysVisible&&<LeadDetailOverlays lead={lead} leadName={lead.name} outcomeScopeKey='org-a:lead-a:actor-a:sid-a'
      selectedTask={${await productionOverlayAttribute('selectedTask')}} cadenceTimeZone={leadCadenceState.time_zone} taskInspectOnly={${await productionOverlayAttribute('taskInspectOnly')}} roteiroDialogOpen={roteiroDialogOpen} onRoteiroDialogOpenChange={setRoteiroDialogOpen} onRoteiroAction={handleRoteiroAction}
      taskForOutcome={taskForOutcome} outcomeDialogOpen={outcomeDialogOpen} onOutcomeDialogOpenChange={setOutcomeDialogOpen} onOutcomeConfirm={handleOutcomeConfirm} outcomeDraft={outcomeDraft.draft} onOutcomeDraftChange={outcomeDraft.updateDraft}
      quickActionOutcomeOpen={false} quickActionOutcomeType='call' onQuickActionOutcomeOpenChange={noop} onQuickActionOutcomeConfirm={()=>false}
      cadenceTaskPending={cadenceActionPending} quickActionPending={false} reopenStatusConfirmation={null} onReopenStatusConfirmationChange={noop} onConfirmReopen={noop} assigneeScheduleConfirmation={null} onAssigneeScheduleConfirmationChange={noop} onConfirmAssignee={noop} dealStatusPending={false} lostReasonDialogOpen={false} onLostReasonDialogOpenChange={noop} onConfirmLostReason={noop} selectedAttachment={null} onSelectedAttachmentChange={noop} hasAgendaModule={false} scheduleFormOpen={false} onCloseScheduleForm={noop} editingScheduleEvent={null} scheduleDefaultType='visit'/>}
  </main>;
}
const root=createRoot(document.getElementById('root'));h.render=()=>root.render(<QueryClientProvider client={client}><Fixture key={h.instance}/></QueryClientProvider>);
h.reopen=()=>{h.visible=true;h.instance++;h.render()};
h.commit=index=>{const request=h.requests[index],key=request.body.taskId;if(!h.ledger.has(key)){const canonical={id:key,lead_id:lead.id,is_done:true,status:'completed',outcome:request.body.outcome,outcome_notes:request.body.outcomeNotes};h.ledger.set(key,canonical);h.history.push({type:'task_completed',taskId:key,outcome:canonical.outcome,notes:canonical.outcome_notes})}return h.ledger.get(key)};
h.ack=index=>{const canonical=h.commit(index);h.task={...h.task,...canonical};h.requests[index].resolve(canonical);h.render()};
h.loseACK=index=>{h.commit(index);h.requests[index].reject(Error('Synthetic unknown ACK after canonical commit'))};
h.conflict=index=>{const request=h.requests[index],canonical={id:request.body.taskId,lead_id:lead.id,is_done:true,status:'completed',outcome:'not_seen',outcome_notes:'Resultado canônico de outra janela'};h.ledger.set(canonical.id,canonical);h.history.push({type:'task_completed',taskId:canonical.id,outcome:canonical.outcome,notes:canonical.outcome_notes});request.resolve(canonical)};
h.render();`);
  await new Promise((done,reject)=>{const compiler=webpack({mode:'development',target:'web',devtool:false,entry,output:{path:directory,filename:'fixture.js'},resolve:{extensions:['.tsx','.ts','.js'],modules:[join(repository,'node_modules'),'node_modules'],alias:{'@/components/features/schedule/EventSheet$':empty,'@/components/features/leads/LeadAttachmentViewer$':empty,'@/components/features/leads/LostReasonDialog$':empty,'@':repository}},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:loader}]}});compiler.run((error,stats)=>compiler.close(()=>error||stats.hasErrors()?reject(error||Error(stats.toString({all:false,errors:true}))):done()))});
  bundle=await readFile(join(directory,'fixture.js'),'utf8');
  const globals=(await readFile(join(repository,'app/globals.css'),'utf8')).replace('@import "tailwindcss";','@import "tailwindcss" source(none);');
  const cssSources=['components/features/leads/LeadCadencePanel.tsx','components/features/leads/lead-detail/LeadDetailOverlays.tsx','components/features/leads/TaskOutcomeDialog.tsx','components/ui',entry];
  css=(await require('postcss')([require('@tailwindcss/postcss')({base:repository})]).process(globals+'\n'+cssSources.map(file=>'@source '+JSON.stringify((isAbsolute(file)?file:join(repository,file)).replaceAll('\\','/'))+';').join('\n'),{from:join(repository,'app/globals.css')})).css;
  browser=await chromium.launch({headless:true});
});

after(async()=>{
  await browser?.close();
  if(artifacts)await writeFile(join(artifacts,`cadence-message-dom-${sourceRoot===repository?'current':'before'}-receipt.json`),JSON.stringify({sourceRoot,sourceHash,results,runtimeErrors,requests,limits:'Real panel/overlays/outcome dialog/draft/scope and AST production handlers; synthetic transport/chat and canonical ledger. Chromium viewport is not physical iPhone; no actual API, database, send or first-response service.'},null,2));
  if(directory){assert.equal(dirname(resolve(directory)),resolve(tmpdir()));assert.ok(directory.startsWith(join(tmpdir(),'vimob-cadence-message-outcome-')));await rm(directory,{recursive:true,force:true})}
});

async function fixture(t,width,observation,required,phone=true){
  const page=await browser.newPage({viewport:{width,height:860},hasTouch:width<600,isMobile:width<600});
  const errors=[],network=[];page.setDefaultTimeout(5000);let rejectRuntime;
  const failed=new Promise((_,reject)=>{rejectRuntime=reject});
  page.on('pageerror',error=>{errors.push(error.message);runtimeErrors.push(error.message);rejectRuntime(error)});
  await page.route('**/*',route=>{network.push(route.request().url());requests.push(route.request().url());return route.abort()});
  t.after(async()=>{try{assert.deepEqual(errors,[]);assert.deepEqual(network,[])}finally{await page.close()}});
  await Promise.race([failed,(async()=>{await page.setContent('<!doctype html><html class="light"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>');await page.addStyleTag({content:css});await page.addScriptTag({content:bundle});await page.evaluate(args=>window.h.configure(args),{observation,required,phone});await page.getByRole('button',{name:'Abrir Mensagem sintética de cadência',exact:true}).waitFor()})()]);
  return page;
}
function scenario(name,run){test(name,async t=>{try{await run(t);results.push({name,ok:true})}catch(error){results.push({name,ok:false,error:error.message});throw error}})}
const openTask=page=>page.getByRole('button',{name:'Abrir Mensagem sintética de cadência',exact:true}).click();
const script=page=>page.getByRole('dialog',{name:'Mensagem sintética de cadência',exact:true});
const notes=page=>page.getByPlaceholder('Adicione detalhes sobre essa tentativa...');
async function zeroSideEffects(page){assert.deepEqual(await page.evaluate(()=>({requests:window.h.requests.length,history:window.h.history.length,generic:window.h.genericActivities,first:window.h.firstResponses})),{requests:0,history:0,generic:0,first:0})}
async function startOutcome(page){await page.getByRole('button',{name:'Registrar resultado',exact:true}).click();await page.getByRole('radio').first().click();await notes(page).fill('Notas sintéticas da mensagem de cadência')}
async function confirm(page,count=1){await page.getByRole('button',{name:'Registrar',exact:true}).click();await page.waitForFunction(count=>window.h.requests.length===count,count)}
async function assertRetained(page){await page.getByRole('button',{name:'Registrar',exact:true}).waitFor();await page.waitForFunction(()=>!document.querySelector('textarea')?.disabled);assert.equal(await notes(page).inputValue(),'Notas sintéticas da mensagem de cadência');assert.equal(await page.getByRole('radio',{checked:true}).count(),1);assert.equal(await page.evaluate(()=>window.h.genericActivities),0);assert.equal(await page.evaluate(()=>window.h.firstResponses),0)}

for(const width of[390,1366])for(const observation of[false,true])for(const required of[false,true])scenario(`recommended message opens script before action at ${width}px observation=${observation} required=${required}`,async t=>{
  const page=await fixture(t,width,observation,required);await openTask(page);await script(page).waitFor();
  await page.getByText('Olá Lead sintético, aqui é Empresa sintética. Confirme seu e-mail: lead@example.invalid.',{exact:true}).waitFor();
  assert.equal(await page.getByText('Roteiro sintético: confirme a necessidade do cliente.',{exact:true}).count(),Number(observation));
  await page.getByRole('button',{name:'Preparar mensagem',exact:true}).waitFor();await page.getByRole('button',{name:required?'Registrar resultado':'Concluir tarefa',exact:true}).waitFor();await zeroSideEffects(page);
  const bounds=await script(page).evaluate(element=>({left:element.getBoundingClientRect().left,right:element.getBoundingClientRect().right,width:innerWidth,overflow:element.scrollWidth>element.clientWidth}));
  assert.ok(bounds.left>=0&&bounds.right<=bounds.width,'Script must fit the viewport');assert.equal(bounds.overflow,false);
  if(artifacts&&!observation&&required)await page.screenshot({path:join(artifacts,`cadence-message-preview-${width}.png`)});
  await page.keyboard.press('Escape');await script(page).waitFor({state:'hidden'});await zeroSideEffects(page);
  await openTask(page);await page.getByRole('button',{name:'Preparar mensagem',exact:true}).click();await page.waitForFunction(()=>window.h.prepared.length===1);
  assert.equal(await page.evaluate(()=>window.h.visible),false);assert.equal(await page.evaluate(()=>window.h.prepared[0].message),'Olá Lead sintético, aqui é Empresa sintética. Confirme seu e-mail: lead@example.invalid.');await zeroSideEffects(page);
  await page.evaluate(()=>window.h.reopen());await openTask(page);await script(page).waitFor();
  if(required){await startOutcome(page);await confirm(page)}else{await page.getByRole('button',{name:'Concluir tarefa',exact:true}).click();await page.waitForFunction(()=>window.h.requests.length===1);assert.equal(await page.getByRole('radio').count(),0)}
  assert.equal(await page.evaluate(()=>window.h.requests[0].body.outcome),required?'replied':'done');assert.equal(await page.evaluate(()=>window.h.history.length),0);
  await page.evaluate(()=>window.h.ack(0));await page.getByRole('dialog').waitFor({state:'hidden'});assert.equal(await page.getByRole('button',{name:'Consultar Mensagem sintética de cadência',exact:true}).count(),1);
  assert.deepEqual(await page.evaluate(()=>({history:window.h.history.length,types:window.h.history.map(row=>row.type),first:window.h.firstResponses,generic:window.h.genericActivities})),{history:1,types:['task_completed'],first:0,generic:0});
});

for(const width of[390,1366])for(const observation of[false,true])scenario(`cancel result leaves task pending at ${width}px observation=${observation}`,async t=>{
  const page=await fixture(t,width,observation,true);await openTask(page);await startOutcome(page);await page.getByRole('button',{name:'Cancelar',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await zeroSideEffects(page);assert.equal(await page.getByRole('button',{name:'Abrir Mensagem sintética de cadência',exact:true}).count(),1);
});

for(const width of[390,1366])for(const observation of[false,true])for(const mode of['error','unknown-ack','canonical-conflict'])scenario(`${mode} retains message result draft at ${width}px observation=${observation}`,async t=>{
  const page=await fixture(t,width,observation,true);await openTask(page);await startOutcome(page);await confirm(page);
  if(mode==='error')await page.evaluate(()=>window.h.requests[0].reject(Error('Synthetic failure before commit')));
  if(mode==='unknown-ack')await page.evaluate(()=>window.h.loseACK(0));
  if(mode==='canonical-conflict')await page.evaluate(()=>window.h.conflict(0));
  await assertRetained(page);await page.evaluate(()=>{window.h.overlaysVisible=false;window.h.render()});await page.getByRole('dialog').waitFor({state:'hidden'});await page.evaluate(()=>{window.h.overlaysVisible=true;window.h.render()});await assertRetained(page);
  if(mode!=='canonical-conflict'){await confirm(page,2);await page.evaluate(()=>window.h.ack(1));await page.getByRole('dialog').waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>window.h.history.length),1)}
  else{assert.equal(await page.evaluate(()=>window.h.history.length),1);assert.equal(await page.evaluate(()=>window.h.notices.some(notice=>notice.kind==='warning')),true)}
  assert.equal(await page.evaluate(()=>window.h.genericActivities),0);assert.equal(await page.evaluate(()=>window.h.firstResponses),0);
});

for(const width of[390,1366])for(const state of['permission','closed','no-phone'])scenario(`${state} guard preserves separate result action at ${width}px`,async t=>{
  const page=await fixture(t,width,false,true,state!=='no-phone');await openTask(page);await script(page).waitFor();
  if(state==='no-phone'){assert.equal(await page.getByRole('button',{name:'Preparar mensagem',exact:true}).count(),0);await page.getByRole('button',{name:'Registrar resultado',exact:true}).waitFor()}
  else{await page.evaluate(state=>{if(state==='permission')window.h.allowed=false;else window.h.status='lost';window.h.render()},state);await page.evaluate(async()=>{await window.h.handlers.handleRoteiroAction('message');await window.h.handlers.handleRoteiroAction('complete')});assert.equal(await page.evaluate(()=>window.h.prepared.length),0)}
  await zeroSideEffects(page);
  if(artifacts&&state==='no-phone')await page.screenshot({path:join(artifacts,`cadence-message-result-${width}.png`)});
});
