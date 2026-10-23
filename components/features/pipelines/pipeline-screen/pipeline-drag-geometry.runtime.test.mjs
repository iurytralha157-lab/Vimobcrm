import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// Real board, cards, Radix, DnD and compiled Tailwind. Authentication and action
// hooks are synthetic; no HTTP service, database, login or external request.
const require = createRequire(import.meta.url);
const { webpack } = require('next/dist/compiled/webpack/webpack.js');
const postcss = require('postcss');
const tailwind = require('@tailwindcss/postcss');
const { transform } = require('lightningcss');
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const artifacts = resolve(process.env.PIPELINE_VISUAL_ARTIFACT_DIR || join(tmpdir(), 'vimob-pipeline-drag-geometry-artifacts'));
let directory, browser, bundle, css;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vimob-pipeline-drag-geometry-'));
  await mkdir(artifacts, { recursive: true });
  const aliases = {};
  async function mock(name, source) {
    const path = join(directory, `mock-${Object.keys(aliases).length}.js`);
    await writeFile(path, source);
    aliases[name] = path;
  }
  // Resolve real individual modules instead of eagerly compiling the icon and
  // locale barrels (thousands of unused files in a development Webpack build).
  const icons = ['ChevronDown', 'ChevronLeft', 'ChevronRight', 'Loader2', 'MoreVertical', 'Plus', 'RefreshCw', 'Target', 'Phone', 'Mail', 'MessageCircle', 'Clock', 'User', 'Zap', 'Trophy', 'XCircle', 'RotateCw', 'AlertTriangle', 'X', 'Check', 'Circle'];
  const iconModule = join(directory, 'icons.js');
  await writeFile(iconModule, icons.map(name => {
    const file = name.replace(/([A-Z])([A-Z][a-z])/g, '$1-$2').replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([a-z])([0-9])/g, '$1-$2').toLowerCase();
    return `export{default as ${name}}from${JSON.stringify(join(repository, 'node_modules/lucide-react/dist/esm/icons', `${file}.mjs`))};`;
  }).join('\n'));
  aliases['lucide-react$'] = iconModule;
  aliases['date-fns$'] = join(repository, 'node_modules/date-fns/format.js');
  aliases['date-fns/locale$'] = join(repository, 'node_modules/date-fns/locale/pt-BR.js');
  const syntheticToken = `header.${Buffer.from(JSON.stringify({ sub: 'synthetic-user', session_id: 'synthetic-sid' })).toString('base64url')}.synthetic`;
  await mock('@/contexts/AuthContext', `export const useAuth=()=>({activeOrganization:{organizationId:"synthetic-org"},profile:{id:"synthetic-user"},user:{id:"synthetic-user"},session:{access_token:${JSON.stringify(syntheticToken)}}});`);
  await mock('@/contexts/FloatingChatContext', 'export const useFloatingChat=()=>({openNewChat:()=>{window.h.chats++}});');
  await mock('@/hooks/use-first-response', 'export const useRecordFirstResponseOnAction=()=>({recordFirstResponse:async()=>{}});');
  await mock('@/hooks/use-activities', 'export const useCreateActivity=()=>({mutateAsync:async()=>{},isPending:false});');
  await mock('@/hooks/leads/use-record-lead-contact-outcome', 'export const useRecordLeadContactOutcome=()=>({mutateAsync:async()=>{},isPending:false});');
  await mock('@/hooks/leads/use-claim-queue-pool', 'export const useClaimQueuePool=()=>({mutate:()=>{},isPending:false});');
  await mock('@/hooks/use-sla-reports', 'export const formatSlaTime=()=>"2h";');
  await mock('@/components/features/leads/TaskOutcomeDialog', 'export const TaskOutcomeDialog=()=>null;');

  const loader = join(directory, 'tsx-loader.cjs');
  const cssLoader = join(directory, 'css-loader.cjs');
  const entry = join(directory, 'entry.js');
  const dragBoardOverride = process.env.PIPELINE_DRAG_BOARD_SOURCE_FILE ? await readFile(process.env.PIPELINE_DRAG_BOARD_SOURCE_FILE, 'utf8') : null;
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});const override=${JSON.stringify(dragBoardOverride)};module.exports=function(s){if(override&&require('node:path').basename(this.resourcePath)==='PipelineDragBoard.tsx')s=override;return ts.transpileModule(s.replace('  const { openNewChat } = useFloatingChat();','  window.h.cardRenders++; const { openNewChat } = useFloatingChat();').replace('onDragStart={begin}', 'onDragOver={event=>{window.h.over=event.over?.id}} onDragMove={event=>{window.h.dndDebug={over:event.over?.id,delta:event.delta,active:event.active.rect.current.translated,mode:event.activatorEvent.type}}} onDragStart={begin}'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;};`);
  await writeFile(cssLoader, `const{transform}=require(${JSON.stringify(require.resolve('lightningcss'))});module.exports=function(s){const out=transform({filename:this.resourcePath,code:Buffer.from(s),cssModules:true});return'export default '+JSON.stringify(Object.fromEntries(Object.entries(out.exports).map(([key,value])=>[key,value.name])))+';'};`);
  // LeadCard's real operation scope now consumes the app's QueryClient and SID.
  // Keep that hook real; provide the same provider boundary to both consumers.
  await writeFile(entry, `import React from'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{PipelineBoard as RawBoard}from${JSON.stringify(join(repository, 'components/features/pipelines/pipeline-screen/PipelineBoard.tsx'))};import{Dialog,DialogContent,DialogTitle,DialogDescription}from'@/components/ui/dialog';import{Drawer,DrawerContent,DrawerTitle,DrawerDescription}from'@/components/ui/drawer';
    function PipelineBoard(props){return React.createElement(React.Profiler,{id:'board',onRender:(id,phase,actualDuration)=>window.h.renders.push({phase,actualDuration})},React.createElement(RawBoard,props))};const h=window.h={renders:[],cardRenders:0,opened:0,chats:0,active:0,sidebar:216,dragging:false,mobile:innerWidth<768,overlay:null,critical:false,transition:false,single:false,rootClicks:0,rootPointers:0};
    h.stages=Array.from({length:5},(_,stage)=>({id:'stage'+stage,name:'Etapa sintética '+stage+' com nome longo',color:'#ff4529',is_qualified:stage===2,total_lead_count:6,total_value:3600000,leads:Array.from({length:6},(_,index)=>({id:'lead'+stage+'-'+index,stage_id:'stage'+stage,name:'Lead sintético '+stage+'-'+index+' com nome longo',phone:'5511999999999',email:'lead@example.invalid',can_operate:true,organization_id:'synthetic-org',assigned_user_id:'synthetic-user',assignee:{name:'Corretor'},created_at:'2026-10-01T12:00:00Z',stage_entered_at:'2026-10-01T12:00:00Z',source:'meta',lead_meta:[{platform:'meta',campaign_name:'Campanha sintética com nome bastante longo'}],tags:[{name:'Prioridade '.repeat(12),color:'#ff4529'}],valor_interesse:600000}))}));
    const sourceVariants=[{}, {source:'whatsapp'}, {source:'google',lead_meta:[{platform:'google',campaign_name:'Campanha sintética Google'}]}, {source:'site',lead_meta:[],interest_property:{code:'TESTE-123',title:'Imóvel sintético'}}, {source:'manual',lead_meta:[]}, {source:'indicacao',lead_meta:[]}];
    h.stages.forEach(stage=>stage.leads.forEach((lead,index)=>Object.assign(lead,sourceVariants[index])));
    const noop=()=>{};const onOpenLead=()=>{h.opened++};const root=createRoot(document.getElementById('root'));const queryClient=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity},mutations:{retry:false}}});const renderWithQueries=element=>root.render(React.createElement(QueryClientProvider,{client:queryClient},element));
    h.shell=()=>React.createElement('div',{className:'app-shell',style:{height:'100vh',display:'flex',overflow:'hidden'}},!h.mobile&&React.createElement('aside',{style:{width:h.sidebar,flexShrink:0}},'Sidebar'),React.createElement('main',{onClick:()=>{h.rootClicks++},onPointerDown:()=>{h.rootPointers++},style:{flex:1,minWidth:0,minHeight:0,display:'flex',flexDirection:'column',padding:h.mobile?'64px 20px 65px':'76px 24px 12px'}},React.createElement('div',{style:{height:52,flexShrink:0}},'Pipeline'),React.createElement(PipelineBoard,{
      stages:h.stages,filteredStages:h.single?h.stages.slice(0,1):h.stages,visibleStages:h.mobile?[h.stages[h.active]]:h.stages,stageValueMap:new Map(h.stages.map(s=>[s.id,{totalValue:s.total_value}])),stageCountMetaMap:new Map(h.stages.map(s=>[s.id,{total:6,remaining:0,canLoadMore:false}])),selectedPipelineId:'pipeline',pendingMoveLeadIds:h.pendingMoveLeadIds,isMobile:h.mobile,isLoading:false,isInitialLeadsLoading:false,isPipelineBoardTransitioning:h.transition,leadsPlaceholderData:false,hasCriticalLoadError:h.critical,hasPipelineBoardError:false,isRefreshing:false,pipelinesFetching:false,leadVisibilityFetching:false,hasPreviousMobileStage:h.active>0,hasNextMobileStage:h.active<4,canEditPipeline:true,hasWhatsAppModule:true,canViewWhatsApp:true,canOperateWhatsApp:true,canShowColumnActions:!h.mobile,isDragDisabled:false,nowMs:h.nowMs||Date.parse('2026-10-12T12:00:00Z'),editingStageId:null,editingStageName:'',savingStageNameId:null,loadMoreIsPending:false,onDragStart:()=>{h.dragging=true},onDragEnd:result=>{h.dragging=false;h.drop=result;if(h.applyDrop&&result.destination){h.beforeDrop=h.stages;const lead=h.stages.flatMap(stage=>stage.leads).find(lead=>lead.id===result.draggableId);h.stages=h.stages.map(stage=>({...stage,leads:stage.leads.filter(row=>row.id!==lead.id)}));const target=h.stages.find(stage=>stage.id===result.destination.droppableId);target.leads.splice(result.destination.index,0,{...lead,stage_id:target.id});h.render()}},onCriticalLoadRetry:noop,onBoardRefresh:noop,onMobileStageNavigation:direction=>{h.active+=direction==='next'?1:-1;h.render()},onEditingStageNameChange:noop,onStartEditingStage:noop,onCommitStageName:noop,onCancelEditingStage:noop,onOpenStageSettings:(stage,tab)=>{h.settingsRequests=(h.settingsRequests||[]).concat({stageId:stage.id,tab})},onOpenLead:onOpenLead,onAssignLeadNow:noop,onLoadMore:noop,onCreateStage:noop,onCreatePipeline:noop
    })));
    h.render=()=>renderWithQueries(React.createElement(React.Fragment,null,h.shell(),h.overlay==='dialog'?React.createElement(Dialog,{open:true,onOpenChange:noop},React.createElement(DialogContent,null,React.createElement(DialogTitle,null,'Popup sintético'),React.createElement(DialogDescription,null,'Teste da camada real Radix'))):h.overlay==='drawer'?React.createElement(Drawer,{open:true,onOpenChange:noop,shouldScaleBackground:false},React.createElement(DrawerContent,{showHandle:false,style:{height:'80dvh'}},React.createElement(DrawerTitle,null,'Drawer sintético'),React.createElement(DrawerDescription,null,'Teste da camada real Vaul'))):null));h.render();`);

  let entrySource = await readFile(entry, 'utf8');
  entrySource = entrySource.replace("import React from'react';", "import React from'react';import{DragDropContext,Droppable}from'@hello-pangea/dnd';import{LeadCard}from'@/components/features/leads/LeadCard';")
    .replace('onOpenLead:onOpenLead', 'onOpenLead:h.overrideOpen||onOpenLead')
    .replace('isDragDisabled:false,nowMs:', 'isDragDisabled:!!h.disabled,nowMs:')
    .replace('canOperateWhatsApp:true,canShowColumnActions:', 'canOperateWhatsApp:!h.readOnly,canShowColumnActions:')
    .replace('const root=createRoot', 'const onAssignLeadNow=()=>{h.assigned=(h.assigned||0)+1};const root=createRoot')
    .replace('onAssignLeadNow:noop', 'onAssignLeadNow:onAssignLeadNow');
  entrySource += `\nh.renderLegacy=()=>renderWithQueries(React.createElement(DragDropContext,{onDragEnd:result=>{h.legacyDrop=result}},React.createElement(Droppable,{droppableId:'legacy'},provided=>React.createElement('div',{ref:provided.innerRef,...provided.droppableProps,style:{width:280,padding:8}},React.createElement(LeadCard,{lead:h.stages[0].leads[0],index:0,onClick:onOpenLead,onAssignNow:noop,isDragDisabled:false,hasWhatsAppModule:true,canViewWhatsApp:true,canOperateWhatsApp:true}),provided.placeholder))));`;
  await writeFile(entry, entrySource);
  console.info('Pipeline harness: compiling real board/cards');
  await new Promise((done, reject) => {
    const compiler = webpack({ mode: 'development', target: 'web', entry, output: { path: directory, filename: 'pipeline.js' },
      resolve: { extensions: ['.ts', '.tsx', '.js'], modules: [join(repository, 'node_modules'), 'node_modules'], alias: { ...aliases, '@': repository } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }, { test: /\.module\.css$/, use: cssLoader }] } });
    compiler.run((error, stats) => compiler.close(() => error ? reject(error) : stats.hasErrors() ? reject(Error(stats.toString({ all: false, errors: true }))) : done()));
  });
  bundle = await readFile(join(directory, 'pipeline.js'), 'utf8');
  console.info('Pipeline harness: compiling CSS');
  const globals = (await readFile(join(repository, 'app/globals.css'), 'utf8')).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);');
  const sources = ['components/features/pipelines/pipeline-screen/PipelineBoard.tsx', 'components/features/pipelines/pipeline-screen/StageColumnMenu.tsx', 'components/features/leads/LeadCard.tsx', 'components/features/leads/ReentryBadge.tsx', 'components/ui'].map(path => `@source "${join(repository, path).replaceAll('\\', '/')}";`).join('\n');
  css = (await postcss([tailwind({ base: repository })]).process(`${globals}\n${sources}`, { from: join(repository, 'app/globals.css') })).css;
  const modulePath = join(repository, 'components/features/pipelines/pipeline-screen/PipelineBoard.module.css');
  css += transform({ filename: modulePath, code: await readFile(modulePath), cssModules: true }).code.toString();
  console.info('Pipeline harness: starting isolated Chromium');
  browser = await chromium.launch({ headless: true });
}, { timeout: 180_000 });

after(async () => {
  await browser?.close();
  if (directory) {
    assert.ok(dirname(resolve(directory)) === resolve(tmpdir()) && basename(directory).startsWith('vimob-pipeline-drag-geometry-'));
    await rm(directory, { recursive: true, force: true });
  }
});

async function openBoard(width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.route('**/*', route => route.abort());
  await page.setContent('<html><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: css });
  // KeyboardSensor installs its document listener on a timer after onDragStart.
  // Observe that real readiness instead of sleeping or racing its first arrow.
  await page.evaluate(() => {
    const add = document.addEventListener.bind(document), remove = document.removeEventListener.bind(document);
    window.pipelineKeyboardSensors = new Set();
    document.addEventListener = (type, listener, options) => {
      add(type, listener, options);
      if (type === 'keydown' && listener?.name === 'bound handleKeyDown') window.pipelineKeyboardSensors.add(listener);
    };
    document.removeEventListener = (type, listener, options) => {
      remove(type, listener, options);
      if (type === 'keydown') window.pipelineKeyboardSensors.delete(listener);
    };
  });
  await page.addScriptTag({ content: bundle });
  await page.locator('[data-tour="pipeline-column"]').waitFor();
  if (width >= 768) await page.waitForFunction(() => document.querySelector('[data-tour="pipeline-column"]').parentElement.parentElement.parentElement.style.getPropertyValue('--pipeline-column-width') !== '288px');
  return page;
}

async function keyboardReady(page) {
  await page.waitForFunction(() => window.pipelineKeyboardSensors.size > 0);
}


const firstCard = page => page.locator('[data-pipeline-drop-column="stage0"] article').first();
const cardHandle = card => card.getByRole('button', { name: /pressione Enter/ });
async function measure(page) {
  return page.evaluate(() => {
    const source = document.querySelector('[data-pipeline-drop-column="stage0"] article');
    const clone = document.querySelector('[inert] article');
    const read = element => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const font = node => { const s = getComputedStyle(node); return {family:s.fontFamily,weight:s.fontWeight,size:s.fontSize,lineHeight:s.lineHeight,letterSpacing:s.letterSpacing}; };
      const parts = [...element.querySelectorAll('[data-lead-card-part], .font-light, .font-normal, .font-medium')];
      return {width:element.offsetWidth,height:element.offsetHeight,x:rect.x,y:rect.y,centerX:rect.x+rect.width/2,centerY:rect.y+rect.height/2,
        actionRows: [...element.querySelector('[data-lead-card-part="actions"]').children].map(node => node.offsetTop + node.offsetHeight / 2).sort((a,b)=>a-b).filter((center,index,all)=>index===0||center-all[index-1]>8).length,
        fonts:parts.map(node => ({part:node.dataset.leadCardPart||node.tagName+'.'+[...node.classList].filter(name=>name.startsWith('font-')).join('.'),...font(node)})),
        transform:getComputedStyle(element).transform,rotate:getComputedStyle(element).rotate,scale:getComputedStyle(element).scale,
        opacity:getComputedStyle(element).opacity,transition:getComputedStyle(element).transitionDuration};
    };
    return {source:read(source),clone:read(clone),opened:window.h.opened,dragging:window.h.dragging};
  });
}
async function picked(page, mode) {
  const handle = cardHandle(firstCard(page));
  if(mode==='keyboard'){await handle.focus();await handle.press('Space');await keyboardReady(page);}
  else {const box=await handle.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+7,box.y+box.height/2,{steps:2});}
  await page.locator('[inert] article').waitFor();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}
async function cancel(page, mode) {
  await page.keyboard.press('Escape');
  if(mode==='pointer')await page.mouse.up();
  await page.waitForFunction(()=>!window.h.dragging);
  await page.locator('[inert] article').waitFor({state:'detached'});
}
for(const width of [1280,1440])for(const mode of ['keyboard','pointer'])test('real card/clone retain layout and typography '+width+'/'+mode, {timeout:30_000},async()=>{
 const page=await openBoard(width,720);try{
  const before=await measure(page);await picked(page,mode);const active=await measure(page);
  const record={width,mode,before,active};await writeFile(join(artifacts,(process.env.PIPELINE_GEOMETRY_LABEL||'current')+'-'+width+'-'+mode+'.json'),JSON.stringify(record,null,2));
  if(mode==='keyboard')await page.screenshot({path:join(artifacts,(process.env.PIPELINE_GEOMETRY_LABEL||'current')+'-'+width+'.png')});
  assert.equal(active.source.width,before.source.width,'the measured origin width must not change on pickup');
  assert.equal(active.source.height,before.source.height,'the source keeps its layout height');
  assert.equal(active.clone.width,before.source.width,'the portal must preserve the source layout width');
  assert.equal(active.clone.height,before.source.height,'the portal must preserve the source layout height');
  assert.equal(active.clone.actionRows,before.source.actionRows,'the clone cannot reflow its action row');
  assert.deepEqual(active.clone.fonts,before.source.fonts,'portal typography must match the approved card');
  assert.ok(Math.abs(active.clone.centerY-before.source.centerY)<5,'pickup must not jump vertically');
  assert.equal(active.source.opacity,'0.25');assert.notEqual(active.clone.rotate,'none');
  assert.equal(before.source.width,width===1280?232:272);assert.equal(before.source.actionRows,width===1280?2:1);
  await cancel(page,mode);assert.equal((await measure(page)).opened,0);
 }finally{await page.close()}
});
test('keyboard logic, resize freeze, cancellation and second gesture remain live', {timeout:30_000},async()=>{
 const page=await openBoard(1280,720);try{
  await picked(page,'keyboard');const first=await measure(page);await page.evaluate(()=>{window.h.sidebar=64;window.h.render()});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal((await measure(page)).source.width,first.source.width);await page.keyboard.press('Enter');await page.waitForFunction(()=>!window.h.dragging);assert.equal(await page.evaluate(()=>window.h.opened),0);
  await page.locator('[inert] article').waitFor({state:'detached'});await page.waitForFunction(previous=>document.querySelector('[data-pipeline-drop-column="stage0"] article').offsetWidth>previous,first.source.width);
  await picked(page,'keyboard');await cancel(page,'keyboard');assert.equal(await page.evaluate(()=>window.h.opened),0);
  await cardHandle(firstCard(page)).press('Enter');assert.equal(await page.evaluate(()=>window.h.opened),1);
 }finally{await page.close()}
});
test('reduced motion keeps stable geometry and a cancelled gesture can start again', {timeout:30_000},async()=>{
 const page=await openBoard(1280,720);try{
  await page.emulateMedia({reducedMotion:'reduce'});await picked(page,'keyboard');const active=await measure(page);
  assert.equal(active.source.transition,'0s');assert.equal(active.clone.width,active.source.width);assert.equal(active.clone.height,active.source.height);
  await cancel(page,'keyboard');await picked(page,'pointer');await cancel(page,'pointer');assert.equal(await page.evaluate(()=>window.h.opened),0);
 }finally{await page.close()}
});
test('accepted movement and rollback retire the clone without changing the card layout', {timeout:30_000},async()=>{
 const page=await openBoard(1280,720);try{
  await page.evaluate(()=>{window.h.applyDrop=true});await picked(page,'keyboard');await page.keyboard.press('ArrowRight');await page.waitForFunction(()=>window.h.over==='lead1-0');await page.keyboard.press('Space');await page.waitForFunction(()=>!window.h.dragging&&window.h.drop?.destination?.droppableId==='stage1');
  await page.locator('[inert] article').waitFor({state:'detached'});assert.ok((await page.locator('[data-pipeline-drop-column="stage1"] article').first().locator('[data-lead-card-part="name"]').textContent()).includes('0-0'));
  await page.evaluate(()=>{window.h.stages=window.h.beforeDrop;window.h.render()});await page.waitForFunction(()=>document.querySelector('[data-pipeline-drop-column="stage0"] article [data-lead-card-part="name"]').textContent.includes('0-0'));
  assert.equal((await measure(page)).source.width,232);await picked(page,'keyboard');await cancel(page,'keyboard');assert.equal(await page.evaluate(()=>window.h.opened),0);
 }finally{await page.close()}
});
test('legacy Pangea still decorates its dragging card by default', {timeout:30_000},async()=>{
 const page=await openBoard(1280,720);try{
  await page.evaluate(()=>window.h.renderLegacy());const handle=page.locator('article').getByRole('button',{name:/pressione Enter/});await handle.focus();await handle.press('Space');
  await page.waitForFunction(()=>document.querySelector('article')?.classList.contains('rotate-1'));
  assert.ok((await page.locator('article[data-rfd-draggable-id]').getAttribute('class')).includes('scale-[1.02]'));
  await page.keyboard.press('Escape');await page.waitForFunction(()=>window.h.legacyDrop?.reason==='CANCEL');assert.equal(await page.evaluate(()=>window.h.opened),0);
 }finally{await page.close()}
});
