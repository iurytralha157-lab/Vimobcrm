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
const artifacts = resolve(process.env.PIPELINE_VISUAL_ARTIFACT_DIR || join(tmpdir(), 'vimob-pipeline-interactions-artifacts'));
let directory, browser, bundle, css;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vimob-pipeline-interactions-'));
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
      stages:h.stages,filteredStages:h.single?h.stages.slice(0,1):h.stages,visibleStages:h.mobile?[h.stages[h.active]]:h.stages,stageValueMap:new Map(h.stages.map(s=>[s.id,{totalValue:s.total_value}])),stageCountMetaMap:new Map(h.stages.map(s=>[s.id,{total:6,remaining:0,canLoadMore:false}])),selectedPipelineId:'pipeline',pendingMoveLeadIds:h.pendingMoveLeadIds,isMobile:h.mobile,isLoading:false,isInitialLeadsLoading:false,isPipelineBoardTransitioning:h.transition,leadsPlaceholderData:false,hasCriticalLoadError:h.critical,hasPipelineBoardError:false,isRefreshing:false,pipelinesFetching:false,leadVisibilityFetching:false,hasPreviousMobileStage:h.active>0,hasNextMobileStage:h.active<4,canEditPipeline:true,hasWhatsAppModule:true,canViewWhatsApp:true,canOperateWhatsApp:true,canShowColumnActions:!h.mobile,isDragDisabled:false,nowMs:h.nowMs||Date.parse('2026-10-12T12:00:00Z'),editingStageId:null,editingStageName:'',savingStageNameId:null,loadMoreIsPending:false,onDragStart:()=>{h.dragging=true},onDragEnd:result=>{h.dragging=false;h.drop=result},onCriticalLoadRetry:noop,onBoardRefresh:noop,onMobileStageNavigation:direction=>{h.active+=direction==='next'?1:-1;h.render()},onEditingStageNameChange:noop,onStartEditingStage:noop,onCommitStageName:noop,onCancelEditingStage:noop,onOpenStageSettings:(stage,tab)=>{h.settingsRequests=(h.settingsRequests||[]).concat({stageId:stage.id,tab})},onOpenLead:onOpenLead,onAssignLeadNow:noop,onLoadMore:noop,onCreateStage:noop,onCreatePipeline:noop
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
    assert.ok(dirname(resolve(directory)) === resolve(tmpdir()) && basename(directory).startsWith('vimob-pipeline-interactions-'));
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

test('synthetic real Board benchmark: clock, vertical drag and horizontal boundary', { timeout: 90_000 }, async () => {
  const page = await openBoard(1280, 580);
  const warnings = [];
  page.on('console', message => { if (message.type() === 'warning' || message.type() === 'error') warnings.push(message.text()); });
  try {
    await page.evaluate(() => {
      window.h.stages.forEach((stage, stageIndex) => { const sample = stage.leads[0]; stage.leads = Array.from({ length: 60 }, (_, index) => ({ ...sample, id: `volume-${stageIndex}-${index}` })); });
      window.h.render();
    });
    await page.waitForFunction(() => document.querySelectorAll('article').length === 300);
    const clock = await page.evaluate(async () => {
      window.h.cardRenders = 0; window.h.renders = [];
      for (let tick = 1; tick <= 5; tick++) {
        window.h.nowMs = Date.parse('2026-10-12T12:00:00Z') + tick * 30_000; window.h.render();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }
      return { cardRenders: window.h.cardRenders, commits: window.h.renders, cards: document.querySelectorAll('article').length };
    });
    const card = page.locator('[data-tour="pipeline-column"] article').first();
    const list = card.locator('..');
    const listBox = await list.boundingBox(); const cardBox = await card.boundingBox();
    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + 30);
    await page.mouse.down(); await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + 42, { steps: 4 });
    await page.waitForFunction(() => window.h.dragging);
    await page.mouse.move(cardBox.x + cardBox.width / 2, listBox.y + listBox.height - 8, { steps: 20 });
    await page.waitForTimeout(1600);
    const vertical = await list.evaluate(element => ({ scrollTop: element.scrollTop, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight, refIsList: element.hasAttribute('data-pipeline-drop-column') }));
    await page.mouse.up(); await page.waitForFunction(() => !window.h.dragging);
    const drop = await page.evaluate(() => window.h.drop);
    const geometry = await page.locator('[data-tour="pipeline-column"]').evaluate(column => ({
      documentOverflow: document.documentElement.scrollWidth > innerWidth,
      nameFont: getComputedStyle(column.querySelector('[data-lead-card-part~="name"]')).fontSize,
      phoneFont: getComputedStyle(column.querySelector('p[data-lead-card-part~="caption"]')).fontSize,
      tagFont: getComputedStyle(column.querySelector('[data-lead-card-part~="tag"]')).fontSize,
      campaignFont: getComputedStyle(column.querySelector('[data-lead-card-part~="source-label"]')).fontSize,
      fourthRight: column.parentElement.children[3].getBoundingClientRect().right,
      viewportRight: column.parentElement.parentElement.getBoundingClientRect().right,
    }));
    const metrics = { clock, vertical, drop, geometry, warnings };
    console.info('PIPELINE_BOARD_METRICS', JSON.stringify(metrics));
    await writeFile(join(artifacts, `${process.env.PIPELINE_BOARD_MEASUREMENT_LABEL || 'current'}-metrics.json`), JSON.stringify(metrics, null, 2));
    await page.screenshot({ path: join(artifacts, `${process.env.PIPELINE_BOARD_MEASUREMENT_LABEL || 'current'}-1280x580.png`) });
    assert.ok(vertical.scrollTop > 0, 'drag near the bottom must auto-scroll the actual lead list');
    assert.equal(vertical.refIsList, true); assert.equal(geometry.documentOverflow, false);
    assert.deepEqual([geometry.nameFont, geometry.phoneFont, geometry.tagFont, geometry.campaignFont], ['13px', '12px', '9px', '10px']);
    assert.ok(geometry.fourthRight <= geometry.viewportRight + 1);
    assert.ok(!warnings.some(warning => /nested scroll container/.test(warning)));
    assert.ok(clock.cardRenders < 300, 'unchanged hourly labels must avoid full-card renders on every clock tick');
  } finally { await page.close(); }
});

async function drag(page, from, to) {
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(from.x + 8, from.y + 8, { steps: 2 });
  await page.waitForFunction(() => window.h.dragging);
  await page.mouse.move(to.x, to.y, { steps: 8 });
}

async function diagnostic(page, label) {
  console.info(label, JSON.stringify(await page.evaluate(() => ({
    debug: window.h.dndDebug, over: window.h.over, drop: window.h.drop, dragging: window.h.dragging,
    columns: [...document.querySelectorAll('[data-pipeline-drop-column]')].map(node => ({ id: node.dataset.pipelineDropColumn, top: node.scrollTop, rect: node.getBoundingClientRect().toJSON() })),
    scrolls: [...document.querySelectorAll('div')].filter(node => node.scrollWidth > node.clientWidth + 10).map(node => ({ class: node.className, left: node.scrollLeft, width: node.clientWidth, scrollWidth: node.scrollWidth })),
    overlay: document.querySelector('[inert]')?.getBoundingClientRect().toJSON(),
    terminals: [...document.querySelectorAll('[data-pipeline-drop-end]')].map(node => ({ stage: node.dataset.pipelineDropEnd, rect: node.getBoundingClientRect().toJSON() })),
  }))));
}

test('real nested auto-scroll reaches a column outside the viewport and a later vertical position', { timeout: 90_000 }, async () => {
  const page = await openBoard(1280, 580);
  try {
    const first = page.locator('[data-pipeline-drop-column="stage0"] article').first();
    const from = await first.boundingBox();
    const scroller = page.locator('[data-pipeline-drop-column="stage0"]').locator('../../..');
    const bounds = await scroller.boundingBox();
    await drag(page, { x: from.x + 100, y: from.y + 30 }, { x: bounds.x + bounds.width - 10, y: from.y + 40 });
    await page.waitForFunction(() => {
      const target = document.querySelector('[data-pipeline-drop-column="stage4"]');
      const scroller = target.parentElement.parentElement.parentElement;
      return scroller.scrollLeft > 80 && target.getBoundingClientRect().right < scroller.getBoundingClientRect().right - 5;
    });
    const target = page.locator('[data-pipeline-drop-column="stage4"]');
    const targetBox = await target.boundingBox();
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height - 10, { steps: 8 });
    await page.waitForFunction(() => document.querySelector('[data-pipeline-drop-column="stage4"]').scrollTop > 30);
    await page.mouse.up(); await page.waitForFunction(() => !window.h.dragging);
    const drop = await page.evaluate(() => window.h.drop);
    assert.equal(drop.source.droppableId, 'stage0'); assert.equal(drop.destination.droppableId, 'stage4');
    assert.ok(drop.destination.index > 1); assert.equal(drop.reason, 'DROP');
    assert.equal(await page.evaluate(() => window.h.opened), 0);
    console.info('PIPELINE_NESTED_SCROLL_DROP', JSON.stringify(drop));
  } catch (error) { await diagnostic(page, 'NESTED_SCROLL_FAILURE'); throw error; } finally { await page.close(); }
});

test('same-column keyboard order, cross-column keyboard, cancellation and focus are preserved', { timeout: 60_000 }, async () => {
  const page = await openBoard(1280, 720);
  try {
    const first = page.locator('[data-pipeline-drop-column="stage0"] article').first().getByRole('button', { name: /pressione Enter/ });
    await first.focus(); await page.keyboard.press('Space'); await page.waitForFunction(() => window.h.dragging);
    await keyboardReady(page);
    const initial = await page.locator('[inert]').boundingBox();
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(y => document.querySelector('[inert]')?.getBoundingClientRect().top > y + 50, initial.y);
    await page.keyboard.press('Space');
    await page.waitForFunction(() => !window.h.dragging);
    assert.equal(await page.evaluate(() => window.h.drop.destination.index), 1);
    await first.focus(); await page.keyboard.press('Space'); await page.waitForFunction(() => window.h.dragging);
    await keyboardReady(page);
    const second = await page.locator('[inert]').boundingBox();
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(x => document.querySelector('[inert]')?.getBoundingClientRect().left > x + 100, second.x);
    await page.keyboard.press('Space'); await page.waitForFunction(() => !window.h.dragging);
    assert.equal(await page.evaluate(() => window.h.drop.destination.droppableId), 'stage1');
    await first.focus(); await page.keyboard.press('Space'); await page.waitForFunction(() => window.h.dragging);
    await keyboardReady(page);
    const overlay = await page.locator('[inert] article').count(); assert.equal(overlay, 1);
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !window.h.dragging);
    assert.equal(await page.evaluate(() => window.h.drop.reason), 'CANCEL');
    assert.equal(await page.evaluate(() => window.h.drop.destination), null);
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('role')), 'button');
    assert.equal(await page.evaluate(() => window.h.opened), 0);
    await page.keyboard.press('Enter'); assert.equal(await page.evaluate(() => window.h.opened), 1);
  } catch (error) { await diagnostic(page, 'KEYBOARD_FAILURE'); throw error; } finally { await page.close(); }
});

test('keyboard reaches the terminal slot of a populated column and can return, cancel or lose permission', { timeout: 90_000 }, async () => {
  const page = await openBoard(1280, 720);
  try {
    await page.evaluate(() => { window.h.stages[1].leads = window.h.stages[1].leads.slice(0, 3); window.h.render(); });
    const source = page.locator('[data-pipeline-drop-column="stage0"] article').first().getByRole('button', { name: /pressione Enter/ });
    const begin = async () => { await source.focus(); await page.keyboard.press('Space'); await page.waitForFunction(() => window.h.dragging
      && window.h.over === 'lead0-0' && document.querySelector('[data-pipeline-drop-column="stage0"] article [aria-pressed="true"]')); await keyboardReady(page); };
    const next = async (code, expectedOver) => {
      const previous = await page.locator('[inert]').boundingBox(); await page.keyboard.press(code);
      await page.waitForFunction(({ x, y }) => {
        const rect = document.querySelector('[inert]')?.getBoundingClientRect();
        return rect && (Math.abs(rect.x - x) > 5 || Math.abs(rect.y - y) > 5);
      }, { x: previous.x, y: previous.y });
      await page.waitForFunction(id => window.h.over === id, expectedOver);
    };
    const toEnd = async () => { await next('ArrowRight', 'lead1-0'); await next('ArrowDown', 'lead1-1'); await next('ArrowDown', 'lead1-2'); await next('ArrowDown', 'pipeline-end:stage1'); };
    const finish = async key => { await page.keyboard.press(key); await page.waitForFunction(() => !window.h.dragging); return page.evaluate(() => window.h.drop); };
    await begin(); await toEnd();
    assert.deepEqual((await finish('Space')).destination, { droppableId: 'stage1', index: 3 });
    await begin(); await toEnd(); await next('ArrowUp', 'lead1-2');
    assert.deepEqual((await finish('Enter')).destination, { droppableId: 'stage1', index: 2 });
    await begin();
    await page.evaluate(() => {
      for (const code of ['ArrowRight', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'Space']) {
        document.dispatchEvent(new KeyboardEvent('keydown', { code, key: code === 'Space' ? ' ' : code, bubbles: true }));
      }
    });
    await page.waitForFunction(() => !window.h.dragging);
    assert.deepEqual(await page.evaluate(() => window.h.drop.destination), { droppableId: 'stage1', index: 3 });
    await begin(); await toEnd();
    const canceled = await finish('Escape'); assert.equal(canceled.reason, 'CANCEL'); assert.equal(canceled.destination, null);
    await begin(); await toEnd();
    await page.evaluate(() => { const lead = window.h.stages[0].leads[0]; window.h.stages[0].leads[0] = { ...lead, can_operate: false }; window.h.render(); });
    await source.waitFor({ state: 'detached' });
    assert.equal((await finish('Space')).destination, null);
    assert.equal(await page.evaluate(() => window.h.opened), 0);
    assert.equal(await page.locator('[data-pipeline-drop-end="stage1"]').evaluate(node => node.getBoundingClientRect().height), 0);
  } catch (error) { await diagnostic(page, 'KEYBOARD_TERMINAL_FAILURE'); throw error; } finally { await page.close(); }
});

test('keyboard terminal navigation also accepts an empty column at index zero', { timeout: 45_000 }, async () => {
  const page = await openBoard(1280, 720);
  try {
    await page.evaluate(() => { window.h.stages[1].leads = []; window.h.render(); });
    const source = page.locator('[data-pipeline-drop-column="stage0"] article').first().getByRole('button', { name: /pressione Enter/ });
    await source.focus(); await page.keyboard.press('Space'); await page.waitForFunction(() => window.h.dragging);
    await keyboardReady(page);
    const before = await page.locator('[inert]').boundingBox(); await page.keyboard.press('ArrowRight');
    await page.waitForFunction(x => document.querySelector('[inert]')?.getBoundingClientRect().left > x + 100, before.x);
    await page.keyboard.press('Space'); await page.waitForFunction(() => !window.h.dragging);
    assert.deepEqual(await page.evaluate(() => window.h.drop.destination), { droppableId: 'stage1', index: 0 });
  } catch (error) { await diagnostic(page, 'KEYBOARD_EMPTY_FAILURE'); throw error; } finally { await page.close(); }
});

test('keyboard reaches a terminal slot below the viewport through the target column scroll', { timeout: 60_000 }, async () => {
  const page = await openBoard(1280, 580);
  try {
    await page.evaluate(() => { const sample = window.h.stages[1].leads[0]; window.h.stages[1].leads = Array.from({ length: 8 }, (_, index) => ({ ...sample, id: `terminal-${index}` })); window.h.render(); });
    const source = page.locator('[data-pipeline-drop-column="stage0"] article').first().getByRole('button', { name: /pressione Enter/ });
    await source.focus(); await page.keyboard.press('Space'); await page.waitForFunction(() => window.h.dragging);
    await keyboardReady(page);
    await page.keyboard.press('ArrowRight'); await page.waitForFunction(() => window.h.over === 'terminal-0');
    for (let index = 1; index <= 8; index++) {
      await page.keyboard.press('ArrowDown');
      await page.waitForFunction(id => window.h.over === id, index < 8 ? `terminal-${index}` : 'pipeline-end:stage1');
    }
    await page.keyboard.press('Space'); await page.waitForFunction(() => !window.h.dragging);
    assert.deepEqual(await page.evaluate(() => window.h.drop.destination), { droppableId: 'stage1', index: 8 });
    assert.ok(await page.locator('[data-pipeline-drop-column="stage1"]').evaluate(node => node.scrollTop) > 0);
  } catch (error) { await diagnostic(page, 'KEYBOARD_SCROLL_TERMINAL_FAILURE'); throw error; } finally { await page.close(); }
});

test('a removed keyboard target cannot fall back to a neighboring lead or column', { timeout: 60_000 }, async () => {
  for (const mode of ['lead', 'column']) {
    const page = await openBoard(1280, 720);
    try {
      const source = page.locator('[data-pipeline-drop-column="stage0"] article').first().getByRole('button', { name: /pressione Enter/ });
      await source.focus(); await page.keyboard.press('Space'); await page.waitForFunction(() => window.h.dragging);
      await keyboardReady(page);
      await page.keyboard.press('ArrowRight'); await page.waitForFunction(() => window.h.over === 'lead1-0');
      await page.evaluate(mode => {
        if (mode === 'lead') window.h.stages[1].leads = window.h.stages[1].leads.slice(1);
        else window.h.stages = window.h.stages.filter(stage => stage.id !== 'stage1');
        window.h.render();
      }, mode);
      await page.waitForFunction(() => window.h.over == null);
      await page.keyboard.press('ArrowDown'); await page.keyboard.press('Space'); await page.waitForFunction(() => !window.h.dragging);
      assert.equal(await page.evaluate(() => window.h.drop.destination), null);
      assert.equal(await page.evaluate(() => window.h.opened), 0);
    } catch (error) { await diagnostic(page, `KEYBOARD_REMOVED_${mode}`); throw error; } finally { await page.close(); }
  }
});

test('click, action buttons, live props, permission and mobile do not start an unauthorized drag', { timeout: 60_000 }, async () => {
  const page = await openBoard(1280, 720);
  try {
    const first = page.locator('[data-pipeline-drop-column="stage0"] article').first();
    await first.getByRole('button', { name: /pressione Enter/ }).click();
    assert.equal(await page.evaluate(() => window.h.opened), 1);
    await page.evaluate(() => { window.h.overrideOpen = () => { window.h.latestCallback = true; }; window.h.readOnly = true;
      const lead = window.h.stages[0].leads[0]; window.h.stages[0].leads[0] = { ...lead, name: 'Nome atualizado', tags: [{ name: 'Tag atualizada', color: '#ff4529' }], assignee: { name: 'Novo corretor' }, deal_status: 'won' }; window.h.render(); });
    await first.getByText('Nome atualizado', { exact: true }).waitFor(); await first.getByText('Tag atualizada', { exact: true }).waitFor();
    await first.getByRole('button', { name: /pressione Enter/ }).click(); assert.equal(await page.evaluate(() => window.h.latestCallback), true);
    const action = first.getByRole('button', { name: /^Ver mensagens/ });
    const box = await action.boundingBox(); await page.mouse.move(box.x + 10, box.y + 10); await page.mouse.down();
    await page.mouse.move(box.x + 90, box.y + 50, { steps: 4 }); await page.mouse.up();
    assert.equal(await page.evaluate(() => window.h.dragging), false);
    await action.click(); assert.equal(await page.evaluate(() => window.h.chats), 1);
    await page.evaluate(() => { const lead = window.h.stages[0].leads[0]; window.h.stages[0].leads[0] = { ...lead, assigned_user_id: null, assignee: null }; window.h.render(); });
    const assign = first.getByRole('button', { name: /^Atribuir / }); await assign.waitFor();
    const assignmentBox = await assign.boundingBox(); await page.mouse.move(assignmentBox.x + 5, assignmentBox.y + 5); await page.mouse.down();
    await page.mouse.move(assignmentBox.x + 90, assignmentBox.y + 45, { steps: 4 }); await page.mouse.up();
    assert.equal(await page.evaluate(() => window.h.dragging), false);
    await assign.click(); assert.equal(await page.evaluate(() => window.h.assigned), 1);
    await page.evaluate(() => { window.h.disabled = true; window.h.render(); });
    await first.getByRole('button', { name: /^Abrir detalhes/ }).waitFor(); const surface = await first.boundingBox();
    assert.equal(await first.getByRole('button', { name: /^Abrir detalhes/ }).getAttribute('aria-disabled'), null);
    await page.mouse.move(surface.x + 100, surface.y + 30); await page.mouse.down(); await page.mouse.move(surface.x + 150, surface.y + 120, { steps: 5 }); await page.mouse.up();
    assert.equal(await page.evaluate(() => window.h.dragging), false);
    await page.evaluate(() => { window.h.disabled = false; window.h.mobile = true; window.h.render(); });
    await page.getByRole('button', { name: 'Ver próxima coluna' }).waitFor();
    assert.equal(await page.locator('[data-pipeline-drop-column] article').first().getByRole('button', { name: /^Abrir detalhes/ }).count(), 1);
  } finally { await page.close(); }
});

test('LeadCard without the new optional presentation preserves the legacy Pangea consumer', { timeout: 30_000 }, async () => {
  const page = await openBoard(1280, 720);
  try {
    await page.evaluate(() => window.h.renderLegacy());
    const card = page.locator('[data-rfd-draggable-id]').first(); await card.waitFor();
    const handle = card.getByRole('button', { name: /pressione Enter/ }); await handle.focus();
    await page.keyboard.press('Space'); await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.h.legacyDrop?.reason === 'CANCEL');
    await handle.press('Enter'); assert.equal(await page.evaluate(() => window.h.opened), 1);
    assert.equal(await card.locator('[data-lead-card-part~="name"]').textContent(), 'Lead sintético 0-0 com nome longo');
  } finally { await page.close(); }
});

test('empty target, outside release and permission revoked during drag keep the existing mutation boundary', { timeout: 60_000 }, async () => {
  const page = await openBoard(1280, 720);
  try {
    await page.evaluate(() => { window.h.stages[1].leads = []; window.h.render(); });
    await page.waitForFunction(() => document.querySelectorAll('[data-pipeline-drop-column="stage1"] article').length === 0);
    const from = await page.locator('[data-pipeline-drop-column="stage0"] article').first().boundingBox();
    const target = await page.locator('[data-pipeline-drop-column="stage1"]').boundingBox();
    await drag(page, { x: from.x + 80, y: from.y + 30 }, { x: target.x + target.width / 2, y: target.y + 60 });
    await page.mouse.up(); await page.waitForFunction(() => !window.h.dragging);
    assert.deepEqual(await page.evaluate(() => window.h.drop.destination), { droppableId: 'stage1', index: 0 });
    await drag(page, { x: from.x + 80, y: from.y + 30 }, { x: 100, y: 30 });
    await page.mouse.up(); await page.waitForFunction(() => !window.h.dragging);
    assert.equal(await page.evaluate(() => window.h.drop.destination), null);
    await drag(page, { x: from.x + 80, y: from.y + 30 }, { x: target.x + target.width / 2, y: target.y + 60 });
    await page.evaluate(() => { window.h.disabled = true; window.h.render(); });
    await page.mouse.up(); await page.waitForFunction(() => !window.h.dragging);
    assert.equal(await page.evaluate(() => window.h.drop.destination), null);
    assert.equal(await page.evaluate(() => window.h.opened), 0);
  } finally { await page.close(); }
});

test('one pending move replaces only its elapsed icon and clears without changing real card geometry', { timeout: 30_000 }, async () => {
  const page = await openBoard(1280, 720);
  try {
    const card = page.locator('[data-pipeline-drop-column="stage0"] article').first();
    const before = await card.boundingBox();
    for (const completedBy of ['confirmation', 'rollback']) {
      await page.evaluate(() => { window.h.pendingMoveLeadIds = new Set(['lead0-0']); window.h.render(); });
      const pending = card.locator('[data-lead-move-pending]');
      await pending.waitFor();
      assert.equal(await page.locator('[data-lead-move-pending]').count(), 1, 'other leads do not display this move as pending');
      assert.equal(await pending.getAttribute('aria-label'), 'Salvando movimentação');
      // A rotating square has a larger axis-aligned bounding rect between
      // quarter turns; its layout width/height must stay exactly 12px.
      const icon = await pending.evaluate(node => ({ width: getComputedStyle(node).width, height: getComputedStyle(node).height }));
      const during = await card.boundingBox();
      assert.deepEqual([icon.width, icon.height], ['12px', '12px']);
      assert.deepEqual([during.width, during.height], [before.width, before.height]);
      await page.evaluate(reason => { window.h.pendingMoveLeadIds = new Set(); window.h.pendingClearedBy = reason; window.h.render(); }, completedBy);
      await pending.waitFor({ state: 'detached' });
      const after = await card.boundingBox();
      assert.deepEqual([after.width, after.height], [before.width, before.height]);
      assert.equal(await card.locator('[data-lead-card-part~="elapsed"] svg').count(), 1, 'the original clock returns when the pending entry is released');
    }
  } finally { await page.close(); }
});

test('consultable leads remain precise drop targets without becoming draggable origins', { timeout: 45_000 }, async () => {
  const page = await openBoard(1280, 720);
  try {
    await page.evaluate(() => { window.h.stages[1].leads = window.h.stages[1].leads.map(lead => ({ ...lead, can_operate: false, tags: [] })); window.h.render(); });
    const source = page.locator('[data-pipeline-drop-column="stage0"] article').first();
    const targetRows = page.locator('[data-pipeline-drop-column="stage1"] article');
    await targetRows.first().getByRole('button', { name: /^Abrir detalhes/ }).waitFor();
    for (const index of [0, 1]) {
      const from = await source.boundingBox(); const to = await targetRows.nth(index).boundingBox();
      await drag(page, { x: from.x + 80, y: from.y + 30 }, { x: to.x + 80, y: to.y + 5 });
      await page.mouse.up(); await page.waitForFunction(() => !window.h.dragging);
      assert.deepEqual(await page.evaluate(() => window.h.drop.destination), { droppableId: 'stage1', index });
    }
    const handle = source.getByRole('button', { name: /pressione Enter/ });
    await handle.focus(); await page.keyboard.press('Space'); await page.waitForFunction(() => window.h.dragging);
    await keyboardReady(page);
    await page.waitForFunction(() => window.h.over === 'lead0-0' && document.querySelector('[data-pipeline-drop-column="stage0"] article [aria-pressed="true"]'));
    await page.keyboard.press('ArrowRight'); await page.waitForFunction(() => window.h.over === 'lead1-0');
    await page.waitForFunction(() => {
      const overlay = document.querySelector('[inert]')?.getBoundingClientRect(), target = document.querySelector('[data-pipeline-drop-column="stage1"]')?.getBoundingClientRect();
      return overlay && target && overlay.left >= target.left - 10 && overlay.left < target.right;
    });
    const overlay = await page.locator('[inert]').boundingBox(), target = await page.locator('[data-pipeline-drop-column="stage1"]').boundingBox();
    assert.ok(overlay.x >= target.x - 10 && overlay.x < target.x + target.width, 'keyboard overlay belongs to the selected consultable column');
    await page.keyboard.press('Space'); await page.waitForFunction(() => !window.h.dragging);
    assert.deepEqual(await page.evaluate(() => window.h.drop.destination), { droppableId: 'stage1', index: 0 });
    const readonlyHandle = targetRows.first().getByRole('button', { name: /^Abrir detalhes/ });
    await readonlyHandle.focus(); await page.keyboard.press('Space');
    assert.equal(await page.evaluate(() => window.h.dragging), false);
  } catch (error) { await diagnostic(page, 'CONSULTABLE_TARGET_FAILURE'); throw error; } finally { await page.close(); }
});

for (const [width, height] of [[1280, 720], [1280, 580], [1024, 464]]) test(`compact board preserves font sizes and scroll at effective viewport ${width}x${height}`, async () => {
  const page = await openBoard(width, height);
  try {
    const result = await page.locator('[data-pipeline-drop-column="stage0"]').evaluate(list => ({
      documentOverflow: document.documentElement.scrollWidth > innerWidth,
      listHeight: list.clientHeight, scrollable: list.scrollHeight > list.clientHeight,
      fonts: ['name', 'caption', 'tag', 'source-label'].map(part => getComputedStyle(list.querySelector(`[data-lead-card-part~="${part}"]`)).fontSize),
      headerHeight: list.previousElementSibling.getBoundingClientRect().height,
    }));
    assert.equal(result.documentOverflow, false); assert.ok(result.listHeight > 150); assert.equal(result.scrollable, true);
    assert.deepEqual(result.fonts, ['13px', '12px', '9px', '10px']); assert.ok(result.headerHeight <= 39);
  } finally { await page.close(); }
});

for (const [width, height] of [[360, 640], [390, 844]]) test(`mobile controls stay compact and navigate without opening leads at ${width}x${height}`, async () => {
  const page = await openBoard(width, height);
  try {
    const navigation = page.getByRole('navigation', { name: 'Navegar entre as etapas da Pipeline' });
    await navigation.getByRole('button', { name: 'Ver próxima coluna' }).click();
    await page.waitForFunction(() => window.h.active === 1);
    await page.locator('[data-pipeline-drop-column="stage1"]').waitFor();
    await navigation.getByRole('button', { name: 'Ver coluna anterior' }).click();
    await page.waitForFunction(() => window.h.active === 0);
    await page.locator('[data-pipeline-drop-column="stage0"]').waitFor();
    assert.deepEqual(await page.evaluate(() => [window.h.opened, window.h.chats, window.h.rootClicks, window.h.rootPointers]), [0, 0, 0, 0]);
    const metrics = await page.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="Navegar entre as etapas da Pipeline"]');
      const rect = nav.getBoundingClientRect();
      const size = node => { const box = node.getBoundingClientRect(); return [box.width, box.height]; };
      const borders = node => ['Top', 'Right', 'Bottom', 'Left'].map(side => getComputedStyle(node)[`border${side}Width`]);
      const radii = node => ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map(corner => getComputedStyle(node)[`border${corner}Radius`]);
      const buttons = [...nav.querySelectorAll('button')];
      const surfaces = buttons.map(button => button.firstElementChild);
      const cards = [...document.querySelectorAll('[data-pipeline-drop-column="stage0"] article')];
      const parts = selector => cards.flatMap(card => [...card.querySelectorAll(selector)]);
      const controls = parts('[data-lead-card-part~="owner"], [data-lead-card-part~="quick-action"]');
      const font = selector => getComputedStyle(cards[0].querySelector(selector)).fontSize;
      return { width: innerWidth, height: innerHeight, top: getComputedStyle(nav).top, centerY: rect.y + rect.height / 2,
        pointerEvents: getComputedStyle(nav).pointerEvents, documentOverflow: document.documentElement.scrollWidth > innerWidth,
        buttons: buttons.map(size), surfaces: surfaces.map(size), buttonBorders: buttons.map(borders), surfaceBorders: surfaces.map(borders),
        buttonRadii: buttons.map(radii), surfaceRadii: surfaces.map(radii),
        owners: parts('[data-lead-card-part~="owner"]').map(size), quickActions: parts('[data-lead-card-part~="quick-action"]').map(size), cardHeights: cards.map(card => card.getBoundingClientRect().height),
        controlsContained: controls.every(control => { const box = control.getBoundingClientRect(), card = control.closest('article').getBoundingClientRect(); return box.left >= card.left && box.right <= card.right; }),
        fonts: ['[data-lead-card-part~="name"]', 'p[data-lead-card-part~="caption"]', '[data-lead-card-part~="tag"]', '[data-lead-card-part~="source-label"]', '[data-lead-card-part~="value"]', '[data-lead-card-part~="elapsed"]'].map(font),
      };
    });
    const label = process.env.PIPELINE_BOARD_MEASUREMENT_LABEL || 'current';
    await writeFile(join(artifacts, `${label}-mobile-controls-${width}x${height}.json`), JSON.stringify(metrics, null, 2));
    await page.screenshot({ path: join(artifacts, `${label}-mobile-controls-${width}x${height}.png`) });
    console.info('PIPELINE_MOBILE_CONTROL_METRICS', JSON.stringify(metrics));
    assert.equal(metrics.top, `${height / 2}px`); assert.ok(Math.abs(metrics.centerY - height / 2) < 1);
    assert.equal(metrics.pointerEvents, 'none'); assert.equal(metrics.documentOverflow, false); assert.equal(metrics.controlsContained, true);
    assert.deepEqual(metrics.buttons, [[44, 44], [44, 44]]); assert.deepEqual(metrics.surfaces, [[36, 36], [36, 36]]);
    assert.deepEqual(metrics.fonts, ['13px', '12px', '9px', '10px', '10px', '10px']);
    assert.deepEqual({ buttonBorders: metrics.buttonBorders, surfaceBorders: metrics.surfaceBorders,
      buttonRadii: metrics.buttonRadii, surfaceRadii: metrics.surfaceRadii, owners: metrics.owners, quickActions: metrics.quickActions }, {
      buttonBorders: Array.from({ length: 2 }, () => Array(4).fill('0px')), surfaceBorders: Array.from({ length: 2 }, () => Array(4).fill('0px')),
      buttonRadii: Array.from({ length: 2 }, () => Array(4).fill('6px')), surfaceRadii: Array.from({ length: 2 }, () => Array(4).fill('6px')),
      owners: Array.from({ length: 6 }, () => [32, 32]), quickActions: Array.from({ length: 18 }, () => [32, 32]),
    });
  } finally { await page.close(); }
});

test('desktop controls retain 28px owner and quick actions without mobile navigation', async () => {
  const page = await openBoard(1280, 720);
  try {
    assert.equal(await page.getByRole('navigation', { name: 'Navegar entre as etapas da Pipeline' }).count(), 0);
    const sizes = await page.locator('[data-pipeline-drop-column="stage0"] article').first()
      .locator('[data-lead-card-part~="owner"], [data-lead-card-part~="quick-action"]').evaluateAll(elements => elements.map(element => {
        const rect = element.getBoundingClientRect(); return [rect.width, rect.height];
      }));
    assert.deepEqual(sizes, [[28, 28], [28, 28], [28, 28], [28, 28]]);
  } finally { await page.close(); }
});

