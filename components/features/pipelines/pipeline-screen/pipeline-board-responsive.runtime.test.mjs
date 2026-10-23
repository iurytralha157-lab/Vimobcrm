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
const artifacts = resolve(process.env.PIPELINE_VISUAL_ARTIFACT_DIR || join(tmpdir(), 'vimob-pipeline-responsive-artifacts'));
let directory, browser, bundle, css;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vimob-pipeline-responsive-'));
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
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;`);
  await writeFile(cssLoader, `const{transform}=require(${JSON.stringify(require.resolve('lightningcss'))});module.exports=function(s){const out=transform({filename:this.resourcePath,code:Buffer.from(s),cssModules:true});return'export default '+JSON.stringify(Object.fromEntries(Object.entries(out.exports).map(([key,value])=>[key,value.name])))+';'};`);
  await writeFile(entry, `import React from'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{PipelineBoard}from${JSON.stringify(join(repository, 'components/features/pipelines/pipeline-screen/PipelineBoard.tsx'))};import{Dialog,DialogContent,DialogTitle,DialogDescription}from'@/components/ui/dialog';import{Drawer,DrawerContent,DrawerTitle,DrawerDescription}from'@/components/ui/drawer';
    const h=window.h={opened:0,chats:0,active:0,sidebar:216,dragging:false,mobile:innerWidth<768,overlay:null,critical:false,transition:false,single:false,rootClicks:0,rootPointers:0};
    h.stages=Array.from({length:5},(_,stage)=>({id:'stage'+stage,name:'Etapa sintética '+stage+' com nome longo',color:'#ff4529',is_qualified:stage===2,total_lead_count:6,total_value:3600000,leads:Array.from({length:6},(_,index)=>({id:'lead'+stage+'-'+index,stage_id:'stage'+stage,name:'Lead sintético '+stage+'-'+index+' com nome longo',phone:'5511999999999',email:'lead@example.invalid',can_operate:true,organization_id:'synthetic-org',assigned_user_id:'synthetic-user',assignee:{name:'Corretor'},created_at:'2026-10-01T12:00:00Z',stage_entered_at:'2026-10-01T12:00:00Z',source:'meta',lead_meta:[{platform:'meta',campaign_name:'Campanha sintética com nome bastante longo'}],tags:[{name:'Prioridade '.repeat(12),color:'#ff4529'}],valor_interesse:600000}))}));
    const sourceVariants=[{}, {source:'whatsapp'}, {source:'google',lead_meta:[{platform:'google',campaign_name:'Campanha sintética Google'}]}, {source:'site',lead_meta:[],interest_property:{code:'TESTE-123',title:'Imóvel sintético'}}, {source:'manual',lead_meta:[]}, {source:'indicacao',lead_meta:[]}];
    h.stages.forEach(stage=>stage.leads.forEach((lead,index)=>Object.assign(lead,sourceVariants[index])));
    const noop=()=>{};const root=createRoot(document.getElementById('root'));const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity},mutations:{retry:false}}});const renderWithQueries=element=>root.render(React.createElement(QueryClientProvider,{client},element));
    h.shell=()=>React.createElement('div',{className:'app-shell',style:{height:'100vh',display:'flex',overflow:'hidden'}},!h.mobile&&React.createElement('aside',{style:{width:h.sidebar,flexShrink:0}},'Sidebar'),React.createElement('main',{onClick:()=>{h.rootClicks++},onPointerDown:()=>{h.rootPointers++},style:{flex:1,minWidth:0,minHeight:0,display:'flex',flexDirection:'column',padding:h.mobile?'64px 20px 65px':'76px 24px 12px'}},React.createElement('div',{style:{height:52,flexShrink:0}},'Pipeline'),React.createElement(PipelineBoard,{
      stages:h.stages,filteredStages:h.single?h.stages.slice(0,1):h.stages,visibleStages:h.mobile?[h.stages[h.active]]:h.stages,stageValueMap:new Map(h.stages.map(s=>[s.id,{totalValue:s.total_value}])),stageCountMetaMap:new Map(h.stages.map(s=>[s.id,{total:6,remaining:0,canLoadMore:false}])),selectedPipelineId:'pipeline',isMobile:h.mobile,isLoading:false,isInitialLeadsLoading:false,isPipelineBoardTransitioning:h.transition,leadsPlaceholderData:false,hasCriticalLoadError:h.critical,hasPipelineBoardError:false,isRefreshing:false,pipelinesFetching:false,leadVisibilityFetching:false,hasPreviousMobileStage:h.active>0,hasNextMobileStage:h.active<4,canEditPipeline:true,hasWhatsAppModule:true,canViewWhatsApp:true,canOperateWhatsApp:true,canShowColumnActions:!h.mobile,isDragDisabled:false,nowMs:Date.parse('2026-10-12T12:00:00Z'),editingStageId:null,editingStageName:'',savingStageNameId:null,loadMoreIsPending:false,onDragStart:()=>{h.dragging=true},onDragEnd:result=>{h.dragging=false;h.drop=result},onCriticalLoadRetry:noop,onBoardRefresh:noop,onMobileStageNavigation:direction=>{h.active+=direction==='next'?1:-1;h.render()},onEditingStageNameChange:noop,onStartEditingStage:noop,onCommitStageName:noop,onCancelEditingStage:noop,onOpenStageSettings:(stage,tab)=>{h.settingsRequests=(h.settingsRequests||[]).concat({stageId:stage.id,tab})},onOpenLead:()=>{h.opened++},onAssignLeadNow:noop,onLoadMore:noop,onCreateStage:noop,onCreatePipeline:noop
    })));
    h.render=()=>renderWithQueries(React.createElement(React.Fragment,null,h.shell(),h.overlay==='dialog'?React.createElement(Dialog,{open:true,onOpenChange:noop},React.createElement(DialogContent,null,React.createElement(DialogTitle,null,'Popup sintético'),React.createElement(DialogDescription,null,'Teste da camada real Radix'))):h.overlay==='drawer'?React.createElement(Drawer,{open:true,onOpenChange:noop,shouldScaleBackground:false},React.createElement(DrawerContent,{showHandle:false,style:{height:'80dvh'}},React.createElement(DrawerTitle,null,'Drawer sintético'),React.createElement(DrawerDescription,null,'Teste da camada real Vaul'))):null));h.render();`);

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
    assert.ok(dirname(resolve(directory)) === resolve(tmpdir()) && basename(directory).startsWith('vimob-pipeline-responsive-'));
    await rm(directory, { recursive: true, force: true });
  }
});

async function openBoard(width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.route('**/*', route => route.abort());
  await page.setContent('<html><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle });
  await page.locator('[data-tour="pipeline-column"]').waitFor();
  await page.waitForFunction(() => document.querySelector('[data-tour="pipeline-column"]').parentElement.parentElement.parentElement.style.getPropertyValue('--pipeline-column-width') !== '288px');
  return page;
}

for (const [width, height] of [[1280, 720], [1366, 768], [1440, 900], [1280, 580]]) {
  test(`real pipeline fits ${width}x${height}, preserves fonts and contains long metadata`, async () => {
    const page = await openBoard(width, height);
    try {
      const geometry = await page.locator('[data-tour="pipeline-column"]').evaluate(column => {
        const columns = [...column.parentElement.children].slice(0, 4).map(element => element.getBoundingClientRect());
        const viewport = column.parentElement.parentElement.getBoundingClientRect();
        const cards = [...column.querySelectorAll('article')];
        const list = cards[0].parentElement;
        const headers = [...column.parentElement.children].slice(0, 5).map(element => element.firstElementChild);
        return {
          documentOverflow: document.documentElement.scrollWidth > innerWidth,
          widths: columns.map(rect => rect.width),
          fourthRight: columns[3].right,
          viewportRight: viewport.right,
          nameFontSize: parseFloat(getComputedStyle(cards[0].querySelector('[data-lead-card-part~="name"]')).fontSize),
          cardPaddingTop: parseFloat(getComputedStyle(cards[0]).paddingTop),
          cardPaddingBottom: parseFloat(getComputedStyle(cards[0]).paddingBottom),
          cardPaddingRight: parseFloat(getComputedStyle(cards[0]).paddingRight),
          cardGap: parseFloat(getComputedStyle(list).rowGap),
          dividerMargins: ['marginTop', 'marginBottom'].map(property => getComputedStyle(cards[0].querySelector('[data-lead-card-part~="divider"]'))[property]),
          phoneFontSize: parseFloat(getComputedStyle(cards[0].querySelector('p[data-lead-card-part~="caption"]')).fontSize),
          sourceFontSizes: cards.map(card => parseFloat(getComputedStyle(card.querySelector('[data-lead-card-part~="source-label"]')).fontSize)),
          elapsedFontSize: parseFloat(getComputedStyle(cards[0].querySelector('[data-lead-card-part~="elapsed"]')).fontSize),
          fieldFontSizes: Object.fromEntries([
            ['name', '[data-lead-card-part~="name"]'], ['phone', 'p[data-lead-card-part~="caption"]'],
            ['source', '[data-lead-card-part~="source-label"]'], ['value', '[data-lead-card-part~="value"]'],
            ['tag', '[data-lead-card-part~="tag"]'], ['elapsed', '[data-lead-card-part~="elapsed"]'],
          ].map(([part, selector]) => [part, parseFloat(getComputedStyle(cards[0].querySelector(selector)).fontSize)])),
          tagFontSizes: cards[0] ? [...cards[0].querySelectorAll('[data-lead-card-part~="tag"]')].map(element => parseFloat(getComputedStyle(element).fontSize)) : [],
          tagCountFontSizes: cards[0] ? [...cards[0].querySelectorAll('[data-lead-card-part~="tag-count"]')].map(element => parseFloat(getComputedStyle(element).fontSize)) : [],
          tagFontWeights: [...cards[0].querySelectorAll('[data-lead-card-part~="tag"]')].map(element => getComputedStyle(element).fontWeight),
          tagContained: cards.every(card => [...card.querySelectorAll('[data-lead-card-part~="tag"]')].every(tag => tag.getBoundingClientRect().right <= card.getBoundingClientRect().right)),
          scrollbar: getComputedStyle(list).scrollbarWidth,
          scrollbarGutter: getComputedStyle(list).scrollbarGutter,
          scrollable: list.scrollHeight > list.clientHeight,
          headerHeights: [...column.parentElement.children].slice(0, 5).map(element => element.firstElementChild.getBoundingClientRect().height),
          headersContainMoney: headers.some(header => /R\$/.test(header.textContent)),
          headerFontSizes: headers.map(header => [...header.querySelectorAll('[aria-label^="Renomear coluna"], [data-pipeline-part="stage-count"]')].map(element => getComputedStyle(element).fontSize)),
          headersAligned: headers.every(header => {
            const centers = [...header.querySelectorAll('[data-pipeline-part="stage-count"], [aria-label^="Renomear coluna"], [aria-label^="Configurar coluna"], [aria-label="Etapa de lead qualificado"]')].map(element => { const rect = element.getBoundingClientRect(); return rect.y + rect.height / 2; });
            const rect = header.getBoundingClientRect();
            return centers.length >= 3 && Math.max(...centers) - Math.min(...centers) < 1 && centers.every(center => Math.abs(center - (rect.y + rect.height / 2)) < 1);
          }),
          cardContainsMoney: /R\$/.test(cards[0].textContent),
        };
      });
      assert.equal(geometry.documentOverflow, false);
      assert.ok(geometry.widths.every(value => value >= 240 && value <= 288));
      assert.ok(geometry.fourthRight <= geometry.viewportRight + 1);
      assert.equal(geometry.nameFontSize, 13);
      assert.equal(geometry.cardPaddingRight - geometry.cardPaddingTop, 2);
      assert.equal(geometry.cardPaddingTop, geometry.cardPaddingBottom);
      assert.ok([4, 6].includes(geometry.cardGap));
      assert.deepEqual(geometry.dividerMargins, ['4px', '4px']);
      assert.equal(geometry.phoneFontSize, 12);
      assert.deepEqual(geometry.sourceFontSizes, [10, 10, 10, 10, 10, 10]);
      assert.equal(geometry.elapsedFontSize, 10);
      assert.deepEqual(geometry.fieldFontSizes, { name: 13, phone: 12, source: 10, value: 10, tag: 9, elapsed: 10 });
      assert.ok(geometry.tagFontSizes.length > 0);
      assert.ok(geometry.tagFontSizes.every(value => value === 9));
      assert.ok(geometry.tagCountFontSizes.every(value => value === 10));
      assert.deepEqual(geometry.tagFontWeights, ['300']);
      assert.equal(geometry.tagContained, true);
      assert.equal(geometry.scrollbar, 'none');
      assert.equal(geometry.scrollbarGutter, 'auto');
      assert.equal(geometry.scrollable, true);
      const leadList = page.locator('[data-tour="pipeline-column"] article').first().locator('..');
      await leadList.hover();
      await page.mouse.wheel(0, 160);
      await page.waitForFunction(() => document.querySelector('[data-tour="pipeline-column"] article').parentElement.scrollTop > 0);
      await leadList.evaluate(element => { element.scrollTop = 0; });
      assert.ok(Math.max(...geometry.headerHeights) - Math.min(...geometry.headerHeights) < 1);
      assert.ok(geometry.headerHeights.every(height => height <= 39));
      assert.equal(geometry.headersContainMoney, false);
      assert.deepEqual(geometry.headerFontSizes, Array.from({ length: 5 }, () => ['12px', '12px']));
      assert.equal(geometry.headersAligned, true);
      assert.equal(geometry.cardContainsMoney, true);
      const qualified = page.getByLabel('Etapa de lead qualificado', { exact: true });
      await qualified.focus();
      await page.getByRole('tooltip').getByText('Etapa qualificada desta pipeline', { exact: true }).waitFor();
      await qualified.press('Escape');
      const owner = page.locator('[data-lead-card-part~="owner"]').first();
      await owner.focus();
      const ownerTooltip = page.locator('[data-lead-card-part~="owner-tooltip"]');
      await ownerTooltip.waitFor({ state: 'visible' });
      assert.deepEqual(await ownerTooltip.evaluate(element => [getComputedStyle(element).fontSize, getComputedStyle(element).fontWeight]), ['12px', '300']);
      await owner.press('Escape');
      await page.screenshot({ path: join(artifacts, `pipeline-${width}x${height}.png`) });
      await page.getByRole('button', { name: /^lead.*pressione Enter/i }).first().press('Enter');
      assert.equal(await page.evaluate(() => window.h.opened), 1);
    } finally { await page.close(); }
  });
}

for (const [width, height] of [[1280, 720], [390, 844]]) {
  test(`column menu chooses the destination without opening settings early at ${width}x${height}`, async () => {
    const page = width < 768 ? await openMobileBoard(width, height) : await openBoard(width, height);
    try {
      const trigger = page.getByRole('button', { name: /^Configurar coluna/ }).first();
      await trigger.click();
      const menu = page.getByRole('menu');
      await menu.waitFor();
      assert.deepEqual(await menu.getByRole('menuitem').allTextContents(), ['Configurações da coluna', 'Regras da etapa', 'Automações']);
      assert.equal(await page.evaluate(() => (window.h.settingsRequests || []).length), 0);
      const bounds = await menu.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
      if (width < 768) assert.ok((await menu.getByRole('menuitem').first().boundingBox()).height >= 44);
      await page.keyboard.press('Escape');
      await menu.waitFor({ state: 'hidden' });
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label')?.startsWith('Configurar coluna'));
      await trigger.press('ArrowDown');
      await menu.waitFor();
      await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'menuitem');
      await page.keyboard.press('End');
      await page.waitForFunction(() => document.activeElement?.textContent === 'Automações');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => window.h.settingsRequests?.length === 1);
      for (const label of ['Configurações da coluna', 'Regras da etapa']) {
        await trigger.click();
        await menu.getByRole('menuitem', { name: label, exact: true }).click();
        await menu.waitFor({ state: 'hidden' });
      }
      assert.deepEqual(await page.evaluate(() => window.h.settingsRequests), [
        { stageId: 'stage0', tab: 'automations' },
        { stageId: 'stage0', tab: 'general' },
        { stageId: 'stage0', tab: 'cadence' },
      ]);
      assert.equal(await page.evaluate(() => window.h.opened), 0);
      assert.notEqual(await page.evaluate(() => getComputedStyle(document.body).pointerEvents), 'none');
    } finally { await page.close(); }
  });
}

test('real drag keeps viewport positioning and freezes resizing until it finishes', async () => {
  const page = await openBoard(1280, 720);
  try {
    const card = page.locator('[data-pipeline-drop-column="stage0"] article').first();
    const handle = card.getByRole('button', { name: /^lead.*pressione Enter/i });
    const before = await card.boundingBox();
    const column = page.locator('[data-tour="pipeline-column"]');
    const widthBefore = (await column.boundingBox()).width;
    await handle.focus();
    await handle.press('Space');
    await page.waitForFunction(() => window.h.dragging);
    const during = await page.locator('[inert] article').boundingBox();
    assert.ok(Math.abs((during.x + during.width / 2) - (before.x + before.width / 2)) < 5);
    assert.ok(Math.abs((during.y + during.height / 2) - (before.y + before.height / 2)) < 5);
    await page.evaluate(() => { window.h.sidebar = 64; window.h.render(); });
    await page.waitForTimeout(100);
    assert.equal((await column.boundingBox()).width, widthBefore);
    await handle.press('Escape');
    await page.waitForFunction(() => !window.h.dragging);
    await page.waitForFunction(previous => document.querySelector('[data-tour="pipeline-column"]').getBoundingClientRect().width > previous, widthBefore);
    assert.equal(await page.evaluate(() => window.h.opened), 0);
  } finally { await page.close(); }
});

async function openMobileBoard(width, height) {
  const page = await browser.newPage({ viewport: { width, height }, hasTouch: true });
  await page.route('**/*', route => route.abort());
  await page.setContent('<html><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle });
  await page.locator('[data-tour="pipeline-column"]').waitFor();
  return page;
}

for (const [width, height] of [[390, 844], [320, 568]]) {
test(`mobile slides stay centered at ${width}x${height}, protect card input and preserve endpoints`, async () => {
  const page = await openMobileBoard(width, height);
  try {
    const column = page.locator('[data-tour="pipeline-column"]');
    assert.equal(await column.evaluate(element => element.parentElement.children.length), 1);
    assert.doesNotMatch(await column.locator('[data-pipeline-part="column-header"]').innerText(), /R\$/);
    const headerGeometry = await column.locator('[data-pipeline-part="column-header"]').evaluate(header => {
      const rect = header.getBoundingClientRect();
      return { height: rect.height, centered: [...header.querySelectorAll('[aria-label^="Renomear coluna"], [data-pipeline-part="stage-count"], [aria-label^="Configurar coluna"]')].every(element => { const item = element.getBoundingClientRect(); return Math.abs(item.y + item.height / 2 - (rect.y + rect.height / 2)) < 1; }) };
    });
    assert.equal(headerGeometry.height, 51);
    assert.equal(headerGeometry.centered, true);
    assert.equal(await column.locator('article').first().locator('..').evaluate(element => getComputedStyle(element).scrollbarWidth), 'none');
    assert.deepEqual(await column.locator('[aria-label^="Renomear coluna"], [data-pipeline-part="stage-count"]').evaluateAll(elements => elements.map(element => getComputedStyle(element).fontSize)), ['12px', '12px']);
    assert.equal(await column.locator('[data-lead-card-part~="name"]').first().evaluate(element => getComputedStyle(element).fontSize), '13px');
    assert.deepEqual(await column.locator('article').first().evaluate(element => [getComputedStyle(element).paddingTop, getComputedStyle(element).paddingRight, getComputedStyle(element.parentElement).rowGap]), ['10px', '12px', '6px']);
    assert.equal(await column.locator('[data-lead-card-part~="quick-action"]').first().evaluate(element => element.getBoundingClientRect().height), 32);
    assert.deepEqual(await column.locator('[data-lead-card-part~="tag"]').first().evaluate(element => [getComputedStyle(element).fontSize, getComputedStyle(element).fontWeight]), ['9px', '300']);
    assert.equal(await column.locator('p[data-lead-card-part~="caption"]').first().evaluate(element => getComputedStyle(element).fontSize), '12px');
    assert.deepEqual(await column.locator('[data-lead-card-part~="source-label"]').evaluateAll(elements => elements.map(element => getComputedStyle(element).fontSize)), ['10px', '10px', '10px', '10px', '10px', '10px']);
    const next = page.getByRole('button', { name: 'Ver próxima coluna' });
    const previous = page.getByRole('button', { name: 'Ver coluna anterior' });
    assert.equal(await previous.isDisabled(), true);
    const nextBox = await next.boundingBox();
    const previousBox = await previous.boundingBox();
    const surfaceBox = await next.locator('span').boundingBox();
    for (const box of [nextBox, previousBox]) {
      assert.ok(box.width >= 44 && box.height >= 44);
      assert.ok(box.width < 56 && box.height < 56);
      assert.ok(Math.abs(box.y + box.height / 2 - height / 2) <= 1);
      assert.ok(box.x >= 0 && box.x + box.width <= width);
    }
    assert.ok(previousBox.x <= 16);
    assert.ok(width - nextBox.x - nextBox.width <= 16);
    assert.ok(surfaceBox.width < nextBox.width && surfaceBox.height < nextBox.height);
    assert.ok(surfaceBox.width <= 40 && surfaceBox.height <= 40);
    assert.equal(await column.evaluate(element => element.contains(document.querySelector('button[aria-label="Ver próxima coluna"]'))), false);
    for (const action of await page.locator('article').first().locator('[data-lead-card-part="quick-action"]').all()) {
      const box = await action.boundingBox();
      assert.deepEqual([box.width, box.height], [32, 32]);
    }

    // Exercise the transparent part of the larger touch target while a real
    // card is underneath it. Only navigation should receive this touch.
    const hasCardUnderTarget = await next.evaluate(button => {
      const rect = button.getBoundingClientRect();
      const original = button.style.pointerEvents;
      button.style.pointerEvents = 'none';
      const underneath = document.elementFromPoint(rect.left + 2, rect.top + rect.height / 2);
      button.style.pointerEvents = original;
      return Boolean(underneath?.closest('article'));
    });
    assert.equal(hasCardUnderTarget, true);
    await page.touchscreen.tap(previousBox.x + previousBox.width - 2, previousBox.y + previousBox.height / 2);
    assert.equal(await page.evaluate(() => window.h.active), 0);
    assert.equal(await page.evaluate(() => window.h.opened), 0);
    await page.evaluate(() => { window.h.rootClicks = 0; window.h.rootPointers = 0; });
    await page.touchscreen.tap(nextBox.x + 2, nextBox.y + nextBox.height / 2);
    await page.waitForFunction(() => window.h.active === 1);
    assert.equal(await page.evaluate(() => window.h.active), 1);
    assert.equal(await page.evaluate(() => window.h.opened), 0);
    assert.equal(await page.evaluate(() => window.h.chats), 0);
    assert.equal(await page.evaluate(() => window.h.rootClicks), 0);
    assert.equal(await page.evaluate(() => window.h.rootPointers), 0);
    assert.equal(await previous.isDisabled(), false);
    await page.screenshot({ path: join(artifacts, `pipeline-mobile-slides-${width}x${height}.png`) });

    const list = column.locator('article').first().locator('..');
    await list.evaluate(element => { element.scrollTop = 190; });
    assert.ok(await list.evaluate(element => element.scrollTop) > 0);
    const afterScroll = await next.boundingBox();
    assert.ok(Math.abs(afterScroll.y - nextBox.y) <= 1);

    await page.evaluate(() => { window.h.active = 4; window.h.render(); });
    await page.waitForFunction(() => document.querySelector('button[aria-label="Ver próxima coluna"]').disabled);
    const disabledNextBox = await next.boundingBox();
    await page.touchscreen.tap(disabledNextBox.x + 2, disabledNextBox.y + disabledNextBox.height / 2);
    assert.equal(await page.evaluate(() => window.h.active), 4);
    assert.equal(await page.evaluate(() => window.h.opened), 0);

    for (const state of ['critical', 'transition', 'single']) {
      await page.evaluate(state => { window.h.active = 0; window.h[state] = true; window.h.render(); }, state);
      await page.getByRole('navigation', { name: 'Navegar entre as etapas da Pipeline' }).waitFor({ state: 'detached' });
      await page.evaluate(state => { window.h[state] = false; window.h.render(); }, state);
      await page.getByRole('navigation', { name: 'Navegar entre as etapas da Pipeline' }).waitFor();
    }
  } finally { await page.close(); }
});
}

test('mobile slides remain below real Radix and Vaul popup layers', async () => {
  const page = await openMobileBoard(390, 844);
  try {
    for (const overlay of ['dialog', 'drawer']) {
      await page.evaluate(overlay => { window.h.active = 1; window.h.overlay = overlay; window.h.render(); }, overlay);
      await page.getByRole('dialog').waitFor();
      const next = page.locator('button[aria-label="Ver próxima coluna"]');
      const box = await next.boundingBox();
      const layering = await next.evaluate(button => {
        const rect = button.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return {
          arrowIsOnTop: Boolean(hit?.closest('button[aria-label="Ver próxima coluna"]')),
          arrowLevel: Number(getComputedStyle(button.parentElement).zIndex),
          popupLevel: Number(getComputedStyle(document.querySelector('[role="dialog"]')).zIndex),
        };
      });
      assert.equal(layering.arrowIsOnTop, false);
      assert.ok(layering.popupLevel > layering.arrowLevel);
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      assert.equal(await page.evaluate(() => window.h.active), 1);
      assert.equal(await page.evaluate(() => window.h.opened), 0);
      await page.evaluate(() => { window.h.overlay = null; window.h.render(); });
      await page.getByRole('dialog').waitFor({ state: 'detached' });
    }
  } finally { await page.close(); }
});
